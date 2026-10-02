// Evidence access for parties other than the document's owner or contributor (daml-model.md §4.6: "The API
// checks an active, unexpired share covering the document at every download"):
//   metadata  — the read model (stakeholder-filtered projections) and the domain presenters decide which
//               documents and versions a recipient, auditor or verifier may see (presentEvidenceDocument);
//   download  — re-checked at request time against the recipient's FRESH ledger view: an active PackageShare
//               to the actor's organisation that covers the exact version (and SHA-256), with VIEW_DOWNLOAD, not
//               expired. A VERIFICATION grant (purpose VERIFICATION) also needs the VERIFIER role and an OPEN
//               VerificationRequest on the same ledger view that names the actor as verifier, has the grant's
//               owner, is the request the grant reference names, and points at the grant's evidence version.
// A former recipient (share revoked or expired) gets 409 with the approved revocation copy; a party that may
// see the metadata but never had download permission gets 403; everyone else gets the 404-shaped answer.
import { evidenceDocuments, type Db } from "@collara/db";
import { presentEvidenceDocument, STATUS_COPY, VERIFICATION_GRANT_PURPOSE, verificationGrantRequestRef, type EvidenceDocument, type Role, type RuntimeMode } from "@collara/domain";
import { and, eq } from "drizzle-orm";
import { problems, type ProblemError } from "../../errors";
import type { Payload } from "../../ledger/contracts";
import type { ResolvedActor } from "../../plugins/actor";
import type { WorkflowServices } from "../context";
import { loadViewerWorld } from "../cases/read";
import { sameAnchor } from "../preconditions";

/** The document as the viewer may see it through the read model, or null (404-shaped). */
export async function presentSharedEvidence(db: Db, member: ResolvedActor, docRef: string, mode: RuntimeMode, now: Date): Promise<{ doc: EvidenceDocument; revoked: boolean } | null> {
  const { world, pctx } = await loadViewerWorld(db, member, mode, now);
  for (const asset of world.assets) {
    if (!asset.documents.some((d) => d.ref === docRef)) continue;
    const doc = presentEvidenceDocument(asset, docRef, world.cases, member, pctx);
    if (!doc) return null;
    const revoked = world.cases.some(
      (c) =>
        c.asset.ref === asset.ref &&
        c.shares.some((s) => s.recipientOrgId === member.orgId && (s.state === "REVOKED" || s.state === "EXPIRED") && s.entries.some((e) => e.documentRef === docRef)),
    );
    return { doc, revoked };
  }
  return null;
}

export interface ShareCoverage {
  readonly version: number;
  readonly sha256: string;
  readonly permission: "VIEW" | "VIEW_DOWNLOAD";
}

/**
 * Pure coverage rule over the actor's fresh ACS: active shares to `party` (the caller lists them) and, for
 * VERIFICATION grants, the open verification requests `party` observes.
 */
export function coverageOf(input: {
  readonly party: string;
  readonly roles: readonly Role[];
  readonly docRef: string;
  readonly now: Date;
  readonly shares: readonly Payload<"PackageShare">[];
  readonly openRequests: readonly Payload<"VerificationRequest">[];
}): ShareCoverage[] {
  const covered: ShareCoverage[] = [];
  for (const s of input.shares) {
    if (s.recipient !== input.party || Date.parse(s.expiresAt) <= input.now.getTime()) continue;
    if (s.purpose === VERIFICATION_GRANT_PURPOSE) {
      const requestRef = verificationGrantRequestRef(s.shareRef);
      const bound =
        input.roles.includes("VERIFIER") &&
        input.openRequests.some((r) => r.verifier === input.party && r.owner === s.owner && r.requestRef === requestRef && sameAnchor(r.evidence, s.evidence));
      if (!bound) continue;
    }
    for (const d of s.documents) if (d.docRef === input.docRef) covered.push({ version: d.docVersion, sha256: d.sha256, permission: s.permission });
  }
  return covered;
}

/** Active, unexpired package shares to the actor's organisation covering the document (fresh ACS read). */
export async function activeShareCoverage(workflow: WorkflowServices | null, member: ResolvedActor, docRef: string, now: Date): Promise<ShareCoverage[]> {
  if (!workflow?.access) return [];
  const actor = await workflow.actorFor(member);
  const party = actor.business?.party;
  if (!party) return [];
  const acs = workflow.acs(actor);
  const shares = await acs.list("PackageShare", (s) => s.recipient === party && Date.parse(s.expiresAt) > now.getTime() && s.documents.some((d) => d.docRef === docRef));
  const needsRequest = shares.some((s) => s.payload.purpose === VERIFICATION_GRANT_PURPOSE);
  const openRequests = needsRequest ? await acs.list("VerificationRequest", (r) => r.verifier === party) : [];
  return coverageOf({ party, roles: member.roles, docRef, now, shares: shares.map((s) => s.payload), openRequests: openRequests.map((r) => r.payload) });
}

/**
 * The version a non-owner may download right now, or the problem to answer with. `requested` is the optional
 * ?version= query parameter. The stored version must have the SHA-256 the share names.
 */
export async function sharedDownloadVersion(input: {
  db: Db;
  workflow: WorkflowServices | null;
  member: ResolvedActor;
  docRef: string;
  requested: number | undefined;
  mode: RuntimeMode;
  now: Date;
}): Promise<{ version: number } | { problem: ProblemError }> {
  const coverage = await activeShareCoverage(input.workflow, input.member, input.docRef, input.now);
  const downloadable = coverage.filter((c) => c.permission === "VIEW_DOWNLOAD");
  const version = input.requested ?? (downloadable.length > 0 ? Math.max(...downloadable.map((c) => c.version)) : undefined);
  const granted = version === undefined ? [] : downloadable.filter((c) => c.version === version);
  if (version !== undefined && granted.length > 0) {
    const [row] = await input.db
      .select({ sha256: evidenceDocuments.sha256 })
      .from(evidenceDocuments)
      .where(and(eq(evidenceDocuments.docRef, input.docRef), eq(evidenceDocuments.version, version)))
      .limit(1);
    if (row?.sha256 && granted.some((c) => c.sha256 === row.sha256)) return { version };
    return { problem: problems.forbidden() };
  }
  const visible = await presentSharedEvidence(input.db, input.member, input.docRef, input.mode, input.now);
  if (!visible) return { problem: problems.unavailable() };
  if (coverage.length === 0 && visible.revoked) return { problem: problems.stateConflict(STATUS_COPY.ACCESS_REVOKED) };
  return { problem: problems.forbidden() };
}
