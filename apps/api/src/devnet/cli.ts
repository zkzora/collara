// DEVNET operator CLI, run through scripts/devnet/*.mjs (tsx, COLLARA_MODE=DEVNET, env from .env.devnet):
//   db-setup          creates the DEVNET database if missing (its name must contain "devnet"), applies the
//                     migrations, seeds the synthetic demo identities and the system users
//   login             owner only, in their own terminal: prompts for the team login (password hidden), runs ONE
//                     password grant, validates the token and stores ONLY the refresh token in ledger_credentials
//   preflight         public checks; with a stored credential also the ledger user, rights, synchronizers, packages
//   import-bindings   matches the Console-created parties to the Collara hints; writes .local/devnet/state.json and
//                     the DB bindings (never allocates parties)
//   bootstrap         the seed (clean-start or main) through the API's workflow runner on the DevNet state
//   verify-first-tx   the first committed command (update id, offset) and the registrar's AssetRegistry/CollaraConfig
// Secrets are never printed, logged, put in argv or read from the environment (the password is read from the TTY).
import { rename, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import {
  decodeJwtSubject,
  devnetCredentialId,
  DevnetEnvSchema,
  devnetGuardIssues,
  devnetOidcSettings,
  devnetStatePath,
  LedgerClient,
  OidcRefreshTokenProvider,
  parseOidcLedgerSettings,
  remoteJwks,
  requestToken,
  validateLedgerAccessToken,
  type DevnetEnv,
} from "@collara/canton";
import { commands as commandsTable, createPgDatabase, PgRefreshTokenStore, seedDemoIdentities, type DbHandle } from "@collara/db";
import { asc, inArray } from "drizzle-orm";
import { AcsReader } from "../ledger/acs";
import { loadLedgerState } from "../ledger/state";
import { ensureDatabase, prepareDatabase } from "../seed/database";
import { ensureSystemUsers } from "../workflow/actors";
import { redactUrl, seedLocalnet, SeedRefusedError, type SeedProfile } from "../seed/localnet";
import { buildDevnetState, COLLARA_PARTIES, devnetNamespace, matchParties, matchProblems, rightsToParties, type CollaraPartyHint } from "./bindings";
import { authenticatedChecks, formatChecks, publicChecks, readUploadManifest } from "./preflight";

class CliError extends Error {}

type Env = DevnetEnv & { DATABASE_URL?: string | undefined };

function loadEnv(options: { requireDatabase: boolean; requireUser: boolean }): Env {
  const cleaned = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v !== "")) as Record<string, string>;
  const parsed = DevnetEnvSchema.safeParse(cleaned);
  if (!parsed.success) throw new CliError(`invalid DEVNET settings in .env.devnet:\n${parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  const env: Env = { ...parsed.data, DATABASE_URL: cleaned.DATABASE_URL };
  if (options.requireDatabase) {
    const issues = devnetGuardIssues({ ...env, COLLARA_LOCALNET_STATE: cleaned.COLLARA_LOCALNET_STATE, CANTON_JWT_HMAC_SECRET: cleaned.CANTON_JWT_HMAC_SECRET });
    if (issues.length) throw new CliError(issues.map((i) => `${i.path}: ${i.message}`).join("\n"));
  }
  if (options.requireUser && !env.DEVNET_LEDGER_USER_ID) throw new CliError("DEVNET_LEDGER_USER_ID is not set in .env.devnet (login.mjs prints it)");
  return env;
}

function openDb(env: Env): DbHandle {
  if (!env.DATABASE_URL) throw new CliError("DATABASE_URL is not set in .env.devnet");
  return createPgDatabase({ url: env.DATABASE_URL, max: 2, applicationName: "collara-devnet-cli" });
}

function provider(env: Env, db: DbHandle): OidcRefreshTokenProvider {
  const user = env.DEVNET_LEDGER_USER_ID ?? "";
  return new OidcRefreshTokenProvider({ settings: devnetOidcSettings({ ...env, DEVNET_LEDGER_USER_ID: user }), store: new PgRefreshTokenStore(db.db), credentialId: devnetCredentialId(user) });
}

// --- prompts (TTY only; the password is never echoed) ---------------------------------------------------------

function promptLine(question: string, hidden: boolean): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    throw new CliError(
      "login needs an interactive terminal (stdin is not a TTY). Run it in PowerShell or Windows Terminal; in Git Bash (mintty) use: winpty node scripts/devnet/login.mjs",
    );
  }
  process.stdout.write(question);
  return new Promise((resolve, reject) => {
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const done = (error?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\u0003") return done(new CliError("cancelled"));
        if (ch === "\r" || ch === "\n" || ch === "\u0004") return done();
        if (ch === "\u0008" || ch === "\u007f") {
          if (value.length) {
            value = value.slice(0, -1);
            if (!hidden) process.stdout.write("\b \b");
          }
          continue;
        }
        if (ch < " ") continue;
        value += ch;
        if (!hidden) process.stdout.write(ch);
      }
    };
    stdin.on("data", onData);
  });
}

// --- commands ----------------------------------------------------------------------------------------------------

async function dbSetup(): Promise<void> {
  const env = loadEnv({ requireDatabase: true, requireUser: false });
  const url = env.DATABASE_URL ?? "";
  const created = await ensureDatabase(url);
  const db = openDb(env);
  try {
    await db.migrate();
    const seeded = await seedDemoIdentities(db.db);
    await ensureSystemUsers(db.db);
    console.log(`database ${redactUrl(url)}${created ? " created" : " exists"}; migrations applied (incl. 0004_ledger_credentials)`);
    console.log(`synthetic demo identities: ${JSON.stringify(seeded)}`);
  } finally {
    await db.close();
  }
}

async function login(): Promise<void> {
  const env = loadEnv({ requireDatabase: true, requireUser: false });
  const settings = parseOidcLedgerSettings(devnetOidcSettings({ ...env, DEVNET_LEDGER_USER_ID: env.DEVNET_LEDGER_USER_ID ?? "placeholder" }));
  console.log(`DevNet login: ${settings.issuer} (client ${settings.clientId})`);
  console.log("Enter the team's hackathon login. The password is not shown, not stored and not logged.");
  const username = (await promptLine("Username: ", false)).trim();
  const password = await promptLine("Password: ", true);
  if (!username || !password) throw new CliError("username and password are required");

  const response = await requestToken(settings, { grant_type: "password", username, password });
  if (!response.refresh_token) throw new CliError("the identity provider returned no refresh token (is offline_access in DEVNET_OIDC_SCOPE?)");
  const subject = decodeJwtSubject(response.access_token);
  if (env.DEVNET_LEDGER_USER_ID && subject !== env.DEVNET_LEDGER_USER_ID) {
    throw new CliError(`this login belongs to ledger user ${subject ?? "?"}, but DEVNET_LEDGER_USER_ID is ${env.DEVNET_LEDGER_USER_ID}; nothing was stored`);
  }
  const ledgerUserId = env.DEVNET_LEDGER_USER_ID ?? subject ?? "";
  const validated = await validateLedgerAccessToken(response.access_token, { ...settings, ledgerUserId }, remoteJwks(settings.jwksUri));

  // The participant must accept the token (read-only GET).
  const client = new LedgerClient({ baseUrl: env.CANTON_DEVNET_JSON_API_URL, tokenProvider: { getToken: async () => response.access_token } });
  const user = await client.authenticatedUser().catch((error: unknown) => {
    throw new CliError(`the participant did not accept the token: ${error instanceof Error ? error.message : String(error)}`);
  });

  const db = openDb(env);
  try {
    await new PgRefreshTokenStore(db.db).storeLogin({
      id: devnetCredentialId(validated.ledgerUserId),
      ledgerUserId: validated.ledgerUserId,
      issuer: settings.issuer,
      clientId: settings.clientId,
      refreshToken: response.refresh_token,
      accessTokenExpiresAt: validated.expiresAt,
    });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    throw new CliError(/ledger_credentials/.test(text) ? "table ledger_credentials is missing: run the migrations first (owner checklist step d)" : `could not store the credential: ${text.slice(0, 200)}`);
  } finally {
    await db.close();
  }
  console.log("");
  console.log(`ledger user id:       ${validated.ledgerUserId}`);
  console.log(`participant user:     ${user.id}${user.primaryParty ? ` (primary party ${user.primaryParty})` : ""}`);
  console.log(`access token expires: ${validated.expiresAt.toISOString()} (not stored)`);
  console.log(`audience:             ${validated.audience.join(", ")}`);
  console.log(`stored:               refresh token in ${redactUrl(env.DATABASE_URL ?? "")} table ledger_credentials, id ${devnetCredentialId(validated.ledgerUserId)}`);
  if (!env.DEVNET_LEDGER_USER_ID) console.log(`\nNext: add this line to .env.devnet, then run preflight:\nDEVNET_LEDGER_USER_ID=${validated.ledgerUserId}`);
}

async function preflight(json: boolean): Promise<number> {
  const env = loadEnv({ requireDatabase: false, requireUser: false });
  const checks = await publicChecks({ jsonApiUrl: env.CANTON_DEVNET_JSON_API_URL, issuer: env.DEVNET_OIDC_ISSUER, tokenEndpoint: env.DEVNET_OIDC_TOKEN_ENDPOINT, jwksUri: env.DEVNET_OIDC_JWKS_URI });
  let rightsTable: string[] = [];
  const guard = env.DATABASE_URL ? devnetGuardIssues({ ...env, COLLARA_LOCALNET_STATE: process.env.COLLARA_LOCALNET_STATE, CANTON_JWT_HMAC_SECRET: process.env.CANTON_JWT_HMAC_SECRET }) : [];
  if (!env.DATABASE_URL || !env.DEVNET_LEDGER_USER_ID) {
    checks.push({ name: "credentialed checks", status: "skip", detail: "no DATABASE_URL or DEVNET_LEDGER_USER_ID in .env.devnet (run login.mjs first)" });
  } else if (guard.length) {
    checks.push({ name: "DEVNET guards", status: "fail", detail: guard.map((i) => `${i.path}: ${i.message}`).join("; ") });
  } else {
    const db = openDb(env);
    try {
      const status = await new PgRefreshTokenStore(db.db).status(devnetCredentialId(env.DEVNET_LEDGER_USER_ID)).catch(() => null);
      if (!status?.hasRefreshToken || status.status !== "ACTIVE") {
        checks.push({ name: "credential", status: "skip", detail: status ? `stored credential is ${status.status}: run login.mjs again` : "no credential stored: run login.mjs" });
      } else {
        checks.push({ name: "credential", status: "ok", detail: `stored, rotated ${status.rotationCount} time(s), last at ${status.rotatedAt?.toISOString() ?? "never"}` });
        const result = await authenticatedChecks({
          jsonApiUrl: env.CANTON_DEVNET_JSON_API_URL,
          ledgerUserId: env.DEVNET_LEDGER_USER_ID,
          tokenProvider: provider(env, db),
          manifest: await readUploadManifest(),
        });
        checks.push(...result.checks);
        rightsTable = result.rightsTable;
      }
    } finally {
      await db.close();
    }
  }
  if (json) {
    console.log(JSON.stringify({ checks, rights: rightsTable }, null, 2));
  } else {
    console.log(`DevNet preflight: ${env.CANTON_DEVNET_JSON_API_URL}`);
    console.log(formatChecks(checks));
    if (rightsTable.length) console.log(`\nRights of ${env.DEVNET_LEDGER_USER_ID}:\n${rightsTable.map((l) => `  ${l}`).join("\n")}`);
  }
  return checks.some((c) => c.status === "fail") ? 1 : 0;
}

async function importBindings(runRef: string | undefined): Promise<void> {
  const env = loadEnv({ requireDatabase: true, requireUser: true });
  const userId = env.DEVNET_LEDGER_USER_ID ?? "";
  const statePath = devnetStatePath(env);
  const db = openDb(env);
  let state;
  try {
    const client = new LedgerClient({ baseUrl: env.CANTON_DEVNET_JSON_API_URL, tokenProvider: provider(env, db), timeoutMs: 30_000 });
    const user = await client.authenticatedUser();
    if (user.id !== userId) throw new CliError(`the token authenticates ${user.id}, not ${userId}`);
    const rights = rightsToParties(await client.listUserRights(userId));
    const match = matchParties(rights);
    const problems = matchProblems(match);
    if (problems) throw new CliError(`refusing to import: the Collara parties are not all usable by ${userId}\n${problems}`);
    const parties = match.matched as Record<CollaraPartyHint, string>;
    const [participantId, ledgerEnd, version, manifest, previous] = await Promise.all([
      client.participantId(),
      client.ledgerEnd(),
      client.version(),
      readUploadManifest(),
      loadLedgerState(statePath).catch(() => null),
    ]);
    // Keep the run namespace while the participant is the same; a new participant (network reset) gets a new one.
    const sameLedger = previous?.topology === "devnet-shared-participant" && previous.participantId === participantId;
    const ref = runRef ?? (sameLedger && previous?.namespace ? null : `r${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`);
    const namespace = ref ? devnetNamespace(ref) : (previous?.namespace ?? devnetNamespace("r1"));
    state = buildDevnetState({
      ledgerUserId: userId,
      primaryParty: user.primaryParty || undefined,
      jsonApiUrl: env.CANTON_DEVNET_JSON_API_URL,
      participantId,
      ledgerEnd,
      cantonVersion: version.version,
      audience: env.DEVNET_LEDGER_AUDIENCE,
      parties,
      packages: manifest.map((d) => ({ file: `.local/devnet/dars/${String(d.order).padStart(2, "0")}-${d.file}`, name: d.name, version: d.version, mainPackageId: d.mainPackageId, sha256: d.sha256 })),
      namespace,
    });
    await mkdir(dirname(statePath), { recursive: true });
    const tmp = `${statePath}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`);
    await rename(tmp, statePath);
    if (previous && !sameLedger) console.log(`participant changed (${previous.participantId} → ${participantId}): new run namespace ${namespace}`);
  } finally {
    await db.close();
  }
  const prepared = await prepareDatabase(env.DATABASE_URL ?? "", state, { applicationName: "collara-devnet-cli", environment: "DEVNET" });
  await prepared.handle.close();
  console.log(`wrote ${statePath}`);
  console.log(`namespace ${state.namespace}; participant ${state.participantId}; ledger end ${state.participants.devnet?.ledgerEndAtBootstrap}`);
  for (const { hint, role } of COLLARA_PARTIES) console.log(`  ${hint.padEnd(18)} ${state.parties[hint]?.party}  (${role})`);
  console.log(
    `database ${redactUrl(env.DATABASE_URL ?? "")}${prepared.created ? " (created)" : ""}: ${prepared.bindings.bindings} party bindings, ${prepared.bindings.ledgerUsers} ledger user, revoked ${prepared.bindings.revoked}` +
      `${prepared.bindings.sources.some((s) => s.reset) ? "; RESET DETECTED: the worker will not mix histories (docs/devnet.md §6)" : ""}`,
  );
}

async function bootstrap(profile: SeedProfile, skipDocuments: boolean, json: boolean): Promise<void> {
  const env = loadEnv({ requireDatabase: true, requireUser: true });
  const statePath = devnetStatePath(env);
  const state = await loadLedgerState(statePath);
  if (!state) throw new CliError(`no DevNet state at ${statePath}: run node scripts/devnet/import-bindings.mjs first`);
  const report = await seedLocalnet({
    profile,
    statePath,
    databaseUrl: env.DATABASE_URL ?? "",
    skipDocuments,
    log: json ? () => undefined : (line) => console.log(line),
  });
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const replayed = report.steps.filter((s) => s.replayed).length;
  const first = report.steps.find((s) => s.updateId);
  console.log(`\nbootstrapped ${report.profile} on ${report.namespace} in ${report.totalMs} ms: ${report.steps.length} ledger steps (${replayed} replayed)`);
  if (first) console.log(`first step ${first.step}: update ${first.updateId} at offset ${first.offset}`);
}

async function verifyFirstTx(): Promise<number> {
  const env = loadEnv({ requireDatabase: true, requireUser: true });
  const state = await loadLedgerState(devnetStatePath(env));
  if (!state) throw new CliError("no DevNet state: run import-bindings and bootstrap first");
  const db = openDb(env);
  try {
    const [first] = await db.db
      .select({ operation: commandsTable.operation, status: commandsTable.status, updateId: commandsTable.updateId, offset: commandsTable.completionOffset, actor: commandsTable.actorUserId, at: commandsTable.createdAt })
      .from(commandsTable)
      .where(inArray(commandsTable.status, ["COMMITTED", "PROJECTED", "PROJECTION_DELAYED"]))
      .orderBy(asc(commandsTable.completionOffset))
      .limit(1);
    if (!first?.updateId) {
      console.log("no committed command in this database yet: run node scripts/devnet/bootstrap.mjs");
      return 1;
    }
    console.log(`first committed command: ${first.operation} (${first.actor}), ${first.status}`);
    console.log(`  updateId ${first.updateId}`);
    console.log(`  offset   ${first.offset}`);
    const registrar = state.parties.CollaraRegistrar?.party;
    if (!registrar) throw new CliError("the DevNet state has no CollaraRegistrar party");
    const client = new LedgerClient({ baseUrl: env.CANTON_DEVNET_JSON_API_URL, tokenProvider: provider(env, db), timeoutMs: 30_000 });
    const acs = new AcsReader(client, [registrar]);
    const ns = state.namespace ?? "";
    const registries = await acs.list("AssetRegistry", (r) => r.namespace === ns);
    const configs = await acs.list("CollaraConfig", (c) => c.namespace === ns);
    console.log(`ACS as ${registrar} (namespace ${ns}):`);
    for (const r of registries) console.log(`  AssetRegistry  ${r.contractId}  created at offset ${r.offset}`);
    for (const c of configs) console.log(`  CollaraConfig  ${c.contractId}  created at offset ${c.offset}`);
    if (registries.length === 0) console.log("  no AssetRegistry for this namespace");
    if (configs.length === 0) console.log("  no CollaraConfig for this namespace (clean-start step B7 not committed yet)");
    console.log("\nIn the Console: open the update or contract ids above (Transactions / Contracts views) to see the same records.");
    return registries.length === 1 && configs.length === 1 ? 0 : 1;
  } finally {
    await db.close();
  }
}

// --- main ------------------------------------------------------------------------------------------------------

const [command, ...rest] = process.argv.slice(2).filter((arg) => arg !== "--");
const { values } = parseArgs({
  args: rest,
  options: {
    json: { type: "boolean", default: false },
    profile: { type: "string", default: "clean-start" },
    "skip-documents": { type: "boolean", default: false },
    "run-ref": { type: "string" },
  },
  allowPositionals: false,
});

try {
  switch (command) {
    case "db-setup":
      await dbSetup();
      break;
    case "login":
      await login();
      break;
    case "preflight":
      process.exitCode = await preflight(values.json);
      break;
    case "import-bindings":
      await importBindings(values["run-ref"]);
      break;
    case "bootstrap": {
      const profile = values.profile as SeedProfile;
      if (profile !== "clean-start" && profile !== "main") throw new CliError("--profile must be clean-start or main");
      await bootstrap(profile, values["skip-documents"], values.json);
      break;
    }
    case "verify-first-tx":
      process.exitCode = await verifyFirstTx();
      break;
    default:
      throw new CliError("usage: cli.ts db-setup | login | preflight [--json] | import-bindings [--run-ref <ref>] | bootstrap [--profile clean-start|main] [--skip-documents] | verify-first-tx");
  }
} catch (error) {
  const known = error instanceof CliError || error instanceof SeedRefusedError || (error instanceof Error && error.name === "LedgerCredentialError");
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  if (!known && error instanceof Error && process.env.DEVNET_CLI_DEBUG === "1") console.error(error.stack);
  process.exitCode = 1;
}
