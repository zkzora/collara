import { z } from "zod";
import { templateRefOf, type TemplateId } from "./commands";

const parties = z.array(z.string());

const CreatedEventSchema = z.object({
  offset: z.number(),
  nodeId: z.number(),
  contractId: z.string(),
  templateId: z.string(),
  packageName: z.string(),
  createArgument: z.unknown(),
  createdEventBlob: z.string().nullish(),
  witnessParties: parties,
  signatories: parties,
  observers: parties.nullish(),
  createdAt: z.string(),
});

const ArchivedEventSchema = z.object({
  offset: z.number(),
  nodeId: z.number(),
  contractId: z.string(),
  templateId: z.string(),
  packageName: z.string(),
  witnessParties: parties,
});

const ExercisedEventSchema = z.object({
  offset: z.number(),
  nodeId: z.number(),
  contractId: z.string(),
  templateId: z.string(),
  packageName: z.string(),
  interfaceId: z.string().nullish(),
  choice: z.string(),
  choiceArgument: z.unknown(),
  actingParties: parties,
  consuming: z.boolean(),
  witnessParties: parties,
  lastDescendantNodeId: z.number(),
  exerciseResult: z.unknown(),
});

const RawEventSchema = z.union([
  z.object({ CreatedEvent: CreatedEventSchema }),
  z.object({ ArchivedEvent: ArchivedEventSchema }),
  z.object({ ExercisedEvent: ExercisedEventSchema }),
]);

export const RawTransactionSchema = z.object({
  updateId: z.string(),
  commandId: z.string().nullish(),
  workflowId: z.string().nullish(),
  effectiveAt: z.string(),
  offset: z.number(),
  synchronizerId: z.string(),
  recordTime: z.string(),
  events: z.array(RawEventSchema),
});

interface EventBase {
  offset: number;
  nodeId: number;
  contractId: string;
  /** Package-id form as served, e.g. "3281ed…:Module:Template". */
  templateId: string;
  /** Package-name form, e.g. "#collara-contracts:Collara.Control:AssetControl". */
  templateRef: TemplateId;
  packageName: string;
  /** Requesting parties that witnessed this event (stakeholders in ACS_DELTA, witnesses in LEDGER_EFFECTS). */
  witnessParties: string[];
}

export interface CreatedLedgerEvent extends EventBase {
  kind: "created";
  createArgument: unknown;
  signatories: string[];
  observers: string[];
  createdAt: string;
  /** Present when requested with includeCreatedEventBlob (for explicit disclosure). */
  createdEventBlob?: string;
}

export interface ArchivedLedgerEvent extends EventBase {
  kind: "archived";
}

/** Only in the LEDGER_EFFECTS shape. */
export interface ExercisedLedgerEvent extends EventBase {
  kind: "exercised";
  choice: string;
  choiceArgument: unknown;
  actingParties: string[];
  consuming: boolean;
  exerciseResult: unknown;
  lastDescendantNodeId: number;
  interfaceId?: string;
}

export type LedgerEvent = CreatedLedgerEvent | ArchivedLedgerEvent | ExercisedLedgerEvent;

export interface LedgerTransaction {
  updateId: string;
  offset: number;
  /** Empty for parties other than the submitter: correlate by updateId. */
  commandId: string;
  workflowId: string;
  effectiveAt: string;
  recordTime: string;
  synchronizerId: string;
  events: LedgerEvent[];
}

export type LedgerUpdate =
  | { kind: "transaction"; offset: number; transaction: LedgerTransaction }
  | { kind: "checkpoint"; offset: number }
  | { kind: "other"; offset?: number; type: string };

export function normalizeEvent(raw: unknown): LedgerEvent {
  const event = RawEventSchema.parse(raw);
  if ("CreatedEvent" in event) {
    const e = event.CreatedEvent;
    return {
      kind: "created",
      offset: e.offset,
      nodeId: e.nodeId,
      contractId: e.contractId,
      templateId: e.templateId,
      templateRef: templateRefOf(e),
      packageName: e.packageName,
      witnessParties: e.witnessParties,
      createArgument: e.createArgument,
      signatories: e.signatories,
      observers: e.observers ?? [],
      createdAt: e.createdAt,
      ...(e.createdEventBlob ? { createdEventBlob: e.createdEventBlob } : {}),
    };
  }
  if ("ArchivedEvent" in event) {
    const e = event.ArchivedEvent;
    return {
      kind: "archived",
      offset: e.offset,
      nodeId: e.nodeId,
      contractId: e.contractId,
      templateId: e.templateId,
      templateRef: templateRefOf(e),
      packageName: e.packageName,
      witnessParties: e.witnessParties,
    };
  }
  const e = event.ExercisedEvent;
  return {
    kind: "exercised",
    offset: e.offset,
    nodeId: e.nodeId,
    contractId: e.contractId,
    templateId: e.templateId,
    templateRef: templateRefOf(e),
    packageName: e.packageName,
    witnessParties: e.witnessParties,
    choice: e.choice,
    choiceArgument: e.choiceArgument,
    actingParties: e.actingParties,
    consuming: e.consuming,
    exerciseResult: e.exerciseResult,
    lastDescendantNodeId: e.lastDescendantNodeId,
    ...(e.interfaceId ? { interfaceId: e.interfaceId } : {}),
  };
}

export function normalizeTransaction(raw: unknown): LedgerTransaction {
  const tx = RawTransactionSchema.parse(raw);
  return {
    updateId: tx.updateId,
    offset: tx.offset,
    commandId: tx.commandId ?? "",
    workflowId: tx.workflowId ?? "",
    effectiveAt: tx.effectiveAt,
    recordTime: tx.recordTime,
    synchronizerId: tx.synchronizerId,
    events: tx.events.map(normalizeEvent),
  };
}

const RawUpdateSchema = z.object({ update: z.record(z.string(), z.unknown()).nullish() });
const ValueWrapper = z.object({ value: z.unknown() });
const OffsetOnly = z.object({ offset: z.number() }).loose();

/** Normalizes one element of POST /v2/updates (JsGetUpdatesResponse). */
export function normalizeUpdate(raw: unknown): LedgerUpdate {
  const update = RawUpdateSchema.parse(raw).update ?? {};
  const [type, wrapped] = Object.entries(update)[0] ?? ["Empty", undefined];
  const value = ValueWrapper.safeParse(wrapped).success ? (wrapped as { value: unknown }).value : wrapped;
  if (type === "Transaction") {
    const transaction = normalizeTransaction(value);
    return { kind: "transaction", offset: transaction.offset, transaction };
  }
  const offset = OffsetOnly.safeParse(value);
  if (type === "OffsetCheckpoint" && offset.success) return { kind: "checkpoint", offset: offset.data.offset };
  return { kind: "other", type, ...(offset.success ? { offset: offset.data.offset } : {}) };
}

export interface ActiveContract {
  event: CreatedLedgerEvent;
  synchronizerId: string;
  reassignmentCounter: number;
}

const RawActiveEntrySchema = z.object({
  contractEntry: z.record(z.string(), z.unknown()).nullish(),
});
const RawActiveContractSchema = z.object({
  createdEvent: z.unknown(),
  synchronizerId: z.string(),
  reassignmentCounter: z.number(),
});

/** Normalizes one ACS entry; returns undefined for incomplete (un)assignments. */
export function normalizeActiveContract(raw: unknown): ActiveContract | undefined {
  const entry = RawActiveEntrySchema.parse(raw).contractEntry;
  if (!entry || !("JsActiveContract" in entry)) return undefined;
  const active = RawActiveContractSchema.parse(entry.JsActiveContract);
  const event = normalizeEvent({ CreatedEvent: active.createdEvent });
  if (event.kind !== "created") return undefined;
  return { event, synchronizerId: active.synchronizerId, reassignmentCounter: active.reassignmentCounter };
}
