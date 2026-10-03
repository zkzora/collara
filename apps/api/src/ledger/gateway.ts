// LedgerGateway on @collara/canton (synthesis §1.5.2, ADR-0001 §2.6):
// - submits as the organisation's least-privilege ledger user with the command record's deterministic
//   commandId and a fresh submissionId per attempt;
// - LOCAL_VERDICT_LOCKED_CONTRACTS → bounded retry with the same commandId;
// - DUPLICATE_COMMAND accepted → committed (the original transaction is read back at its completion
//   offset); not accepted → unknown;
// - timeouts and 5xx → unknown (never "failed"); 401/403/ledger down → failed; Daml rejections → rejected.
import { randomUUID } from "node:crypto";
import type { CommandRow } from "@collara/db";
import { isLedgerError, LedgerError, type LedgerClient, type LedgerTransaction } from "@collara/canton";
import type { LedgerGateway, LedgerSubmitOutcome, LedgerSubmitRequest } from "../services/ledger";
import { LedgerResetError, type LedgerAccess } from "./access";

export interface CantonGatewayOptions {
  /** Retries of LOCKED_CONTRACTS with the same commandId (default 3). */
  readonly lockedRetries?: number;
  /** Base back-off when the ledger gives no retryInfo (default 500 ms, linear). */
  readonly lockedBackoffMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class CantonLedgerGateway implements LedgerGateway {
  readonly #access: LedgerAccess;
  readonly #options: Required<CantonGatewayOptions>;

  constructor(access: LedgerAccess, options: CantonGatewayOptions = {}) {
    this.#access = access;
    this.#options = {
      lockedRetries: options.lockedRetries ?? 3,
      lockedBackoffMs: options.lockedBackoffMs ?? 500,
      sleep: options.sleep ?? defaultSleep,
    };
  }

  get access(): LedgerAccess {
    return this.#access;
  }

  /** Ledger end of the user's participant (recorded before a first submission for exact reconciliation). */
  async ledgerEnd(request: { readonly ledgerUserId: string; readonly source?: string }): Promise<number> {
    return this.#access.client(request.ledgerUserId, request.source).ledgerEnd();
  }

  async submit(_command: CommandRow, request: LedgerSubmitRequest): Promise<LedgerSubmitOutcome> {
    try {
      await this.#access.assertSameLedger(request.ledgerUserId, request.source);
    } catch (error) {
      if (error instanceof LedgerResetError) return { kind: "failed", errorKind: "LEDGER_RESET", message: error.message };
      return outcomeOf(error);
    }
    const client = this.#access.client(request.ledgerUserId, request.source);
    const visible = [...request.actAs, ...request.readAs];
    for (let attempt = 0; ; attempt++) {
      try {
        const transaction = await client.submitAndWaitForTransaction({
          commandId: request.commandId,
          // The first attempt uses the command record's submission id; bounded retries get fresh ones.
          submissionId: attempt === 0 ? request.submissionId : randomUUID(),
          userId: request.ledgerUserId,
          actAs: [...request.actAs],
          ...(request.readAs.length ? { readAs: [...request.readAs] } : {}),
          commands: [...request.commands],
          shape: "LEDGER_EFFECTS",
        });
        return { kind: "committed", updateId: transaction.updateId, offset: transaction.offset, transaction };
      } catch (error) {
        if (!isLedgerError(error)) return outcomeOf(error);
        const info = error.info;
        if (info.kind === "LOCKED_CONTRACTS" && attempt < this.#options.lockedRetries) {
          await this.#options.sleep(info.retryAfterMs ?? this.#options.lockedBackoffMs * (attempt + 1));
          continue;
        }
        if (info.kind === "DUPLICATE_COMMAND" && info.commandState === "COMMITTED" && info.duplicate?.completionOffset !== undefined) {
          const offset = info.duplicate.completionOffset;
          const transaction = await transactionAt(client, visible, offset).catch(() => undefined);
          if (transaction) return { kind: "committed", updateId: transaction.updateId, offset, transaction, deduplicated: true };
          // Committed for sure, but the update id could not be read back: report unknown so the
          // runner retries (and never shows success without an update id).
          return { kind: "unknown", errorKind: "DUPLICATE_COMMAND", code: info.code, message: `committed at offset ${offset}; update id not yet readable` };
        }
        return outcomeOf(error);
      }
    }
  }
}

/** Maps a thrown error to an outcome using the canton classifier (synthesis §1.5.2). */
export function outcomeOf(error: unknown): LedgerSubmitOutcome {
  if (!(error instanceof LedgerError)) {
    return { kind: "unknown", errorKind: "UNKNOWN", message: error instanceof Error ? error.message : String(error) };
  }
  const { info } = error;
  const base = {
    errorKind: info.kind,
    message: info.message,
    ...(info.code ? { code: info.code } : {}),
    ...(info.retryAfterMs !== undefined ? { retryAfterMs: info.retryAfterMs } : {}),
  };
  switch (info.commandState) {
    case "REJECTED":
      return { kind: "rejected", ...base };
    case "FAILED":
      return { kind: "failed", ...base };
    case "UNKNOWN_OUTCOME":
    case "COMMITTED": // a committed duplicate without an offset: the update id is unknown
      return { kind: "unknown", ...base };
  }
}

/** The transaction committed at `offset`, as visible to `parties` (LEDGER_EFFECTS). */
export async function transactionAt(client: LedgerClient, parties: readonly string[], offset: number): Promise<LedgerTransaction | undefined> {
  const page = await client.updates({ beginExclusive: offset - 1, endInclusive: offset, parties: [...parties], shape: "LEDGER_EFFECTS" });
  for (const update of page.updates) {
    if (update.kind === "transaction" && update.offset === offset) return update.transaction;
  }
  return undefined;
}
