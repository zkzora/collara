#!/usr/bin/env node
// Local OIDC provider: Keycloak 26.7.5 (distribution zip, Java 21) with the `collara` realm.
//
//   node scripts/infra/keycloak.mjs install   download + verify the zip into .local/keycloak
//   node scripts/infra/keycloak.mjs start     start-dev on 127.0.0.1:18080 (management 19000), import the realm
//   node scripts/infra/keycloak.mjs status    exit 0 when /health/ready is UP and discovery answers
//   node scripts/infra/keycloak.mjs check     discovery, PKCE enforcement and a code-flow login per demo user
//   node scripts/infra/keycloak.mjs stop
//   node scripts/infra/keycloak.mjs reset     stop and delete the dev database so the next start re-imports the realm
//
// Needs COLLARA_OIDC_CLIENT_SECRET and KC_BOOTSTRAP_ADMIN_PASSWORD (shell or .env); the admin user
// name defaults to "admin". Everything here is dev-only: start-dev, an H2 file database, plain HTTP.
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DOWNLOADS_DIR,
  IS_WINDOWS,
  LOCAL_DIR,
  REPO_ROOT,
  env,
  extractZip,
  fail,
  fetchVerified,
  httpRequest,
  loadDotEnv,
  parseCommand,
  readJson,
  requireEnv,
  runningService,
  spawnDetached,
  stopService,
  tailFile,
  tcpOpen,
  waitFor,
  writeJson,
} from "./lib.mjs";

const VERSION = "26.7.5";
// GitHub release asset digest of keycloak-26.7.5.zip (upstream .sha1: 4aaddef6c5a3f29d51b7d46ad0ac70086e6f3210).
const ARCHIVE = {
  url: `https://github.com/keycloak/keycloak/releases/download/${VERSION}/keycloak-${VERSION}.zip`,
  sha256: "30ef87fb7101c43d29688d1ae80c0588ff4a151b3330e9f664bf9692d398658a",
};
const ROOT = join(LOCAL_DIR, "keycloak");
const HOME = join(ROOT, `keycloak-${VERSION}`);
const FILES = {
  installed: join(ROOT, "installed.json"),
  imported: join(ROOT, "imported.json"),
  pid: join(ROOT, "keycloak.pid.json"),
  log: join(ROOT, "keycloak.log"),
  devDatabase: join(HOME, "data", "h2"),
  realmImport: join(HOME, "data", "import", "collara-realm.json"),
};
const REALM_SOURCE = join(REPO_ROOT, "infra", "keycloak", "collara-realm.json");
const SECRET_PLACEHOLDER = "${COLLARA_OIDC_CLIENT_SECRET}";
const HTTP_PORT = 18080;
const MANAGEMENT_PORT = 19000;
const PROCESS_MARKER = IS_WINDOWS ? "kc.bat" : "kc.sh";
const STOP_OPTIONS = { ports: [HTTP_PORT, MANAGEMENT_PORT] };

loadDotEnv();
const issuer = () => env("COLLARA_OIDC_ISSUER", `http://localhost:${HTTP_PORT}/realms/collara`);
const clientId = () => env("COLLARA_OIDC_CLIENT_ID", "collara-web");
const redirectUri = () => env("COLLARA_OIDC_REDIRECT_URI", "http://localhost:3000/api/auth/callback");

async function install() {
  if (readJson(FILES.installed)?.version === VERSION && existsSync(join(HOME, "bin", PROCESS_MARKER))) {
    console.log(`Keycloak ${VERSION} already installed: ${HOME}`);
    return;
  }
  const zip = await fetchVerified({ ...ARCHIVE, dest: join(DOWNLOADS_DIR, `keycloak-${VERSION}.zip`) });
  const staging = join(ROOT, ".extract");
  rmSync(staging, { recursive: true, force: true });
  extractZip(zip, staging);
  rmSync(HOME, { recursive: true, force: true });
  renameSync(join(staging, `keycloak-${VERSION}`), HOME);
  rmSync(staging, { recursive: true, force: true });
  rmSync(zip, { force: true });
  writeJson(FILES.installed, { version: VERSION, archiveSha256: ARCHIVE.sha256 });
  console.log(`installed Keycloak ${VERSION}: ${HOME}`);
}

/** Copies the realm into data/import with the client secret substituted (JSON-escaped). */
function renderRealm(secret) {
  const source = readFileSync(REALM_SOURCE, "utf8");
  if (!source.includes(SECRET_PLACEHOLDER)) fail(`${REALM_SOURCE} has no ${SECRET_PLACEHOLDER} placeholder`);
  const rendered = source.replaceAll(SECRET_PLACEHOLDER, JSON.stringify(secret).slice(1, -1));
  JSON.parse(rendered);
  mkdirSync(dirname(FILES.realmImport), { recursive: true });
  writeFileSync(FILES.realmImport, rendered);
  return createHash("sha256").update(rendered).digest("hex");
}

async function discovery() {
  const response = await httpRequest(`${issuer()}/.well-known/openid-configuration`);
  if (response?.status !== 200) return null;
  try {
    return JSON.parse(response.text);
  } catch {
    return null;
  }
}

async function start() {
  const secrets = requireEnv(["COLLARA_OIDC_CLIENT_SECRET", "KC_BOOTSTRAP_ADMIN_PASSWORD"]);
  const running = runningService(FILES.pid, PROCESS_MARKER);
  if (running) {
    console.log(`Keycloak is already running (pid ${running.pid}); issuer ${issuer()}`);
    return;
  }
  for (const port of [HTTP_PORT, MANAGEMENT_PORT]) {
    if (await tcpOpen("127.0.0.1", port)) fail(`port ${port} is already in use by another process`);
  }
  // kc.bat/kc.sh use JAVA_HOME when it is set, otherwise java from PATH.
  const java = env("JAVA_HOME") ? join(env("JAVA_HOME"), "bin", "java") : "java";
  if (spawnSync(java, ["-version"], { stdio: "ignore" }).status !== 0) {
    fail("Java was not found (JAVA_HOME or PATH). Keycloak 26.7 needs Java 21 (17 and 25 are also supported).");
  }
  await install();

  const realmHash = renderRealm(secrets.COLLARA_OIDC_CLIENT_SECRET);
  // --import-realm skips a realm that already exists in the dev database.
  if (existsSync(FILES.devDatabase)) {
    if (readJson(FILES.imported)?.realmSha256 !== realmHash) {
      console.warn(
        "warning: the realm was imported earlier from a different realm file or client secret. Keycloak keeps the " +
          "imported version; run `node scripts/infra/keycloak.mjs reset` to re-import it.",
      );
    }
  } else {
    writeJson(FILES.imported, { realmSha256: realmHash, importedAt: new Date().toISOString() });
  }

  const kcArgs = [
    "start-dev",
    "--http-host=127.0.0.1",
    `--http-port=${HTTP_PORT}`,
    `--http-management-port=${MANAGEMENT_PORT}`,
    "--health-enabled=true",
    "--import-realm",
  ];
  const childEnv = {
    ...process.env,
    KC_BOOTSTRAP_ADMIN_USERNAME: env("KC_BOOTSTRAP_ADMIN_USERNAME", "admin"),
    KC_BOOTSTRAP_ADMIN_PASSWORD: secrets.KC_BOOTSTRAP_ADMIN_PASSWORD,
    // kc.bat/kc.sh read the heap from JAVA_OPTS_KC_HEAP and keep their other JVM defaults.
    JAVA_OPTS_KC_HEAP: env("JAVA_OPTS_KC_HEAP", "-Xms64m -Xmx512m"),
  };
  const bin = join(HOME, "bin", PROCESS_MARKER);
  const child = IS_WINDOWS
    ? // cmd /s /c strips the outer quotes; the inner ones keep the kc.bat path intact.
      // kc.bat pipes into findstr, which hangs without a console, hence hiddenConsole.
      spawnDetached("cmd.exe", ["/d", "/s", "/c", `""${bin}" ${kcArgs.join(" ")}"`], {
        logFile: FILES.log,
        env: childEnv,
        cwd: HOME,
        verbatim: true,
        hiddenConsole: true,
      })
    : spawnDetached(bin, kcArgs, { logFile: FILES.log, env: childEnv, cwd: HOME });
  writeJson(FILES.pid, { pid: child.pid, startedAt: new Date().toISOString(), version: VERSION, args: kcArgs });
  console.log(`Keycloak starting (pid ${child.pid}); about 1 minute, several minutes the first time (build step)`);

  const ready = await waitFor(discovery, { timeoutMs: 420_000, intervalMs: 2000, abort: child.exited });
  if (!ready) {
    await stopService(FILES.pid, PROCESS_MARKER, "Keycloak", STOP_OPTIONS);
    fail(`Keycloak did not become ready (exit code ${child.exitCode() ?? "n/a"}). Last log lines:\n${tailFile(FILES.log)}`);
  }
  console.log(`Keycloak ${VERSION} running (pid ${child.pid})`);
  console.log(`  issuer        ${ready.issuer}`);
  console.log(`  admin console http://localhost:${HTTP_PORT}/admin/  (user ${childEnv.KC_BOOTSTRAP_ADMIN_USERNAME}, password from KC_BOOTSTRAP_ADMIN_PASSWORD)`);
  console.log(`  log           ${FILES.log}`);
}

async function status() {
  const running = runningService(FILES.pid, PROCESS_MARKER);
  const health = await httpRequest(`http://127.0.0.1:${MANAGEMENT_PORT}/health/ready`);
  const meta = await discovery();
  console.log(`process    ${running ? `running (pid ${running.pid}, since ${running.startedAt})` : "not running"}`);
  console.log(`health     ${health ? `HTTP ${health.status} ${health.text.includes('"UP"') ? "UP" : "not ready"}` : "not reachable"}`);
  console.log(`discovery  ${meta ? `ok (issuer ${meta.issuer})` : "not available"}`);
  if (!running || !meta) process.exitCode = 1;
}

/** Cookie header from a response's Set-Cookie headers. */
const cookiesFrom = (headers) =>
  headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");

const decodeHtml = (value) => value.replaceAll("&amp;", "&").replaceAll("&#61;", "=").replaceAll("&quot;", '"');

/** Browser-style login: authorization request with PKCE, submit the login form, return the code. */
async function authorize(meta, { username, password }, codeChallenge) {
  const state = randomBytes(16).toString("base64url");
  const authUrl = new URL(meta.authorization_endpoint);
  authUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId(),
    redirect_uri: redirectUri(),
    scope: "openid email profile",
    state,
    ...(codeChallenge ? { code_challenge: codeChallenge, code_challenge_method: "S256" } : {}),
  }).toString();
  const page = await httpRequest(authUrl);
  if (page?.status !== 200) return { error: `authorization request -> HTTP ${page?.status}`, location: page?.headers.get("location") };
  const action = page.text.match(/<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/)?.[1];
  if (!action) return { error: "login form not found" };
  const submitted = await httpRequest(decodeHtml(action), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookiesFrom(page.headers) },
    body: new URLSearchParams({ username, password, credentialId: "" }),
  });
  const location = submitted?.headers.get("location");
  if (submitted?.status !== 302 || !location?.startsWith(redirectUri())) {
    return { error: `login -> HTTP ${submitted?.status ?? "unreachable"} (wrong password or a required action?)` };
  }
  const params = new URL(location).searchParams;
  if (params.get("state") !== state || !params.get("code")) return { error: "callback without code or with a wrong state" };
  return { code: params.get("code") };
}

async function exchange(meta, code, codeVerifier, secret) {
  const basic = Buffer.from(`${encodeURIComponent(clientId())}:${encodeURIComponent(secret)}`).toString("base64");
  const response = await httpRequest(meta.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${basic}` },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri(), code_verifier: codeVerifier }),
  });
  let body = {};
  try {
    body = JSON.parse(response?.text ?? "{}");
  } catch {
    // non-JSON error page
  }
  return { status: response?.status, body };
}

const pkcePair = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

async function check() {
  const { COLLARA_OIDC_CLIENT_SECRET: secret } = requireEnv(["COLLARA_OIDC_CLIENT_SECRET"]);
  const results = [];
  const record = (name, ok, detail) => {
    results.push(ok);
    console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  };
  const meta = await discovery();
  record("discovery document (HTTP 200)", Boolean(meta), `${issuer()}/.well-known/openid-configuration`);
  if (!meta) {
    process.exitCode = 1;
    return;
  }
  record("issuer matches COLLARA_OIDC_ISSUER", meta.issuer === issuer(), meta.issuer);
  record("S256 supported", meta.code_challenge_methods_supported?.includes("S256"));

  const users = JSON.parse(readFileSync(REALM_SOURCE, "utf8")).users.map((user) => ({
    username: user.username,
    password: user.credentials.find((c) => c.type === "password").value,
  }));

  const withoutPkce = await authorize(meta, users[0]);
  record(
    "authorization request without PKCE is refused",
    /code_challenge_method/.test(decodeURIComponent(withoutPkce.location ?? "")),
    withoutPkce.code ? "a code was issued" : "invalid_request: missing code_challenge_method",
  );

  const wrong = pkcePair();
  const wrongAttempt = await authorize(meta, users[0], wrong.challenge);
  if (wrongAttempt.code) {
    const result = await exchange(meta, wrongAttempt.code, pkcePair().verifier, secret);
    record("token exchange with the wrong PKCE verifier is refused", result.status === 400, `HTTP ${result.status} ${result.body.error ?? ""}`);
  } else {
    record("token exchange with the wrong PKCE verifier is refused", false, wrongAttempt.error);
  }

  for (const user of users) {
    const pkce = pkcePair();
    const attempt = await authorize(meta, user, pkce.challenge);
    if (!attempt.code) {
      record(`login ${user.username}`, false, attempt.error);
      continue;
    }
    const { status: tokenStatus, body } = await exchange(meta, attempt.code, pkce.verifier, secret);
    const claims = body.id_token ? JSON.parse(Buffer.from(body.id_token.split(".")[1], "base64url").toString()) : {};
    record(
      `login ${user.username}`,
      tokenStatus === 200 && claims.email === user.username && body.expires_in === 300,
      `HTTP ${tokenStatus}, access token ${body.expires_in ?? "?"} s`,
    );
  }
  if (results.includes(false)) process.exitCode = 1;
}

async function reset() {
  await stopService(FILES.pid, PROCESS_MARKER, "Keycloak", STOP_OPTIONS);
  rmSync(FILES.devDatabase, { recursive: true, force: true });
  rmSync(FILES.imported, { force: true });
  rmSync(FILES.realmImport, { force: true });
  console.log("deleted the Keycloak dev database; the next start imports infra/keycloak/collara-realm.json again");
}

const { command } = parseCommand(process.argv.slice(2), ["install", "start", "stop", "status", "check", "reset"], "status");
const actions = {
  install,
  start,
  status,
  check,
  reset,
  stop: () => stopService(FILES.pid, PROCESS_MARKER, "Keycloak", STOP_OPTIONS),
};
await actions[command]();
