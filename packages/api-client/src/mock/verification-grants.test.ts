// UI_MOCK parity of the verification evidence grants (same rules as the LOCALNET API, apps/api
// workflow/verification/grants.ts): the verifier sees exactly the selected owner documents at the granted versions,
// a resubmission re-grants the selection at the new version, dealer documents need the dealer's consent.
import { describe, expect, it } from "vitest";
import { ApiError } from "../errors";
import { createMockClient } from "./index";

const NOW = new Date("2026-11-15T12:00:00Z");
const PDF = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])], { type: "application/pdf" });

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => {
      throw new Error("expected the call to fail");
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

describe("mock client: verification evidence grants", () => {
  it("grants exactly the selected documents and versions; a resubmission moves the grant to the new version", async () => {
    const client = createMockClient({ personaId: "manufacturer-owner", now: new Date(NOW), latencyMs: 0, profile: "clean-start" });
    const { result } = await client.assets.register({
      intent: "REGISTER",
      equipmentClass: "CNC machining center",
      manufacturer: "Demo Machine Works (synthetic)",
      model: "DEMO-CNC-500",
      serialNumber: "SYNTH-CNC-001",
      locationScope: "Demo Manufacturer facility · Ohio, US (declared)",
    });
    const assetRef = result.assetRef;
    const upload = async (type: "EQUIPMENT_PHOTOS" | "INSPECTION_REPORT" | "MAINTENANCE_SUMMARY", replacesDocumentId?: string) => {
      const intent = await client.evidence.createUploadIntent({
        assetRef,
        type,
        title: type,
        fileName: `${type}.pdf`,
        contentType: "application/pdf",
        sizeBytes: PDF.size,
        ...(replacesDocumentId ? { replacesDocumentId } : {}),
      });
      await client.evidence.uploadContent(intent.result.evidenceId, PDF);
      return (await client.evidence.finalize(intent.result.evidenceId)).result.id;
    };
    const photos = await upload("EQUIPMENT_PHOTOS");
    const inspection = await upload("INSPECTION_REPORT");
    const maintenance = await upload("MAINTENANCE_SUMMARY");

    const vr = (await client.assets.requestVerification(assetRef, { verifierRegistryRef: "VER-001", scope: ["Photos"], documentIds: [photos, inspection] })).result.verificationRef;
    const owner = await client.verifications.get(vr);
    expect(owner.documentIds).toEqual([photos, inspection].sort());
    expect(owner.assignedVersions).toEqual([photos, inspection].sort().map((documentId) => ({ documentId, version: 1 })));

    client.setPersona("verifier-inspector");
    const assigned = await client.assets.evidence(assetRef);
    expect(assigned.map((d) => d.id).sort()).toEqual([photos, inspection].sort());
    expect((await client.evidence.download(inspection)).url).toBeTruthy();
    expect((await rejection(client.evidence.download(maintenance))).code).toBe("unavailable");
    await client.verifications.decideAssignment(vr, { decision: "ACCEPT" });
    await client.verifications.requestChanges(vr, { message: "Please upload the full inspection report." });

    // A new version that is not resubmitted yet stays invisible to the verifier.
    client.setPersona("manufacturer-owner");
    expect((await rejection(client.verifications.submitEvidence(vr))).code).toBe("state_conflict");
    await upload("INSPECTION_REPORT", inspection);
    client.setPersona("verifier-inspector");
    expect((await client.assets.evidence(assetRef)).find((d) => d.id === inspection)?.version).toBe(1);

    // Resubmitted without a selection: the previously granted documents, now at the new version.
    client.setPersona("manufacturer-owner");
    await client.verifications.submitEvidence(vr);
    expect((await client.verifications.get(vr)).assignedVersions).toEqual(
      [
        { documentId: photos, version: 1 },
        { documentId: inspection, version: 2 },
      ].sort((a, b) => a.documentId.localeCompare(b.documentId)),
    );
    client.setPersona("verifier-inspector");
    const after = await client.assets.evidence(assetRef);
    expect(after.find((d) => d.id === inspection)?.version).toBe(2);
    expect(after.find((d) => d.id === inspection)?.versions.map((v) => v.version)).toEqual([2]);
    expect(after.some((d) => d.id === maintenance)).toBe(false);

    const att = await client.verifications.issueAttestation(vr, {
      method: "Document review",
      inspectedAt: NOW.toISOString(),
      validUntil: "2027-05-15T00:00:00.000Z",
      checks: [{ item: "Photos", finding: "Consistent", result: "CHECKED" }],
      limitations: "Synthetic.",
    });
    const attestation = await client.attestations.get(att.result.attestationRef);
    expect(attestation.evidencePackage.version).toBe((await client.verifications.get(vr)).evidencePackage.version);
    expect(attestation.supportingVersions.map((v) => [v.documentId, v.version])).toEqual(
      [
        [photos, 1],
        [inspection, 2],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
    // Access ends with the assignment.
    expect((await rejection(client.evidence.download(inspection))).code).toBe("unavailable");
  });

  it("never grants a dealer document on the owner's authority (the dealer's consent is not simulated in UI_MOCK)", async () => {
    const client = createMockClient({ personaId: "manufacturer-owner", now: new Date(NOW), latencyMs: 0 });
    const docs = await client.assets.evidence("ASSET-DEMO-001");
    const dealerDoc = docs.find((d) => d.source.id !== "demo-manufacturer");
    const ownDoc = docs.find((d) => d.source.id === "demo-manufacturer");
    expect(dealerDoc && ownDoc).toBeTruthy();
    expect((await rejection(client.assets.requestVerification("ASSET-DEMO-001", { verifierRegistryRef: "VER-001", scope: ["Photos"], documentIds: ["DOC-999"] }))).code).toBe("validation_error");
    const vr = await client.assets.requestVerification("ASSET-DEMO-001", { verifierRegistryRef: "VER-001", scope: ["Photos"], documentIds: [dealerDoc!.id, ownDoc!.id] });
    const request = await client.verifications.get(vr.result.verificationRef);
    expect(request.documentIds).toEqual([ownDoc!.id]);
    client.setPersona("verifier-inspector");
    expect((await rejection(client.evidence.download(dealerDoc!.id))).code).toBe("unavailable");
  });
});
