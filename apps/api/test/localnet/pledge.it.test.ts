// LocalNet (LOCALNET_IT=1): activation preconditions on the real sandbox (one fresh prefix, case AUTHORIZED).
//   1. A withdrawn (owner-revoked) AttestationDisclosure: the API refuses activation before submitting
//      (daml-model.md §8.2 — the ledger does not re-check revocation); after a new disclosure it would pass.
//   2. A manifest bump after authorization (control v3 → v4): the API refuses with the approved copy, and a
//      Control_Activate submitted directly through the runner is REJECTED by the ledger.
// No lock exists at the end.
import { randomUUID } from "node:crypto";
import { COMMAND_COPY, STATUS_COPY } from "@collara/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ledgerCommands as L, manifestHashOf } from "../../src/ledger";
import { ASSET, authorizedWorld, CASE, ledgerTokens, type AuthorizedWorld } from "./financing-fixture";
import { LOCALNET_IT_ENABLED } from "./harness";

describe.skipIf(!LOCALNET_IT_ENABLED)("LocalNet activation preconditions (revoked disclosure, manifest bump)", () => {
  let w: AuthorizedWorld;
  const facts: Record<string, unknown> = {};

  beforeAll(async () => {
    w = await authorizedWorld("ep2p");
    facts.prefix = w.h.prefix;
    facts.setupMs = w.ms;
  });
  afterAll(async () => {
    console.log(`LocalNet activation-precondition facts: ${JSON.stringify(facts, null, 2)}`);
    await w?.h.close();
  });

  const ownerRun = async (name: string, prepare: Parameters<AuthorizedWorld["h"]["workflow"]["run"]>[0]["prepare"]) => {
    const { h } = w;
    return h.workflow.run({ actor: await h.actor("manufacturer-owner"), operation: `it.pledge.${name}`, idempotencyKey: `it-${name}-${randomUUID()}`, payload: {}, prepare });
  };

  it("revoked disclosure: activation is refused before submission; no lock", async () => {
    const { h, approver } = w;
    const disclosure = (await h.acsAs("borrower", "AttestationDisclosure", (d) => d.recipient === h.party("lenderA") && d.caseRef === CASE))[0]!;
    expect((await ownerRun("revoke-disclosure", async (ctx) => ({ commands: [L.attDiscRevoke(disclosure.contractId, { actorRef: ctx.actorRef })] }))).committed).toBe(true);
    expect(await h.acsAs("lenderA", "AttestationDisclosure")).toHaveLength(0);
    await h.project();

    const refused = await approver.inject("POST", `/api/cases/${CASE}/pledge-activation`, { body: {} });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: "state_conflict", detail: COMMAND_COPY.STATE_CHANGED });
    expect(refused.json().command).toBeUndefined();
    expect(await ledgerTokens(h)).toEqual({ locksLender: 0, locksBorrower: 0, controls: 1 });

    // The owner discloses again (a new verifier-signed copy): the precondition is satisfied again.
    const attestation = (await h.acsAs("borrower", "VerificationAttestation", (a) => a.attestationRef === "ATT-001"))[0]!;
    const again = await ownerRun("redisclose", async (ctx) => ({
      commands: [L.attDiscloseTo(attestation.contractId, { recipient: h.party("lenderA"), purpose: "LENDER_REVIEW", disclosureCaseRef: CASE, actorRef: ctx.actorRef })],
    }));
    expect(again.committed).toBe(true);
    expect(await h.acsAs("lenderA", "AttestationDisclosure")).toHaveLength(1);
    facts.revokedDisclosure = { apiStatus: refused.statusCode, detail: refused.json().detail };
  });

  it("manifest bump after authorization: API refuses (evidence changed); a direct Control_Activate is REJECTED by the ledger", async () => {
    const { h, approver } = w;
    const manifest = (await h.acsAs("borrower", "EvidenceManifest", (m) => m.assetId === ASSET && m.namespace === h.namespace)).sort((a, b) => a.payload.version - b.payload.version).at(-1)!;
    const control = (await h.acsAs("borrower", "AssetControl", (c) => c.assetId === ASSET && c.namespace === h.namespace))[0]!;
    expect(control.payload.controlVersion).toBe(3);
    const entries = manifest.payload.entries;
    const bump = await ownerRun("manifest-bump", async (ctx) => ({
      commands: [
        L.manifestNewVersion(manifest.contractId, {
          newEntries: entries,
          newManifestHash: manifestHashOf({ packageRef: manifest.payload.packageRef, version: manifest.payload.version + 1, entries }),
          controlCid: control.contractId,
          actorRef: ctx.actorRef,
        }),
      ],
    }));
    expect(bump.committed).toBe(true);
    const bumped = (await h.acsAs("lenderA", "AssetControl", (c) => c.assetId === ASSET))[0]!;
    expect(bumped.payload).toMatchObject({ controlVersion: 4, sharedLender: h.party("lenderA") });
    await h.project();

    const refused = await approver.inject("POST", `/api/cases/${CASE}/pledge-activation`, { body: {} });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().detail).toBe(STATUS_COPY.EVIDENCE_STALE);

    // Bypassing the API: the ledger refuses the stale authorization on its own.
    const auth = (await h.acsAs("lenderA", "PledgeActivationAuthorization", (a) => a.caseRef === CASE))[0]!;
    const config = (await h.acsAs("lenderA", "CollaraConfig", (c) => c.namespace === h.namespace))[0]!;
    const mirror = (await h.acsAs("lenderA", "VerifierStatusMirror", (m) => m.namespace === h.namespace && m.verifierRef === "VER-001"))[0]!;
    const direct = await h.workflow.run({
      actor: await h.actor("lender-a-approver"),
      operation: "it.pledge.direct-activate",
      idempotencyKey: `it-direct-${randomUUID()}`,
      payload: {},
      prepare: async (ctx) => ({
        commands: [L.controlActivate(bumped.contractId, { lender: h.party("lenderA"), authorizationCid: auth.contractId, configCid: config.contractId, verifierStatusCid: mirror.contractId, lockRef: "PL-999", actorRef: ctx.actorRef })],
      }),
    });
    expect(direct.command.state).toBe("REJECTED");
    expect(direct.record.errorMessage ?? "").toContain("Control version changed since authorization");
    expect(await ledgerTokens(h)).toEqual({ locksLender: 0, locksBorrower: 0, controls: 1 });
    facts.manifestBump = { apiStatus: refused.statusCode, apiDetail: refused.json().detail, ledger: { state: direct.command.state, errorKind: direct.record.errorKind } };
  });
});
