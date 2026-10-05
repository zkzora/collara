// API-side presenters for records that do not (yet) come from projections.
import type { EvidenceDocumentRow } from "@collara/db";
import {
  evidenceLedgerStates,
  evidenceScanStates,
  evidenceUploadStates,
  integrityStates,
  MeSchema,
  navigationFor,
  orderRoles,
  orgName,
  ROLE_LABELS,
  type DocumentType,
  type EvidenceDocument,
  type EvidenceUploadState,
  type IntegrityState,
  type Me,
  type RuntimeMode,
} from "@collara/domain";
import type { ResolvedActor } from "./plugins/actor";

export function presentMe(actor: ResolvedActor, mode: RuntimeMode): Me {
  // Business role first (memberships are stored in no particular order): "Lender Approver", not "Governance Member".
  const roles = orderRoles(actor.roles);
  return MeSchema.parse({
    user: actor.user,
    org: actor.org,
    roles,
    roleLabels: roles.map((role) => ROLE_LABELS[role]),
    mandates: actor.mandates,
    governanceSeat: actor.mandates.find((m) => m.code === "GOVERNANCE_SEAT")?.seat ?? null,
    mode,
    ledgerIdentity: {
      network: mode,
      participant: mode === "DEVNET" ? "shared-devnet-participant" : mode === "LOCALNET" ? "localnet-participant" : null,
      partyId: actor.parties.business,
      authMethod: actor.authMethod,
      // This is not a role grant. It only says that the server has a bound business party
      // through which an already-authorized workflow action may be submitted.
      canSubmit: mode !== "UI_MOCK" && actor.parties.business !== null,
    },
    personaId: actor.personaId,
    navigation: navigationFor(actor),
  });
}

const MEDIA_LABELS: Readonly<Record<string, string>> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPEG",
  "image/png": "PNG",
};

function integrityOf(row: EvidenceDocumentRow): IntegrityState {
  if (row.status === "HASH_MISMATCH") return "MISMATCH";
  return row.status === "AVAILABLE" && row.sha256 ? "VERIFIED" : "NOT_CHECKED";
}

/**
 * Evidence document from its version rows (oldest first). Review state and committed-manifest state come
 * from ledger projections in a later stage; until then review is null and the ledger state UNCOMMITTED.
 */
export function presentEvidenceRows(
  versions: readonly EvidenceDocumentRow[],
  options: { readonly uploaderName: (userId: string) => string | null; readonly canDownload: boolean },
): EvidenceDocument {
  const latest = versions.at(-1);
  if (!latest) throw new Error("an evidence document needs at least one version");
  const uploader = options.uploaderName(latest.uploadedByUserId);
  const uploadedAt = (row: EvidenceDocumentRow) => (row.uploadedAt ?? row.createdAt).toISOString();
  return {
    id: latest.docRef,
    assetRef: latest.assetRef,
    type: latest.type as DocumentType,
    title: latest.title,
    mediaSummary: MEDIA_LABELS[latest.contentType] ?? "File",
    source: { id: latest.contributorOrgId, name: orgName(latest.contributorOrgId) },
    uploadedBy: uploader ? `${uploader} · ${orgName(latest.contributorOrgId)}` : orgName(latest.contributorOrgId),
    version: latest.version,
    uploadedAt: uploadedAt(latest),
    status: evidenceUploadStates.badge(latest.status as EvidenceUploadState),
    scanStatus: evidenceScanStates.badge("NOT_SCANNED"),
    integrity: { algorithm: "SHA-256", hash: latest.sha256, state: integrityStates.badge(integrityOf(latest)) },
    review: null,
    ledger: evidenceLedgerStates.badge("UNCOMMITTED"),
    sharingScope: [],
    versions: versions.map((row) => ({ version: row.version, uploadedAt: uploadedAt(row) })),
    canDownload: options.canDownload,
  };
}
