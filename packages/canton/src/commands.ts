import type { components } from "./generated/ledger-api";

type Schemas = components["schemas"];
export type LedgerCommand = Schemas["Command"];
export type DeduplicationPeriod = Schemas["DeduplicationPeriod"];
export type DisclosedContract = Schemas["DisclosedContract"];

/**
 * Package-name template reference `#<package-name>:<Module.Path>:<Entity>`. The package-id form
 * is deprecated for submissions; responses still carry package ids (see `templateRefOf`).
 */
export type TemplateId = `#${string}:${string}:${string}`;

const NAME_PART = /^[A-Za-z_][A-Za-z0-9_']*(?:\.[A-Za-z_][A-Za-z0-9_']*)*$/;

export function templateId(packageName: string, moduleName: string, entityName: string): TemplateId {
  if (!/^[A-Za-z0-9_-]+$/.test(packageName)) throw new RangeError(`invalid package name ${JSON.stringify(packageName)}`);
  if (!NAME_PART.test(moduleName) || !NAME_PART.test(entityName)) {
    throw new RangeError(`invalid module or entity name ${moduleName}:${entityName}`);
  }
  return `#${packageName}:${moduleName}:${entityName}`;
}

export interface ParsedTemplateId {
  /** Package name (for `#name:...`) or package id. */
  packageRef: string;
  byPackageName: boolean;
  moduleName: string;
  entityName: string;
}

export function parseTemplateId(id: string): ParsedTemplateId {
  const match = /^(#?)([^:]+):([^:]+):([^:]+)$/.exec(id);
  if (!match?.[2] || !match[3] || !match[4]) throw new RangeError(`not a template id: ${JSON.stringify(id)}`);
  return { packageRef: match[2], byPackageName: match[1] === "#", moduleName: match[3], entityName: match[4] };
}

/**
 * Converts an event's package-id template id plus its `packageName` into the package-name form,
 * so events can be matched against the ids used for submissions.
 */
export function templateRefOf(event: { templateId: string; packageName: string }): TemplateId {
  const { moduleName, entityName } = parseTemplateId(event.templateId);
  return `#${event.packageName}:${moduleName}:${entityName}`;
}

export function create(templateId: TemplateId, createArguments: unknown): LedgerCommand {
  return { CreateCommand: { templateId, createArguments } };
}

/** Exercise a choice. A choice without parameters takes `{}`. */
export function exercise(
  templateId: TemplateId,
  contractId: string,
  choice: string,
  choiceArgument: unknown = {},
): LedgerCommand {
  return { ExerciseCommand: { templateId, contractId, choice, choiceArgument } };
}

export function createAndExercise(
  templateId: TemplateId,
  createArguments: unknown,
  choice: string,
  choiceArgument: unknown = {},
): LedgerCommand {
  return { CreateAndExerciseCommand: { templateId, createArguments, choice, choiceArgument } };
}

/** Deduplication periods. The ledger default when omitted is PT168H (7 days). */
export const deduplication = {
  duration: (seconds: number): DeduplicationPeriod => ({
    DeduplicationDuration: { value: { seconds, nanos: 0 } },
  }),
  sinceOffset: (offset: number): DeduplicationPeriod => ({ DeduplicationOffset: { value: offset } }),
} as const;

/** User rights for POST /v2/users and /v2/users/{id}/rights. */
export const rights = {
  canActAs: (party: string): Schemas["Right"] => ({ kind: { CanActAs: { value: { party } } } }),
  canReadAs: (party: string): Schemas["Right"] => ({ kind: { CanReadAs: { value: { party } } } }),
  canReadAsAnyParty: (): Schemas["Right"] => ({ kind: { CanReadAsAnyParty: { value: {} } } }),
  participantAdmin: (): Schemas["Right"] => ({ kind: { ParticipantAdmin: { value: {} } } }),
} as const;
