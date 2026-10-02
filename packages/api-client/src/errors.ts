import {
  ApiProblemSchema,
  COMMAND_COPY,
  ERROR_COPY,
  PROBLEM_CODES,
  PROBLEM_TITLES,
  problemFor,
  type ApiProblem,
  type ProblemCode,
} from "@collara/domain";

/** Problem codes from the API plus client-side failure modes. */
export type ApiErrorCode = ProblemCode | "network_error" | "invalid_response" | "upstream_unavailable";

const CLIENT_TITLES: Readonly<Record<Exclude<ApiErrorCode, ProblemCode>, string>> = {
  network_error: "Network error",
  invalid_response: "Invalid response",
  upstream_unavailable: "Service unavailable",
};

function title(code: ApiErrorCode): string {
  return (PROBLEM_CODES as readonly string[]).includes(code)
    ? PROBLEM_TITLES[code as ProblemCode]
    : CLIENT_TITLES[code as Exclude<ApiErrorCode, ProblemCode>];
}

function isProblemCode(value: string): value is ProblemCode {
  return (PROBLEM_CODES as readonly string[]).includes(value);
}

function codeForStatus(status: number): ApiErrorCode {
  switch (status) {
    case 400:
    case 422:
      return "validation_error";
    case 401:
      return "unauthenticated";
    case 403:
      return "forbidden";
    case 404:
      return "unavailable";
    case 409:
      return "state_conflict";
    case 429:
      return "rate_limited";
    case 502:
    case 504:
      return "upstream_unavailable";
    case 503:
      return "ledger_unavailable";
    default:
      return "internal_error";
  }
}

export class ApiError extends Error {
  /** HTTP status; 0 when no response was received. */
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly problem: ApiProblem | null;

  constructor(status: number, code: ApiErrorCode, message: string, problem: ApiProblem | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.problem = problem;
  }

  /** A problem+json error exactly as the API reports it (used by the UI_MOCK client). */
  static problem(code: ProblemCode, detail?: string, issues?: ApiProblem["issues"]): ApiError {
    const problem = problemFor(code, detail, issues);
    return new ApiError(problem.status, code, detail ?? problem.title, problem);
  }

  /**
   * Normalises any error body: RFC 9457 problems, the API's `{ error, issues }` validation shape and
   * the web proxy's `{ error: "upstream_unavailable" | "upstream_timeout" }`.
   */
  static fromResponse(status: number, body: unknown): ApiError {
    const parsed = ApiProblemSchema.safeParse(body);
    if (parsed.success) return new ApiError(status, parsed.data.code, parsed.data.detail ?? parsed.data.title, parsed.data);
    const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    const raw = typeof record.error === "string" ? record.error : null;
    const code: ApiErrorCode =
      raw && isProblemCode(raw)
        ? raw
        : raw === "upstream_unavailable" || raw === "upstream_timeout"
          ? "upstream_unavailable"
          : codeForStatus(status);
    const issues = Array.isArray(record.issues)
      ? record.issues.flatMap((issue: unknown) => {
          const i = (typeof issue === "object" && issue !== null ? issue : {}) as Record<string, unknown>;
          return typeof i.message === "string" ? [{ path: String(i.path ?? ""), message: i.message }] : [];
        })
      : undefined;
    const detail = typeof record.detail === "string" ? record.detail : undefined;
    const problem = isProblemCode(code) ? { ...problemFor(code, detail, issues), status } : null;
    return new ApiError(status, code, detail ?? title(code), problem);
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** User-facing copy for an error (approved copy where it exists; never reveals existence). */
export function errorMessage(error: unknown): string {
  if (!isApiError(error)) return ERROR_COPY.UNAVAILABLE;
  switch (error.code) {
    case "unavailable":
      return ERROR_COPY.UNAVAILABLE;
    case "state_conflict":
      return error.problem?.detail ?? COMMAND_COPY.STATE_CHANGED;
    case "ledger_unavailable":
      return COMMAND_COPY.LEDGER_UNAVAILABLE;
    case "forbidden":
      return error.problem?.detail ?? ERROR_COPY.FORBIDDEN;
    case "idempotency_conflict":
      return ERROR_COPY.IDEMPOTENCY_CONFLICT;
    case "validation_error":
      return error.problem?.detail ?? ERROR_COPY.VALIDATION;
    default:
      return error.problem?.detail ?? error.message;
  }
}
