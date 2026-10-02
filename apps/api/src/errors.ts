// RFC 9457 problem responses (application/problem+json) built from @collara/domain's problemFor.
// Unrelated or unauthorized resources are 404-shaped and never reveal existence (synthesis §1.2.5).
import { COMMAND_COPY, ERROR_COPY, problemFor, type ApiProblem, type ProblemCode } from "@collara/domain";

export const PROBLEM_CONTENT_TYPE = "application/problem+json";

export class ProblemError extends Error {
  readonly problem: ApiProblem;

  constructor(problem: ApiProblem) {
    super(problem.detail ?? problem.title);
    this.name = "ProblemError";
    this.problem = problem;
  }

  get statusCode(): number {
    return this.problem.status;
  }
}

export function problemError(code: ProblemCode, detail?: string, issues?: ApiProblem["issues"], status?: number): ProblemError {
  const problem = problemFor(code, detail, issues);
  return new ProblemError(status ? { ...problem, status } : problem);
}

export const problems = {
  /** 404-shaped: the record does not exist or the caller is not related to it (indistinguishable). */
  unavailable: () => problemError("unavailable", ERROR_COPY.UNAVAILABLE),
  unauthenticated: () => problemError("unauthenticated"),
  forbidden: (detail: string = ERROR_COPY.FORBIDDEN) => problemError("forbidden", detail),
  stateConflict: (detail: string = COMMAND_COPY.STATE_CHANGED) => problemError("state_conflict", detail),
  idempotencyConflict: () => problemError("idempotency_conflict", ERROR_COPY.IDEMPOTENCY_CONFLICT),
  validation: (issues: ApiProblem["issues"], detail: string = ERROR_COPY.VALIDATION, status?: number) =>
    problemError("validation_error", detail, issues, status),
  rateLimited: () => problemError("rate_limited"),
  /** A dependency (database, object storage) is not available; no state change was recorded. */
  serviceUnavailable: (detail: string) => problemError("internal_error", detail, undefined, 503),
  internal: () => problemError("internal_error"),
};

export function isProblemError(error: unknown): error is ProblemError {
  return error instanceof ProblemError;
}
