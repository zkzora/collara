// LocalNet (LOCALNET_IT=1): single-lock invariant under contention on the real sandbox.
//   Rounds (default 5, EP2_CONCURRENCY_ROUNDS): each on a FRESH prefix (seed main → review → proposal → accept →
//   authorize via the API), then two parallel POST /cases/CL-001/pledge-activation (distinct Idempotency-Keys):
//   exactly one lock on the ledger, the loser is a 409 with the approved copy (REJECTED by the ledger, or refused
//   by the fresh ACS precondition when it prepared after the winner committed).
//   Variant: two DISTINCT agreements/authorizations for the same control, two parallel Control_Activate
//   submissions through the runner → still exactly one lock.
import { randomUUID } from "node:crypto";
import { COMMAND_COPY } from "@collara/domain";
import { afterAll, describe, expect, it } from "vitest";
import { ledgerCommands as L } from "../../src/ledger";
import { ASSET, authorizedWorld, CASE, ledgerTokens, PRINCIPAL } from "./financing-fixture";
import { LOCALNET_IT_ENABLED } from "./harness";

const ROUNDS = Number(process.env.EP2_CONCURRENCY_ROUNDS ?? 5);
const results: Record<string, unknown>[] = [];

describe.skipIf(!LOCALNET_IT_ENABLED)("LocalNet concurrency: parallel pledge activations", () => {
  afterAll(() => {
    console.log(`LocalNet concurrency results: ${JSON.stringify(results, null, 2)}`);
  });

  for (let round = 1; round <= ROUNDS; round++) {
    it(`round ${round}: two parallel activations → exactly one lock, the other 409 with approved copy`, async () => {
      const { h, approver, ms } = await authorizedWorld("ep2c");
      try {
        const before = await ledgerTokens(h);
        expect(before).toEqual({ locksLender: 0, locksBorrower: 0, controls: 1 });
        const started = Date.now();
        const responses = await Promise.all(
          [0, 1].map(() => approver.inject("POST", `/api/cases/${CASE}/pledge-activation`, { body: {}, idempotencyKey: `race-${randomUUID()}` })),
        );
        const raceMs = Date.now() - started;
        const statuses = responses.map((r) => r.statusCode).sort();
        expect(statuses, responses.map((r) => r.body).join("\n")).toEqual([200, 409]);
        const winner = responses.find((r) => r.statusCode === 200)!.json();
        const loser = responses.find((r) => r.statusCode === 409)!.json();
        expect(winner.command).toMatchObject({ state: "COMMITTED", message: COMMAND_COPY.COMMITTED });
        expect(winner.result.pledgeRef).toMatch(/^PL-\d{3}$/);
        expect(loser).toMatchObject({ code: "state_conflict", detail: COMMAND_COPY.STATE_CHANGED });
        if (loser.command) {
          expect(loser.command).toMatchObject({ state: "REJECTED", message: COMMAND_COPY.STATE_CHANGED });
          expect(loser.command.updateId).toBeUndefined();
        }
        const loserRecord = loser.command ? await h.command(loser.command.commandId) : null;

        const after = await ledgerTokens(h);
        expect(after).toEqual({ locksLender: 1, locksBorrower: 1, controls: 0 });
        results.push({
          round,
          prefix: h.prefix,
          setupMs: ms,
          raceMs,
          winner: { pledgeRef: winner.result.pledgeRef, updateId: winner.command.updateId },
          loser: loser.command ? { path: "ledger REJECTED", errorKind: loserRecord?.errorKind, errorCode: loserRecord?.errorCode } : { path: "ACS precondition (prepared after the winner committed)" },
          ledger: after,
        });
      } finally {
        await h.close();
      }
    });
  }

  it("variant: two distinct agreements and authorizations for one control → one lock (runner-level race)", async () => {
    const { h } = await authorizedWorld("ep2v");
    try {
      const owner = await h.actor("manufacturer-owner");
      const lender = await h.actor("lender-a-approver");
      const run = (actor: typeof owner, name: string, prepare: Parameters<typeof h.workflow.run>[0]["prepare"]) =>
        h.workflow.run({ actor, operation: `it.variant.${name}`, idempotencyKey: `it-${name}-${randomUUID()}`, payload: {}, prepare });

      // A second proposal, accepted and authorized: two agreements, two authorizations, one control (v3).
      const eligible = (await h.acsAs("lenderA", "CollateralAssessment", (a) => a.caseRef === CASE && a.status === "ELIGIBLE"))[0]!;
      const issued = await run(lender, "issue", async (ctx) => ({
        commands: [L.assessmentIssueProposal(eligible.contractId, { proposalRef: "FP-900", principal: PRINCIPAL, termMetadata: "variant", externalLegalRef: "", expiresAt: new Date(Date.now() + 14 * 86_400_000), actorRef: ctx.actorRef })],
      }));
      expect(issued.committed).toBe(true);
      const proposal = (await h.acsAs("borrower", "FinancingProposal", (p) => p.proposalRef === "FP-900"))[0]!;
      expect((await run(owner, "accept", async (ctx) => ({ commands: [L.proposalAccept(proposal.contractId, { expectedProposalRef: "FP-900", expectedVersion: 1, actorRef: ctx.actorRef })] }))).committed).toBe(true);
      const agreement = (await h.acsAs("borrower", "FinancingAgreement", (a) => a.agreementRef === "FP-900"))[0]!;
      const authorized = await run(owner, "authorize", async (ctx) => ({
        commands: [L.agreementAuthorizeActivation(agreement.contractId, { authorizationRef: "AUTH-900", expectedControlVersion: 3, expiresAt: new Date(Date.now() + 7 * 86_400_000), actorRef: ctx.actorRef })],
      }));
      expect(authorized.committed).toBe(true);

      const auths = await h.acsAs("lenderA", "PledgeActivationAuthorization", (a) => a.caseRef === CASE);
      expect(auths.map((a) => a.payload.agreementRef).sort()).toEqual(["FP-001", "FP-900"]);
      const control = (await h.acsAs("lenderA", "AssetControl", (c) => c.assetId === ASSET))[0]!;
      const config = (await h.acsAs("lenderA", "CollaraConfig", (c) => c.namespace === h.namespace))[0]!;
      const mirror = (await h.acsAs("lenderA", "VerifierStatusMirror", (m) => m.namespace === h.namespace && m.verifierRef === "VER-001"))[0]!;
      const outcomes = await Promise.all(
        auths.map((auth, i) =>
          run(lender, `activate-${i}`, async (ctx) => ({
            commands: [
              L.controlActivate(control.contractId, {
                lender: h.party("lenderA"),
                authorizationCid: auth.contractId,
                configCid: config.contractId,
                verifierStatusCid: mirror.contractId,
                lockRef: `PL-90${i + 1}`,
                actorRef: ctx.actorRef,
              }),
            ],
          })),
        ),
      );
      const states = outcomes.map((o) => o.command.state).sort();
      expect(states).toEqual(["COMMITTED", "REJECTED"]);
      expect(await ledgerTokens(h)).toEqual({ locksLender: 1, locksBorrower: 1, controls: 0 });
      const rejected = outcomes.find((o) => o.command.state === "REJECTED")!;
      results.push({ variant: "two agreements", prefix: h.prefix, states, loser: { errorKind: rejected.record.errorKind, errorCode: rejected.record.errorCode } });
    } finally {
      await h.close();
    }
  });
});
