// Verification evidence grants (daml-model.md §4.6 "Verification evidence grants"). The documents the owner selects
// for a verification request reach the ASSIGNED verifier only, as an immutable, scoped, expiring grant created in
// the same correlated sequence as the request (or the evidence resubmission):
// A selection must hold at least one owner document or one dealer document that may be requested (400 otherwise).
//   "grant"            owner-signed PackageShare {purpose VERIFICATION, recipient = the request's verifier,
//                      evidence = the request's anchor, documents = the selected OWNER documents at the exact
//                      manifest version + SHA-256, VIEW_DOWNLOAD, expiresAt = the request's due date or 30 days}
//   "dealer-grant-N"   PackageShareProposal (a consent request) for dealer N's selected documents, for a
//                      case-linked request only, unless the dealer's DealerContribution of that exact version
//                      records verificationUseConsented = false (withheld); the verifier gets them only after
//                      that dealer's own Consent_Grant (POST /consent-requests/:id/decision, or
//                      dealerVerificationConsent below)
//   "revoke-<ref>"     Share_Revoke of every other VERIFICATION grant of the package (superseded evidence version,
//   "withdraw-<ref>"   or an earlier, closed request: one open request per asset) / ShareProposal_Withdraw
// The share reference binds the grant to its request and evidence version (verificationGrantRef). No Daml change:
// PackageShare already requires the owner's signature and, for a dealer document, the dealer's.
import { evidenceDocuments, type Db } from "@collara/db";
import { VERIFICATION_GRANT_PURPOSE, verificationGrantRef, verificationGrantRequestRef } from "@collara/domain";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { problems } from "../../errors";
import type { AcsContract, AcsReader } from "../../ledger/acs";
import { ledgerCommands as L, type SharedDocumentInput } from "../../ledger/builders";
import type { Payload } from "../../ledger/contracts";
import type { WorkflowActor } from "../actors";
import type { WorkflowServices } from "../context";
import { must, sameAnchor } from "../preconditions";
import { workflowProblems } from "../problems";
import type { WorkflowOutcome, WorkflowSequence } from "../run";
import { currentManifest, manifestEntriesFor } from "../assets/manifest";
import { activeRequest } from "./ledger";

/** Grant lifetime when the request has no due date (or the due date has passed by a resubmission). */
export const DEFAULT_VERIFICATION_GRANT_DAYS = 30;
const DAY_MS = 86_400_000;
/** Step-name fragment of a share reference (step names are lower-case letters, digits and hyphens). */
const slug = (ref: string) => ref.toLowerCase().replace(/[^a-z0-9-]/g, "-");

/** INFERRED copy (same strings as the UI_MOCK client). */
export const GRANT_COPY = {
  NOT_AVAILABLE: (docRef: string, assetRef: string) => `Document ${docRef} is not available on ${assetRef}.`,
  NOTHING_TO_GRANT: "Select at least one of your own documents. Dealer documents can be requested only for a request linked to the dealer's case.",
  NO_PREVIOUS_SELECTION: "Select the documents to share with the verifier.",
  NO_GRANTED_EVIDENCE: "No evidence has been shared with you for the current version of this request.",
} as const;

type Anchor = { packageRef: string; manifestVersion: number; manifestHash: string };
type Entry = { docRef: string; docVersion: number; sha256: string; source: string };

export const verificationGrantExpiry = (dueBy: string | null | undefined, now: Date): Date => {
  const due = dueBy ? Date.parse(dueBy) : Number.NaN;
  return Number.isFinite(due) && due > now.getTime() ? new Date(due) : new Date(now.getTime() + DEFAULT_VERIFICATION_GRANT_DAYS * DAY_MS);
};

/** Key of an exact document version (DealerContribution ↔ manifest entry). */
export const exactKey = (d: { docRef: string; docVersion: number; sha256: string }) => `${d.docRef}#${d.docVersion}#${d.sha256}`;

export interface GrantPlan {
  /** Selected owner documents (exact version, hash and source from the manifest). */
  readonly owner: SharedDocumentInput[];
  /** Selected dealer documents to request from their dealer (a consent request each), per dealer (sorted by party). */
  readonly dealers: { readonly dealer: string; readonly documents: SharedDocumentInput[] }[];
  /** Selected dealer documents that cannot be requested (asset-level request, or withheld by the dealer): not shared. */
  readonly withheld: string[];
  /** Selected documents that are not in the manifest. */
  readonly missing: string[];
}

/**
 * Which of the selected documents go into which grant. Pure: `entries` is the current manifest (one entry per
 * document), `caseRef` the request's case (dealer documents need one: the dealer is invited to a case),
 * `dealerWithheld` holds exactKey() of the dealer contributions that record verificationUseConsented = false.
 */
export function planVerificationGrant(input: {
  readonly entries: readonly Entry[];
  readonly selection: readonly string[];
  readonly ownerParty: string;
  readonly caseRef: string | null;
  readonly dealerWithheld: ReadonlySet<string>;
}): GrantPlan {
  const byRef = new Map(input.entries.map((e) => [e.docRef, e]));
  const selected = [...new Set(input.selection)].sort();
  const shared = (e: Entry): SharedDocumentInput => ({ docRef: e.docRef, docVersion: e.docVersion, sha256: e.sha256, source: e.source });
  const owner: SharedDocumentInput[] = [];
  const dealers = new Map<string, SharedDocumentInput[]>();
  const withheld: string[] = [];
  const missing: string[] = [];
  for (const docRef of selected) {
    const entry = byRef.get(docRef);
    if (!entry) missing.push(docRef);
    else if (entry.source === input.ownerParty) owner.push(shared(entry));
    else if (input.caseRef && !input.dealerWithheld.has(exactKey(entry))) dealers.set(entry.source, [...(dealers.get(entry.source) ?? []), shared(entry)]);
    else withheld.push(docRef);
  }
  return {
    owner,
    dealers: [...dealers.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dealer, documents]) => ({ dealer, documents })),
    withheld,
    missing,
  };
}

/** docRef → contributing organisation of the asset's finalized documents (exactly what the next manifest commits). */
export async function finalizedDocuments(db: Db, input: { assetRef: string; ownerOrgId: string }): Promise<Map<string, string>> {
  const rows = await db
    .select({ docRef: evidenceDocuments.docRef, contributorOrgId: evidenceDocuments.contributorOrgId })
    .from(evidenceDocuments)
    .where(
      and(
        eq(evidenceDocuments.assetRef, input.assetRef),
        eq(evidenceDocuments.ownerOrgId, input.ownerOrgId),
        eq(evidenceDocuments.status, "AVAILABLE"),
        isNotNull(evidenceDocuments.sha256),
      ),
    )
    .orderBy(asc(evidenceDocuments.docRef), asc(evidenceDocuments.version));
  return new Map(rows.map((r) => [r.docRef, r.contributorOrgId]));
}

/**
 * Checks a selection against the asset's finalized documents (AVAILABLE with a server SHA-256) before anything is
 * submitted: 400 for a document that is not available.
 */
export async function validateSelection(db: Db, input: { assetRef: string; ownerOrgId: string; selection: readonly string[] }): Promise<void> {
  const finalized = await finalizedDocuments(db, input);
  const missing = input.selection.filter((id) => !finalized.has(id));
  if (missing.length > 0) {
    throw problems.validation(missing.map((id) => ({ path: "body.documentIds", message: GRANT_COPY.NOT_AVAILABLE(id, input.assetRef) })));
  }
}

/** exactKey() of the dealer contributions of a case that withhold verification use (owner's fresh view). */
async function withheldDealerDocuments(acs: AcsReader, input: { ownerParty: string; caseRef: string | null }): Promise<Set<string>> {
  if (!input.caseRef) return new Set();
  const contributions = await acs.list("DealerContribution", (c) => c.owner === input.ownerParty && c.caseRef === input.caseRef && !c.verificationUseConsented);
  return new Set(contributions.map((c) => exactKey(c.payload)));
}

/**
 * Inside the sequence, before anything is submitted: the selection against the manifest the request will point at
 * (the finalized documents) and the dealers' consents. 400 when nothing in it can reach the verifier.
 */
export async function assertGrantable(
  db: Db,
  ownerAcs: AcsReader,
  input: { assetRef: string; ownerOrgId: string; ownerParty: string; caseRef: string | null; selection: readonly string[] },
): Promise<void> {
  const entries = await manifestEntriesFor(db, input);
  const plan = planVerificationGrant({
    entries,
    selection: input.selection,
    ownerParty: input.ownerParty,
    caseRef: input.caseRef,
    dealerWithheld: await withheldDealerDocuments(ownerAcs, input),
  });
  if (plan.missing.length > 0) {
    throw problems.validation(plan.missing.map((id) => ({ path: "body.documentIds", message: GRANT_COPY.NOT_AVAILABLE(id, input.assetRef) })));
  }
  if (plan.owner.length === 0 && plan.dealers.length === 0) {
    throw problems.validation([{ path: "body.documentIds", message: GRANT_COPY.NOTHING_TO_GRANT }], GRANT_COPY.NOTHING_TO_GRANT);
  }
}

const isGrantOf = (owner: string, packageRef: string) => (s: { owner: string; purpose: string; evidence: Anchor }) =>
  s.owner === owner && s.purpose === VERIFICATION_GRANT_PURPOSE && s.evidence.packageRef === packageRef;

/** The owner's VERIFICATION grants (shares) and pending dealer requests (proposals) of a package, fresh. */
export async function packageGrants(acs: AcsReader, input: { ownerParty: string; packageRef: string }) {
  const of = isGrantOf(input.ownerParty, input.packageRef);
  const [shares, proposals] = await Promise.all([acs.list("PackageShare", of), acs.list("PackageShareProposal", of)]);
  return { shares, proposals };
}

/** Documents granted (or awaiting the dealer's consent) for one request, any evidence version: the default resubmission selection. */
export async function previousSelection(acs: AcsReader, input: { ownerParty: string; packageRef: string; requestRef: string }): Promise<string[]> {
  const { shares, proposals } = await packageGrants(acs, input);
  const mine = [...shares, ...proposals].filter((c) => verificationGrantRequestRef(c.payload.shareRef) === input.requestRef);
  return [...new Set(mine.flatMap((c) => c.payload.documents.map((d) => d.docRef)))].sort();
}

export interface IssueGrantsInput {
  readonly ownerAcs: AcsReader;
  readonly namespace: string;
  readonly ownerParty: string;
  readonly assetRef: string;
  readonly requestRef: string;
  readonly caseRef: string | null;
  readonly selection: readonly string[];
  readonly now: Date;
}

export interface IssuedGrants {
  /** The owner-signed grant of the request's current evidence version (null: no owner document selected). */
  readonly grantRef: string | null;
  /** Dealer grant requests awaiting the dealer's Consent_Grant. */
  readonly pendingDealerRefs: string[];
}

/**
 * Grants the selection for the request's CURRENT evidence version and retires every other VERIFICATION grant of
 * the package. Runs inside the owner's sequence, after the request (or resubmission) step committed.
 */
export async function issueVerificationGrants(seq: WorkflowSequence, input: IssueGrantsInput): Promise<IssuedGrants> {
  const { ownerAcs, ownerParty, requestRef } = input;
  const request = await activeRequest(ownerAcs, { ref: requestRef, namespace: input.namespace });
  const manifest = must(await currentManifest(ownerAcs, { assetRef: input.assetRef, ownerParty, namespace: input.namespace }));
  const evidence: Anchor = request.payload.evidence;
  const manifestAnchor = { packageRef: manifest.payload.packageRef, manifestVersion: manifest.payload.version, manifestHash: manifest.payload.manifestHash };
  // The request must point at the manifest whose entries are granted (the exact versions and hashes).
  if (!sameAnchor(evidence, manifestAnchor) || request.payload.owner !== ownerParty) throw workflowProblems.stateChanged();
  const verifier = request.payload.verifier;
  const plan = planVerificationGrant({
    entries: manifest.payload.entries,
    selection: input.selection,
    ownerParty,
    caseRef: input.caseRef,
    dealerWithheld: await withheldDealerDocuments(ownerAcs, { ownerParty, caseRef: input.caseRef }),
  });
  if (plan.missing.length > 0 || (plan.owner.length === 0 && plan.dealers.length === 0)) throw workflowProblems.stateChanged();
  const expiresAt = verificationGrantExpiry(request.payload.dueBy, input.now);
  const { shares, proposals } = await packageGrants(ownerAcs, { ownerParty, packageRef: evidence.packageRef });
  const exists = (ref: string) => [...shares, ...proposals].some((c) => c.payload.shareRef === ref && sameAnchor(c.payload.evidence, evidence));
  const live = async (ctxAcs: AcsReader) => {
    const current = await activeRequest(ctxAcs, { ref: requestRef, namespace: input.namespace });
    if (!sameAnchor(current.payload.evidence, evidence) || current.payload.verifier !== verifier) throw workflowProblems.stateChanged();
  };
  const common = {
    owner: ownerParty,
    recipient: verifier,
    purpose: VERIFICATION_GRANT_PURPOSE,
    caseRef: input.caseRef ?? "",
    evidence,
    permission: "VIEW_DOWNLOAD" as const,
    expiresAt,
  };
  const keep = new Set<string>();

  const grantRef = plan.owner.length > 0 ? verificationGrantRef(requestRef, evidence.manifestVersion) : null;
  if (grantRef) keep.add(grantRef);
  if (grantRef && !exists(grantRef)) {
    await seq.step("grant", {
      payload: { shareRef: grantRef, documents: plan.owner.map((d) => `${d.docRef}#${d.docVersion}`) },
      prepare: async (ctx) => {
        await live(ctx.acs);
        return { commands: [L.createPackageShare({ ...common, consenters: [], shareRef: grantRef, documents: plan.owner })] };
      },
      result: (s) => ({ shareCid: s.createdOf("PackageShare") }),
    });
  }

  const pendingDealerRefs: string[] = [];
  for (const [i, { dealer, documents }] of plan.dealers.entries()) {
    const ref = verificationGrantRef(requestRef, evidence.manifestVersion, i + 1);
    keep.add(ref);
    if (!shares.some((c) => c.payload.shareRef === ref && sameAnchor(c.payload.evidence, evidence))) pendingDealerRefs.push(ref);
    if (exists(ref)) continue;
    await seq.step(`dealer-grant-${i + 1}`, {
      payload: { shareRef: ref, documents: documents.map((d) => `${d.docRef}#${d.docVersion}`) },
      prepare: async (ctx) => {
        await live(ctx.acs);
        return { commands: [L.createPackageShareProposal({ ...common, dealer, shareRef: ref, documents })] };
      },
      result: (s) => ({ proposalCid: s.createdOf("PackageShareProposal") }),
    });
  }

  await retireGrants(seq, { shares: shares.filter((c) => !keep.has(c.payload.shareRef)), proposals: proposals.filter((c) => !keep.has(c.payload.shareRef)) });
  return { grantRef, pendingDealerRefs };
}

/** Share_Revoke / ShareProposal_Withdraw (owner) of superseded grants, one step each. */
async function retireGrants(
  seq: WorkflowSequence,
  input: { shares: readonly AcsContract<Payload<"PackageShare">>[]; proposals: readonly AcsContract<Payload<"PackageShareProposal">>[] },
): Promise<void> {
  const byRef = <T extends { payload: { shareRef: string } }>(a: T, b: T) => a.payload.shareRef.localeCompare(b.payload.shareRef);
  for (const share of [...input.shares].sort(byRef)) {
    await seq.step(`revoke-${slug(share.payload.shareRef)}`, {
      payload: { shareRef: share.payload.shareRef },
      prepare: async (ctx) => {
        const live = must(await ctx.acs.get("PackageShare", share.contractId));
        return { commands: [L.shareRevoke(live.contractId, { actorRef: ctx.actorRef })] };
      },
    });
  }
  for (const proposal of [...input.proposals].sort(byRef)) {
    await seq.step(`withdraw-${slug(proposal.payload.shareRef)}`, {
      payload: { shareRef: proposal.payload.shareRef },
      prepare: async (ctx) => {
        const live = must(await ctx.acs.get("PackageShareProposal", proposal.contractId));
        return { commands: [L.shareProposalWithdraw(live.contractId, { actorRef: ctx.actorRef })] };
      },
    });
  }
}

/**
 * The invited dealer's bulk consent path for verification: Consent_Grant on every pending VERIFICATION grant
 * request of the case naming this dealer. The resulting PackageShare is signed by the owner and the dealer. 409
 * when nothing awaits the dealer's consent. One request at a time: POST /consent-requests/:id/decision.
 */
export function dealerVerificationConsent(input: {
  readonly workflow: WorkflowServices;
  readonly dealer: WorkflowActor;
  readonly caseRef: string;
  readonly idempotencyKey: string;
}): Promise<WorkflowOutcome<{ grantIds: string[] }>> {
  const { workflow, dealer, caseRef } = input;
  return workflow.sequence({
    actor: dealer,
    operation: "verification.dealerConsent",
    idempotencyKey: input.idempotencyKey,
    payload: { caseRef },
    resourceRef: caseRef,
    steps: async (seq) => {
      const dealerParty = must(dealer.business, workflowProblems.ledgerUnavailable).party;
      const proposals = (
        await workflow.acs(dealer).list("PackageShareProposal", (p) => p.dealer === dealerParty && p.caseRef === caseRef && p.purpose === VERIFICATION_GRANT_PURPOSE)
      ).sort((a, b) => a.payload.shareRef.localeCompare(b.payload.shareRef));
      if (proposals.length === 0) throw workflowProblems.stateChanged();
      for (const proposal of proposals) {
        await seq.step(`consent-${slug(proposal.payload.shareRef)}`, {
          payload: { shareRef: proposal.payload.shareRef },
          prepare: async (ctx) => {
            const live = must(await ctx.acs.get("PackageShareProposal", proposal.contractId));
            return { commands: [L.consentGrant(live.contractId, { actorRef: ctx.actorRef })] };
          },
          result: (s) => ({ shareCid: s.createdOf("PackageShare") }),
        });
      }
      return { grantIds: proposals.map((p) => p.payload.shareRef) };
    },
  });
}
