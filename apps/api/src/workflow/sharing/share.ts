// Sharing a case package with the selected lender (daml-model.md §7 M13–M17, D9; synthesis §5 step 3). One
// parent command per request, one child command per ledger submission (the parent id is the correlation id):
//   owner  "manifest"           commit the finalized documents when they changed (../assets/manifest.ts)
//          "dealer-request-N"   PackageShareProposal listing only dealer N's documents (dealer consent needed)
//          "share"              owner-signed PackageShare of the owner's documents
//          "control"            Control_ShareWithLender (the lender observes the control; same version)
//          "disclose"           Att_DiscloseTo the lender (verifier-signed copy of the current attestation)
//   dealer "contribute-<doc>"   DealerContribution for each of its documents in the request (if missing)
//          "consent-<shareRef>" Consent_Grant → PackageShare signed by owner + dealer
// The owner never signs for the dealer: dealer documents reach the lender only after the dealer's own consent
// (POST /cases/:id/sharing by the invited dealer). The lender's CollateralAssessment is NOT created here; the
// lender creates it under its own authority (./assessment.ts).
import { evidenceDocuments, type Db } from "@collara/db";
import type { CaseFacts, DocumentType } from "@collara/domain";
import { and, eq } from "drizzle-orm";
import type { AcsReader } from "../../ledger/acs";
import { LEDGER_DOC_TYPES, ledgerCommands as L, type SharedDocumentInput } from "../../ledger/builders";
import type { WorkflowActor } from "../actors";
import type { WorkflowServices } from "../context";
import { must } from "../preconditions";
import { workflowProblems } from "../problems";
import type { WorkflowOutcome, WorkflowSequence } from "../run";
import { commitManifestIfChanged, currentManifest } from "../assets/manifest";
import { allocateFreshRef } from "../cases/read";
import { createdField } from "../cases/steps";

export const SHARE_PURPOSE = "LENDER_REVIEW";
/** Default share lifetime when the request names none (the seed uses the same 30 days). */
export const DEFAULT_SHARE_DAYS = 30;

export interface ShareInput {
  readonly db: Db;
  readonly workflow: WorkflowServices;
  readonly facts: CaseFacts;
  /** The selected lender's business party (server-side binding). */
  readonly lenderParty: string;
  readonly permission: "VIEW" | "VIEW_DOWNLOAD";
  readonly expiresAt: Date;
  readonly idempotencyKey: string;
  /** The request body (hashed for the idempotency check). */
  readonly payload: unknown;
}

const shared = (e: { docRef: string; docVersion: number; sha256: string; source: string }): SharedDocumentInput => ({
  docRef: e.docRef,
  docVersion: e.docVersion,
  sha256: e.sha256,
  source: e.source,
});

async function activeShareRefs(acs: AcsReader, caseRef: string): Promise<string[]> {
  const [shares, proposals] = await Promise.all([
    acs.list("PackageShare", (s) => s.caseRef === caseRef),
    acs.list("PackageShareProposal", (s) => s.caseRef === caseRef),
  ]);
  return [...shares, ...proposals].map((s) => s.payload.shareRef);
}

/** Owner side: package share(s), control view and attestation disclosure for the selected lender. */
export async function shareWithLender(input: ShareInput & { readonly owner: WorkflowActor }): Promise<WorkflowOutcome<{ grantId: string }>> {
  const { db, workflow, owner, facts, lenderParty } = input;
  const caseRef = facts.ref;
  const assetRef = facts.asset.ref;
  return workflow.sequence({
    actor: owner,
    operation: "case.share",
    idempotencyKey: input.idempotencyKey,
    payload: input.payload,
    resourceRef: caseRef,
    steps: async (seq) => {
      const namespace = must(workflow.namespace, workflowProblems.ledgerUnavailable);
      const ownerParty = must(owner.business, workflowProblems.ledgerUnavailable).party;
      const ownerAcs = workflow.acs(owner);
      // Everything already in place (e.g. a second request before the projection caught up): nothing to submit.
      let submitted = (await commitManifestIfChanged(seq, { db, ownerAcs, namespace, assetRef, ownerOrgId: owner.orgId, ownerParty })) ? 1 : 0;
      const manifest = must(await currentManifest(ownerAcs, { assetRef, ownerParty, namespace }));
      const anchor = { packageRef: manifest.payload.packageRef, manifestVersion: manifest.payload.version, manifestHash: manifest.payload.manifestHash };
      const sameAnchor = (e: { packageRef: string; manifestVersion: number; manifestHash: string }) =>
        e.packageRef === anchor.packageRef && e.manifestVersion === anchor.manifestVersion && e.manifestHash === anchor.manifestHash;
      const toLender = (s: { recipient: string; caseRef: string; evidence: typeof anchor }) => s.recipient === lenderParty && s.caseRef === caseRef && sameAnchor(s.evidence);
      const known = await activeShareRefs(ownerAcs, caseRef);

      const ownerDocs = manifest.payload.entries.filter((e) => e.source === ownerParty).map(shared);
      const dealers = [...new Set(manifest.payload.entries.filter((e) => e.source !== ownerParty).map((e) => e.source))].sort();
      const refs: string[] = [];

      for (const [i, dealer] of dealers.entries()) {
        const documents = manifest.payload.entries.filter((e) => e.source === dealer).map(shared);
        const pending = await ownerAcs.list("PackageShareProposal", (p) => p.dealer === dealer && toLender(p));
        const consented = await ownerAcs.list("PackageShare", (s) => s.consenters.includes(dealer) && toLender(s));
        if (pending.length > 0 || consented.length > 0) {
          refs.push((pending[0] ?? consented[0])!.payload.shareRef);
          continue;
        }
        const shareRef = await allocateFreshRef(db, "accessGrant", known);
        known.push(shareRef);
        submitted += 1;
        refs.push(
          (
            await seq.step<{ shareRef: string }>(`dealer-request-${i + 1}`, {
              payload: { dealer: i + 1 },
              prepare: async () => ({
                commands: [
                  L.createPackageShareProposal({
                    owner: ownerParty,
                    dealer,
                    recipient: lenderParty,
                    shareRef,
                    purpose: SHARE_PURPOSE,
                    caseRef,
                    evidence: anchor,
                    documents,
                    permission: input.permission,
                    expiresAt: input.expiresAt,
                  }),
                ],
              }),
              result: (s) => ({ shareRef: createdField(s, "PackageShareProposal", "shareRef", shareRef) }),
            })
          ).shareRef,
        );
      }

      let ownerShareRef: string | null = null;
      if (ownerDocs.length > 0) {
        const existing = await ownerAcs.list("PackageShare", (s) => s.consenters.length === 0 && toLender(s));
        if (existing[0]) ownerShareRef = existing[0].payload.shareRef;
        else {
          const shareRef = await allocateFreshRef(db, "accessGrant", known);
          known.push(shareRef);
          submitted += 1;
          ownerShareRef = (
            await seq.step<{ shareRef: string }>("share", {
              payload: { documents: ownerDocs.length },
              prepare: async () => ({
                commands: [
                  L.createPackageShare({
                    owner: ownerParty,
                    consenters: [],
                    recipient: lenderParty,
                    shareRef,
                    purpose: SHARE_PURPOSE,
                    caseRef,
                    evidence: anchor,
                    documents: ownerDocs,
                    permission: input.permission,
                    expiresAt: input.expiresAt,
                  }),
                ],
              }),
              result: (s) => ({ shareRef: createdField(s, "PackageShare", "shareRef", shareRef) }),
            })
          ).shareRef;
        }
      }

      const control = must(await ownerAcs.one("AssetControl", (c) => c.assetId === assetRef && c.owner === ownerParty && c.namespace === namespace));
      if (control.payload.sharedLender !== null && control.payload.sharedLender !== lenderParty) throw workflowProblems.stateChanged();
      if (control.payload.sharedLender === null) {
        submitted += 1;
        await seq.step("control", {
          prepare: async (ctx) => {
            const live = must(await ctx.acs.one("AssetControl", (c) => c.assetId === assetRef && c.owner === ownerParty && c.namespace === ctx.namespace));
            if (live.payload.sharedLender !== null) throw workflowProblems.stateChanged();
            return { commands: [L.controlShareWithLender(live.contractId, { lender: lenderParty, actorRef: ctx.actorRef })] };
          },
          result: (s) => ({ controlCid: s.createdOf("AssetControl") }),
        });
      }

      const attestations = await ownerAcs.list("VerificationAttestation", (a) => a.assetId === assetRef && a.owner === ownerParty && a.namespace === namespace);
      const attestation = attestations.sort((a, b) => a.offset - b.offset).at(-1);
      if (attestation) {
        const disclosed = await ownerAcs.list("AttestationDisclosure", (d) => d.attestationCid === attestation.contractId && d.recipient === lenderParty && d.caseRef === caseRef);
        if (disclosed.length === 0) {
          submitted += 1;
          await seq.step("disclose", {
            prepare: async (ctx) => {
              const live = must(await ctx.acs.get("VerificationAttestation", attestation.contractId));
              return {
                commands: [L.attDiscloseTo(live.contractId, { recipient: lenderParty, purpose: SHARE_PURPOSE, disclosureCaseRef: caseRef, actorRef: ctx.actorRef })],
              };
            },
            result: (s) => ({ disclosureCid: s.createdOf("AttestationDisclosure") }),
          });
        }
      }
      if (submitted === 0) throw workflowProblems.stateChanged();
      return { grantId: must(ownerShareRef ?? refs[0]) };
    },
  });
}

/**
 * Dealer side ("Consent for own records"): records the dealer's contributions on the ledger when missing, then
 * grants the pending share request(s) of this case for the selected lender. 409 when nothing awaits consent.
 */
export async function dealerConsent(input: ShareInput & { readonly dealer: WorkflowActor }): Promise<WorkflowOutcome<{ grantId: string }>> {
  const { db, workflow, dealer, facts, lenderParty } = input;
  const caseRef = facts.ref;
  return workflow.sequence({
    actor: dealer,
    operation: "case.shareConsent",
    idempotencyKey: input.idempotencyKey,
    payload: input.payload,
    resourceRef: caseRef,
    steps: async (seq) => {
      const dealerParty = must(dealer.business, workflowProblems.ledgerUnavailable).party;
      const acs = workflow.acs(dealer);
      const proposals = (await acs.list("PackageShareProposal", (p) => p.dealer === dealerParty && p.caseRef === caseRef && p.recipient === lenderParty)).sort(
        (a, b) => a.payload.shareRef.localeCompare(b.payload.shareRef),
      );
      if (proposals.length === 0) throw workflowProblems.stateChanged();
      const documents = [...new Map(proposals.flatMap((p) => p.payload.documents).map((d) => [`${d.docRef}#${d.docVersion}`, d])).values()];
      await recordContributions(seq, { db, acs, dealerParty, owner: proposals[0]!.payload.owner, caseRef, documents });
      for (const proposal of proposals) {
        await seq.step(`consent-${proposal.payload.shareRef.toLowerCase()}`, {
          payload: { shareRef: proposal.payload.shareRef },
          prepare: async (ctx) => {
            const live = must(await ctx.acs.get("PackageShareProposal", proposal.contractId));
            return { commands: [L.consentGrant(live.contractId, { actorRef: ctx.actorRef })] };
          },
          result: (s) => ({ shareCid: s.createdOf("PackageShare") }),
        });
      }
      return { grantId: proposals[0]!.payload.shareRef };
    },
  });
}

/**
 * The dealer's own ledger record of each listed document ("contribute-<doc>-v<n>" steps): a dealer-signed
 * DealerContribution (owner observer) for every document without one for that exact version and hash. The type
 * comes from the dealer's own evidence row. `verificationUseConsented` stays true, as before: the per-recipient
 * Consent_Grant is the signature the ledger requires; a contribution recorded with false withholds the document
 * from verification requests (../verification/grants.ts).
 */
export async function recordContributions(
  seq: WorkflowSequence,
  input: {
    readonly db: Db;
    readonly acs: AcsReader;
    readonly dealerParty: string;
    readonly owner: string;
    readonly caseRef: string;
    readonly documents: readonly { docRef: string; docVersion: number; sha256: string }[];
  },
): Promise<void> {
  const { db, dealerParty, owner, caseRef } = input;
  const contributions = await input.acs.list("DealerContribution", (c) => c.dealer === dealerParty && c.caseRef === caseRef);
  const documents = [...input.documents].sort((a, b) => a.docRef.localeCompare(b.docRef) || a.docVersion - b.docVersion);
  for (const doc of documents) {
    if (contributions.some((c) => c.payload.docRef === doc.docRef && c.payload.docVersion === doc.docVersion && c.payload.sha256 === doc.sha256)) continue;
    const [row] = await db
      .select({ type: evidenceDocuments.type })
      .from(evidenceDocuments)
      .where(and(eq(evidenceDocuments.docRef, doc.docRef), eq(evidenceDocuments.version, doc.docVersion)))
      .limit(1);
    await seq.step(`contribute-${doc.docRef.toLowerCase()}-v${doc.docVersion}`, {
      prepare: async (ctx) => ({
        commands: [
          L.createDealerContribution({
            dealer: dealerParty,
            owner,
            caseRef,
            docRef: doc.docRef,
            docType: row ? (LEDGER_DOC_TYPES[row.type as DocumentType] ?? "OTHER") : "OTHER",
            docVersion: doc.docVersion,
            sha256: doc.sha256,
            contributorRef: ctx.actorRef,
            verificationUseConsented: true,
          }),
        ],
      }),
    });
  }
}
