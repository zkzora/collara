import { z } from "zod";

/**
 * Error kinds. The first ten are the command-lifecycle kinds from docs/_research/synthesis.md
 * §1.5.2; NOT_FOUND, ALREADY_EXISTS and FAILED_PRECONDITION cover non-contract resources
 * (users, templates, packages) and Daml failures (`ensure`, `assert`, `abort`, exceptions).
 */
export const LEDGER_ERROR_KINDS = [
  "DUPLICATE_COMMAND",
  "CONTRACT_NOT_FOUND",
  "LOCKED_CONTRACTS",
  "AUTHORIZATION",
  "INVALID_ARGUMENT",
  "UNAUTHENTICATED",
  "PERMISSION_DENIED",
  "UNAVAILABLE",
  "TIMEOUT",
  "UNKNOWN",
  "NOT_FOUND",
  "ALREADY_EXISTS",
  "FAILED_PRECONDITION",
] as const;
export type LedgerErrorKind = (typeof LEDGER_ERROR_KINDS)[number];

/**
 * The command state to record when the caller stops here (no retry). Only meaningful for
 * submissions; reads use the same classification for kind and retryability.
 * - COMMITTED: a DUPLICATE_COMMAND whose original submission was accepted.
 * - REJECTED: definitely not committed (business/authorization/contention rejection).
 * - FAILED: never reached the ledger (auth, ledger down); nothing was recorded.
 * - UNKNOWN_OUTCOME: may or may not have committed; reconcile with the same commandId.
 */
export type LedgerCommandState = "COMMITTED" | "REJECTED" | "FAILED" | "UNKNOWN_OUTCOME";

export interface LedgerErrorInfo {
  kind: LedgerErrorKind;
  commandState: LedgerCommandState;
  /** True when the outcome of this attempt is known (committed, or certainly not committed). */
  definite: boolean;
  /** True when resubmitting the same commandId (or repeating the read) may succeed. */
  retryable: boolean;
  /** Canton error code id, e.g. CONTRACT_NOT_FOUND. Auth errors are redacted to "NA". */
  code?: string;
  httpStatus?: number;
  grpcCode?: number;
  errorCategory?: number;
  /** Parsed from `retryInfo` (e.g. "1 second"). */
  retryAfterMs?: number;
  /** The server's own definite-answer flag, when present (often "false" even for rejections). */
  serverDefiniteAnswer?: boolean;
  /** Present for DUPLICATE_COMMAND: whether the original submission was accepted, and where. */
  duplicate?: { accepted: boolean; completionOffset?: number; existingSubmissionId?: string };
  /**
   * Code and cause, truncated. The cause can contain party ids and contract arguments, so do
   * not show it to other organisations. Tokens are never included.
   */
  message: string;
  /** The raw error body (parsed JSON or text) or the thrown error. */
  original: unknown;
}

/** JsCantonError as served by the JSON Ledger API v2 (lenient: optional fields may be null). */
export const JsCantonErrorSchema = z.object({
  code: z.string(),
  cause: z.string().nullish(),
  correlationId: z.string().nullish(),
  traceId: z.string().nullish(),
  context: z.record(z.string(), z.unknown()).nullish(),
  resources: z.array(z.array(z.string())).nullish(),
  errorCategory: z.number().nullish(),
  grpcCodeValue: z.number().nullish(),
  retryInfo: z.string().nullish(),
  definiteAnswer: z.boolean().nullish(),
});
export type JsCantonError = z.infer<typeof JsCantonErrorSchema>;

type Outcome = Pick<LedgerErrorInfo, "kind" | "commandState" | "definite" | "retryable">;

const outcome = (
  kind: LedgerErrorKind,
  commandState: LedgerCommandState,
  definite: boolean,
  retryable: boolean,
): Outcome => ({ kind, commandState, definite, retryable });

const REJECTED = (kind: LedgerErrorKind) => outcome(kind, "REJECTED", true, false);
const UNKNOWN_OUTCOME = (kind: LedgerErrorKind, retryable = true) => outcome(kind, "UNKNOWN_OUTCOME", false, retryable);
const FAILED = (kind: LedgerErrorKind, retryable: boolean) => outcome(kind, "FAILED", true, retryable);

/** Canton error categories (`errorCategory`), see the Canton error-code reference. */
function byCategory(category: number | undefined): Outcome | undefined {
  switch (category) {
    case 1: // TransientServerFailure
    case 13: // BackgroundProcessDegradationWarning
      return UNKNOWN_OUTCOME("UNAVAILABLE");
    case 2: // ContentionOnSharedResources
      return { ...REJECTED("LOCKED_CONTRACTS"), retryable: true };
    case 3: // DeadlineExceededRequestStateUnknown
      return UNKNOWN_OUTCOME("TIMEOUT");
    case 4: // SystemInternalAssumptionViolated (also used for some JSON decoding errors)
    case 5: // MaliciousOrFaultyBehaviour
      return UNKNOWN_OUTCOME("UNKNOWN", false);
    case 6:
      return FAILED("UNAUTHENTICATED", false);
    case 7:
      return FAILED("PERMISSION_DENIED", false);
    case 8: // InvalidIndependentOfSystemState
    case 12: // SeekAfterEnd
    case 14: // InternalUnsupportedOperation
      return REJECTED("INVALID_ARGUMENT");
    case 9: // InvalidGivenCurrentSystemStateOther (DAML_FAILURE, ...)
      return REJECTED("FAILED_PRECONDITION");
    case 10:
      return REJECTED("ALREADY_EXISTS");
    case 11:
      return REJECTED("NOT_FOUND");
    default:
      return undefined;
  }
}

/** gRPC status codes, used when the body is redacted ("code":"NA", errorCategory -1). */
function byGrpcCode(grpc: number | undefined): Outcome | undefined {
  switch (grpc) {
    case 16:
      return FAILED("UNAUTHENTICATED", false);
    case 7:
      return FAILED("PERMISSION_DENIED", false);
    case 14:
      return UNKNOWN_OUTCOME("UNAVAILABLE");
    case 4:
      return UNKNOWN_OUTCOME("TIMEOUT");
    default:
      return undefined;
  }
}

function byHttpStatus(status: number): Outcome {
  if (status === 401) return FAILED("UNAUTHENTICATED", false);
  if (status === 403) return FAILED("PERMISSION_DENIED", false);
  if (status === 404) return REJECTED("NOT_FOUND");
  if (status === 409) return REJECTED("ALREADY_EXISTS");
  if (status === 408 || status === 504) return UNKNOWN_OUTCOME("TIMEOUT");
  if (status === 429) return FAILED("UNAVAILABLE", true);
  if (status === 502 || status === 503) return UNKNOWN_OUTCOME("UNAVAILABLE");
  if (status >= 500) return UNKNOWN_OUTCOME("UNKNOWN");
  if (status >= 400) return REJECTED("INVALID_ARGUMENT");
  return UNKNOWN_OUTCOME("UNKNOWN", false);
}

function byCode(error: JsCantonError, context: Record<string, string>): Partial<LedgerErrorInfo> | undefined {
  switch (error.code) {
    case "DUPLICATE_COMMAND": {
      // The original submission of this change id (userId, actAs, commandId) exists.
      // accepted:"true" means it committed at completion_offset; otherwise it is still in flight.
      const accepted = context.accepted === "true";
      const offset = Number(context.completion_offset);
      const existing = context.existingSubmissionId?.match(/^Some\((.*)\)$/)?.[1];
      return {
        ...(accepted ? outcome("DUPLICATE_COMMAND", "COMMITTED", true, false) : UNKNOWN_OUTCOME("DUPLICATE_COMMAND")),
        duplicate: {
          accepted,
          ...(Number.isFinite(offset) && context.completion_offset !== undefined ? { completionOffset: offset } : {}),
          ...(existing ? { existingSubmissionId: existing } : {}),
        },
      };
    }
    case "SUBMISSION_ALREADY_IN_FLIGHT":
      return UNKNOWN_OUTCOME("DUPLICATE_COMMAND");
    case "CONTRACT_NOT_FOUND":
      return REJECTED("CONTRACT_NOT_FOUND");
    case "LOCAL_VERDICT_LOCKED_CONTRACTS":
      return { ...REJECTED("LOCKED_CONTRACTS"), retryable: true };
    case "DAML_AUTHORIZATION_ERROR":
      return REJECTED("AUTHORIZATION");
    default:
      return undefined;
  }
}

function parseRetryInfo(value: string | null | undefined): number | undefined {
  const match = value?.match(/^(\d+(?:\.\d+)?)\s*(millisecond|second|minute)s?$/);
  if (!match?.[1]) return undefined;
  const unit = match[2] === "millisecond" ? 1 : match[2] === "second" ? 1000 : 60_000;
  return Math.round(Number(match[1]) * unit);
}

function stringContext(context: Record<string, unknown> | null | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(context ?? {})) {
    if (typeof value === "string") result[key] = value;
  }
  return result;
}

const truncate = (text: string, max = 500) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** Network errors whose request certainly never reached the server. */
const NOT_SENT_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"]);

function networkCodes(error: unknown, depth = 0): string[] {
  if (!error || typeof error !== "object" || depth > 4) return [];
  const codes: string[] = [];
  const record = error as { code?: unknown; cause?: unknown; errors?: unknown };
  if (typeof record.code === "string") codes.push(record.code);
  if (record.cause) codes.push(...networkCodes(record.cause, depth + 1));
  if (Array.isArray(record.errors)) for (const inner of record.errors) codes.push(...networkCodes(inner, depth + 1));
  return codes;
}

/**
 * Classifies a JSON Ledger API failure: either an HTTP response (`status` + parsed `body`) or a
 * thrown error (`error`: timeout, abort, network). Mapping follows synthesis §1.5.2:
 * 409 DUPLICATE_COMMAND accepted -> COMMITTED; 409 LOCKED -> retry the same change id;
 * 404 CONTRACT_NOT_FOUND and 400 DAML_AUTHORIZATION_ERROR -> REJECTED; 401/403 or ledger down
 * -> FAILED; timeouts and 5xx -> UNKNOWN_OUTCOME.
 */
export function classifyLedgerError(input: { status?: number; body?: unknown; error?: unknown }): LedgerErrorInfo {
  if (input.status === undefined) {
    const error = input.error;
    const name = error instanceof Error || (typeof error === "object" && error !== null) ? (error as Error).name : "";
    if (name === "TimeoutError") {
      return { ...UNKNOWN_OUTCOME("TIMEOUT"), message: "request timed out", original: error };
    }
    if (name === "AbortError") {
      return { ...UNKNOWN_OUTCOME("UNKNOWN"), message: "request aborted", original: error };
    }
    const codes = networkCodes(error);
    if (codes.length > 0) {
      const notSent = codes.some((code) => NOT_SENT_CODES.has(code));
      return {
        ...(notSent ? FAILED("UNAVAILABLE", true) : UNKNOWN_OUTCOME("UNAVAILABLE")),
        message: `ledger unreachable (${[...new Set(codes)].join(", ")})`,
        original: error,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { ...UNKNOWN_OUTCOME("UNKNOWN", false), message: truncate(message), original: error };
  }

  const status = input.status;
  const parsed = JsCantonErrorSchema.safeParse(input.body);
  if (!parsed.success) {
    const text = typeof input.body === "string" ? input.body : JSON.stringify(input.body ?? "");
    return { ...byHttpStatus(status), httpStatus: status, message: truncate(`HTTP ${status}: ${text}`), original: input.body };
  }

  const error = parsed.data;
  const context = stringContext(error.context);
  const category = error.errorCategory ?? (context.category ? Number(context.category) : undefined);
  const grpcCode = error.grpcCodeValue ?? undefined;
  const base =
    byCode(error, context) ??
    (category !== undefined && category >= 0 ? byCategory(category) : undefined) ??
    byGrpcCode(grpcCode) ??
    byHttpStatus(status);
  const serverDefinite =
    error.definiteAnswer ?? (context.definite_answer !== undefined ? context.definite_answer === "true" : undefined);
  const retryAfterMs = parseRetryInfo(error.retryInfo);

  return {
    kind: "UNKNOWN",
    commandState: "UNKNOWN_OUTCOME",
    definite: false,
    retryable: false,
    ...base,
    code: error.code,
    httpStatus: status,
    ...(grpcCode !== undefined ? { grpcCode } : {}),
    ...(category !== undefined && category >= 0 ? { errorCategory: category } : {}),
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    ...(serverDefinite !== undefined ? { serverDefiniteAnswer: serverDefinite } : {}),
    message: truncate(error.cause ? `${error.code}: ${error.cause}` : error.code),
    original: input.body,
  };
}

/**
 * The bearer token could not be obtained (identity provider down, refresh token revoked, token failed
 * validation). The request was never sent, so a submission is FAILED, never UNKNOWN_OUTCOME. The message comes
 * from the token provider, which never includes a token.
 */
export function classifyCredentialFailure(error: unknown): LedgerErrorInfo {
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError") return { ...FAILED("TIMEOUT", true), message: "token request timed out", original: error };
  if (name === "AbortError") return { ...FAILED("UNKNOWN", true), message: "token request aborted", original: error };
  const retryable = typeof error === "object" && error !== null && (error as { retryable?: unknown }).retryable === true;
  const message = error instanceof Error ? error.message : String(error);
  return { ...FAILED("UNAUTHENTICATED", retryable), message: truncate(`ledger token unavailable: ${message}`), original: error };
}

/** Error thrown by LedgerClient for every failed call. */
export class LedgerError extends Error {
  override readonly name = "LedgerError";
  readonly info: LedgerErrorInfo;
  readonly operation: string;

  constructor(operation: string, info: LedgerErrorInfo) {
    super(`${operation}: ${info.message}`);
    this.operation = operation;
    this.info = info;
  }

  get kind(): LedgerErrorKind {
    return this.info.kind;
  }
}

export function isLedgerError(error: unknown): error is LedgerError {
  return error instanceof LedgerError;
}
