// Builds the viewer's domain facts (AssetFacts, CaseFacts) from the stakeholder-filtered ledger view plus the
// application records the viewer's organization may use (cases, evidence_documents, export_jobs). The mapping
// of every Daml field and status is documented in README.md (same folder).
import {
  ASSET_NAMESPACE,
  AUDIT_SCOPES,
  CREDIT_POLICY_REF,
  DOCUMENT_TYPE_LABELS,
  DOCUMENT_TYPES,
  orgName,
  safeParseMoney,
  userIdFromActorRef,
  VERIFICATION_GRANT_PURPOSE,
  verificationGrantRequestRef,
  type ActivationAuthorizationFacts,
  type AssetControlFacts,
  type AssetFacts,
  type AssetLifecycleState,
  type AttestationFacts,
  type AuditGrantFacts,
  type AuditScope,
  type CaseFacts,
  type CheckResult,
  type ConsentFacts,
  type ConsentState,
  type DocumentType,
  type EvidenceContentType,
  type EvidenceDocumentFacts,
  type EvidencePackageFacts,
  type EvidenceUploadState,
  type ExportFacts,
  type ExportJobState,
  type LockFacts,
  type ManifestEntry,
  type ProposalVersionFacts,
  type ReleaseReason,
  type ReleaseRequestFacts,
  type ReviewFacts,
  type ReviewState,
  type Role,
  type ShareFacts,
  type VerificationFacts,
  type VerificationState,
} from "@collara/domain";
import { T } from "../projection/templates";
import type { CaseRow, EvidenceDocumentRow, ExportJobRow } from "../schema";
import { decode, obj, str } from "./decode";
import { mapLedgerEvent, type MappedEvent } from "./events";
import type { LedgerView, PartyDirectory, VisibleContract } from "./ledger-view";
import type { ReadViewer } from "./viewer";

export interface WorldInput {
  readonly viewer: ReadViewer;
  readonly now: Date;
  readonly view: LedgerView;
  readonly parties: PartyDirectory;
  /** Application case rows the viewer may use (borrower org rows + rows of cases visible on the ledger). */
  readonly caseRows: readonly CaseRow[];
  /** Evidence rows of the assets in scope (filtered per document here). */
  readonly documents: readonly EvidenceDocumentRow[];
  /** Export jobs of the viewer's organization. */
  readonly exports: readonly ExportJobRow[];
}

export interface PendingRegistration {
  readonly requestRef: string;
  readonly ownerOrgId: string;
  readonly equipmentClass: string;
  readonly manufacturer: string;
  readonly model: string;
  readonly serialNumber: string;
  readonly state: AssetLifecycleState;
  readonly requestedAt: string;
  /** Set once the registrar accepted (from the owner's issuance ticket). */
  readonly assetRef: string | null;
}

export interface BuiltWorld {
  readonly assets: AssetFacts[];
  readonly cases: CaseFacts[];
  readonly pendingRegistrations: PendingRegistration[];
  readonly events: readonly MappedEvent[];
}

// --- small helpers --------------------------------------------------------------------------------------

const byOffset = (a: VisibleContract, b: VisibleContract) => a.createdOffset - b.createdOffset || a.createdNodeId - b.createdNodeId;
const last = <X>(xs: readonly X[]): X | undefined => xs[xs.length - 1];
const isActive = (c: VisibleContract) => c.archived === null;
const isoOr = (value: string | null | undefined, fallback: string) => (value ? value : fallback);
const lastTouched = (c: VisibleContract) => c.archived?.at ?? c.createdAt;
const maxIso = (xs: readonly string[]) => xs.filter(Boolean).sort().at(-1) ?? "";
const minIso = (xs: readonly string[]) => xs.filter(Boolean).sort()[0] ?? "";

function groupBy<X>(xs: readonly X[], key: (x: X) => string | null): Map<string, X[]> {
  const map = new Map<string, X[]>();
  for (const x of xs) {
    const k = key(x);
    if (k === null) continue;
    const list = map.get(k);
    if (list) list.push(x);
    else map.set(k, [x]);
  }
  return map;
}

/** Latest version of a versioned contract family (active first, then by the given version, then by offset). */
function latestOf(xs: readonly VisibleContract[], version: (c: VisibleContract) => number): VisibleContract | undefined {
  return [...xs].sort((a, b) => version(a) - version(b) || byOffset(a, b)).at(-1);
}

const DOC_TYPE_ALIASES: Readonly<Record<string, DocumentType>> = {
  INVOICE: "DEALER_INVOICE",
  DEALER_INVOICE: "DEALER_INVOICE",
  PHOTOS: "EQUIPMENT_PHOTOS",
  PHOTO: "EQUIPMENT_PHOTOS",
  INSPECTION: "INSPECTION_REPORT",
  MAINTENANCE: "MAINTENANCE_SUMMARY",
  MAINTENANCE_LOG: "MAINTENANCE_SUMMARY",
  PURCHASE: "PURCHASE_AGREEMENT",
};
export function documentTypeOf(raw: string): DocumentType {
  const upper = raw.toUpperCase();
  if ((DOCUMENT_TYPES as readonly string[]).includes(upper)) return upper as DocumentType;
  return DOC_TYPE_ALIASES[upper] ?? "OTHER";
}

const CHECK_RESULTS: readonly CheckResult[] = ["CHECKED", "CHECKED_NOTED", "REVIEWED_DOCUMENTS", "NOT_CHECKED"];
const checkResult = (raw: string): CheckResult => (CHECK_RESULTS.includes(raw as CheckResult) ? (raw as CheckResult) : "NOT_CHECKED");
const REVIEW_STATES: readonly ReviewState[] = ["SUBMITTED", "IN_REVIEW", "NEEDS_INFORMATION", "PENDING_APPROVAL", "ELIGIBLE", "REJECTED"];
const RELEASE_REASONS: readonly ReleaseReason[] = ["EXTERNAL_LOAN_COMPLETION", "REFINANCING", "ADMINISTRATIVE_CORRECTION"];
const UPLOAD_STATES: readonly EvidenceUploadState[] = ["UPLOAD_PENDING", "QUARANTINED", "AVAILABLE", "REJECTED", "HASH_MISMATCH"];
const CONTENT_TYPES: readonly EvidenceContentType[] = ["application/pdf", "image/jpeg", "image/png"];
const EXPORT_STATES: readonly ExportJobState[] = ["QUEUED", "GENERATING", "READY", "EXPIRED", "FAILED"];

/** VerificationRequest terminal choices (daml-model D14: no successor contract). */
const VR_TERMINAL: Readonly<Record<string, VerificationState>> = {
  VR_IssueAttestation: "ATTESTED",
  VR_Reject: "REJECTED",
  VR_DeclineAssignment: "DECLINED",
  VR_Cancel: "CANCELLED",
};
/** Choices that recreate the request (a newer version normally exists; used only if it is not visible). */
const VR_NEXT: Readonly<Record<string, VerificationState>> = {
  VR_AcceptAssignment: "IN_REVIEW",
  VR_RequestChanges: "CHANGES_REQUESTED",
  VR_SubmitNewEvidence: "IN_REVIEW",
};

// --- the builder ----------------------------------------------------------------------------------------

export function buildWorld(input: WorldInput): BuiltWorld {
  const { viewer, now, view, parties } = input;
  const nowIso = now.toISOString();
  const org = (party: string | null | undefined) => parties.orgIdOf(party);
  const of = (template: string) => view.contracts.filter((c) => c.templateRef === template);

  const events: MappedEvent[] = view.events.flatMap((e) => {
    const mapped = mapLedgerEvent(e, parties);
    return mapped ? [mapped] : [];
  });

  // Cross-asset/cross-case lookups. Everything scoped to one asset or case is picked per asset (byAsset) or per
  // case (byCase) below, from the business columns extracted at projection time (projection/templates.ts).
  const requests = of(T.AssetRegistrationRequest);
  const tickets = of(T.IssuanceTicket);
  const contributions = of(T.DealerContribution);
  // Verification grants (purpose VERIFICATION, recipient = the assigned verifier) are not lender shares: they never
  // appear in case.shares and only count while active and unexpired (daml-model.md §4.6).
  const isVerificationGrant = (c: VisibleContract) => decode.share(c.payload).purpose === VERIFICATION_GRANT_PURPOSE;
  const liveGrant = (c: VisibleContract) => {
    const expiresAt = decode.share(c.payload).expiresAt;
    return isActive(c) && (!expiresAt || Date.parse(expiresAt) > now.getTime());
  };
  const shareProposals = of(T.PackageShareProposal).filter((c) => !isVerificationGrant(c));
  const verificationGrants = of(T.PackageShare).filter(isVerificationGrant);
  const shares = [...of(T.PackageShare).filter((c) => !isVerificationGrant(c)), ...verificationGrants.filter(liveGrant)];
  const attestations = of(T.VerificationAttestation);
  const revoked = of(T.RevokedAttestation);
  const mirrors = of(T.VerifierStatusMirror);
  const accreditations = of(T.VerifierAccreditation);

  const verifierRefByParty = new Map<string, string>();
  for (const c of [...mirrors, ...accreditations]) verifierRefByParty.set(str(c.payload.verifier), str(c.payload.verifierRef));
  for (const c of attestations) verifierRefByParty.set(str(c.payload.verifier), str(c.payload.verifierRef));

  // Registration requests → pending registrations (requestRef → assetId through the owner's ticket) -------
  const assetByRequest = new Map(tickets.map((t) => [str(t.payload.requestRef), str(t.payload.assetId)]));
  const pendingRegistrations: PendingRegistration[] = requests.map((c) => {
    const r = decode.registrationRequest(c.payload);
    const choice = c.archived?.choice ?? null;
    const state: AssetLifecycleState =
      choice === null ? "REGISTRATION_REQUESTED" : choice === "Request_Accept" ? "REGISTERED" : choice === "Request_Decline" ? "REGISTRATION_DECLINED" : "ARCHIVED";
    return {
      requestRef: r.requestRef,
      ownerOrgId: org(r.owner),
      equipmentClass: r.equipmentClass,
      manufacturer: r.manufacturer,
      model: r.model,
      serialNumber: r.serialNumber,
      state,
      requestedAt: c.createdAt,
      assetRef: assetByRequest.get(r.requestRef) ?? null,
    };
  });

  // Documents: app rows visible to the viewer ----------------------------------------------------------
  const sharedDocKeys = new Set(
    [...shares, ...shareProposals].flatMap((c) => decode.share(c.payload).documents.map((d) => `${d.docRef}#${d.docVersion}`)),
  );

  // Case rows by ref ------------------------------------------------------------------------------------
  const caseRowByRef = new Map(input.caseRows.map((r) => [r.caseRef, r]));

  // Asset refs in scope -------------------------------------------------------------------------------------
  const assetRefs = new Set<string>();
  for (const c of view.contracts) {
    if (c.assetRef && c.templateRef !== T.AssetRegistrationRequest) assetRefs.add(c.assetRef);
  }
  for (const r of input.caseRows) assetRefs.add(r.assetRef);
  for (const d of input.documents) if (d.ownerOrgId === viewer.orgId || d.contributorOrgId === viewer.orgId) assetRefs.add(d.assetRef);

  const byAsset = groupBy(view.contracts, (c) => c.assetRef);

  // --- Asset facts ------------------------------------------------------------------------------------------
  function buildAsset(ref: string, fallbackOwnerOrg: string | null): AssetFacts {
    const cs = byAsset.get(ref) ?? [];
    const pick = (template: string) => cs.filter((c) => c.templateRef === template);
    const passport = latestOf(pick(T.AssetPassport), (c) => decode.passport(c.payload).passportVersion);
    const pp = passport ? decode.passport(passport.payload) : null;
    const ticket = pick(T.IssuanceTicket)[0];
    const request = ticket ? requests.find((r) => str(r.payload.requestRef) === str(ticket.payload.requestRef)) : undefined;
    const rq = request ? decode.registrationRequest(request.payload) : null;
    const ownerParty =
      pp?.owner ??
      cs.map((c) => str(c.payload.owner) || str(c.payload.borrower) || str(obj(c.payload.attestation).owner)).find(Boolean) ??
      null;
    const ownerOrgId = ownerParty ? org(ownerParty) : (fallbackOwnerOrg ?? "party:unknown");
    const isOwnerView = ownerOrgId === viewer.orgId;

    // Package: owner manifests, else the anchor the viewer can see.
    const assetManifests = pick(T.EvidenceManifest).sort(byOffset);
    const currentManifest = latestOf(assetManifests, (c) => decode.manifest(c.payload).version);
    const manifestEntries = (c: VisibleContract | undefined): ManifestEntry[] =>
      c ? decode.manifest(c.payload).entries.map((e) => ({ documentRef: e.docRef, version: e.docVersion })) : [];
    const activeControl = pick(T.AssetControl).filter(isActive).sort(byOffset).at(-1);
    const activeLock = pick(T.CollateralLock).filter(isActive).sort(byOffset).at(-1);
    const assetVrs = pick(T.VerificationRequest).sort(byOffset);
    const assetAttestations = pick(T.VerificationAttestation).sort(byOffset);
    const assetDisclosures = pick(T.AttestationDisclosure).sort(byOffset);
    // Shares name a case, not an asset: the shares (and share requests) of this asset's cases. A consenting dealer
    // sees the package anchor only through them.
    const assetShares = [...shares, ...shareProposals]
      .filter((c) => caseRowByRef.get(str(c.payload.caseRef))?.assetRef === ref)
      .sort(byOffset);
    const visibleAnchor =
      (activeControl && decode.control(activeControl.payload).evidence) ??
      (activeLock && decode.lock(activeLock.payload).evidence) ??
      [...assetVrs].reverse().map((c) => decode.verificationRequest(c.payload).evidence).find(Boolean) ??
      [...assetDisclosures].reverse().map((c) => decode.attestation(decode.disclosure(c.payload).attestation).evidence).find(Boolean) ??
      [...assetShares].reverse().map((c) => decode.share(c.payload).evidence).find(Boolean) ??
      null;
    let pkg: EvidencePackageFacts;
    if (currentManifest) {
      const m = decode.manifest(currentManifest.payload);
      pkg = {
        ref: m.packageRef,
        version: m.version,
        entries: manifestEntries(currentManifest),
        history: assetManifests.map((c) => ({ version: decode.manifest(c.payload).version, committedAt: c.createdAt })),
      };
    } else {
      const anchorShares = shares.filter((s) => {
        const a = decode.share(s.payload).evidence;
        return a && visibleAnchor && a.packageRef === visibleAnchor.packageRef && a.manifestVersion === visibleAnchor.manifestVersion;
      });
      const entries = new Map<string, ManifestEntry>();
      for (const s of anchorShares) for (const d of decode.share(s.payload).documents) entries.set(d.docRef, { documentRef: d.docRef, version: d.docVersion });
      pkg = {
        ref: visibleAnchor?.packageRef ?? "",
        version: visibleAnchor?.manifestVersion ?? 0,
        entries: [...entries.values()].sort((a, b) => a.documentRef.localeCompare(b.documentRef)),
        history: visibleAnchor ? [{ version: visibleAnchor.manifestVersion, committedAt: activeControl?.createdAt ?? activeLock?.createdAt ?? "" }] : [],
      };
    }
    const entriesOf = (packageRef: string, version: number): ManifestEntry[] => {
      const m = assetManifests.find((c) => {
        const d = decode.manifest(c.payload);
        return d.packageRef === packageRef && d.version === version;
      });
      if (m) return manifestEntries(m);
      const entries: ManifestEntry[] = [];
      for (const s of shares) {
        const d = decode.share(s.payload);
        if (d.evidence?.packageRef === packageRef && d.evidence.manifestVersion === version) {
          for (const doc of d.documents) entries.push({ documentRef: doc.docRef, version: doc.docVersion });
        }
      }
      return entries;
    };
    // Verification grants of one request (bound by the grant reference) for one evidence version. Only the owner
    // and the verifier are stakeholders; any state for history (attestations), live ones for current access.
    type Anchor = { packageRef: string; manifestVersion: number; manifestHash: string } | null;
    const grantsOf = (r: { requestRef: string; owner: string; verifier: string; evidence: Anchor }, liveOnly: boolean) =>
      verificationGrants.filter((c) => {
        const s = decode.share(c.payload);
        const e = s.evidence;
        return (
          (!liveOnly || liveGrant(c)) &&
          verificationGrantRequestRef(s.shareRef) === r.requestRef &&
          s.owner === r.owner &&
          s.recipient === r.verifier &&
          !!e &&
          !!r.evidence &&
          e.packageRef === r.evidence.packageRef &&
          e.manifestVersion === r.evidence.manifestVersion &&
          e.manifestHash === r.evidence.manifestHash
        );
      });
    const grantedEntries = (grants: readonly VisibleContract[]): ManifestEntry[] => {
      const entries = new Map<string, ManifestEntry>();
      for (const g of grants) for (const d of decode.share(g.payload).documents) entries.set(`${d.docRef}#${d.docVersion}`, { documentRef: d.docRef, version: d.docVersion });
      return [...entries.values()].sort((a, b) => a.documentRef.localeCompare(b.documentRef) || a.version - b.version);
    };

    // Attestations (verifier/owner originals, recipient copies).
    const attestationFacts = new Map<string, AttestationFacts>();
    const supersededBy = new Map<string, string>();
    for (const c of assetAttestations) {
      const a = decode.attestation(c.payload);
      if (a.supersedesRef) supersededBy.set(a.supersedesRef, a.attestationRef);
      if (c.archived?.choice === "Att_Supersede") supersededBy.set(a.attestationRef, str(c.archived.argument.supersededByRef));
    }
    for (const c of assetDisclosures) {
      const a = decode.attestation(decode.disclosure(c.payload).attestation);
      if (a.supersedesRef) supersededBy.set(a.supersedesRef, a.attestationRef);
    }
    const revokedAt = new Map(
      revoked.filter((c) => str(c.payload.assetId) === ref).map((c) => [str(c.payload.attestationRef), str(c.payload.revokedAt) || c.createdAt]),
    );
    const attestationOf = (raw: ReturnType<typeof decode.attestation>, contract: VisibleContract, copy: boolean): AttestationFacts => {
      const withdrawn = copy && contract.archived && contract.archived.choice !== "AttDisc_Revoke" ? contract.archived.at : null;
      const supersededByRef = supersededBy.get(raw.attestationRef) ?? null;
      return {
        ref: raw.attestationRef,
        verificationRef: raw.requestRef,
        assetRef: raw.assetId,
        issuerOrgId: org(raw.verifier),
        verifierRegistryRef: raw.verifierRef,
        method: raw.method,
        inspectedAt: raw.inspectedAt,
        issuedAt: raw.issuedAt || contract.createdAt,
        validFrom: raw.validFrom,
        validUntil: raw.validUntil,
        checks: raw.checks.map((x) => ({ item: x.item, finding: x.finding, result: checkResult(x.result) })),
        limitations: raw.limitations,
        packageRef: raw.evidence?.packageRef ?? "",
        packageVersion: raw.evidence?.manifestVersion ?? 0,
        // The versions the verifier was granted for the attested evidence version (owner and verifier views);
        // otherwise (lender copies, attestations issued without a grant) the package entries of that version.
        supportingVersions: raw.evidence
          ? (() => {
              const reviewed = grantedEntries(grantsOf({ requestRef: raw.requestRef, owner: raw.owner, verifier: raw.verifier, evidence: raw.evidence }, false));
              return reviewed.length > 0 ? reviewed : entriesOf(raw.evidence.packageRef, raw.evidence.manifestVersion);
            })()
          : [],
        supersedes: raw.supersedesRef,
        supersededBy: supersededByRef,
        revokedAt:
          revokedAt.get(raw.attestationRef) ??
          (contract.archived?.choice === "Att_Revoke" ? contract.archived.at : null) ??
          (withdrawn && !supersededByRef ? withdrawn : null),
      };
    };
    for (const c of assetAttestations) {
      const a = decode.attestation(c.payload);
      attestationFacts.set(a.attestationRef, attestationOf(a, c, false));
    }
    for (const c of assetDisclosures) {
      const a = decode.attestation(decode.disclosure(c.payload).attestation);
      const existing = attestationFacts.get(a.attestationRef);
      // Prefer the original; among copies prefer an active one.
      if (!existing || (existing.revokedAt && isActive(c) && !assetAttestations.length)) attestationFacts.set(a.attestationRef, attestationOf(a, c, true));
    }

    // Verification requests grouped by requestRef.
    const verifications: VerificationFacts[] = [...groupBy(assetVrs, (c) => str(c.payload.requestRef)).entries()].map(([requestRef, versions]) => {
      const latest = latestOf(versions, (c) => decode.verificationRequest(c.payload).version) ?? versions[0];
      if (!latest) throw new Error("unreachable: empty verification group");
      const v = decode.verificationRequest(latest.payload);
      const choice = latest.archived?.choice ?? null;
      const state: VerificationState =
        choice === null
          ? ((["REQUESTED", "IN_REVIEW", "CHANGES_REQUESTED"] as const).find((s) => s === v.status) ?? "REQUESTED")
          : (VR_TERMINAL[choice] ?? VR_NEXT[choice] ?? "REQUESTED");
      const issued = choice === "VR_IssueAttestation" ? str(latest.archived?.argument.attestationRef) : null;
      const attestationRef = issued || [...attestationFacts.values()].find((a) => a.verificationRef === requestRef)?.ref || null;
      const terminalNote = choice ? str(latest.archived?.argument.reason) || null : null;
      // Documents disclosed to the verifier: exactly the live VERIFICATION grants of this request for its current
      // evidence version (owner and assigned verifier views; never the whole package). A request recorded
      // without any grant (seeded before grants existed) keeps the owner-only manifest listing.
      const isVerifierView = viewer.readableParties.includes(v.verifier);
      const everGranted = verificationGrants.some((c) => {
        const s = decode.share(c.payload);
        return verificationGrantRequestRef(s.shareRef) === requestRef && s.owner === v.owner && s.recipient === v.verifier;
      });
      let documentRefs: string[] = [];
      let documentVersions: ManifestEntry[] | undefined;
      if (everGranted && (isOwnerView || isVerifierView)) {
        const ended = state === "DECLINED" || state === "CANCELLED";
        documentVersions = ended && !isOwnerView ? [] : grantedEntries(grantsOf({ requestRef, owner: v.owner, verifier: v.verifier, evidence: v.evidence }, true));
        documentRefs = [...new Set(documentVersions.map((e) => e.documentRef))];
      } else if (isOwnerView && v.evidence) {
        documentRefs = entriesOf(v.evidence.packageRef, v.evidence.manifestVersion).map((e) => e.documentRef);
      }
      return {
        ref: requestRef,
        assetRef: ref,
        caseRef: v.caseRef,
        verifierOrgId: org(v.verifier),
        verifierRegistryRef: verifierRefByParty.get(v.verifier) ?? "",
        requestedByOrgId: org(v.owner),
        scope: v.checklist.length > 0 ? v.checklist : [v.equipmentScope].filter(Boolean),
        documentRefs,
        ...(documentVersions ? { documentVersions } : {}),
        packageVersion: v.evidence?.manifestVersion ?? 0,
        state,
        requestedAt: minIso(versions.map((c) => c.createdAt)),
        updatedAt: maxIso(versions.map(lastTouched)),
        dueAt: v.dueBy,
        attestationRef,
        lastMessage: terminalNote ?? (v.changeNote || null),
      };
    });

    // Control: the newest visible token (AssetControl or CollateralLock), else the release record.
    const tokenCandidates = [...pick(T.AssetControl), ...pick(T.CollateralLock)].sort(byOffset);
    const activeToken = tokenCandidates.filter(isActive).at(-1);
    let control: AssetControlFacts;
    if (activeToken?.templateRef === T.CollateralLock) {
      const l = decode.lock(activeToken.payload);
      control = { version: l.controlVersion, state: "LOCKED", lockRef: l.lockRef };
    } else if (activeToken) {
      control = { version: decode.control(activeToken.payload).controlVersion, state: "AVAILABLE", lockRef: null };
    } else {
      const rel = pick(T.CollateralLockReleased).sort(byOffset).at(-1);
      const prior = tokenCandidates.at(-1);
      control = rel
        ? { version: decode.lockReleased(rel.payload).releasedControlVersion, state: "AVAILABLE", lockRef: null }
        : prior?.templateRef === T.CollateralLock && prior.archived?.choice !== "Lock_Release"
          ? { version: decode.lock(prior.payload).controlVersion, state: "LOCKED", lockRef: decode.lock(prior.payload).lockRef }
          : { version: prior ? decode.control(prior.payload).controlVersion + (prior.templateRef === T.CollateralLock ? 1 : 0) : 1, state: "AVAILABLE", lockRef: null };
    }

    // Documents: application rows the viewer may see, then ledger-only references.
    const currentKeys = new Set(pkg.entries.map((e) => `${e.documentRef}#${e.version}`));
    const attested = [...attestationFacts.values()].find((a) => !a.supersededBy && !a.revokedAt);
    const attestedKeys = new Set((attested?.supportingVersions ?? []).map((e) => `${e.documentRef}#${e.version}`));
    const visibleRows = input.documents.filter(
      (d) =>
        d.assetRef === ref &&
        (d.ownerOrgId === viewer.orgId || d.contributorOrgId === viewer.orgId || sharedDocKeys.has(`${d.docRef}#${d.version}`)),
    );
    const documents: EvidenceDocumentFacts[] = [];
    for (const [docRef, rows] of groupBy(visibleRows, (d) => d.docRef)) {
      const sorted = [...rows].sort((a, b) => a.version - b.version);
      const first = sorted[0];
      if (!first) continue;
      const committed = sorted.some((r) => currentKeys.has(`${docRef}#${r.version}`));
      documents.push({
        ref: docRef,
        type: documentTypeOf(first.type),
        title: first.title,
        mediaSummary: mediaSummary(first.contentType),
        sourceOrgId: first.contributorOrgId,
        versions: sorted.map((r) => ({
          version: r.version,
          uploadedAt: (r.uploadedAt ?? r.createdAt).toISOString(),
          uploadedBy: { orgId: r.contributorOrgId, userId: r.uploadedByUserId, label: orgName(r.contributorOrgId) },
          fileName: r.fileName,
          contentType: CONTENT_TYPES.includes(r.contentType as EvidenceContentType) ? (r.contentType as EvidenceContentType) : "application/pdf",
          sizeBytes: r.sizeBytes,
          sha256: r.sha256,
          uploadState: UPLOAD_STATES.includes(r.status as EvidenceUploadState) ? (r.status as EvidenceUploadState) : "UPLOAD_PENDING",
          integrity: r.status === "HASH_MISMATCH" ? "MISMATCH" : r.status === "AVAILABLE" && r.sha256 ? "VERIFIED" : "NOT_CHECKED",
        })),
        reviewState: sorted.some((r) => attestedKeys.has(`${docRef}#${r.version}`)) ? "ATTESTED" : "SUBMITTED",
        ledgerState: committed ? "COMMITTED" : "UNCOMMITTED",
      });
    }
    // Ledger-only references (no application row): manifest entries (owner), shared documents (recipient,
    // consenters), the dealer's own contributions. Hashes and refs only; bytes never come from the ledger.
    const ledgerDocs = new Map<string, { type: string; version: number; sha256: string; source: string; at: string }>();
    if (currentManifest) {
      for (const e of decode.manifest(currentManifest.payload).entries) {
        ledgerDocs.set(e.docRef, { type: e.docType, version: e.docVersion, sha256: e.sha256, source: e.source, at: currentManifest.createdAt });
      }
    }
    for (const s of shares.filter((c) => decode.share(c.payload).evidence?.packageRef === pkg.ref)) {
      for (const d of decode.share(s.payload).documents) {
        if (!ledgerDocs.has(d.docRef)) ledgerDocs.set(d.docRef, { type: "OTHER", version: d.docVersion, sha256: d.sha256, source: d.source, at: s.createdAt });
      }
    }
    for (const c of contributions.filter((x) => isActive(x))) {
      const d = decode.dealerContribution(c.payload);
      const caseRow = caseRowByRef.get(d.caseRef);
      if (caseRow?.assetRef !== ref) continue;
      if (!ledgerDocs.has(d.docRef)) ledgerDocs.set(d.docRef, { type: d.docType, version: d.docVersion, sha256: d.sha256, source: d.dealer, at: c.createdAt });
    }
    for (const [docRef, d] of ledgerDocs) {
      if (documents.some((x) => x.ref === docRef)) continue;
      const type = documentTypeOf(d.type);
      const sourceOrg = org(d.source);
      documents.push({
        ref: docRef,
        type,
        title: DOCUMENT_TYPE_LABELS[type],
        mediaSummary: "Ledger reference only",
        sourceOrgId: sourceOrg,
        versions: [
          {
            version: d.version,
            uploadedAt: d.at,
            uploadedBy: { orgId: sourceOrg, userId: null, label: orgName(sourceOrg) },
            fileName: "",
            contentType: "application/pdf",
            sizeBytes: null,
            sha256: d.sha256 || null,
            uploadState: "AVAILABLE",
            integrity: "NOT_CHECKED",
          },
        ],
        reviewState: attestedKeys.has(`${docRef}#${d.version}`) ? "ATTESTED" : "SUBMITTED",
        ledgerState: currentKeys.has(`${docRef}#${d.version}`) ? "COMMITTED" : "UNCOMMITTED",
      });
    }
    documents.sort((a, b) => a.ref.localeCompare(b.ref));

    // A case application record exists only for a registered asset (POST /cases refuses any other), so a case
    // participant without the owner-only passport (e.g. the invited dealer) still sees the asset as registered.
    const hasCase = input.caseRows.some((r) => r.assetRef === ref);
    const lifecycle: AssetLifecycleState = pick(T.RetiredControl).length
      ? "ARCHIVED"
      : passport || tokenCandidates.length || pick(T.CollateralLockReleased).length || assetVrs.length || attestationFacts.size || ticket || hasCase
        ? "REGISTERED"
        : rq
          ? "REGISTRATION_REQUESTED"
          : "DRAFT";
    const firstControl = pick(T.AssetControl).sort(byOffset)[0];
    return {
      ref,
      namespace: pp?.namespace || str(cs[0]?.payload.namespace) || ASSET_NAMESPACE,
      equipmentClass: pp?.equipmentClass ?? rq?.equipmentClass ?? "",
      manufacturer: pp?.manufacturer ?? rq?.manufacturer ?? "",
      model: pp?.model ?? rq?.model ?? "",
      serialNumber: pp?.serialNumber ?? rq?.serialNumber ?? "",
      yearOfManufacture: pp?.yearOfManufacture ?? rq?.yearOfManufacture ?? null,
      ownerOrgId,
      ownerClaimSource: rq?.ownerClaimRef ?? "",
      locationScope: pp?.locationScope ?? rq?.locationScope ?? "",
      claimedAcquisitionValue: null,
      lifecycle,
      createdAt: isoOr(request?.createdAt ?? minIso(cs.map((c) => c.createdAt)), nowIso),
      registeredAt: pp?.registeredAt ?? firstControl?.createdAt ?? null,
      updatedAt: isoOr(maxIso(cs.map(lastTouched)), nowIso),
      passportVersion: pp?.passportVersion ?? (assetVrs.length ? decode.verificationRequest(last(assetVrs)?.payload ?? {}).passportVersion : 1),
      documents,
      package: pkg,
      verifications,
      attestations: [...attestationFacts.values()].sort((a, b) => a.issuedAt.localeCompare(b.issuedAt)),
      control,
      events: events.filter((e) => e.assetRef === ref && e.assetLevel).map((e) => e.event),
    };
  }

  // --- Case facts ---------------------------------------------------------------------------------------
  const caseRefs = new Set<string>();
  for (const c of view.contracts) if (c.caseRef) caseRefs.add(c.caseRef);
  for (const r of input.caseRows) if (r.borrowerOrgId === viewer.orgId || r.dealerOrgId === viewer.orgId) caseRefs.add(r.caseRef);
  const byCase = groupBy(view.contracts, (c) => c.caseRef);

  const assetsByRef = new Map<string, AssetFacts>();
  const assetFor = (ref: string, ownerOrg: string | null) => {
    let asset = assetsByRef.get(ref);
    if (!asset) {
      asset = buildAsset(ref, ownerOrg);
      assetsByRef.set(ref, asset);
    }
    return asset;
  };

  function buildCase(ref: string): CaseFacts {
    const row = caseRowByRef.get(ref) ?? null;
    const cs = (byCase.get(ref) ?? []).sort(byOffset);
    // Case shares are the lender's package shares; verification grants belong to the asset's verification facts.
    const caseScoped = (c: VisibleContract) => (c.templateRef !== T.PackageShare && c.templateRef !== T.PackageShareProposal) || !isVerificationGrant(c);
    const pick = (template: string) => cs.filter((c) => c.templateRef === template && caseScoped(c)).sort(byOffset);
    const firstParty = (fields: readonly string[]) => {
      for (const c of cs) for (const f of fields) if (str(c.payload[f])) return str(c.payload[f]);
      return null;
    };
    const borrowerParty = firstParty(["owner", "borrower"]);
    const borrowerOrgId = row?.borrowerOrgId ?? (borrowerParty ? org(borrowerParty) : "party:unknown");
    const lenderParty =
      [...pick(T.CollateralLock), ...pick(T.FinancingProposal), ...pick(T.CollateralAssessment), ...pick(T.LenderDecisionNotice)]
        .map((c) => str(c.payload.lender))
        .find(Boolean) ??
      pick(T.PackageShare).map((c) => str(c.payload.recipient)).find(Boolean) ??
      null;
    const selectedLenderOrgId = row?.selectedLenderOrgId ?? (lenderParty ? org(lenderParty) : null);
    const dealerParty = [...pick(T.DealerContribution), ...pick(T.PackageShareProposal)].map((c) => str(c.payload.dealer)).find(Boolean) ?? null;
    const dealerOrgId = row?.dealerOrgId ?? (dealerParty ? org(dealerParty) : null);
    const assetRef = row?.assetRef ?? cs.map((c) => c.assetRef).find((x): x is string => !!x) ?? "";
    const asset = assetFor(assetRef, borrowerOrgId);

    // Shares --------------------------------------------------------------------------------------------
    const shareFacts: ShareFacts[] = [];
    for (const c of [...pick(T.PackageShare), ...pick(T.PackageShareProposal)].sort(byOffset)) {
      const s = decode.share(c.payload);
      const isProposal = c.templateRef === T.PackageShareProposal;
      const choice = c.archived?.choice ?? null;
      if (isProposal && (choice === "Consent_Grant" || choice === "ShareProposal_Withdraw")) continue;
      const expired = !!s.expiresAt && Date.parse(s.expiresAt) < now.getTime();
      const state: ShareFacts["state"] = isProposal
        ? choice === "Consent_Decline"
          ? "DECLINED"
          : "REQUESTED"
        : choice === null
          ? expired
            ? "EXPIRED"
            : "GRANTED"
          : "REVOKED";
      shareFacts.push({
        ref: s.shareRef,
        recipientOrgId: org(s.recipient),
        purpose: "LENDER_REVIEW",
        packageRef: s.evidence?.packageRef ?? "",
        packageVersion: s.evidence?.manifestVersion ?? 0,
        entries: s.documents.map((d) => ({ documentRef: d.docRef, version: d.docVersion })),
        permission: s.permission,
        state,
        consentingOrgIds: [...new Set([org(s.owner), ...s.consenters.map(org)])],
        createdAt: c.createdAt,
        expiresAt: s.expiresAt,
        revokedAt: state === "REVOKED" ? (c.archived?.at ?? null) : null,
      });
    }

    // Dealer consent requests (daml-model.md §4.6), both purposes: PackageShareProposals naming a dealer and the
    // PackageShares a dealer co-signed (Consent_Grant). Latest contract per share reference; a granted proposal
    // continues as its share. Expiry is applied by the presenter (effectiveConsentState).
    const consentFacts = new Map<string, ConsentFacts>();
    const requestedAt = new Map<string, string>();
    for (const c of cs.filter((x) => x.templateRef === T.PackageShareProposal || x.templateRef === T.PackageShare)) {
      const s = decode.share(c.payload);
      const isProposal = c.templateRef === T.PackageShareProposal;
      const dealer = isProposal ? s.dealer : (s.consenters[0] ?? null);
      if (!dealer) continue;
      const choice = c.archived?.choice ?? null;
      if (isProposal && choice === "Consent_Grant") {
        requestedAt.set(s.shareRef, c.createdAt);
        continue;
      }
      const state: ConsentState = isProposal
        ? choice === null
          ? "PENDING"
          : choice === "Consent_Decline"
            ? "DECLINED"
            : "CANCELLED"
        : choice === null
          ? "GRANTED"
          : choice === "Share_WithdrawConsent"
            ? "WITHDRAWN"
            : "REVOKED";
      const purpose = s.purpose === VERIFICATION_GRANT_PURPOSE ? "VERIFICATION" : "LENDER_REVIEW";
      consentFacts.set(s.shareRef, {
        ref: s.shareRef,
        purpose,
        dealerOrgId: org(dealer),
        ownerOrgId: org(s.owner),
        recipientOrgId: org(s.recipient),
        verificationRef: purpose === "VERIFICATION" ? verificationGrantRequestRef(s.shareRef) : null,
        packageRef: s.evidence?.packageRef ?? "",
        packageVersion: s.evidence?.manifestVersion ?? 0,
        documents: s.documents.map((d) => ({ documentRef: d.docRef, version: d.docVersion, sha256: d.sha256 })),
        permission: s.permission,
        state,
        requestedAt: isProposal ? c.createdAt : (requestedAt.get(s.shareRef) ?? c.createdAt),
        decidedAt: c.archived?.at ?? (isProposal ? null : c.createdAt),
        expiresAt: s.expiresAt ?? c.createdAt,
      });
    }

    // Review ------------------------------------------------------------------------------------------------
    const assessmentVersions = pick(T.CollateralAssessment);
    const latestAssessment = latestOf(assessmentVersions, (c) => decode.assessment(c.payload).version);
    const caseNotices = pick(T.LenderDecisionNotice);
    const latestNotice = caseNotices.at(-1);
    const notice = latestNotice ? decode.notice(latestNotice.payload) : null;
    const decisionNotice = [...caseNotices].reverse().find((c) => ["ELIGIBLE", "REJECTED"].includes(str(c.payload.outcome)));
    const actorOf = (choice: string) => {
      const e = view.events.filter((x) => x.contract.caseRef === ref && x.choice === choice).at(-1);
      return e ? { userId: userIdFromActorRef(str(e.argument.actorRef)), at: e.effectiveAt } : null;
    };
    let review: ReviewFacts;
    if (latestAssessment) {
      const a = decode.assessment(latestAssessment.payload);
      const state = (REVIEW_STATES.find((s) => s === a.status) ?? "SUBMITTED") as ReviewState;
      const saved = actorOf("Assessment_Save");
      const approve = actorOf("Assessment_Approve") ?? actorOf("Assessment_Reject");
      const started = actorOf("Assessment_StartReview");
      const submitted = actorOf("Assessment_SubmitForApproval");
      const valuation = a.valuation?.value ?? null;
      review = {
        ref: a.assessmentRef,
        lenderOrgId: org(a.lender),
        state,
        analystUserId: saved?.userId ?? started?.userId ?? null,
        approverUserId: approve?.userId ?? null,
        startedAt: started?.at ?? null,
        submittedForApprovalAt: submitted?.at ?? null,
        evidenceSnapshot: a.snapshot.evidence ? entriesForAnchor(a.snapshot.evidence.packageRef, a.snapshot.evidence.manifestVersion) : null,
        snapshotPackageVersion: a.snapshot.evidence?.manifestVersion ?? null,
        assessment:
          a.valuation && valuation
            ? {
                valuation,
                valuationSource: a.valuation.source,
                valuationDate: a.valuation.valuationDate,
                limitations: a.valuation.limitations,
                // The analyst's recommendation is not on the ledger: the decision once recorded, else a placeholder.
                outcome: state === "ELIGIBLE" || state === "REJECTED" || state === "NEEDS_INFORMATION" ? state : state === "PENDING_APPROVAL" ? "ELIGIBLE" : "NEEDS_INFORMATION",
                policyRef: a.policyRef,
                version: a.version,
                savedAt: saved?.at ?? latestAssessment.createdAt,
                savedByUserId: saved?.userId ?? userIdFromActorRef(a.lastActorRef) ?? "",
                requiredExternalChecks: [],
              }
            : null,
        internalNotes: null,
        sharedFeedback: notice?.sharedFeedback || null,
        informationRequest: notice?.outcome === "NEEDS_INFORMATION" ? notice.sharedFeedback || null : null,
        decision: decisionNotice
          ? {
              outcome: str(decisionNotice.payload.outcome) as "ELIGIBLE" | "REJECTED",
              decidedAt: str(decisionNotice.payload.decidedAt) || decisionNotice.createdAt,
              decidedByUserId: approve?.userId ?? "",
            }
          : null,
      };
    } else {
      // Borrower (or another non-lender): only the lender's decision notices and the share are visible.
      const sharedWithLender = shareFacts.some((s) => s.recipientOrgId === selectedLenderOrgId && s.state !== "REQUESTED" && s.state !== "DECLINED");
      const state: ReviewState = notice
        ? ((REVIEW_STATES.find((s) => s === notice.outcome) ?? "SUBMITTED") as ReviewState)
        : sharedWithLender
          ? "SUBMITTED"
          : "NOT_SUBMITTED";
      review = {
        ref: notice?.assessmentRef ?? "",
        lenderOrgId: notice ? org(notice.lender) : (selectedLenderOrgId ?? ""),
        state,
        analystUserId: null,
        approverUserId: null,
        startedAt: null,
        submittedForApprovalAt: null,
        evidenceSnapshot: null,
        snapshotPackageVersion: null,
        assessment: null,
        internalNotes: null,
        sharedFeedback: notice?.sharedFeedback || null,
        informationRequest: notice?.outcome === "NEEDS_INFORMATION" ? notice.sharedFeedback || null : null,
        decision: decisionNotice
          ? {
              outcome: str(decisionNotice.payload.outcome) as "ELIGIBLE" | "REJECTED",
              decidedAt: str(decisionNotice.payload.decidedAt) || decisionNotice.createdAt,
              decidedByUserId: "",
            }
          : null,
      };
    }

    function entriesForAnchor(packageRef: string, version: number): ManifestEntry[] {
      if (asset.package.ref === packageRef && asset.package.version === version) return asset.package.entries.map((e) => ({ ...e }));
      const entries: ManifestEntry[] = [];
      for (const s of pick(T.PackageShare)) {
        const d = decode.share(s.payload);
        if (d.evidence?.packageRef === packageRef && d.evidence.manifestVersion === version) {
          for (const doc of d.documents) entries.push({ documentRef: doc.docRef, version: doc.docVersion });
        }
      }
      return entries;
    }

    // Proposals -------------------------------------------------------------------------------------------
    // Proposal_Accept archives the proposal version and creates the FinancingAgreement (agreementRef =
    // proposalRef, proposalVersion = the accepted version). The agreement is authoritative for acceptance.
    const agreementOf = new Map(
      pick(T.FinancingAgreement).map((c) => {
        const a = decode.agreement(c.payload);
        return [`${a.agreementRef}#${a.proposalVersion}`, { contract: c, agreement: a }] as const;
      }),
    );
    const proposalFacts: ProposalVersionFacts[] = pick(T.FinancingProposal).flatMap((c): ProposalVersionFacts[] => {
      const p = decode.proposal(c.payload);
      // An undecodable principal is unavailable, never 0: such a version is left out.
      if (!p.principal) return [];
      const choice = c.archived?.choice ?? null;
      const arg = c.archived?.argument ?? {};
      const accepted = agreementOf.get(`${p.proposalRef}#${p.version}`);
      const state: ProposalVersionFacts["state"] =
        accepted || choice === "Proposal_Accept" ? "ACCEPTED" : choice === null ? "ISSUED" : choice === "Proposal_Decline" ? "DECLINED" : "WITHDRAWN";
      const responded = state === "ACCEPTED" || choice === "Proposal_Decline";
      return [{
        ref: p.proposalRef,
        version: p.version,
        state,
        lenderOrgId: org(p.lender),
        principal: p.principal,
        termMetadata: p.termMetadata,
        financingRef: null,
        externalLegalRef: p.externalLegalRef,
        expiresAt: p.expiresAt,
        draftedAt: p.issuedAt || c.createdAt,
        draftedByUserId: userIdFromActorRef(p.issuedByRef) ?? "",
        issuedAt: p.issuedAt || c.createdAt,
        issuedByUserId: userIdFromActorRef(p.issuedByRef),
        respondedAt: responded ? (accepted?.agreement.acceptedAt || c.archived?.at || null) : null,
        respondedByUserId: responded ? userIdFromActorRef(accepted?.agreement.acceptedByRef || str(arg.actorRef)) : null,
        withdrawnAt: choice === "Proposal_Withdraw" || choice === "Proposal_Revise" ? (c.archived?.at ?? null) : null,
        note: choice === "Proposal_Revise" ? `Revised as v${p.version + 1}` : str(arg.reason) || null,
      }];
    });
    // An agreement whose proposal version is not in the view (e.g. a viewer that is a stakeholder of the
    // agreement only) still yields the accepted version, with the terms the agreement holds.
    for (const [key, { contract, agreement: a }] of agreementOf) {
      if (!a.principal || proposalFacts.some((p) => `${p.ref}#${p.version}` === key)) continue;
      proposalFacts.push({
        ref: a.agreementRef,
        version: a.proposalVersion,
        state: "ACCEPTED",
        lenderOrgId: org(a.lender),
        principal: a.principal,
        termMetadata: a.termMetadata,
        financingRef: null,
        externalLegalRef: a.externalLegalRef,
        expiresAt: a.acceptedAt || contract.createdAt,
        draftedAt: contract.createdAt,
        draftedByUserId: "",
        issuedAt: null,
        issuedByUserId: null,
        respondedAt: a.acceptedAt || contract.createdAt,
        respondedByUserId: userIdFromActorRef(a.acceptedByRef),
        withdrawnAt: null,
        note: null,
      });
    }

    // Activation authorization --------------------------------------------------------------------------
    const auth = pick(T.PledgeActivationAuthorization).filter((c) => c.archived?.choice !== "Auth_Withdraw").at(-1);
    let activation: ActivationAuthorizationFacts | null = null;
    if (auth) {
      const a = decode.authorization(auth.payload);
      // Control_Activate archives the authorization with `archive` (an exercised "Archive" node in the same update).
      const lockedWith = pick(T.CollateralLock).some((l) => str(l.payload.authorizationRef) === a.authorizationRef);
      const consumed = !!auth.archived && (lockedWith || auth.archived.choice === "Control_Activate");
      activation = {
        state: consumed ? "CONSUMED" : Date.parse(a.expiresAt) < now.getTime() ? "EXPIRED" : "AUTHORIZED",
        proposalRef: a.agreementRef,
        proposalVersion: a.agreementVersion,
        attestationRef: a.snapshot.attestationRef,
        packageVersion: a.snapshot.evidence?.manifestVersion ?? 0,
        controlVersion: a.expectedControlVersion,
        authorizedAt: a.authorizedAt || auth.createdAt,
        authorizedByUserId: userIdFromActorRef(a.authorizedByRef) ?? "",
        expiresAt: a.expiresAt,
        consumedAt: consumed ? (auth.archived?.at ?? null) : null,
      };
    }

    // Lock ----------------------------------------------------------------------------------------------
    const lockContract = pick(T.CollateralLock).at(-1);
    let lock: LockFacts | null = null;
    if (lockContract) {
      const l = decode.lock(lockContract.payload);
      const rel = pick(T.CollateralLockReleased).find((c) => str(c.payload.lockRef) === l.lockRef);
      const r = rel ? decode.lockReleased(rel.payload) : null;
      const isReleased = !!r || lockContract.archived?.choice === "Lock_Release";
      const authForLock = pick(T.PledgeActivationAuthorization).find((c) => str(c.payload.authorizationRef) === l.authorizationRef);
      lock = {
        ref: l.lockRef,
        state: isReleased ? "RELEASED" : "ACTIVE",
        lenderOrgId: org(l.lender),
        borrowerOrgId: org(l.owner),
        activatedAt: l.activatedAt || lockContract.createdAt,
        activatedByUserId: userIdFromActorRef(l.activatedByRef) ?? "",
        proposalRef: l.agreementRef,
        proposalVersion: authForLock ? decode.authorization(authForLock.payload).agreementVersion : 1,
        attestationRef: l.attestationRef,
        packageRef: l.evidence?.packageRef ?? "",
        packageVersion: l.evidence?.manifestVersion ?? 0,
        controlVersionConsumed: l.controlVersion - 1,
        controlVersionLocked: l.controlVersion,
        releasedAt: r?.releasedAt ?? (isReleased ? (lockContract.archived?.at ?? null) : null),
        releasedByUserId: r ? userIdFromActorRef(r.releasedByRef) : null,
        controlVersionAfterRelease: r?.releasedControlVersion ?? (isReleased ? l.controlVersion + 1 : null),
      };
    }

    // Release requests ------------------------------------------------------------------------------------
    const releaseFacts: ReleaseRequestFacts[] = [...groupBy(pick(T.ReleaseRequest), (c) => str(c.payload.releaseRequestRef)).entries()].map(
      ([rrRef, versions]) => {
        const latest = latestOf(versions, (c) => decode.releaseRequest(c.payload).version) ?? versions[0];
        if (!latest) throw new Error("unreachable: empty release request group");
        const r = decode.releaseRequest(latest.payload);
        const decisionContract = pick(T.ReleaseDecision).find((c) => str(c.payload.releaseRequestRef) === rrRef);
        const d = decisionContract ? decode.releaseDecision(decisionContract.payload) : null;
        const choice = latest.archived?.choice ?? null;
        const state: ReleaseRequestFacts["state"] =
          d?.outcome === "AUTHORIZED" || choice === "Release_Authorize"
            ? "AUTHORIZED"
            : d?.outcome === "REJECTED" || choice === "Release_Reject"
              ? "REJECTED"
              : choice === "Release_Withdraw"
                ? "WITHDRAWN"
                : r.status === "INFORMATION_REQUESTED"
                  ? "INFORMATION_REQUESTED"
                  : "REQUESTED";
        const first = versions.sort(byOffset)[0] ?? latest;
        return {
          ref: rrRef,
          lockRef: r.lockRef,
          state,
          reason: (RELEASE_REASONS.find((x) => x === r.reason) ?? "EXTERNAL_LOAN_COMPLETION") as ReleaseReason,
          note: null,
          servicingRef: null,
          requestedByOrgId: org(r.requester),
          requestedByUserId: userIdFromActorRef(decode.releaseRequest(first.payload).requestedByRef) ?? "",
          requestedAt: first.createdAt,
          informationRequest: r.status === "INFORMATION_REQUESTED" ? "Information requested by the lender." : null,
          decidedAt: d ? d.decidedAt || decisionContract?.createdAt || null : choice === "Release_Withdraw" ? (latest.archived?.at ?? null) : null,
          decidedByUserId: d ? userIdFromActorRef(d.decidedByRef) : null,
          decisionReason: d?.sharedReason || null,
        };
      },
    );

    // Audit grants ---------------------------------------------------------------------------------------
    const grantFacts: AuditGrantFacts[] = pick(T.AuditGrant).map((c) => {
      const g = decode.auditGrant(c.payload);
      const grantorOrgId = org(g.grantor);
      return {
        ref: g.grantRef,
        grantorOrgId,
        grantorSide: grantorOrgId === borrowerOrgId ? "OWNER" : "LENDER",
        grantedByUserId: "",
        auditorOrgId: org(g.auditor),
        scopes: g.scopes.filter((s): s is AuditScope => (AUDIT_SCOPES as readonly string[]).includes(s)),
        permission: g.permission === "EXPORT" ? "VIEW_EXPORT" : "VIEW",
        purpose: g.purpose,
        createdAt: c.createdAt,
        expiresAt: g.expiresAt,
        revokedAt: c.archived?.choice === "Grant_Revoke" ? c.archived.at : null,
      };
    });

    // Exports (application records of the viewer's organization) -----------------------------------------
    const exportFacts: ExportFacts[] = input.exports
      .filter((x) => x.caseRef === ref)
      .map((x) => {
        const scope = obj(x.scope);
        const scopes = Array.isArray(scope.auditScopes)
          ? (scope.auditScopes as unknown[]).filter((s): s is AuditScope => (AUDIT_SCOPES as readonly string[]).includes(String(s)))
          : null;
        const watermark = obj(x.watermark);
        return {
          ref: x.reportRef,
          caseRef: x.caseRef,
          format: x.format === "CSV" ? "CSV" : "JSON",
          state: (EXPORT_STATES.find((s) => s === x.state) ?? "QUEUED") as ExportJobState,
          requestedByOrgId: x.orgId,
          requestedByUserId: x.requestedByUserId,
          requestedRole: (str(scope.requestedRole) || "BORROWER") as Role,
          requestedAt: x.requestedAt.toISOString(),
          generatedAt: x.generatedAt ? x.generatedAt.toISOString() : null,
          cutoff: { offset: x.cutoffOffset, at: str(watermark.at) || (x.generatedAt ?? x.requestedAt).toISOString() },
          checksum: x.checksumSha256,
          scopeLabel: str(scope.scopeLabel) || `Own scope · ${orgName(x.orgId)}`,
          schemaVersion: x.schemaVersion,
          expiresAt: x.expiresAt ? x.expiresAt.toISOString() : null,
          auditScopes: scopes,
        };
      });

    const firstAt = minIso(cs.map((c) => c.createdAt));
    return {
      ref,
      title: row?.title ?? `Case ${ref}`,
      purpose: row?.purpose ?? null,
      createdAt: row ? row.createdAt.toISOString() : isoOr(firstAt, nowIso),
      createdByUserId: row?.createdByUserId ?? "",
      borrowerOrgId,
      dealerOrgId,
      selectedLenderOrgId,
      requestedPrincipal: row?.requestedPrincipal && row.requestedCurrency ? safeParseMoney({ amount: row.requestedPrincipal, currency: row.requestedCurrency }) : null,
      policyRef: row?.policyRef || (latestAssessment ? decode.assessment(latestAssessment.payload).policyRef : "") || CREDIT_POLICY_REF,
      asset,
      shares: shareFacts,
      consents: [...consentFacts.values()],
      review,
      proposals: proposalFacts.sort((a, b) => a.version - b.version),
      activation,
      lock,
      releaseRequests: releaseFacts.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt)),
      auditGrants: grantFacts,
      exports: exportFacts,
      events: events.filter((e) => e.caseRef === ref && !e.assetLevel).map((e) => e.event),
      cancelledAt: row?.cancelledAt ? row.cancelledAt.toISOString() : null,
      closedAt: row?.closedAt ? row.closedAt.toISOString() : null,
    };
  }

  const cases = [...caseRefs].sort().map(buildCase);
  for (const ref of [...assetRefs].sort()) assetFor(ref, null);
  const assets = [...assetsByRef.values()].filter((a) => a.ref !== "").sort((a, b) => a.ref.localeCompare(b.ref));
  return { assets, cases, pendingRegistrations, events };
}

function mediaSummary(contentType: string): string {
  if (contentType === "application/pdf") return "PDF";
  if (contentType === "image/jpeg") return "JPEG";
  if (contentType === "image/png") return "PNG";
  return contentType;
}
