// Off-ledger preconditions checked in prepare() against fresh ACS reads (daml-model.md §8). The ledger
// enforces the invariants; these checks give a clear 404/409 before submitting (fast-fail) and pick the inputs
// the ledger then re-checks at commit (e.g. the disclosure's validity marker that Control_Activate fetches).
import type { ProblemError } from "../errors";
import type { AcsContract, AcsReader } from "../ledger/acs";
import type { AttestationDisclosurePayload, ReviewSnapshot } from "../ledger/contracts";
import type { ReviewSnapshotInput } from "../ledger/builders";
import { workflowProblems } from "./problems";

/** The value, or throws the given problem (default: 409 "…the asset workflow state changed."). */
export function must<T>(value: T | null | undefined, problem: () => ProblemError = workflowProblems.stateChanged): T {
  if (value === null || value === undefined) throw problem();
  return value;
}

/** 404-shaped when the actor's ledger view has no such record (never reveals existence). */
export function mustBeVisible<T>(value: T | null | undefined): T {
  return must(value, workflowProblems.unavailable);
}

/** Throws 409 when `at` (ISO) is before `now`. */
export function assertNotExpired(at: string, now: Date, problem: () => ProblemError = workflowProblems.stateChanged): void {
  if (Date.parse(at) < now.getTime()) throw problem();
}

/**
 * daml-model.md §4.5/§8.2: before `Control_Activate` the API confirms that the lender still holds an active
 * `AttestationDisclosure` of the snapshot's attestation whose `DisclosureValidity` is live (revocation, withdrawal
 * and supersession archive both). The activation passes that disclosure's `validityCid`, never any other marker;
 * the ledger fetches it at commit, so a revocation that lands after this check makes the activation fail. Reads
 * the LENDER's ACS (`lenderAcs`), so the verifier is never informed. Also checks the validity period.
 */
export async function requireActiveAttestationDisclosure(
  lenderAcs: AcsReader,
  snapshot: Pick<ReviewSnapshot, "attestationRef" | "attestationVerifier" | "evidence">,
  options: { now: Date; owner?: string; caseRef?: string },
): Promise<AcsContract<AttestationDisclosurePayload>> {
  const recipient = lenderAcs.parties[0];
  const disclosures = await lenderAcs.list(
    "AttestationDisclosure",
    (d) =>
      d.recipient === recipient &&
      d.attestation.attestationRef === snapshot.attestationRef &&
      d.verifier === snapshot.attestationVerifier &&
      (options.owner === undefined || d.owner === options.owner) &&
      (options.caseRef === undefined || d.caseRef === options.caseRef),
  );
  const live = new Set((await lenderAcs.list("DisclosureValidity", (v) => v.recipient === recipient)).map((v) => v.contractId));
  // Newest first: after a revocation the owner may disclose the same attestation again (a new marker).
  const current = disclosures
    .filter(
      (d) =>
        live.has(d.payload.validityCid) &&
        d.payload.attestation.evidence.packageRef === snapshot.evidence.packageRef &&
        d.payload.attestation.evidence.manifestVersion === snapshot.evidence.manifestVersion &&
        d.payload.attestation.evidence.manifestHash === snapshot.evidence.manifestHash,
    )
    .at(-1);
  const disclosure = must(current);
  assertNotExpired(disclosure.payload.attestation.validUntil, options.now, workflowProblems.attestationExpired);
  return disclosure;
}

/** The review snapshot a lender copies from its verifier-signed disclosure (daml-model.md §7 M18). */
export function snapshotFromDisclosure(disclosure: AttestationDisclosurePayload): ReviewSnapshotInput {
  const a = disclosure.attestation;
  return {
    evidence: { packageRef: a.evidence.packageRef, manifestVersion: a.evidence.manifestVersion, manifestHash: a.evidence.manifestHash },
    attestationRef: a.attestationRef,
    attestationVerifier: a.verifier,
    attestationValidUntil: a.validUntil,
  };
}

/** Same evidence anchor (package, version, hash). */
export function sameAnchor(
  a: { packageRef: string; manifestVersion: number; manifestHash: string } | null | undefined,
  b: { packageRef: string; manifestVersion: number; manifestHash: string } | null | undefined,
): boolean {
  return !!a && !!b && a.packageRef === b.packageRef && a.manifestVersion === b.manifestVersion && a.manifestHash === b.manifestHash;
}
