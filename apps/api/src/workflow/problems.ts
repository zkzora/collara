// Problems specific to the ledger write path (application/problem+json; see src/errors.ts).
import { COMMAND_COPY, ERROR_COPY, STATUS_COPY } from "@collara/domain";
import { problemError, problems, type ProblemError } from "../errors";

export const workflowProblems = {
  /** 503 `ledger_unavailable`: no ledger connection or binding; nothing was submitted. */
  ledgerUnavailable: (): ProblemError => problemError("ledger_unavailable", COMMAND_COPY.LEDGER_UNAVAILABLE),
  /** 409: the authoritative ledger state does not allow the action (read fresh from the ACS). */
  stateChanged: (detail: string = COMMAND_COPY.STATE_CHANGED): ProblemError => problems.stateConflict(detail),
  /** 409: the relied-on attestation is outside its validity period. */
  attestationExpired: (): ProblemError => problems.stateConflict(STATUS_COPY.ATTESTATION_EXPIRED),
  /** 404-shaped: the record does not exist for this actor's ledger view (never reveals existence). */
  unavailable: (): ProblemError => problemError("unavailable", ERROR_COPY.UNAVAILABLE),
} as const;
