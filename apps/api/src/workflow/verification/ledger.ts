// Fresh ACS lookups for the verification write path (daml-model.md §4.5, §7 M7–M12). Each read runs as the
// acting organisation's ledger user; the verifier registry entry is read as the registrar service (the
// registry is a non-sensitive directory; owners do not observe it).
import type { AcsContract, AcsReader } from "../../ledger/acs";
import type { Payload } from "../../ledger/contracts";
import { problems } from "../../errors";
import { must, mustBeVisible } from "../preconditions";

/** INFERRED copy (same string as the UI_MOCK client): the registry status is re-checked at commit. */
export const VERIFIER_NOT_ACTIVE = "The selected verifier is not active in the verifier registry.";

export interface RegistryVerifier {
  readonly party: string;
  readonly verifierRef: string;
  /** First accredited scope (e.g. CNC_MACHINERY); the ledger rejects requests outside the scope. */
  readonly equipmentScope: string;
}

/**
 * The live accreditation of a registry reference (VER-001) from the registrar's view: ACTIVE, in scope and not
 * expired, or 409. The verifier party comes from the governance-signed accreditation, never from the request.
 */
export async function resolveRegistryVerifier(registrarAcs: AcsReader, input: { verifierRef: string; namespace: string; now: Date }): Promise<RegistryVerifier> {
  const accreditations = await registrarAcs.list("VerifierAccreditation", (a) => a.verifierRef === input.verifierRef && a.registryId === input.namespace);
  const live = accreditations.sort((a, b) => a.payload.registryVersion - b.payload.registryVersion || a.offset - b.offset).at(-1);
  const usable =
    live &&
    live.payload.status === "ACTIVE" &&
    live.payload.scope.length > 0 &&
    (live.payload.validUntil === null || Date.parse(live.payload.validUntil) > input.now.getTime());
  if (!live || !usable) throw problems.stateConflict(VERIFIER_NOT_ACTIVE);
  return { party: live.payload.verifier, verifierRef: live.payload.verifierRef, equipmentScope: live.payload.scope[0] ?? "" };
}

/** The active VerificationRequest version of a ref (404-shaped when this party does not see it). */
export async function activeRequest(acs: AcsReader, input: { ref: string; namespace: string }): Promise<AcsContract<Payload<"VerificationRequest">>> {
  const rows = await acs.list("VerificationRequest", (r) => r.requestRef === input.ref && r.namespace === input.namespace);
  return mustBeVisible(rows.sort((a, b) => a.payload.version - b.payload.version).at(-1));
}

/** The config and the verifier's own live accreditation, as the verifier sees them (VR_AcceptAssignment, VR_IssueAttestation). */
export async function verifierInputs(acs: AcsReader, input: { verifierParty: string; namespace: string }) {
  const [config, accreditations] = await Promise.all([
    acs.one("CollaraConfig", (c) => c.namespace === input.namespace),
    acs.list("VerifierAccreditation", (a) => a.verifier === input.verifierParty && a.registryId === input.namespace && a.status === "ACTIVE"),
  ]);
  const accreditation = accreditations.sort((a, b) => a.payload.registryVersion - b.payload.registryVersion).at(-1);
  // A suspended or missing accreditation: the ledger would reject with "Verifier suspended"; say so before submitting.
  return { config: must(config), accreditation: must(accreditation, () => problems.stateConflict(VERIFIER_NOT_ACTIVE)) };
}
