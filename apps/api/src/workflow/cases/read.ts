// Read side shared by the case, asset, verification and access routes: the viewer's world from the worker's
// projections (stakeholder-filtered read model, packages/db/src/read-model), the presenter context (projection
// watermark, verifier registry status) and the domain action checks turned into problems. Authority comes from
// the session's ResolvedActor only; nothing here reads a party, organisation or role from the request.
import {
  allocateRef,
  buildGovernance,
  commands as commandsTable,
  ledgerContracts,
  loadLedgerView,
  loadPartyDirectory,
  loadReadWorld,
  readViewerOf,
  TEMPLATES as PROJECTED,
  type Db,
  type ReadWorld,
} from "@collara/db";
import {
  DEMO_ORG_IDS,
  REF_KINDS,
  type ActionCheck,
  type AssetFacts,
  type CaseFacts,
  type PresentContext,
  type RefKind,
  type RuntimeMode,
  type VerificationFacts,
  type VerifierFacts,
} from "@collara/domain";
import { and, eq, like } from "drizzle-orm";
import { problems } from "../../errors";
import type { ResolvedActor } from "../../plugins/actor";
import { businessPartyOfOrg } from "../actors";

export interface ViewerWorld {
  readonly world: ReadWorld;
  readonly pctx: PresentContext;
  /** Verifier registry entries (server-side directory read; see verifierDirectory). */
  readonly directory: readonly VerifierFacts[];
}

/**
 * Verifier registry as the registrar service sees it in the projections (governance-signed accreditations,
 * else the registrar's status mirrors). It is the non-sensitive directory every party may rely on (VER-001 →
 * organisation, status); owners and lenders do not observe the registry contracts themselves.
 */
export async function verifierDirectory(db: Db): Promise<VerifierFacts[]> {
  const registrar = await businessPartyOfOrg(db, DEMO_ORG_IDS.collara);
  if (!registrar) return [];
  const [view, parties] = await Promise.all([
    loadLedgerView(
      db,
      { orgId: DEMO_ORG_IDS.collara, readableParties: [registrar] },
      { templateRefs: [PROJECTED.VerifierAccreditation, PROJECTED.VerifierStatusMirror, PROJECTED.VerifierRegistry] },
    ),
    loadPartyDirectory(db),
  ]);
  return buildGovernance(view, parties)?.verifiers ?? [];
}

/**
 * The viewer's facts and presenter context. Verification requests seen without a registry contract (the
 * owner's view before an attestation exists) get their registry reference from the directory.
 */
export async function loadViewerWorld(db: Db, member: ResolvedActor, mode: RuntimeMode, now: Date): Promise<ViewerWorld> {
  const [world, directory] = await Promise.all([loadReadWorld(db, readViewerOf(member), { now }), verifierDirectory(db)]);
  const refByOrg = new Map(directory.filter((v) => v.orgId).map((v) => [v.orgId as string, v.ref]));
  for (const asset of [...world.assets, ...world.cases.map((c) => c.asset)]) {
    for (const v of asset.verifications) if (!v.verifierRegistryRef) v.verifierRegistryRef = refByOrg.get(v.verifierOrgId) ?? "";
  }
  const status = new Map(directory.map((v) => [v.ref, v.status]));
  const pctx: PresentContext = {
    now: world.now,
    mode,
    sync: world.lastSync,
    // No registry projected yet (fresh environment): the domain default (every verifier active) applies.
    ...(directory.length > 0 ? { isVerifierActive: (ref: string) => status.get(ref) === "ACTIVE" } : {}),
  };
  return { world, pctx, directory };
}

export function findCase(world: ReadWorld, caseRef: string): CaseFacts | null {
  return world.cases.find((c) => c.ref === caseRef) ?? null;
}

export function findAsset(world: ReadWorld, assetRef: string): AssetFacts | null {
  return world.assets.find((a) => a.ref === assetRef) ?? null;
}

export function findVerification(world: ReadWorld, ref: string): { asset: AssetFacts; verification: VerificationFacts } | null {
  for (const asset of world.assets) {
    const verification = asset.verifications.find((v) => v.ref === ref);
    if (verification) return { asset, verification };
  }
  return null;
}

/**
 * Domain action check → problem: UNAVAILABLE → 404-shaped, FORBIDDEN → 403 (with the approved copy), CONFLICT →
 * 409. `replay` skips the state precondition (never the policy) when the same request already has a command
 * record: a retry must be able to resume a sequence whose earlier steps changed the very state it checked.
 */
export function assertCheck(check: ActionCheck, options: { replay?: boolean } = {}): void {
  if (check.ok) return;
  if (check.reason === "UNAVAILABLE") throw problems.unavailable();
  if (check.reason === "FORBIDDEN") throw problems.forbidden(check.message);
  if (options.replay) return;
  throw problems.stateConflict(check.message);
}

/** True when this actor already has a command record for (operation, idempotency key). */
export async function commandExists(db: Db, member: Pick<ResolvedActor, "userId" | "orgId">, operation: string, idempotencyKey: string): Promise<boolean> {
  const [row] = await db
    .select({ id: commandsTable.id })
    .from(commandsTable)
    .where(
      and(
        eq(commandsTable.actorUserId, member.userId),
        eq(commandsTable.orgId, member.orgId),
        eq(commandsTable.operation, operation),
        eq(commandsTable.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * A new display reference of a kind (VR-###, ATT-###, AG-###, CA-###, PKG-###): the database counter, skipping
 * every reference already used on the ledger (seeded literals do not advance the counter) and `extra` (e.g.
 * refs from a fresh ACS read). Server-internal: the projected refs are never returned to the caller. A retry
 * allocates again, so numbering may have gaps; committed steps keep their stored refs.
 */
export async function allocateFreshRef(db: Db, kind: RefKind, extra: Iterable<string> = []): Promise<string> {
  const { prefix } = REF_KINDS[kind];
  const rows = await db.selectDistinct({ ref: ledgerContracts.businessRef }).from(ledgerContracts).where(like(ledgerContracts.businessRef, `${prefix}-%`));
  const taken = new Set<string>([...rows.flatMap((r) => (r.ref ? [r.ref] : [])), ...extra]);
  for (let i = 0; i < 10_000; i++) {
    const ref = await allocateRef(db, kind);
    if (!taken.has(ref)) return ref;
  }
  throw new Error(`could not allocate a free ${kind} reference`);
}
