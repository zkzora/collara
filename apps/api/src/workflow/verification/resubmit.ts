// Owner evidence resubmission after a change request (daml-model.md §7 M10–M11, D4; §4.6 verification evidence
// grants), one sequence under one parent command:
//   "manifest"          commit the finalized documents (Manifest_NewVersion) when they changed
//   "submit"            Manifest_SubmitToVerification → VR_SubmitNewEvidence (IN_REVIEW, newer anchor)
//   "grant", …          the selection at the NEW evidence version for the assigned verifier; the grants of the
//                       superseded version are revoked (Share_Revoke) or withdrawn (dealer requests) (./grants.ts)
// The selection is the request body's, else the documents granted for the previous version.
import type { Db } from "@collara/db";
import type { AssetFacts } from "@collara/domain";
import { problems } from "../../errors";
import { ledgerCommands as L } from "../../ledger/builders";
import type { WorkflowActor } from "../actors";
import type { WorkflowServices } from "../context";
import { must } from "../preconditions";
import { workflowProblems } from "../problems";
import type { WorkflowOutcome } from "../run";
import { commitManifestIfChanged, currentManifest } from "../assets/manifest";
import { assertGrantable, finalizedDocuments, GRANT_COPY, issueVerificationGrants, previousSelection, validateSelection, type IssuedGrants } from "./grants";
import { activeRequest } from "./ledger";

/** INFERRED copy: VR_SubmitNewEvidence needs a newer version of the package. */
export const NO_NEW_EVIDENCE = "Add a new document version before resubmitting the evidence.";

export interface ResubmitEvidenceInput {
  readonly db: Db;
  readonly workflow: WorkflowServices;
  readonly owner: WorkflowActor;
  readonly asset: AssetFacts;
  readonly verificationRef: string;
  /** The owner's new selection; undefined: the documents granted for the previous evidence version. */
  readonly documentIds: readonly string[] | undefined;
  readonly idempotencyKey: string;
  readonly now: Date;
}

export async function resubmitEvidence(input: ResubmitEvidenceInput): Promise<WorkflowOutcome<{ verificationRef: string } & IssuedGrants>> {
  const { db, workflow, owner, asset, verificationRef: ref } = input;
  const assetRef = asset.ref;
  if (input.documentIds) await validateSelection(db, { assetRef, ownerOrgId: owner.orgId, selection: input.documentIds });
  return workflow.sequence({
    actor: owner,
    operation: "verification.submitEvidence",
    idempotencyKey: input.idempotencyKey,
    payload: { ref, documentIds: input.documentIds ?? null },
    resourceRef: ref,
    steps: async (seq) => {
      const namespace = must(workflow.namespace, workflowProblems.ledgerUnavailable);
      const ownerParty = must(owner.business, workflowProblems.ledgerUnavailable).party;
      const ownerAcs = workflow.acs(owner);
      const vr = await activeRequest(ownerAcs, { ref, namespace });
      let selection = input.documentIds ? [...input.documentIds] : null;
      if (!selection) {
        // The previous grant's documents (and pending dealer requests) that are still finalized.
        const finalized = await finalizedDocuments(db, { assetRef, ownerOrgId: owner.orgId });
        selection = (await previousSelection(ownerAcs, { ownerParty, packageRef: vr.payload.evidence.packageRef, requestRef: ref })).filter((id) => finalized.has(id));
        if (selection.length === 0) {
          throw problems.validation([{ path: "body.documentIds", message: GRANT_COPY.NO_PREVIOUS_SELECTION }], GRANT_COPY.NO_PREVIOUS_SELECTION);
        }
      }
      await assertGrantable(db, ownerAcs, { assetRef, ownerOrgId: owner.orgId, ownerParty, caseRef: vr.payload.caseRef, selection });
      const committed = await commitManifestIfChanged(seq, { db, ownerAcs, namespace, assetRef, ownerOrgId: owner.orgId, ownerParty });
      const manifest = must(await currentManifest(ownerAcs, { assetRef, ownerParty, namespace }));
      if (!committed && manifest.payload.version <= vr.payload.evidence.manifestVersion) throw problems.stateConflict(NO_NEW_EVIDENCE);
      await seq.step("submit", {
        prepare: async (ctx) => {
          const live = await activeRequest(ctx.acs, { ref, namespace: ctx.namespace });
          if (live.payload.status !== "CHANGES_REQUESTED") throw workflowProblems.stateChanged();
          const latest = must(await currentManifest(ctx.acs, { assetRef, ownerParty, namespace: ctx.namespace }));
          return { commands: [L.manifestSubmitToVerification(latest.contractId, { requestCid: live.contractId, actorRef: ctx.actorRef })] };
        },
      });
      const grants = await issueVerificationGrants(seq, {
        ownerAcs,
        namespace,
        ownerParty,
        assetRef,
        requestRef: ref,
        caseRef: vr.payload.caseRef,
        selection,
        now: input.now,
      });
      return { verificationRef: ref, ...grants };
    },
  });
}
