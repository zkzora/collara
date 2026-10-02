// GET /audit/events: ledger-committed events within the viewer's stakeholder scope, presented through the domain
// presenters (audiences, audit-grant scopes), exactly like the UI_MOCK client. A case or asset filter the viewer
// cannot see is 404-shaped. Operational application rows (uploads, downloads) are not part of this feed.
import { paginate, presentAssetActivity, presentCaseActivity, type AuditEvent, type AuditEventQuery, type Page } from "@collara/domain";
import { problems } from "../../errors";
import type { ResolvedActor } from "../../plugins/actor";
import { readWorld, type FinanceDeps } from "../financing/common";

export async function listAuditEvents(deps: FinanceDeps, member: ResolvedActor, query: AuditEventQuery): Promise<Page<AuditEvent>> {
  const { world, pctx } = await readWorld(deps, member);
  let events: AuditEvent[];
  if (query.caseId) {
    const facts = world.cases.find((c) => c.ref === query.caseId);
    const presented = facts ? presentCaseActivity(facts, member, pctx) : null;
    if (!presented) throw problems.unavailable();
    events = presented;
  } else if (query.assetRef) {
    const asset = world.assets.find((a) => a.ref === query.assetRef);
    const presented = asset ? presentAssetActivity(asset, world.cases, member, pctx) : null;
    if (!presented) throw problems.unavailable();
    events = presented;
  } else {
    const byId = new Map<string, AuditEvent>();
    for (const c of world.cases) for (const e of presentCaseActivity(c, member, pctx) ?? []) byId.set(e.id, e);
    for (const asset of world.assets) for (const e of presentAssetActivity(asset, world.cases, member, pctx) ?? []) byId.set(e.id, e);
    events = [...byId.values()];
  }
  const from = query.from ? Date.parse(query.from) : -Infinity;
  const to = query.to ? Date.parse(query.to) : Infinity;
  const filtered = events
    .filter((e) => (!query.kind || e.kind.value === query.kind) && Date.parse(e.occurredAt) >= from && Date.parse(e.occurredAt) <= to)
    .sort((x, y) => Date.parse(y.occurredAt) - Date.parse(x.occurredAt));
  return paginate(filtered, query);
}
