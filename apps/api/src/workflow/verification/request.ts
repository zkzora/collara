// Owner verification request (daml-model.md §7 M5–M7, D4; §4.6 verification evidence grants) as one sequence
// under one parent command (the parent id is the correlation id):
//   "manifest"          commit the finalized documents (create + anchor, or Manifest_NewVersion) when they changed
//   "request"           Manifest_RequestVerification on the current manifest → VerificationRequest (REQUESTED)
//   "grant", …          the selected documents as a VERIFICATION grant for the assigned verifier (./grants.ts)
// The verifier party and its accredited scope come from the registry (registrar view), never from the browser.
import type { Db } from "@collara/db";
import type { AssetFacts, CreateVerificationRequest } from "@collara/domain";
import { ledgerCommands as L } from "../../ledger/builders";
import type { WorkflowActor } from "../actors";
import type { WorkflowServices } from "../context";
import { must } from "../preconditions";
import { workflowProblems } from "../problems";
import type { WorkflowOutcome } from "../run";
import { commitManifestIfChanged, currentManifest } from "../assets/manifest";
import { allocateFreshRef } from "../cases/read";
import { createdField } from "../cases/steps";
import { assertGrantable, issueVerificationGrants, validateSelection, type IssuedGrants } from "./grants";
import { resolveRegistryVerifier } from "./ledger";

export interface RequestVerificationInput {
  readonly db: Db;
  readonly workflow: WorkflowServices;
  readonly owner: WorkflowActor;
  readonly asset: AssetFacts;
  readonly caseRef: string | null;
  readonly body: CreateVerificationRequest;
  readonly idempotencyKey: string;
  readonly now: Date;
}

export type RequestVerificationResult = { verificationRef: string } & IssuedGrants;

export async function requestVerification(input: RequestVerificationInput): Promise<WorkflowOutcome<RequestVerificationResult>> {
  const { db, workflow, owner, asset, body } = input;
  // Every selected document must be finalized (it is then an entry of the manifest the request points at).
  await validateSelection(db, { assetRef: asset.ref, ownerOrgId: owner.orgId, selection: body.documentIds });
  return workflow.sequence({
    actor: owner,
    operation: "verification.request",
    idempotencyKey: input.idempotencyKey,
    payload: { assetRef: asset.ref, caseRef: input.caseRef, input: body },
    resourceRef: asset.ref,
    // Runs only while the parent is not settled: a settled replay returns the stored outcome without re-checking.
    // Without a ledger the runner records FAILED (503) and never reaches the steps.
    steps: async (seq) => {
      const namespace = must(workflow.namespace, workflowProblems.ledgerUnavailable);
      const ownerParty = must(owner.business, workflowProblems.ledgerUnavailable).party;
      const ownerAcs = workflow.acs(owner);
      const registrar = await workflow.systemActor("registrar");
      const verifier = await resolveRegistryVerifier(workflow.acs(registrar), { verifierRef: body.verifierRegistryRef, namespace, now: input.now });
      const active = await ownerAcs.list("VerificationRequest", (r) => r.namespace === namespace);
      const requestRef = await allocateFreshRef(db, "verification", active.map((r) => r.payload.requestRef));
      // Something must reach the verifier: an owner document, or a dealer document requested from its dealer.
      await assertGrantable(db, ownerAcs, { assetRef: asset.ref, ownerOrgId: owner.orgId, ownerParty, caseRef: input.caseRef, selection: body.documentIds });
      await commitManifestIfChanged(seq, { db, ownerAcs, namespace, assetRef: asset.ref, ownerOrgId: owner.orgId, ownerParty });
      const { verificationRef } = await seq.step<{ verificationRef: string }>("request", {
        payload: { verifierRegistryRef: verifier.verifierRef },
        prepare: async (ctx) => {
          const manifest = must(await currentManifest(ctx.acs, { assetRef: asset.ref, ownerParty, namespace: ctx.namespace }));
          const passport = must(await ctx.acs.one("AssetPassport", (p) => p.assetId === asset.ref && p.owner === ownerParty && p.namespace === ctx.namespace));
          // One open verification per asset (REQUESTED / IN_REVIEW / CHANGES_REQUESTED are active contracts).
          const open = await ctx.acs.list("VerificationRequest", (r) => r.assetId === asset.ref && r.namespace === ctx.namespace);
          if (open.length > 0) throw workflowProblems.stateChanged();
          return {
            commands: [
              L.manifestRequestVerification(manifest.contractId, {
                verifier: verifier.party,
                requestRef,
                passportVersion: passport.payload.passportVersion,
                caseRef: input.caseRef,
                equipmentScope: verifier.equipmentScope,
                checklist: body.scope,
                dueBy: body.dueAt ?? null,
                actorRef: ctx.actorRef,
              }),
            ],
          };
        },
        result: (s) => ({ verificationRef: createdField(s, "VerificationRequest", "requestRef", requestRef) }),
      });
      const grants = await issueVerificationGrants(seq, {
        ownerAcs,
        namespace,
        ownerParty,
        assetRef: asset.ref,
        requestRef: verificationRef,
        caseRef: input.caseRef,
        selection: body.documentIds,
        now: input.now,
      });
      return { verificationRef, ...grants };
    },
  });
}
