// Display references. They are kept in the DB and carried as Daml `Text` refs, separate from
// contract ids (which change on every sandbox restart). Synthesis §1.6, P-Dash §4.6.
import { z } from "zod";

export const ASSET_NAMESPACE = "collara-localnet";
export const CREDIT_POLICY_REF = "CP-2026-CNC-01";
/** Maximum advance rate under CP-2026-CNC-01, in percent. */
export const CREDIT_POLICY_MAX_ADVANCE_PERCENT = "70.0";

export const REF_KINDS = {
  case: { prefix: "CL", digits: 3 },
  asset: { prefix: "ASSET-DEMO", digits: 3 },
  document: { prefix: "DOC", digits: 3 },
  package: { prefix: "PKG", digits: 3 },
  verification: { prefix: "VR", digits: 3 },
  attestation: { prefix: "ATT", digits: 3 },
  assessment: { prefix: "CA", digits: 3 },
  proposal: { prefix: "FP", digits: 3 },
  pledge: { prefix: "PL", digits: 3 },
  releaseRequest: { prefix: "RR", digits: 3 },
  report: { prefix: "RPT", digits: 4 },
  governanceProposal: { prefix: "GP", digits: 3 },
  verifier: { prefix: "VER", digits: 3 },
  // Not defined by any source; inferred for access/audit grants.
  accessGrant: { prefix: "AG", digits: 3 },
} as const;

export type RefKind = keyof typeof REF_KINDS;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PATTERNS = Object.fromEntries(
  Object.entries(REF_KINDS).map(([kind, { prefix, digits }]) => [
    kind,
    new RegExp(`^${escapeRegExp(prefix)}-(\\d{${digits},})$`),
  ]),
) as Record<RefKind, RegExp>;

export function refPattern(kind: RefKind): RegExp {
  return PATTERNS[kind];
}

/** formatRef("case", 1) → "CL-001"; formatRef("report", 12) → "RPT-0012". */
export function formatRef(kind: RefKind, n: number): string {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`Reference numbers start at 1 (got ${n}).`);
  const { prefix, digits } = REF_KINDS[kind];
  return `${prefix}-${String(n).padStart(digits, "0")}`;
}

/** The numeric part of a reference, or null if it does not match the kind's format. */
export function parseRef(kind: RefKind, ref: string): number | null {
  const match = PATTERNS[kind].exec(ref);
  return match?.[1] ? Number.parseInt(match[1], 10) : null;
}

export function isRef(kind: RefKind, value: unknown): value is string {
  return typeof value === "string" && PATTERNS[kind].test(value);
}

/** Lowest unused number for a kind (deterministic; fixes the prototype's "GP-0010" concatenation bug). */
export function nextFreeRef(kind: RefKind, used: Iterable<string>): string {
  const taken = new Set<number>();
  for (const ref of used) {
    const n = parseRef(kind, ref);
    if (n !== null) taken.add(n);
  }
  let n = 1;
  while (taken.has(n)) n += 1;
  return formatRef(kind, n);
}

/** "PKG-001 v2" */
export function formatVersionedRef(ref: string, version: number): string {
  return `${ref} v${version}`;
}

/** "9b12…e7a0" — technical hashes are abbreviated in the UI. */
export function abbreviateHash(hash: string, head = 4, tail = 4): string {
  return hash.length <= head + tail + 1 ? hash : `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

export function refSchema(kind: RefKind) {
  const { prefix, digits } = REF_KINDS[kind];
  return z.string().regex(PATTERNS[kind], `Expected a reference like ${prefix}-${"0".repeat(digits - 1)}1.`);
}

export const CaseRefSchema = refSchema("case");
export const AssetRefSchema = refSchema("asset");
export const DocumentRefSchema = refSchema("document");
export const PackageRefSchema = refSchema("package");
export const VerificationRefSchema = refSchema("verification");
export const AttestationRefSchema = refSchema("attestation");
export const AssessmentRefSchema = refSchema("assessment");
export const ProposalRefSchema = refSchema("proposal");
export const PledgeRefSchema = refSchema("pledge");
export const ReleaseRequestRefSchema = refSchema("releaseRequest");
export const ReportRefSchema = refSchema("report");
export const GovernanceProposalRefSchema = refSchema("governanceProposal");
export const VerifierRefSchema = refSchema("verifier");
export const AccessGrantRefSchema = refSchema("accessGrant");
