import { randomUUID } from "node:crypto";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { devnetStatePath, isLedgerError } from "@collara/canton";
import type { DbHandle } from "@collara/db";
import { COMMAND_COPY, ERROR_COPY } from "@collara/domain";
import Fastify, { type FastifyServerOptions } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
  jsonSchemaTransform,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import packageJson from "../package.json" with { type: "json" };
import type { Config } from "./config";
import { isProblemError, problemError, PROBLEM_CONTENT_TYPE, problems, type ProblemError } from "./errors";
import { loggerOptions } from "./logger";
import { actorResolution } from "./plugins/actor";
import { security } from "./plugins/security";
import { parseSerializerCompiler } from "./serializer";
import { sessions } from "./plugins/session";
import { authRoutes } from "./routes/auth";
import { commandRoutes } from "./routes/commands";
import { evidenceRoutes } from "./routes/evidence";
import { pilotRoutes } from "./routes/pilot";
import { demoRoutes, meRoutes } from "./routes/session";
import { systemRoutes } from "./routes/system";
import { CommandService } from "./services/commands";
import { devnetCredentialStatus, probeLedger, type HealthCheck } from "./services/health";
import { createDbProjectionReader, unavailableLedgerGateway, type LedgerGateway, type ProjectionReader } from "./services/ledger";
import { createOidcService, type OidcService } from "./services/oidc";
import { createS3Storage, type StorageService } from "./services/storage";
import { CantonLedgerGateway, DEV_HMAC_SECRET, LedgerAccess } from "./ledger";
import { devnetLedgerAccess } from "./ledger/devnet";
import { workflowRoutes } from "./routes/workflow";
import { directoryRoutes } from "./routes/directory";
import { overviewRoutes } from "./routes/overview";
import { createWorkflowServices } from "./workflow";

export const API_VERSION = packageJson.version;

export interface BuildAppOptions {
  config: Config;
  /** Override the logger (tests pass `false` or a stream-backed pino). Defaults to the redacting pino options. */
  logger?: FastifyServerOptions["logger"];
  /** Database handle. Without one only health and docs are served (UI_MOCK without PostgreSQL). */
  db?: DbHandle | null;
  /** Object storage; defaults to S3 from config (null when unconfigured: evidence endpoints answer 503). */
  storage?: StorageService | null;
  /**
   * Ledger command port. Default: in LOCALNET (outside NODE_ENV=test) the Canton gateway over the bootstrap
   * state (COLLARA_LOCALNET_STATE); otherwise a gateway that reports the ledger as unavailable.
   */
  ledger?: LedgerGateway;
  /**
   * Ledger connections for the workflow runner's ACS reads (and the Canton gateway when `ledger` is not
   * given). Default: loaded from the bootstrap state in LOCALNET outside tests; null otherwise. Tests and the
   * LocalNet harness pass it explicitly, so unit tests never reach a running sandbox by accident.
   */
  ledgerAccess?: LedgerAccess | null;
  projections?: ProjectionReader;
  /** OIDC client; defaults to discovery from OIDC_* config (null when unconfigured). */
  oidc?: OidcService | null;
  /** Ledger reachability probe for health (defaults to the LocalNet bootstrap state + /readyz). */
  probeLedger?: () => Promise<HealthCheck>;
  clock?: () => Date;
  /**
   * Serve the Swagger UI at /api/docs (default true). The embedded adapter turns it off: swagger-ui serves static files
   * from its package directory, which a bundled serverless function does not ship.
   */
  apiDocs?: boolean;
}

/** Services available to route plugins (also decorated on the instance as `services`). */
export interface AppServices {
  readonly db: DbHandle;
  readonly commands: CommandService;
  readonly projections: ProjectionReader;
  readonly storage: StorageService | null;
  readonly ledger: LedgerGateway;
  readonly oidc: OidcService | null;
  readonly clock: () => Date;
}

/**
 * LOCALNET / DEVNET wiring: the Canton gateway over the bootstrap state; UI_MOCK, tests (unless injected) and a
 * missing state file keep the unavailable gateway, so nothing is ever simulated as committed.
 */
async function resolveLedger(options: BuildAppOptions, db: DbHandle, log: { warn(msg: string): void }): Promise<{ gateway: LedgerGateway; access: LedgerAccess | null }> {
  const { config } = options;
  let access = options.ledgerAccess ?? null;
  if (options.ledgerAccess === undefined && config.COLLARA_MODE === "DEVNET" && config.NODE_ENV !== "test") {
    access = await devnetLedgerAccess({ env: config, db: db.db, submitTimeoutMs: config.CANTON_SUBMIT_TIMEOUT_MS });
    if (!access) log.warn("DEVNET without a DevNet state: ledger commands are recorded as FAILED (run node scripts/devnet/import-bindings.mjs)");
  }
  if (options.ledgerAccess === undefined && config.COLLARA_MODE === "LOCALNET" && config.NODE_ENV !== "test") {
    access = await LedgerAccess.fromStateFile({
      ...(config.COLLARA_LOCALNET_STATE ? { path: config.COLLARA_LOCALNET_STATE } : {}),
      secret: config.CANTON_JWT_HMAC_SECRET ?? DEV_HMAC_SECRET,
      ...(config.CANTON_JWT_AUDIENCE ? { audience: config.CANTON_JWT_AUDIENCE } : {}),
      submitTimeoutMs: config.CANTON_SUBMIT_TIMEOUT_MS,
    });
    if (!access) log.warn("LOCALNET without a LocalNet bootstrap state: ledger commands are recorded as FAILED (run scripts/localnet/bootstrap.mjs)");
  }
  const gateway = options.ledger ?? (access ? new CantonLedgerGateway(access) : unavailableLedgerGateway);
  return { gateway, access };
}

declare module "fastify" {
  interface FastifyInstance {
    services: AppServices | null;
  }
}

function toProblem(error: unknown): { problem: ProblemError; log: boolean } {
  if (isProblemError(error)) return { problem: error, log: error.statusCode >= 500 };
  // A fresh ledger read outside a command's prepare step (e.g. a registry lookup) could not reach the participant:
  // 503 with the approved copy, nothing was submitted. Never a 500 and never a simulated success.
  if (isLedgerError(error) && (error.info.commandState === "FAILED" || error.info.commandState === "UNKNOWN_OUTCOME")) {
    return { problem: problemError("ledger_unavailable", COMMAND_COPY.LEDGER_UNAVAILABLE), log: true };
  }
  if (hasZodFastifySchemaValidationErrors(error)) {
    const issues = error.validation.map((issue) => ({
      path: `${error.validationContext ?? "body"}${issue.instancePath.replaceAll("/", ".")}`,
      message: issue.message ?? "Invalid value",
    }));
    return { problem: problems.validation(issues), log: false };
  }
  const status = numberField(error, "statusCode") ?? 500;
  if (status >= 500 || status < 400 || isResponseSerializationError(error)) return { problem: problems.internal(), log: true };
  // Client errors raised by Fastify itself (bad JSON, unsupported media type, payload too large, rate limit).
  const message = error instanceof Error ? error.message : undefined;
  switch (status) {
    case 401:
      return { problem: problems.unauthenticated(), log: false };
    case 403:
      return { problem: problems.forbidden(), log: false };
    case 404:
      return { problem: problems.unavailable(), log: false };
    case 409:
      return { problem: problems.stateConflict(), log: false };
    case 429:
      return { problem: problems.rateLimited(), log: false };
    default:
      return { problem: problemError("validation_error", message ?? ERROR_COPY.VALIDATION, undefined, status), log: false };
  }
}

export async function buildApp(options: BuildAppOptions) {
  const { config } = options;
  const clock = options.clock ?? (() => new Date());
  const app = Fastify({
    logger: options.logger ?? loggerOptions(config),
    trustProxy: config.TRUST_PROXY ?? false,
    // Request ids are generated here; a client-supplied x-request-id is not trusted.
    genReqId: () => randomUUID(),
    requestIdHeader: false,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(parseSerializerCompiler);

  app.setErrorHandler((error, request, reply) => {
    const { problem, log } = toProblem(error);
    if (log) request.log.error({ err: error }, "request failed");
    return reply
      .code(problem.problem.status)
      .type(PROBLEM_CONTENT_TYPE)
      .send({ ...problem.problem, instance: `urn:collara:request:${request.id}` });
  });
  app.setNotFoundHandler((request, reply) =>
    reply
      .code(404)
      .type(PROBLEM_CONTENT_TYPE)
      .send({ ...problems.unavailable().problem, instance: `urn:collara:request:${request.id}` }),
  );

  await app.register(security, { config });
  await app.register(rateLimit, {
    global: false,
    // The thrown object reaches the error handler, which renders the 429 problem.
    errorResponseBuilder: (_request, context) => Object.assign(new Error(`Rate limit exceeded, retry in ${context.after}`), { statusCode: 429 }),
  });

  await app.register(swagger, {
    openapi: {
      info: { title: "Collara API", version: API_VERSION, description: "Synthetic demo data only. Errors are application/problem+json (RFC 9457)." },
    },
    transform: jsonSchemaTransform,
  });
  if (options.apiDocs ?? true) {
    await app.register(swaggerUi, {
      routePrefix: "/api/docs",
      staticCSP: true,
      // The docs are served over plain http locally; upgrade-insecure-requests would break their assets.
      transformStaticCSP: (header) => header.replace(/\s*upgrade-insecure-requests;?/, ""),
    });
  }

  const db = options.db ?? null;
  const storage = options.storage === undefined ? createS3Storage(config) : options.storage;
  await app.register(systemRoutes, {
    prefix: "/api/system",
    mode: config.COLLARA_MODE,
    version: API_VERSION,
    db,
    storage,
    probeLedger:
      options.probeLedger ??
      (config.COLLARA_MODE === "DEVNET"
        ? () => probeLedger({ statePath: devnetStatePath(config), credentialStatus: db ? () => devnetCredentialStatus(config, db.db) : undefined })
        : () => probeLedger({ statePath: config.COLLARA_LOCALNET_STATE })),
    workerStaleAfterSeconds: config.WORKER_STALE_AFTER_SECONDS,
    workerMode: config.WORKER_MODE,
    clock,
  });

  if (!db) {
    app.decorate("services", null);
    app.decorate("workflow", null);
    return app;
  }

  const { gateway: ledger, access } = await resolveLedger(options, db, app.log);
  const projections = options.projections ?? createDbProjectionReader(db.db);
  const commands = new CommandService(db.db, ledger, clock);
  const oidc = options.oidc === undefined ? createOidcService(config) : options.oidc;
  const services = { db, commands, projections, storage, ledger, oidc, clock } satisfies AppServices;
  const workflow = createWorkflowServices({ db: db.db, gateway: ledger, access, clock });
  app.decorate("services", services);
  app.decorate("workflow", workflow);

  await app.register(sessions, { config, db: db.db, clock });
  await app.register(actorResolution, { db: db.db });

  await app.register(authRoutes, { prefix: "/api/auth", config, db: db.db, oidc, clock });
  await app.register(meRoutes, { prefix: "/api/me", mode: config.COLLARA_MODE });
  await app.register(demoRoutes, { prefix: "/api/demo", db: db.db, mode: config.COLLARA_MODE, demoSessionsEnabled: config.DEMO_SESSIONS_ENABLED });
  await app.register(pilotRoutes, {
    prefix: "/api/pilot-requests",
    db: db.db,
    clock,
    rateLimit: { max: config.PILOT_RATE_LIMIT_MAX, timeWindowMs: config.PILOT_RATE_LIMIT_WINDOW_MS },
  });
  await app.register(commandRoutes, { prefix: "/api/commands", commands });
  await app.register(evidenceRoutes, { prefix: "/api/evidence", db: db.db, storage, commands, projections, clock, uploadMode: config.STORAGE_UPLOAD_MODE });
  // Workflow modules (cases, assets, verification, reviews, proposals, pledges, release, access, audit,
  // reports, governance incl. GET /verifiers): one registration; each module declares its full paths under /api.
  await app.register(workflowRoutes, { prefix: "/api", services, workflow, mode: config.COLLARA_MODE });
  await app.register(directoryRoutes, { prefix: "/api/directory", db: db.db });
  await app.register(overviewRoutes, { prefix: "/api/overview", db: db.db, mode: config.COLLARA_MODE, clock });

  return app;
}

export type CollaraApp = Awaited<ReturnType<typeof buildApp>>;

function numberField(value: unknown, key: string): number | undefined {
  const field = typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
  return typeof field === "number" ? field : undefined;
}
