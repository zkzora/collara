// Pledge activation (daml-model.md §7 W8): the selected lender's approver consumes the shared AssetControl and
// the borrower's single-use PledgeActivationAuthorization in one Control_Activate, creating the CollateralLock.
// The ledger enforces one lock per asset (the control is consumed; a parallel activation finds it archived) and
// that the reviewed attestation is still disclosed to the lender: Control_Activate fetches the DisclosureValidity
// of the lender's disclosure, which revocation, withdrawal and supersession archive (daml-model.md §4.5, §8.2).
// Before submitting, the API re-reads the lender's ACS as a fast-fail and takes the marker id from the live
// disclosure (requireActiveAttestationDisclosure); a revocation that lands after that read fails on the ledger.
import { STATUS_COPY } from "@collara/domain";
import { ledgerCommands as L } from "../../ledger/builders";
import { PAYLOAD_SCHEMAS } from "../../ledger/contracts";
import type { ResolvedActor } from "../../plugins/actor";
import { must, requireActiveAttestationDisclosure, sameAnchor } from "../preconditions";
import { workflowProblems } from "../problems";
import type { CommittedStep, WorkflowOutcome } from "../run";
import { guardUnlessReplay, isPast, nextRef, type CaseScope, type FinanceDeps } from "../financing/common";

export interface ActivationResult {
  readonly pledgeRef: string;
}

function lockRefOf(step: CommittedStep): string | null {
  const created = step.created.find((c) => c.template === "CollateralLock");
  return created ? PAYLOAD_SCHEMAS.CollateralLock.parse(created.argument).lockRef : null;
}

// --- POST /cases/:id/pledge-activation -------------------------------------------------------------------------

export async function activatePledge(deps: FinanceDeps, member: ResolvedActor, scope: CaseScope, idempotencyKey: string): Promise<WorkflowOutcome<ActivationResult>> {
  const operation = "pledge.activate";
  await guardUnlessReplay(deps, scope, member, "pledge.activate", operation, idempotencyKey);
  const caseRef = scope.facts.ref;
  const actor = await deps.workflow.actorFor(member);
  return deps.workflow.run({
    actor,
    operation,
    idempotencyKey,
    payload: { caseId: caseRef },
    resourceRef: caseRef,
    prepare: async (ctx) => {
      const lender = ctx.acs.parties[0] ?? "";
      const auths = await ctx.acs.list(
        "PledgeActivationAuthorization",
        (a) => a.caseRef === caseRef && a.namespace === ctx.namespace && a.lender === lender && !isPast(a.expiresAt, ctx.now),
      );
      const auth = must(auths.at(-1));
      const a = auth.payload;
      // Visible to the lender only while the owner shares it (sharedLender); archived once locked.
      const control = must(await ctx.acs.one("AssetControl", (c) => c.assetId === a.assetId && c.namespace === ctx.namespace));
      if (control.payload.sharedLender !== lender) throw workflowProblems.stateChanged();
      if (control.payload.controlVersion !== a.expectedControlVersion || !sameAnchor(control.payload.evidence, a.snapshot.evidence)) {
        throw workflowProblems.stateChanged(STATUS_COPY.EVIDENCE_STALE);
      }
      // daml-model.md §4.5: the marker of the live disclosure; the ledger re-checks it at commit.
      const disclosure = await requireActiveAttestationDisclosure(ctx.acs, a.snapshot, { now: ctx.now, owner: a.borrower, caseRef });
      const config = must(await ctx.acs.one("CollaraConfig", (c) => c.namespace === ctx.namespace));
      const mirror = must(
        await ctx.acs.latest(
          "VerifierStatusMirror",
          (m) => m.namespace === ctx.namespace && m.registrar === config.payload.registrar && m.verifier === a.snapshot.attestationVerifier,
        ),
      );
      if (config.payload.suspensionPolicy === "REQUIRE_ACTIVE_VERIFIER" && mirror.payload.status !== "ACTIVE") throw workflowProblems.attestationExpired();
      const taken = (await ctx.acs.list("CollateralLock")).map((l) => l.payload.lockRef);
      const lockRef = await nextRef(deps.db, "pledge", taken);
      return {
        commands: [
          L.controlActivate(control.contractId, {
            lender,
            authorizationCid: auth.contractId,
            validityCid: disclosure.payload.validityCid,
            configCid: config.contractId,
            verifierStatusCid: mirror.contractId,
            lockRef,
            actorRef: ctx.actorRef,
          }),
        ],
      };
    },
    result: (step) => ({ pledgeRef: lockRefOf(step) ?? "" }),
  });
}
