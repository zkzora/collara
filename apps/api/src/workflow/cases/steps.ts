// Small helpers for reading domain refs back from committed steps.
import { PAYLOAD_SCHEMAS, type Payload, type PayloadTemplate } from "../../ledger/contracts";
import type { CommittedStep } from "../run";

/**
 * A field of the first created contract of a template in a committed step (e.g. the grantRef of the created
 * AuditGrant), so the stored result always names what the ledger committed — also when an UNKNOWN_OUTCOME
 * resubmission committed a submission prepared by an earlier request. Falls back when the gateway returned no
 * transaction (a deduplicated resubmission).
 */
export function createdField<N extends PayloadTemplate, K extends keyof Payload<N>>(step: CommittedStep, template: N, field: K, fallback: Payload<N>[K]): Payload<N>[K] {
  const created = step.created.find((c) => c.template === template);
  if (!created) return fallback;
  const parsed = PAYLOAD_SCHEMAS[template].safeParse(created.argument);
  return parsed.success ? (parsed.data as Payload<N>)[field] : fallback;
}
