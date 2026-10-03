// LocalNet (LOCALNET_IT=1): activation preconditions on the real sandbox (one fresh prefix, case AUTHORIZED).
//   1. A revoked AttestationDisclosure: the API refuses activation before submitting, and a Control_Activate
//      submitted directly through the runner with the revoked disclosure's validity marker is REJECTED by the
//      ledger (daml-model.md §4.5, §8.2). A new disclosure brings a new marker.
//   2. The revocation race: the owner's revocation commits after the API's precheck and before submission; the
//      ledger REJECTS the activation (it fetches the marker the precheck selected).
//   3. A manifest bump after authorization (control v3 → v4): the API refuses with the approved copy, and a
//      Control_Activate submitted directly through the runner is REJECTED by the ledger.
//   No lock exists at the end. A second world (4): an activation committed first is not undone by a later
//   revocation; the lock stays ACTIVE.
import { randomUUID } from "node:crypto";
import { COMMAND_COPY, STATUS_COPY } from "@collara/domain";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ledgerCommands as L, manifestHashOf } from "../../src/ledger";
import type { WorkflowRunner } from "../../src/workflow/run";
import { ASSET, authorizedWorld, CASE, ledgerTokens, type AuthorizedWorld } from "./financing-fixture";
import { LOCALNET_IT_ENABLED } from "./harness";

type Prepare = Parameters<AuthorizedWorld["h"]["workflow"]["run"]>[0]["prepare"];

const lenderDisclosures = (w: AuthorizedWorld) => w.h.acsAs("lenderA", "AttestationDisclosure", (d) => d.caseRef === CASE && d.attestation.attestationRef === "ATT-001");
const lenderMarkers = (w: AuthorizedWorld) => w.h.acsAs("lenderA", "DisclosureValidity", (v) => v.caseRef === CASE && v.attestationRef === "ATT-001");

const ownerRun = async (w: AuthorizedWorld, name: string, prepare: Prepare) =>
  w.h.workflow.run({ actor: await w.h.actor("manufacturer-owner"), operation: `it.pledge.${name}`, idempotencyKey: `it-${name}-${randomUUID()}`, payload: {}, prepare });

/** The owner's AttDisc_Revoke of Lender A's disclosure of ATT-001 for the case. */
const revokeDisclosure = async (w: AuthorizedWorld, name: string) => {
  const disclosure = (await w.h.acsAs("borrower", "AttestationDisclosure", (d) => d.recipient === w.h.party("lenderA") && d.caseRef === CASE))[0];
  if (!disclosure) throw new Error("no disclosure to revoke");
  return ownerRun(w, name, async (ctx) => ({ commands: [L.attDiscRevoke(disclosure.contractId, { actorRef: ctx.actorRef })] }));
};

/** The owner discloses ATT-001 to Lender A again (a new verifier-signed copy and a new validity marker). */
const redisclose = async (w: AuthorizedWorld, name: string) => {
  const attestation = (await w.h.acsAs("borrower", "VerificationAttestation", (a) => a.attestationRef === "ATT-001"))[0]!;
  return ownerRun(w, name, async (ctx) => ({
    commands: [L.attDiscloseTo(attestation.contractId, { recipient: w.h.party("lenderA"), purpose: "LENDER_REVIEW", disclosureCaseRef: CASE, actorRef: ctx.actorRef })],
  }));
};

/** Control_Activate through the runner, bypassing the API's prepare() (the lender's own ledger user). */
const directActivate = async (w: AuthorizedWorld, name: string, inputs: { controlCid: string; validityCid: string; lockRef: string }) => {
  const { h } = w;
  const auth = (await h.acsAs("lenderA", "PledgeActivationAuthorization", (a) => a.caseRef === CASE))[0]!;
  const config = (await h.acsAs("lenderA", "CollaraConfig", (c) => c.namespace === h.namespace))[0]!;
  const mirror = (await h.acsAs("lenderA", "VerifierStatusMirror", (m) => m.namespace === h.namespace && m.verifierRef === "VER-001"))[0]!;
  return h.workflow.run({
    actor: await h.actor("lender-a-approver"),
    operation: `it.pledge.${name}`,
    idempotencyKey: `it-${name}-${randomUUID()}`,
    payload: {},
    prepare: async (ctx) => ({
      commands: [
        L.controlActivate(inputs.controlCid, {
          lender: h.party("lenderA"),
          authorizationCid: auth.contractId,
          validityCid: inputs.validityCid,
          configCid: config.contractId,
          verifierStatusCid: mirror.contractId,
          lockRef: inputs.lockRef,
          actorRef: ctx.actorRef,
        }),
      ],
    }),
  });
};

describe.skipIf(!LOCALNET_IT_ENABLED)("LocalNet activation preconditions (revoked disclosure, revocation race, manifest bump)", () => {
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

  it("revoked disclosure: the API refuses before submission; a direct Control_Activate with the revoked marker is REJECTED by the ledger", async () => {
    const { h, approver } = w;
    const [before] = await lenderDisclosures(w);
    expect(before).toBeDefined();
    const revokedMarker = before!.payload.validityCid;
    expect((await lenderMarkers(w)).map((v) => v.contractId)).toEqual([revokedMarker]);
    expect((await revokeDisclosure(w, "revoke-disclosure")).committed).toBe(true);
    expect(await h.acsAs("lenderA", "AttestationDisclosure")).toHaveLength(0);
    expect(await h.acsAs("lenderA", "DisclosureValidity")).toHaveLength(0);
    await h.project();

    const refused = await approver.inject("POST", `/api/cases/${CASE}/pledge-activation`, { body: {} });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: "state_conflict", detail: COMMAND_COPY.STATE_CHANGED });
    expect(refused.json().command).toBeUndefined();

    // Bypassing the API: the ledger refuses an activation that relies on the revoked disclosure's marker.
    const control = (await h.acsAs("lenderA", "AssetControl", (c) => c.assetId === ASSET))[0]!;
    const direct = await directActivate(w, "direct-activate-revoked", { controlCid: control.contractId, validityCid: revokedMarker, lockRef: "PL-998" });
    expect(direct.command.state).toBe("REJECTED");
    expect(direct.record.errorCode).toBe("CONTRACT_NOT_FOUND");
    expect(direct.record.errorMessage ?? "").toContain(revokedMarker);
    expect(await ledgerTokens(h)).toEqual({ locksLender: 0, locksBorrower: 0, controls: 1 });

    // The owner discloses again: a new verifier-signed copy with a new marker.
    expect((await redisclose(w, "redisclose")).committed).toBe(true);
    const [again] = await lenderDisclosures(w);
    expect(again?.payload.validityCid).toBeDefined();
    expect(again!.payload.validityCid).not.toBe(revokedMarker);
    expect((await lenderMarkers(w)).map((v) => v.contractId)).toEqual([again!.payload.validityCid]);
    facts.revokedDisclosure = {
      apiStatus: refused.statusCode,
      detail: refused.json().detail,
      directLedger: { state: direct.command.state, errorKind: direct.record.errorKind, errorCode: direct.record.errorCode, errorMessage: direct.record.errorMessage?.slice(0, 300) },
    };
  });

  it("revocation race: the owner's revocation commits after the API's precheck and before submission; the ledger REJECTS Control_Activate", async () => {
    const { h, approver } = w;
    expect(await lenderDisclosures(w)).toHaveLength(1);
    const [marker] = await lenderMarkers(w);
    await h.project();
    const runner = h.workflow.runner as WorkflowRunner & { run: WorkflowRunner["run"] };
    const original = runner.run.bind(runner);
    let revocationCommitted = false;
    let markersAtSubmit = -1;
    runner.run = ((input: Parameters<WorkflowRunner["run"]>[0]) =>
      original(
        input.operation !== "pledge.activate"
          ? input
          : {
              ...input,
              prepare: async (ctx) => {
                const plan = await input.prepare(ctx);
                revocationCommitted = (await revokeDisclosure(w, "race-revoke")).committed;
                markersAtSubmit = (await lenderMarkers(w)).length;
                return plan;
              },
            },
      )) as WorkflowRunner["run"];
    let response: LightMyRequestResponse;
    try {
      response = await approver.inject("POST", `/api/cases/${CASE}/pledge-activation`, { body: {} });
    } finally {
      delete (runner as { run?: unknown }).run;
    }
    expect(revocationCommitted).toBe(true);
    expect(markersAtSubmit).toBe(0);
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json()).toMatchObject({ code: "state_conflict", detail: COMMAND_COPY.STATE_CHANGED, command: { state: "REJECTED", message: COMMAND_COPY.STATE_CHANGED } });
    expect(response.json().command.updateId).toBeUndefined();
    expect(await ledgerTokens(h)).toEqual({ locksLender: 0, locksBorrower: 0, controls: 1 });
    const record = await h.command(response.json().command.commandId);
    // The ledger rejected the activation because the marker the precheck selected was archived.
    expect(record?.errorCode).toBe("CONTRACT_NOT_FOUND");
    expect(record?.errorMessage ?? "").toContain(marker!.contractId);
    facts.race = { apiStatus: response.statusCode, ledger: { state: response.json().command.state, errorKind: record?.errorKind, errorCode: record?.errorCode } };
    // Leave a live disclosure for the next test.
    expect((await redisclose(w, "redisclose-after-race")).committed).toBe(true);
  });

  it("manifest bump after authorization: API refuses (evidence changed); a direct Control_Activate is REJECTED by the ledger", async () => {
    const { h, approver } = w;
    const manifest = (await h.acsAs("borrower", "EvidenceManifest", (m) => m.assetId === ASSET && m.namespace === h.namespace)).sort((a, b) => a.payload.version - b.payload.version).at(-1)!;
    const control = (await h.acsAs("borrower", "AssetControl", (c) => c.assetId === ASSET && c.namespace === h.namespace))[0]!;
    expect(control.payload.controlVersion).toBe(3);
    const entries = manifest.payload.entries;
    const bump = await ownerRun(w, "manifest-bump", async (ctx) => ({
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

    // Bypassing the API (with the live disclosure's marker): the ledger refuses the stale authorization on its own.
    const [marker] = await lenderMarkers(w);
    const direct = await directActivate(w, "direct-activate", { controlCid: bumped.contractId, validityCid: marker!.contractId, lockRef: "PL-999" });
    expect(direct.command.state).toBe("REJECTED");
    expect(direct.record.errorMessage ?? "").toContain("Control version changed since authorization");
    expect(await ledgerTokens(h)).toEqual({ locksLender: 0, locksBorrower: 0, controls: 1 });
    facts.manifestBump = { apiStatus: refused.statusCode, apiDetail: refused.json().detail, ledger: { state: direct.command.state, errorKind: direct.record.errorKind } };
  });

  it("activation committed first: a later revocation by the owner commits and leaves the lock ACTIVE", async () => {
    const second = await authorizedWorld("ep2q");
    try {
      const activated = await second.approver.inject("POST", `/api/cases/${CASE}/pledge-activation`, { body: {} });
      expect(activated.statusCode, activated.body).toBe(200);
      expect(activated.json().command).toMatchObject({ state: "COMMITTED" });
      expect(await ledgerTokens(second.h)).toEqual({ locksLender: 1, locksBorrower: 1, controls: 0 });
      // The activation only fetched the marker: the disclosure and its marker are still live.
      expect(await lenderMarkers(second)).toHaveLength(1);
      expect((await revokeDisclosure(second, "revoke-after-activation")).committed).toBe(true);
      expect(await lenderDisclosures(second)).toHaveLength(0);
      expect(await lenderMarkers(second)).toHaveLength(0);
      const locks = await second.h.acsAs("lenderA", "CollateralLock", (l) => l.assetId === ASSET);
      expect(locks).toHaveLength(1);
      expect(locks[0]!.payload).toMatchObject({ attestationRef: "ATT-001", lockRef: activated.json().result.pledgeRef });
      facts.activationFirst = { prefix: second.h.prefix, pledgeRef: activated.json().result.pledgeRef, locksAfterRevocation: locks.length };
    } finally {
      await second.h.close();
    }
  });
});
