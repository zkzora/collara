// LocalNet integration harness (opt-in: LOCALNET_IT=1, run with `pnpm --filter @collara/api test:localnet`).
// One harness = one isolated world on the shared Canton sandbox:
//   bootstrap --prefix <p> (own parties, ledger users, namespace, .local/localnet/state-<p>.json)
//   → fresh database collara_it_<p> (created, migrated, demo users, system users, party bindings)
//   → the API built with the Canton gateway (COLLARA_MODE=LOCALNET, DEMO_SESSIONS_ENABLED=true)
// Helpers: seed(profile) (the real seed through the API's runner), loginAs(persona) (demo session + cookie
// jar), inject() (browser-like CSRF headers + Idempotency-Key), project() (one synchronous projection pass
// into the IT database), acsAs(role, template) (direct ledger reads for assertions) and close() (drops the
// database and the state file unless KEEP_IT_DB=1). Never touches the default namespace or database.
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { commands as commandsTable, projectOnce, type CommandRow, type DbHandle, type ProjectOnceOptions, type ProjectOnceResult } from "@collara/db";
import { DEMO_PERSONAS, type PersonaId } from "@collara/domain";
import { and, eq } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import { buildApp, type CollaraApp } from "../../src/app";
import { loadConfig, type Config } from "../../src/config";
import { AcsReader, CantonLedgerGateway, DEV_HMAC_SECRET, LedgerAccess, ledgerStatePath, loadLedgerState, type AcsContract, type LedgerState } from "../../src/ledger";
import type { Payload, PayloadTemplate } from "../../src/ledger/contracts";
import { loggerOptions } from "../../src/logger";
import { dropDatabase, prepareDatabase } from "../../src/seed/database";
import { seedKey, seedLocalnet, type SeedProfile, type SeedReport } from "../../src/seed/localnet";
import { createMemoryStorage, createS3Storage, type StorageService } from "../../src/services/storage";
import { loadMemberActor, type WorkflowActor, type WorkflowServices } from "../../src/workflow";

export const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** True when LocalNet integration tests are enabled (LOCALNET_IT=1). Use with describe.skipIf(!…). */
export const LOCALNET_IT_ENABLED = process.env.LOCALNET_IT === "1";

/** Organisation (or service) whose ledger view acsAs() reads, mapped to the bootstrap's logical party hint. */
export const LEDGER_ROLES = {
  registrar: "CollaraRegistrar",
  governance: "CollaraGovernance",
  borrower: "DemoManufacturer",
  dealer: "DemoCNCDealer",
  verifier: "DemoVerifier",
  lenderA: "DemoLenderA",
  lenderB: "DemoLenderB",
  auditor: "DemoAuditor",
  seat1: "GovSeat1",
  seat2: "GovSeat2",
  seat3: "GovSeat3",
} as const;
export type LedgerRole = keyof typeof LEDGER_ROLES;

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface InjectOptions {
  /** JSON body (objects are serialised), or raw bytes/text with an explicit content-type header. */
  readonly body?: unknown;
  /**
   * Idempotency-Key for unsafe methods. Default: a fresh random key per call. Pass a fixed key to test
   * replays, or null to omit the header (to test the 400).
   */
  readonly idempotencyKey?: string | null;
  /** Extra or overriding headers (e.g. a spoofed x-collara-org, which the API must ignore). */
  readonly headers?: Readonly<Record<string, string>>;
  /** Send the request as a cross-site browser would (sec-fetch-site: cross-site) to test the CSRF guard. */
  readonly crossSite?: boolean;
}

/** A signed-in demo persona: a cookie jar kept up to date from every response's Set-Cookie. */
export interface ItSession {
  readonly personaId: PersonaId;
  readonly userId: string;
  /** "name=value; …" for the current cookies. */
  cookieHeader(): string;
  inject(method: HttpMethod, path: string, options?: InjectOptions): Promise<LightMyRequestResponse>;
}

export interface HarnessOptions {
  /** Exact prefix to (re)use, e.g. "core-it1". Default: "<prefixBase>-<unique>" (or LOCALNET_IT_PREFIX). */
  readonly prefix?: string;
  /** Base of the generated prefix (default "it"); at most 20 characters. */
  readonly prefixBase?: string;
  /** "s3" (default when COLLARA_S3_* is configured) or "memory". */
  readonly storage?: "s3" | "memory";
  /** Keep the database and the state file after close() (default: KEEP_IT_DB=1). */
  readonly keepDb?: boolean;
  /** Print bootstrap/seed progress (default: LOCALNET_IT_LOG=1, or =debug to add the API request logs). */
  readonly verbose?: boolean;
}

export interface LocalnetHarness {
  readonly prefix: string;
  readonly namespace: string;
  readonly state: LedgerState;
  readonly statePath: string;
  /** postgres://… of the IT database (contains the dev password: do not print it). */
  readonly databaseUrl: string;
  readonly databaseName: string;
  readonly db: DbHandle;
  readonly app: CollaraApp;
  readonly config: Config;
  readonly access: LedgerAccess;
  readonly workflow: WorkflowServices;
  readonly storage: StorageService;
  /** Wall-clock milliseconds of the setup phases (bootstrap, database, app). */
  readonly timings: Readonly<Record<string, number>>;
  /** Runs the LocalNet seed (same runner and services as the endpoints). Re-running replays every step. */
  seed(profile: SeedProfile, options?: { skipDocuments?: boolean }): Promise<SeedReport>;
  /** Demo session as a seeded persona (POST /api/demo/sessions). */
  loginAs(personaId: PersonaId): Promise<ItSession>;
  /** app.inject with browser-like same-origin headers; `as` = a session, or anonymous. */
  inject(method: HttpMethod, path: string, options?: InjectOptions & { as?: ItSession | null }): Promise<LightMyRequestResponse>;
  /** One synchronous projection pass per participant (projector user of this prefix) into the IT database. */
  project(options?: ProjectOnceOptions): Promise<ProjectOnceResult[]>;
  /** Party id of a role in this prefix. */
  party(role: LedgerRole): string;
  /** ACS reader as the role's ledger user (seats also read as the governance party). */
  acs(role: LedgerRole): AcsReader;
  /** Active contracts of a template as the role sees them right now on the ledger. */
  acsAs<N extends PayloadTemplate>(role: LedgerRole, template: N, where?: (payload: Payload<N>) => boolean): Promise<AcsContract<Payload<N>>[]>;
  /** Workflow actor of a persona (for calling the runner/registrar service directly). */
  actor(personaId: PersonaId): Promise<WorkflowActor>;
  /** The command record of one seed step ("B1", "M18", "M1-M3"), or null. */
  seedCommand(step: string): Promise<CommandRow | null>;
  /** A command record by id (fresh from the database). */
  command(id: string): Promise<CommandRow | null>;
  /** Closes the app and the database; drops the IT database and the state file unless keepDb. Idempotent. */
  close(): Promise<void>;
}

const execFileAsync = promisify(execFile);
const SAFE_METHODS = new Set<HttpMethod>(["GET"]);

function loadRepoEnv(): void {
  const file = join(REPO_ROOT, ".env");
  // Variables already set in the environment win over the file.
  if (existsSync(file)) process.loadEnvFile(file);
}

function uniquePrefix(base: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,19}$/.test(base)) throw new Error(`invalid prefix base ${JSON.stringify(base)}`);
  return `${base}-${Date.now().toString(36).slice(-5)}${randomBytes(2).toString("hex")}`;
}

function itDatabaseUrl(prefix: string): { url: string; name: string } {
  const base = process.env.LOCALNET_IT_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://collara:collara_dev@127.0.0.1:5432/collara";
  const name = `collara_it_${prefix.replaceAll("-", "_")}`;
  const url = new URL(base);
  url.pathname = `/${name}`;
  return { url: url.toString(), name };
}

async function runBootstrap(prefix: string, log: (line: string) => void): Promise<void> {
  const script = join(REPO_ROOT, "scripts", "localnet", "bootstrap.mjs");
  try {
    const { stdout } = await execFileAsync(process.execPath, [script, "--prefix", prefix], { cwd: REPO_ROOT, timeout: 240_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    for (const line of stdout.split(/\r?\n/).filter(Boolean)) log(`  bootstrap: ${line}`);
  } catch (error) {
    const detail = error as { stdout?: string; stderr?: string; message?: string };
    throw new Error(`bootstrap --prefix ${prefix} failed: ${detail.stderr || detail.stdout || detail.message}`);
  }
}

/** Starts an isolated LocalNet world (see the file header). Call close() in afterAll. */
export async function startLocalnetHarness(options: HarnessOptions = {}): Promise<LocalnetHarness> {
  if (!LOCALNET_IT_ENABLED) throw new Error("LocalNet integration tests are opt-in: set LOCALNET_IT=1");
  loadRepoEnv();
  const debug = process.env.LOCALNET_IT_LOG === "debug";
  const verbose = options.verbose ?? (debug || process.env.LOCALNET_IT_LOG === "1");
  const log = (line: string) => {
    if (verbose) console.log(line);
  };
  const keepDb = options.keepDb ?? process.env.KEEP_IT_DB === "1";
  const prefix = options.prefix ?? process.env.LOCALNET_IT_PREFIX ?? uniquePrefix(options.prefixBase ?? "it");
  const timings: Record<string, number> = {};
  const timed = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const t = performance.now();
    try {
      return await fn();
    } finally {
      timings[name] = Math.round(performance.now() - t);
    }
  };

  // 1. Ledger: parties, users and the state file of this prefix (idempotent for an existing prefix).
  log(`LocalNet IT harness: prefix ${prefix}`);
  await timed("bootstrapMs", () => runBootstrap(prefix, log));
  const statePath = ledgerStatePath(prefix);
  const state = await loadLedgerState(statePath);
  if (!state) throw new Error(`bootstrap wrote no state at ${statePath}`);

  // 2. Database: create, migrate, demo identities, system users, party bindings from the state file.
  const { url: databaseUrl, name: databaseName } = itDatabaseUrl(prefix);
  const prepared = await timed("databaseMs", () => prepareDatabase(databaseUrl, state, { applicationName: "collara-it" }));
  const db = prepared.handle;
  log(`  database ${databaseName}${prepared.created ? " (created)" : ""}: ${prepared.bindings.bindings} party bindings`);

  let app: CollaraApp | null = null;
  try {
    // 3. The API with the Canton gateway over this prefix's state.
    const config = loadConfig({
      ...process.env,
      NODE_ENV: "test",
      COLLARA_MODE: "LOCALNET",
      DEMO_SESSIONS_ENABLED: "true",
      COOKIE_SECURE: "false",
      LOG_LEVEL: debug ? "info" : "silent",
      DATABASE_URL: databaseUrl,
      COLLARA_LOCALNET_STATE: statePath,
      SESSION_SECRET: process.env.SESSION_SECRET ?? "localnet-it-session-secret-0123456789",
    });
    const access = new LedgerAccess({
      state,
      secret: config.CANTON_JWT_HMAC_SECRET ?? DEV_HMAC_SECRET,
      ...(config.CANTON_JWT_AUDIENCE ? { audience: config.CANTON_JWT_AUDIENCE } : {}),
      submitTimeoutMs: config.CANTON_SUBMIT_TIMEOUT_MS,
    });
    const gateway = new CantonLedgerGateway(access);
    const wantS3 = (options.storage ?? (config.COLLARA_S3_ENDPOINT ? "s3" : "memory")) === "s3";
    const storage = wantS3 ? createS3Storage(config) : createMemoryStorage();
    if (!storage) throw new Error("storage 's3' requested but COLLARA_S3_* is not configured");
    const built = await timed("appMs", async () => {
      const instance = await buildApp({
        config,
        db,
        storage,
        ledger: gateway,
        ledgerAccess: access,
        oidc: null,
        logger: debug ? loggerOptions(config) : false,
      });
      await instance.ready();
      return instance;
    });
    app = built;
    const workflow = built.workflow;
    if (!workflow) throw new Error("the app has no workflow services (no database?)");

    const browserHeaders = (method: HttpMethod, opts: InjectOptions): Record<string, string> => {
      const headers: Record<string, string> = {};
      if (!SAFE_METHODS.has(method)) {
        // What a same-origin page sends through the Next proxy (plugins/security.ts).
        headers["sec-fetch-site"] = opts.crossSite ? "cross-site" : "same-origin";
        headers.origin = opts.crossSite ? "https://attacker.example" : new URL(config.PUBLIC_ORIGIN).origin;
        if (opts.idempotencyKey !== null) headers["idempotency-key"] = opts.idempotencyKey ?? `it-${randomUUID()}`;
      }
      return { ...headers, ...opts.headers };
    };

    const send = (method: HttpMethod, path: string, opts: InjectOptions, cookie: string | null) =>
      built.inject({
        method,
        url: path,
        headers: { ...browserHeaders(method, opts), ...(cookie ? { cookie } : {}) },
        ...(opts.body !== undefined ? { payload: opts.body as string | Buffer | object } : {}),
      });

    const sessionFrom = (personaId: PersonaId, jar: Map<string, string>): ItSession => {
      const cookieHeader = () => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
      return {
        personaId,
        userId: DEMO_PERSONAS[personaId].userId,
        cookieHeader,
        async inject(method, path, opts = {}) {
          const response = await send(method, path, opts, jar.size > 0 ? cookieHeader() : null);
          updateJar(jar, response);
          return response;
        },
      };
    };

    const readers = new Map<LedgerRole, AcsReader>();
    const acs = (role: LedgerRole): AcsReader => {
      let reader = readers.get(role);
      if (!reader) {
        const party = partyOf(state, role);
        const user = state.users.find((u) => u.role === "org" && u.primaryParty === party);
        if (!user) throw new Error(`no ledger user for ${role} in ${statePath}`);
        reader = new AcsReader(access.client(user.id, user.participant), [...new Set([party, ...user.readAs])]);
        readers.set(role, reader);
      }
      return reader;
    };

    const findCommand = async (where: { operation: string; idempotencyKey: string }) => {
      const [row] = await db.db
        .select()
        .from(commandsTable)
        .where(and(eq(commandsTable.operation, where.operation), eq(commandsTable.idempotencyKey, where.idempotencyKey)))
        .limit(1);
      return row ?? null;
    };

    let closed = false;
    const harness: LocalnetHarness = {
      prefix,
      namespace: access.namespace,
      state,
      statePath,
      databaseUrl,
      databaseName,
      db,
      app: built,
      config,
      access,
      workflow,
      storage,
      timings,

      seed: (profile, seedOptions = {}) =>
        seedLocalnet({
          profile,
          statePath,
          databaseUrl,
          db,
          storage,
          skipDocuments: seedOptions.skipDocuments ?? false,
          log: (line) => log(`  seed: ${line}`),
        }),

      async loginAs(personaId) {
        const jar = new Map<string, string>();
        const session = sessionFrom(personaId, jar);
        const response = await session.inject("POST", "/api/demo/sessions", { body: { personaId }, idempotencyKey: null });
        if (response.statusCode !== 200 || jar.size === 0) throw new Error(`demo session for ${personaId} failed: ${response.statusCode} ${response.body}`);
        return session;
      },

      inject(method, path, opts = {}) {
        const { as, ...rest } = opts;
        return as ? as.inject(method, path, rest) : send(method, path, rest, null);
      },

      async project(projectOptions = {}) {
        const results: ProjectOnceResult[] = [];
        for (const [source, participant] of Object.entries(state.participants)) {
          const projector = state.users.find((u) => u.role === "projector" && u.participant === source);
          if (!projector) throw new Error(`no projector user for ${source} in ${statePath}`);
          const client = access.client(projector.id, source);
          results.push(
            await projectOnce(db.db, client, { source, jsonApiUrl: participant.jsonApiUrl, parties: projector.readAs, ledgerUserId: projector.id }, projectOptions),
          );
        }
        return results;
      },

      party: (role) => partyOf(state, role),
      acs,
      acsAs: (role, template, where) => acs(role).list(template, where ? (payload) => where(payload) : undefined),
      actor: (personaId) => loadMemberActor(db.db, DEMO_PERSONAS[personaId].userId),
      seedCommand: (step) => findCommand({ operation: `seed.${step}`, idempotencyKey: seedKey(access.namespace, step) }),
      async command(id) {
        const [row] = await db.db.select().from(commandsTable).where(eq(commandsTable.id, id)).limit(1);
        return row ?? null;
      },

      async close() {
        if (closed) return;
        closed = true;
        await built.close();
        await db.close();
        if (keepDb) {
          console.log(`KEEP_IT_DB: kept database ${databaseName} and ${statePath} (prefix ${prefix})`);
          return;
        }
        await dropDatabase(databaseUrl);
        rmSync(statePath, { force: true });
      },
    };
    return harness;
  } catch (error) {
    if (app) await app.close();
    await db.close();
    if (!keepDb) {
      await dropDatabase(databaseUrl).catch(() => undefined);
      rmSync(statePath, { force: true });
    }
    throw error;
  }
}

function partyOf(state: LedgerState, role: LedgerRole): string {
  const entry = state.parties[LEDGER_ROLES[role]];
  if (!entry) throw new Error(`party ${LEDGER_ROLES[role]} (${role}) is not in the LocalNet state`);
  return entry.party;
}

function updateJar(jar: Map<string, string>, response: LightMyRequestResponse): void {
  for (const cookie of response.cookies as { name: string; value: string; maxAge?: number; expires?: Date }[]) {
    const expired = cookie.maxAge === 0 || (cookie.expires !== undefined && cookie.expires.getTime() <= Date.now()) || cookie.value === "";
    if (expired) jar.delete(cookie.name);
    else jar.set(cookie.name, cookie.value);
  }
}
