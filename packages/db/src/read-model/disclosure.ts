// Application-level disclosure of equipment identity (synthesis §1.4.1, row "Equipment identity").
//
// On the ledger the AssetPassport is owner-only (signatory owner, no observers; daml-model.md §4), so a case
// participant's stakeholder view has no equipment class, manufacturer, model, year or serial. The permission
// matrix nevertheless lets these participants see the identity of the equipment they work on:
//
//   - the selected lender ("Shared case"): an active, unexpired PackageShare of the case with the viewer as
//     recipient, the asset's active AssetControl with the viewer as sharedLender, or an active CollateralLock
//     with the viewer as lender;
//   - the invited dealer ("Scoped (invited case)"): a consenter of an active PackageShare, the dealer of an
//     active PackageShareProposal, or the signatory of an active DealerContribution of the case;
//   - the assigned verifier ("Scoped (assignment)"): the verifier of a VerificationRequest for the asset whose
//     latest version was not declined or cancelled.
//
// The application, which projects the owner's contracts anyway, copies the identity fields (and nothing else)
// from the owner's latest projected passport into the viewer's AssetFacts, and only when the entitling contract
// names the passport's signatory as owner. Nobody else qualifies: Demo Lender B, a dealer or verifier without such
// a contract, auditors (they see the identity only through the owner's AuditGrant, i.e. the grantor's view built
// by the audit delegation) and operators. Ledger privacy is unchanged; this is a read-side disclosure.
import type { AssetFacts, CaseFacts } from "@collara/domain";
import type { DbOrTx } from "../client";
import { T } from "../projection/templates";
import { decode } from "./decode";
import { loadLedgerView, type LedgerView, type VisibleContract } from "./ledger-view";
import type { ReadViewer } from "./viewer";

export type EquipmentIdentity = Pick<AssetFacts, "equipmentClass" | "manufacturer" | "model" | "serialNumber" | "yearOfManufacture">;

/** Verification requests that end the verifier's assignment without an inspection. */
const VR_ENDED_WITHOUT_INSPECTION = new Set(["VR_DeclineAssignment", "VR_Cancel"]);

/**
 * Asset ref → owner parties named by the contracts that entitle the viewer to the equipment identity of that
 * asset. `caseAssets` maps case refs to asset refs (shares and contributions name a case, not an asset).
 */
export function equipmentEntitlements(view: LedgerView, viewer: ReadViewer, caseAssets: ReadonlyMap<string, string>, now: Date): Map<string, Set<string>> {
  const parties = new Set(viewer.readableParties);
  const owners = new Map<string, Set<string>>();
  const entitle = (assetRef: string | null | undefined, owner: string) => {
    if (!assetRef || !owner || parties.has(owner)) return;
    const set = owners.get(assetRef) ?? new Set<string>();
    set.add(owner);
    owners.set(assetRef, set);
  };
  const active = (c: VisibleContract) => c.archived === null;
  const latestRequests = new Map<string, VisibleContract>();

  for (const c of view.contracts) {
    switch (c.templateRef) {
      case T.PackageShare: {
        if (!active(c)) break;
        const s = decode.share(c.payload);
        if (s.expiresAt && Date.parse(s.expiresAt) <= now.getTime()) break;
        if (parties.has(s.recipient) || s.consenters.some((p) => parties.has(p))) entitle(caseAssets.get(s.caseRef), s.owner);
        break;
      }
      case T.PackageShareProposal: {
        if (!active(c)) break;
        const s = decode.share(c.payload);
        if (s.dealer && parties.has(s.dealer)) entitle(caseAssets.get(s.caseRef), s.owner);
        break;
      }
      case T.DealerContribution: {
        if (!active(c)) break;
        const d = decode.dealerContribution(c.payload);
        if (parties.has(d.dealer)) entitle(caseAssets.get(d.caseRef), d.owner);
        break;
      }
      case T.AssetControl: {
        if (!active(c)) break;
        const x = decode.control(c.payload);
        if (x.sharedLender && parties.has(x.sharedLender)) entitle(x.assetId, x.owner);
        break;
      }
      case T.CollateralLock: {
        if (!active(c)) break;
        const l = decode.lock(c.payload);
        if (parties.has(l.lender)) entitle(l.assetId, l.owner);
        break;
      }
      case T.VerificationRequest: {
        const v = decode.verificationRequest(c.payload);
        if (!parties.has(v.verifier)) break;
        const key = `${v.owner}|${v.requestRef}`;
        const previous = latestRequests.get(key);
        if (!previous || decode.verificationRequest(previous.payload).version <= v.version) latestRequests.set(key, c);
        break;
      }
    }
  }
  for (const c of latestRequests.values()) {
    if (c.archived && VR_ENDED_WITHOUT_INSPECTION.has(c.archived.choice ?? "")) continue;
    const v = decode.verificationRequest(c.payload);
    entitle(v.assetId, v.owner);
  }
  return owners;
}

/** The owner's latest passport identity per asset (active preferred), from the owner's projected contracts. */
async function ownerPassports(
  db: DbOrTx,
  viewer: ReadViewer,
  owners: ReadonlyMap<string, ReadonlySet<string>>,
  sources: readonly string[] | undefined,
): Promise<Map<string, EquipmentIdentity>> {
  const ownerParties = [...new Set([...owners.values()].flatMap((s) => [...s]))];
  if (ownerParties.length === 0) return new Map();
  const view = await loadLedgerView(
    db,
    { orgId: viewer.orgId, readableParties: ownerParties },
    { templateRefs: [T.AssetPassport], ...(sources ? { sources } : {}) },
  );
  const best = new Map<string, { active: boolean; version: number; passport: ReturnType<typeof decode.passport> }>();
  for (const c of view.contracts) {
    const p = decode.passport(c.payload);
    const named = c.assetRef ? owners.get(c.assetRef) : undefined;
    // The entitling contract must name this passport's signatory as the owner.
    if (!c.assetRef || !named?.has(p.owner) || !c.signatories.includes(p.owner)) continue;
    const candidate = { active: c.archived === null, version: p.passportVersion, passport: p };
    const current = best.get(c.assetRef);
    const better = !current || (candidate.active !== current.active ? candidate.active : candidate.version > current.version);
    if (better) best.set(c.assetRef, candidate);
  }
  const identities = new Map<string, EquipmentIdentity>();
  for (const [assetRef, { passport: p }] of best) {
    identities.set(assetRef, {
      equipmentClass: p.equipmentClass,
      manufacturer: p.manufacturer,
      model: p.model,
      serialNumber: p.serialNumber,
      yearOfManufacture: p.yearOfManufacture,
    });
  }
  return identities;
}

/**
 * Fills the equipment identity of the assets the viewer is entitled to (see the file header) and returns new
 * assets and cases; everything else is returned unchanged. The owner's own world never changes (it already holds
 * the passport).
 */
export async function discloseEquipmentIdentity(
  db: DbOrTx,
  viewer: ReadViewer,
  world: { readonly assets: readonly AssetFacts[]; readonly cases: readonly CaseFacts[] },
  view: LedgerView,
  options: { readonly now: Date; readonly sources?: readonly string[] },
): Promise<{ assets: AssetFacts[]; cases: CaseFacts[] }> {
  const caseAssets = new Map(world.cases.map((c) => [c.ref, c.asset.ref]));
  const owners = equipmentEntitlements(view, viewer, caseAssets, options.now);
  const identities = await ownerPassports(db, viewer, owners, options.sources);
  if (identities.size === 0) return { assets: [...world.assets], cases: [...world.cases] };
  const replaced = new Map<string, AssetFacts>();
  const disclose = (asset: AssetFacts): AssetFacts => {
    const identity = asset.ownerOrgId === viewer.orgId ? undefined : identities.get(asset.ref);
    if (!identity) return asset;
    const existing = replaced.get(asset.ref);
    if (existing) return existing;
    const next = { ...asset, ...identity };
    replaced.set(asset.ref, next);
    return next;
  };
  return {
    assets: world.assets.map(disclose),
    cases: world.cases.map((c) => {
      const asset = disclose(c.asset);
      return asset === c.asset ? c : { ...c, asset };
    }),
  };
}
