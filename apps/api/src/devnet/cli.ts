// DEVNET operator CLI, run through scripts/devnet/*.mjs (tsx, COLLARA_MODE=DEVNET, env from .env.devnet):
//   db-setup          creates the DEVNET database if missing (its name must contain "devnet"), applies the
//                     migrations, seeds the synthetic demo identities and the system users
//   login             owner only, in their own terminal: prompts for the team login (password hidden), runs ONE
//                     password grant, validates the token and stores ONLY the refresh token in ledger_credentials
//   preflight         public checks; with a stored credential also the ledger user, rights, synchronizers, packages
//   import-bindings   matches the Console-created parties to the Collara hints; writes .local/devnet/state.json and
//                     the DB bindings (never allocates parties)
//   bootstrap         the seed (clean-start or main) through the API's workflow runner on the DevNet state
//   verify-evidence   every recorded receipt (update id, offset) against the participant's update stream, plus the final
//                     contracts; writes the non-secret receipts with --out <file> (read-only)
//   verify-first-tx   the first committed command (update id, offset) and the registrar's AssetRegistry/CollaraConfig
//   recover           read-only diagnosis after a DevNet reset, pruning, a lost credential, key or database: prints the
//                     case and the exact next commands. --new-run --yes: fresh run namespace, reset of the "devnet"
//                     projection source only, bindings re-imported, clean-start bootstrap (idempotent; never
//                     allocates parties, never touches other tenants' data)
// Every command needs DEVNET_CREDENTIAL_KEY (+ _ID): the refresh token is stored AES-256-GCM encrypted with it.
// Secrets are never printed, logged or put in argv; the password is read from the TTY, the key only from the env file.
import { rename, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import {
  credentialKeyIssues,
  decodeJwtSubject,
  decodeJwtClaims,
  devnetCredentialId,
  diagnoseDevnet,
  formatDiagnosis,
  publicEnvKeyLeaks,
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
import { commands as commandsTable, createPgDatabase, resetProjectionSource, seedDemoIdentities, type DbHandle } from "@collara/db";
import { and, asc, inArray, isNotNull } from "drizzle-orm";
import { AcsReader } from "../ledger/acs";
import { devnetCredentialStore } from "../ledger/devnet";
import { loadLedgerState, type LedgerState } from "../ledger/state";
import { ensureDatabase, prepareDatabase } from "../seed/database";
import { ensureSystemUsers } from "../workflow/actors";
import { redactUrl, seedLocalnet, SeedRefusedError, type SeedProfile } from "../seed/localnet";
import { buildDevnetState, COLLARA_PARTIES, DEVNET_SOURCE, devnetNamespace, matchParties, matchProblems, rightsToParties, type CollaraPartyHint } from "./bindings";
import { authenticatedChecks, formatChecks, publicChecks, readUploadManifest } from "./preflight";
import { observeDevnet, planNewRun } from "./recovery";

class CliError extends Error {}

type Env = DevnetEnv & { DATABASE_URL?: string | undefined };

function loadEnv(options: { requireDatabase: boolean; requireUser: boolean }): Env {
  const cleaned = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v !== "")) as Record<string, string>;
  const parsed = DevnetEnvSchema.safeParse(cleaned);
  if (!parsed.success) throw new CliError(`invalid DEVNET settings in .env.devnet:\n${parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  const env: Env = { ...parsed.data, DATABASE_URL: cleaned.DATABASE_URL };
  // Every command reads or writes the encrypted refresh token, or must not run without its key.
  const keyIssues = credentialKeyIssues(env);
  if (keyIssues.length) throw new CliError(keyIssues.map((i) => `${i.path}: ${i.message}`).join("\n"));
  const leaks = publicEnvKeyLeaks(cleaned);
  if (leaks.length) throw new CliError(`${leaks.join(", ")}: must not carry DEVNET_CREDENTIAL_KEY (server-only secret)`);
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
  return new OidcRefreshTokenProvider({ settings: devnetOidcSettings({ ...env, DEVNET_LEDGER_USER_ID: user }), store: devnetCredentialStore(env, db.db), credentialId: devnetCredentialId(user) });
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
    console.log(`database ${redactUrl(url)}${created ? " created" : " exists"}; migrations applied (incl. 0005_credential_encryption_recovery)`);
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
    // The token passed local audience/scope/subject checks, so this is the participant rejecting the ledger user
    // (typically: Wallet onboarding not completed, so the user is not provisioned on the shared participant).
    const claims = decodeJwtClaims(response.access_token);
    console.error("");
    console.error("The identity provider accepted your login and issued a token, but the NODERS participant rejected it.");
    console.error("This usually means the ledger user behind the token is not provisioned on the shared participant yet.");
    console.error("Token claims (not secret):");
    console.error(`  ledger user (sub): ${claims?.sub ?? "?"}`);
    console.error(`  audience (aud):    ${Array.isArray(claims?.aud) ? claims?.aud.join(", ") : (claims?.aud ?? "?")}`);
    console.error(`  scope:             ${claims?.scope ?? "?"}`);
    console.error("Next: open the Wallet, complete onboarding, and confirm the ledger user id it shows matches the sub above.");
    console.error("  Wallet: https://wallet.validator.hackcanton-01.devnet.naas.noders.services");
    console.error("If onboarding is already done and this persists, send the lines above to NODERS (docs/devnet/noders-rights-request.md). Nothing was stored.");
    throw new CliError(`the participant did not accept the token: ${error instanceof Error ? error.message : String(error)}`);
  });

  const db = openDb(env);
  try {
    await devnetCredentialStore(env, db.db).storeLogin({
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
  console.log(`stored:               refresh token, AES-256-GCM encrypted with key ${env.DEVNET_CREDENTIAL_KEY_ID ?? "?"}, in ${redactUrl(env.DATABASE_URL ?? "")} table ledger_credentials, id ${devnetCredentialId(validated.ledgerUserId)}`);
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
      const store = devnetCredentialStore(env, db.db);
      const id = devnetCredentialId(env.DEVNET_LEDGER_USER_ID);
      const [status, check] = await Promise.all([store.status(id).catch(() => null), store.check(id).catch((error: unknown) => ({ state: "ERROR", detail: String(error).slice(0, 200) }))]);
      if (check.state === "MISSING" || check.state === "REAUTH_REQUIRED") {
        checks.push({ name: "credential", status: "skip", detail: check.state === "MISSING" ? "no credential stored: run login.mjs" : `stored credential is REAUTH_REQUIRED (${check.detail}): run login.mjs again` });
      } else if (check.state !== "OK") {
        checks.push({ name: "credential", status: "fail", detail: `${check.state}: ${check.detail}` });
      } else {
        checks.push({ name: "credential", status: "ok", detail: `stored (${check.detail}), rotated ${status?.rotationCount ?? 0} time(s), last at ${status?.rotatedAt?.toISOString() ?? "never"}` });
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

async function importBindings(runRef: string | undefined): Promise<LedgerState> {
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
      `${prepared.bindings.sources.some((s) => s.reset) ? "; RESET DETECTED: the worker will not mix histories (docs/devnet/recovery.md)" : ""}`,
  );
  return state;
}

async function bootstrap(profile: SeedProfile, skipDocuments: boolean, json: boolean, forceNewNamespace = false): Promise<void> {
  const env = loadEnv({ requireDatabase: true, requireUser: true });
  const statePath = devnetStatePath(env);
  const state = await loadLedgerState(statePath);
  if (!state) throw new CliError(`no DevNet state at ${statePath}: run node scripts/devnet/import-bindings.mjs first`);
  const report = await seedLocalnet({
    profile,
    statePath,
    databaseUrl: env.DATABASE_URL ?? "",
    skipDocuments,
    forceNewNamespace,
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

/**
 * Read-only: checks every recorded command receipt (update id + offset in this database) against the participant's
 * own update stream for the Collara parties, then reads the final contract state from the ledger. Writes the
 * non-secret receipts (update ids, offsets, template names, record times) to --out. Exit 0 only when every receipt
 * is found at the recorded offset and the expected final contracts exist.
 */
async function verifyEvidence(options: { out: string | undefined }): Promise<number> {
  const env = loadEnv({ requireDatabase: true, requireUser: true });
  const state = await loadLedgerState(devnetStatePath(env));
  if (!state) throw new CliError("no DevNet state: run import-bindings first");
  const db = openDb(env);
  try {
    const rows = await db.db
      .select({ operation: commandsTable.operation, status: commandsTable.status, updateId: commandsTable.updateId, offset: commandsTable.completionOffset, actor: commandsTable.actorUserId })
      .from(commandsTable)
      .where(and(inArray(commandsTable.status, ["COMMITTED", "PROJECTED", "PROJECTION_DELAYED"]), isNotNull(commandsTable.updateId), isNotNull(commandsTable.completionOffset)))
      .orderBy(asc(commandsTable.completionOffset));
    if (rows.length === 0) throw new CliError("no committed command receipts in this database");
    const client = new LedgerClient({ baseUrl: env.CANTON_DEVNET_JSON_API_URL, tokenProvider: provider(env, db), timeoutMs: 60_000 });
    const parties = Object.values(state.parties).map((p) => p.party);
    const first = Number(rows[0]?.offset);
    const last = Number(rows[rows.length - 1]?.offset);
    const onLedger = new Map<string, { offset: number; recordTime: string; created: string[]; archived: string[] }>();
    const entity = (templateId: string) => templateId.split(":").pop() ?? templateId;
    let begin = first - 1;
    for (let pass = 0; pass < 1_000; pass++) {
      const page = await client.updates({ beginExclusive: begin, endInclusive: last, parties, limit: 200 });
      for (const u of page.updates) {
        if (u.kind !== "transaction") continue;
        onLedger.set(u.transaction.updateId, {
          offset: u.transaction.offset,
          recordTime: u.transaction.recordTime,
          created: u.transaction.events.filter((e) => e.kind === "created").map((e) => entity(e.templateId)),
          archived: u.transaction.events.filter((e) => e.kind === "archived").map((e) => entity(e.templateId)),
        });
      }
      if (page.complete) break;
      begin = page.nextBeginExclusive;
    }
    const receipts = rows.map((r) => {
      const seen = onLedger.get(r.updateId ?? "");
      return {
        operation: r.operation,
        actor: r.actor,
        updateId: r.updateId,
        recordedOffset: Number(r.offset),
        found: !!seen,
        offsetMatches: !!seen && seen.offset === Number(r.offset),
        recordTime: seen?.recordTime ?? null,
        created: seen?.created ?? [],
        archived: seen?.archived ?? [],
      };
    });
    const missing = receipts.filter((r) => !r.found || !r.offsetMatches);
    console.log(`receipts in the database: ${receipts.length}; found on the ledger at the recorded offset: ${receipts.length - missing.length}`);
    for (const r of missing) console.log(`  MISSING/MISMATCH  ${r.operation}  ${r.updateId}  recorded offset ${r.recordedOffset}`);

    const ns = state.namespace ?? "";
    const owner = state.parties.DemoManufacturer?.party;
    const lender = state.parties.DemoLenderA?.party;
    if (!owner || !lender) throw new CliError("the DevNet state has no DemoManufacturer/DemoLenderA party");
    const asOwner = new AcsReader(client, [owner]);
    const asLender = new AcsReader(client, [lender]);
    const controls = await asOwner.list("AssetControl", (c) => c.namespace === ns);
    const locks = await asOwner.list("CollateralLock", (c) => c.namespace === ns);
    const released = await asOwner.list("CollateralLockReleased", (c) => c.namespace === ns);
    const decisions = await asLender.list("ReleaseDecision", (d) => d.outcome === "AUTHORIZED");
    const final = {
      activeAssetControl: controls.map((c) => ({ assetId: c.payload.assetId, controlVersion: c.payload.controlVersion })),
      activeCollateralLocks: locks.length,
      collateralLockReleased: released.map((c) => ({ caseRef: c.payload.caseRef, lockControlVersion: c.payload.lockControlVersion, releasedControlVersion: c.payload.releasedControlVersion })),
      authorizedReleaseDecisions: decisions.length,
    };
    // Privacy at the ledger level: the unrelated lender (and, without a grant, the auditor) must hold none of the
    // case contracts. Counted per template as that party's own ACS, not through the application.
    const caseTemplates = [
      "AssetControl",
      "EvidenceManifest",
      "DealerContribution",
      "VerificationRequest",
      "VerificationAttestation",
      "CollateralAssessment",
      "FinancingProposal",
      "FinancingAgreement",
      "CollateralLock",
      "CollateralLockReleased",
      "ReleaseRequest",
      "ReleaseDecision",
      "PackageShare",
    ] as const;
    const unrelated = state.parties.DemoLenderB?.party;
    const privacy: Record<string, number> = {};
    if (unrelated) {
      const asUnrelated = new AcsReader(client, [unrelated]);
      for (const template of caseTemplates) privacy[template] = (await asUnrelated.list(template, () => true)).length;
    }
    const unrelatedSees = Object.values(privacy).reduce((sum, n) => sum + n, 0);
    console.log(`privacy: Demo Lender B (unrelated) holds ${unrelatedSees} case contracts across ${caseTemplates.length} templates`);
    console.log(`final state on the ledger (namespace ${ns}):`);
    console.log(`  AssetControl (active)        ${JSON.stringify(final.activeAssetControl)}`);
    console.log(`  CollateralLock (active)      ${final.activeCollateralLocks}`);
    console.log(`  CollateralLockReleased       ${JSON.stringify(final.collateralLockReleased)}`);
    console.log(`  ReleaseDecision AUTHORIZED   ${final.authorizedReleaseDecisions}`);
    const ledgerEnd = await client.ledgerEnd();
    const version = await client.version().then((v) => v.version).catch(() => "unknown");
    if (options.out) {
      await mkdir(dirname(options.out), { recursive: true });
      const document = { verifiedAt: new Date().toISOString(), namespace: ns, participant: state.participantId, cantonVersion: version, ledgerEnd, receipts, final, privacy: { unrelatedLenderCaseContracts: unrelatedSees, perTemplate: privacy } };
      await writeFile(options.out, `${JSON.stringify(document, null, 2)}\n`, "utf8");
      console.log(`wrote ${options.out}`);
    }
    const ok = missing.length === 0 && final.activeAssetControl.length === 1 && final.activeCollateralLocks === 0 && final.collateralLockReleased.length >= 1 && final.authorizedReleaseDecisions >= 1 && !!unrelated && unrelatedSees === 0;
    console.log(ok ? "VERIFIED" : "NOT VERIFIED");
    return ok ? 0 : 1;
  } finally {
    await db.close();
  }
}

/**
 * Read-only diagnosis (exit 0 = nothing to recover, 2 = a recovery case applies); with --new-run --yes also the
 * recovery itself: fresh run namespace, reset of the "devnet" projection source only (at the pruning offset when
 * the participant was pruned), bindings re-imported, clean-start bootstrap. Each step is skipped when already done.
 */
async function recover(options: { json: boolean; newRun: boolean; yes: boolean; runRef: string | undefined }): Promise<number> {
  const env = loadEnv({ requireDatabase: true, requireUser: true });
  if (options.runRef) devnetNamespace(options.runRef);
  const userId = env.DEVNET_LEDGER_USER_ID ?? "";
  const statePath = devnetStatePath(env);
  const handle = openDb(env);
  try {
    let databaseError: string | undefined;
    await handle.ping().catch((error: unknown) => {
      databaseError = (error instanceof Error ? error.message : String(error)).slice(0, 160);
    });
    const reachable = databaseError === undefined;
    const client = new LedgerClient({ baseUrl: env.CANTON_DEVNET_JSON_API_URL, tokenProvider: provider(env, handle), timeoutMs: 30_000 });
    const { observation, state } = await observeDevnet({
      db: reachable ? handle.db : null,
      databaseError,
      store: reachable ? devnetCredentialStore(env, handle.db) : null,
      credentialId: devnetCredentialId(userId),
      ledgerUserId: userId,
      client,
      statePath,
      manifest: await readUploadManifest(),
    });
    const diagnosis = diagnoseDevnet(observation);
    if (options.json) console.log(JSON.stringify({ diagnosis, namespace: state?.namespace ?? null }, null, 2));
    else {
      console.log(`DevNet recovery diagnosis (read-only): ${env.CANTON_DEVNET_JSON_API_URL}${state?.namespace ? `, run namespace ${state.namespace}` : ""}`);
      console.log(formatDiagnosis(diagnosis));
    }
    if (!options.newRun) return diagnosis.primary === "OK" ? 0 : 2;

    if (!options.yes) {
      throw new CliError("--new-run writes the DevNet state file, the DEVNET database's bindings and its \"devnet\" projection source, and submits the clean-start bootstrap. Stop the worker and the API, then add --yes.");
    }
    const plan = planNewRun({ diagnosis, observation, requestedRunRef: options.runRef, currentNamespace: state?.namespace ?? null, now: new Date() });
    if (plan.refusal) throw new CliError(plan.refusal);
    const ledger = observation.ledger;
    if (!ledger?.reachable) throw new CliError("the ledger was not observed");

    console.log("\n--new-run:");
    if (plan.importRunRef) {
      console.log(`1. import bindings for a new run namespace ${devnetNamespace(plan.importRunRef)}`);
      await importBindings(plan.importRunRef);
    } else {
      console.log(`1. bindings: the state already names participant ${ledger.participantId} (namespace ${state?.namespace ?? "?"}); kept`);
    }
    if (plan.resetProjection) {
      const { startOffset, reason } = plan.resetProjection;
      const summary = await resetProjectionSource(handle.db, DEVNET_SOURCE, { participantId: ledger.participantId, jsonApiUrl: env.CANTON_DEVNET_JSON_API_URL, startOffset });
      console.log(
        `2. projection source ${DEVNET_SOURCE} reset (${reason}): ${summary.contracts} contracts, ${summary.events} events, ${summary.updates} updates removed; restarts at offset ${startOffset}` +
          (startOffset > 0 ? ` (history floor: offsets up to ${startOffset} were pruned and are not projected)` : ""),
      );
    } else {
      console.log(`2. projection source ${DEVNET_SOURCE}: consistent with the participant; kept`);
    }
    console.log("3. clean-start bootstrap (replays committed steps)");
    await bootstrap("clean-start", true, false, true);
    console.log("\nnext: start the worker and the API again (they load the new state), then:\n  node scripts/devnet/verify-first-tx.mjs\n  node scripts/devnet/recover.mjs");
    return 0;
  } finally {
    await handle.close();
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
    "new-run": { type: "boolean", default: false },
    yes: { type: "boolean", default: false },
    out: { type: "string" },
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
    case "verify-evidence":
      process.exitCode = await verifyEvidence({ out: values.out });
      break;
    case "recover":
      process.exitCode = await recover({ json: values.json, newRun: values["new-run"], yes: values.yes, runRef: values["run-ref"] });
      break;
    default:
      throw new CliError(
        "usage: cli.ts db-setup | login | preflight [--json] | import-bindings [--run-ref <ref>] | bootstrap [--profile clean-start|main] [--skip-documents] | verify-first-tx | verify-evidence [--out <file>] | recover [--json] [--new-run --yes [--run-ref <ref>]]",
      );
  }
} catch (error) {
  const known =
    error instanceof CliError ||
    error instanceof SeedRefusedError ||
    (error instanceof Error && ["LedgerCredentialError", "CredentialCipherError", "CredentialKeyConfigError"].includes(error.name));
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  if (!known && error instanceof Error && process.env.DEVNET_CLI_DEBUG === "1") console.error(error.stack);
  process.exitCode = 1;
}
