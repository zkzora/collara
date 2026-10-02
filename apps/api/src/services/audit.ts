// Application-level (operational) audit trail. Never evidence of a ledger state change.
import { auditEvents, type DbOrTx } from "@collara/db";
import type { FastifyBaseLogger } from "fastify";

export interface AuditInput {
  readonly actor?: { readonly userId: string; readonly orgId: string } | null;
  readonly action: string;
  readonly resourceType?: string;
  readonly resourceRef?: string;
  readonly outcome: "SUCCEEDED" | "DENIED" | "FAILED";
  readonly requestId?: string;
  /** Redacted detail only: no document contents, terms, tokens or credentials. */
  readonly detail?: Record<string, string | number | boolean | null>;
}

/** Best effort: an audit write failure is logged, never turned into a user-facing failure. */
export async function recordAudit(db: DbOrTx, input: AuditInput, log?: FastifyBaseLogger): Promise<void> {
  try {
    await db.insert(auditEvents).values({
      actorUserId: input.actor?.userId ?? null,
      orgId: input.actor?.orgId ?? null,
      action: input.action,
      resourceType: input.resourceType ?? null,
      resourceRef: input.resourceRef ?? null,
      outcome: input.outcome,
      requestId: input.requestId ?? null,
      detail: input.detail ?? null,
    });
  } catch (err) {
    log?.error({ err, action: input.action }, "audit write failed");
  }
}
