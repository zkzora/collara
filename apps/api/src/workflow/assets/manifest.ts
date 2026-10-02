// Evidence linkage (daml-model.md §4.6, D2): the owner's EvidenceManifest is committed from the asset's
// finalized documents (application rows: server-computed SHA-256, AVAILABLE, latest version per document) as the
// first step of the owner's verification request, evidence resubmission and package share. The first version is
// created and anchored on the asset control in one submission (create-and-exercise Manifest_Anchor); later
// changes use Manifest_NewVersion, which moves the control anchor atomically. Unchanged content commits nothing.
// Dealer documents keep the dealer as `source`; their ledger-side record is the dealer-signed DealerContribution
// (created under the dealer's own authority, see ../sharing/share.ts).
import { createAndExercise, damlValue } from "@collara/canton";
import { evidenceDocuments, type Db } from "@collara/db";
import { STATUS_COPY, type DocumentType } from "@collara/domain";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { problems } from "../../errors";
import type { AcsContract, AcsReader } from "../../ledger/acs";
import { actorRefFor, encode, LEDGER_DOC_TYPES, ledgerCommands as L, manifestHashOf, type ManifestEntryInput } from "../../ledger/builders";
import type { EvidenceManifestPayload } from "../../ledger/contracts";
import { TEMPLATES } from "../../ledger/templates";
import { businessPartyOfOrg } from "../actors";
import { must } from "../preconditions";
import type { WorkflowSequence } from "../run";
import { allocateFreshRef } from "../cases/read";

/** Manifest entries from the asset's finalized documents (owner and contributing dealers), ordered by docRef. */
export async function manifestEntriesFor(db: Db, input: { assetRef: string; ownerOrgId: string; ownerParty: string }): Promise<ManifestEntryInput[]> {
  const rows = await db
    .select()
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
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) latest.set(row.docRef, row);
  const partyOfOrg = new Map<string, string | null>([[input.ownerOrgId, input.ownerParty]]);
  const entries: ManifestEntryInput[] = [];
  for (const row of latest.values()) {
    if (!partyOfOrg.has(row.contributorOrgId)) partyOfOrg.set(row.contributorOrgId, await businessPartyOfOrg(db, row.contributorOrgId));
    const source = partyOfOrg.get(row.contributorOrgId);
    if (!source || !row.sha256) continue;
    entries.push({
      docRef: row.docRef,
      docType: LEDGER_DOC_TYPES[row.type as DocumentType] ?? "OTHER",
      docVersion: row.version,
      sha256: row.sha256,
      source,
      contributorRef: actorRefFor(row.uploadedByUserId),
    });
  }
  return entries.sort((a, b) => a.docRef.localeCompare(b.docRef));
}

const key = (e: { docRef: string; docVersion: number; sha256: string; source: string }) => `${e.docRef}#${e.docVersion}#${e.sha256}#${e.source}`;

/** Same documents, versions, hashes and sources (order and display fields ignored). */
export function sameContent(current: readonly { docRef: string; docVersion: number; sha256: string; source: string }[], next: readonly ManifestEntryInput[]): boolean {
  const a = new Set(current.map(key));
  return a.size === next.length && next.every((e) => a.has(key(e)));
}

/** The owner's current manifest of an asset (one package per asset), or null. */
export async function currentManifest(acs: AcsReader, input: { assetRef: string; ownerParty: string; namespace: string }): Promise<AcsContract<EvidenceManifestPayload> | null> {
  const manifests = await acs.list("EvidenceManifest", (m) => m.assetId === input.assetRef && m.owner === input.ownerParty && m.namespace === input.namespace);
  return manifests.sort((a, b) => a.payload.version - b.payload.version).at(-1) ?? null;
}

export interface ManifestCommitInput {
  readonly db: Db;
  /** Fresh ACS reads as the owner (pre-check outside the step). */
  readonly ownerAcs: AcsReader;
  readonly namespace: string;
  readonly assetRef: string;
  readonly ownerOrgId: string;
  readonly ownerParty: string;
}

/**
 * Runs the "manifest" step when the finalized documents differ from the current manifest. Returns true when a
 * step ran (or replayed). Throws 409 when there is nothing to commit at all, or when no available control exists
 * (locked or retired asset: evidence cannot change while a pledge is active).
 */
export async function commitManifestIfChanged(seq: WorkflowSequence, input: ManifestCommitInput): Promise<boolean> {
  const entries = await manifestEntriesFor(input.db, input);
  const current = await currentManifest(input.ownerAcs, input);
  if (current && sameContent(current.payload.entries, entries)) return false;
  if (entries.length === 0) throw problems.stateConflict(STATUS_COPY.EVIDENCE_MISSING);
  const packageRef = current?.payload.packageRef ?? (await allocateFreshRef(input.db, "package"));
  await seq.step("manifest", {
    payload: { assetRef: input.assetRef },
    prepare: async (ctx) => {
      const control = must(await ctx.acs.one("AssetControl", (c) => c.assetId === input.assetRef && c.owner === input.ownerParty && c.namespace === ctx.namespace));
      const latest = await currentManifest(ctx.acs, { ...input, namespace: ctx.namespace });
      if (!latest) {
        const manifestHash = manifestHashOf({ packageRef, version: 1, entries });
        return {
          commands: [
            createAndExercise(
              TEMPLATES.EvidenceManifest,
              {
                owner: input.ownerParty,
                registrar: control.payload.registrar,
                namespace: ctx.namespace,
                assetId: input.assetRef,
                packageRef,
                version: damlValue.int64(1),
                manifestHash,
                entries: entries.map(encode.entry),
              },
              "Manifest_Anchor",
              { controlCid: control.contractId, actorRef: ctx.actorRef },
            ),
          ],
        };
      }
      const version = latest.payload.version + 1;
      return {
        commands: [
          L.manifestNewVersion(latest.contractId, {
            newEntries: entries,
            newManifestHash: manifestHashOf({ packageRef: latest.payload.packageRef, version, entries }),
            controlCid: control.contractId,
            actorRef: ctx.actorRef,
          }),
        ],
      };
    },
    result: (step) => ({ manifestCid: step.createdOf("EvidenceManifest"), controlCid: step.createdOf("AssetControl") }),
  });
  return true;
}
