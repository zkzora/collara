import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createPgliteDatabase, type DbHandle } from "./client";
import { importLocalnetState, type LocalnetBindingSource } from "./bindings";
import { allocateRef, loadUserAuthority, visibleContracts, visibleEvents } from "./queries";
import { cases, commands, ledgerContracts, ledgerEvents, ledgerSources, ledgerUsers, partyBindings } from "./schema";
import { seedDemoIdentities } from "./seed";

const P = "122049e5";
function state(suffix: string, participantId = `sandbox::${suffix}`): LocalnetBindingSource {
  const hints = ["CollaraRegistrar", "CollaraGovernance", "DemoManufacturer", "DemoLenderA", "DemoLenderB", "DemoAuditor", "GovSeat1", "GovSeat2", "GovSeat3", "Stranger"];
  return {
    topology: "sandbox-1-participant",
    participants: { sandbox: { jsonApiUrl: "http://127.0.0.1:7575", participantId } },
    parties: Object.fromEntries(hints.map((h) => [h, { party: `${h}::${suffix}`, participant: "sandbox", user: `${h.toLowerCase()}-svc` }])),
    users: [
      { id: "lender-a-svc", participant: "sandbox", role: "org", party: "DemoLenderA", actAs: [`DemoLenderA::${suffix}`], readAs: [`DemoLenderA::${suffix}`] },
      { id: "projector", participant: "sandbox", role: "projector", actAs: [], readAs: [`DemoLenderA::${suffix}`, `DemoManufacturer::${suffix}`] },
    ],
  };
}

describe("@collara/db on PGlite", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = await createPgliteDatabase();
    await seedDemoIdentities(handle.db);
  });

  afterAll(async () => {
    await handle.close();
  });

  it("applies migrations idempotently and seeds demo identities idempotently", async () => {
    await handle.migrate();
    const again = await seedDemoIdentities(handle.db);
    expect(again.users).toBe(9);
    const authority = await loadUserAuthority(handle.db, "user-lender-a-approver");
    expect(authority?.org?.id).toBe("demo-lender-a");
    expect(authority?.roles.sort()).toEqual(["GOVERNANCE_MEMBER", "LENDER_APPROVER"]);
    expect(authority?.mandates.map((m) => `${m.code}:${m.seat}`).sort()).toEqual(["APPROVER:0", "GOVERNANCE_SEAT:1"]);
  });

  it("ignores a preferred organization the user is not an active member of", async () => {
    const authority = await loadUserAuthority(handle.db, "user-lender-a-analyst", "demo-lender-b");
    expect(authority?.org?.id).toBe("demo-lender-a");
  });

  it("round-trips money as numeric(18,2) strings and enforces the currency pair", async () => {
    const [row] = await handle.db
      .insert(cases)
      .values({
        caseRef: "CL-901",
        title: "Synthetic",
        assetRef: "ASSET-DEMO-901",
        borrowerOrgId: "demo-manufacturer",
        requestedPrincipal: "100000.10",
        requestedCurrency: "USD",
        policyRef: "CP-2026-CNC-01",
        createdByUserId: "user-manufacturer-owner",
      })
      .returning();
    expect(row?.requestedPrincipal).toBe("100000.10");
    await expect(
      handle.db.insert(cases).values({
        caseRef: "CL-902",
        title: "Synthetic",
        assetRef: "ASSET-DEMO-902",
        borrowerOrgId: "demo-manufacturer",
        requestedPrincipal: "1.00",
        policyRef: "CP-2026-CNC-01",
        createdByUserId: "user-manufacturer-owner",
      }),
    ).rejects.toThrow();
  });

  it("allocates display references atomically", async () => {
    const refs = await Promise.all([allocateRef(handle.db, "document"), allocateRef(handle.db, "document"), allocateRef(handle.db, "document")]);
    expect(new Set(refs).size).toBe(3);
    expect(refs.every((ref) => /^DOC-\d{3}$/.test(ref))).toBe(true);
  });

  it("enforces one command per (actor, org, operation, idempotency key)", async () => {
    const values = {
      idempotencyKey: "key-123456",
      actorUserId: "user-lender-a-approver",
      orgId: "demo-lender-a",
      operation: "review.decide",
      target: "LEDGER",
      payloadHash: "abc",
      payload: {},
      ledgerCommandId: "collara-1",
    };
    await handle.db.insert(commands).values(values);
    await expect(handle.db.insert(commands).values({ ...values, ledgerCommandId: "collara-2" })).rejects.toThrow();
  });

  it("imports party bindings, revokes superseded ones and flags a participant reset", async () => {
    const first = await importLocalnetState(handle.db, state(P));
    expect(first.unmatchedHints).toEqual(["Stranger"]);
    expect(first.sources).toEqual([{ source: "sandbox", participantId: `sandbox::${P}`, reset: false }]);
    const lenderA = await loadUserAuthority(handle.db, "user-lender-a-approver");
    expect(lenderA?.bindings.map((b) => `${b.kind}:${b.partyHint}`).sort()).toEqual([
      "business:DemoLenderA",
      "governance-member:GovSeat1",
      "governance:CollaraGovernance",
    ]);
    const analyst = await loadUserAuthority(handle.db, "user-lender-a-analyst");
    expect(analyst?.bindings.some((b) => b.kind === "governance")).toBe(false);
    const ledgerUserRows = await handle.db.select().from(ledgerUsers);
    expect(ledgerUserRows.find((u) => u.ledgerUserId === "lender-a-svc")?.orgId).toBe("demo-lender-a");
    expect(ledgerUserRows.find((u) => u.ledgerUserId === "projector")?.orgId).toBeNull();

    const second = await importLocalnetState(handle.db, state("ffff0000"));
    expect(second.revoked).toBe(first.bindings);
    expect(second.sources[0]?.reset).toBe(true);
    const [source] = await handle.db.select().from(ledgerSources).where(eq(ledgerSources.source, "sandbox"));
    expect(source?.status).toBe("RESET_DETECTED");
    const active = await handle.db.select().from(partyBindings).where(eq(partyBindings.state, "ACTIVE"));
    expect(active.every((b) => b.partyId.endsWith("::ffff0000"))).toBe(true);
  });

  it("returns only contracts and events witnessed by the caller's parties", async () => {
    await handle.db
      .insert(ledgerSources)
      .values({ source: "p2", participantId: "p2::1", jsonApiUrl: "http://127.0.0.1:7576" })
      .onConflictDoNothing();
    const base = {
      source: "p2",
      templateId: "pkg:Collara.Control:AssetControl",
      templateRef: "#collara-contracts:Collara.Control:AssetControl",
      packageName: "collara-contracts",
      payload: { assetRef: "ASSET-DEMO-001" },
      signatories: ["Registrar::1"],
      createdUpdateId: "u1",
      createdOffset: 10,
      createdAt: new Date(),
    };
    await handle.db.insert(ledgerContracts).values([
      { ...base, contractId: "c-owner", witnessParties: ["Owner::1", "Registrar::1"], createdNodeId: 0 },
      { ...base, contractId: "c-lender", witnessParties: ["LenderA::1"], createdNodeId: 1 },
      { ...base, contractId: "c-archived", witnessParties: ["Owner::1"], createdNodeId: 2, archivedOffset: 11, archivedUpdateId: "u2" },
    ]);
    await handle.db.insert(ledgerEvents).values([
      { source: "p2", updateId: "u1", offset: 10, nodeId: 0, kind: "created", contractId: "c-owner", templateId: base.templateId, templateRef: base.templateRef, witnessParties: ["Owner::1"], effectiveAt: new Date() },
      { source: "p2", updateId: "u1", offset: 10, nodeId: 1, kind: "created", contractId: "c-lender", templateId: base.templateId, templateRef: base.templateRef, witnessParties: ["LenderA::1"], effectiveAt: new Date() },
    ]);

    expect((await visibleContracts(handle.db, { parties: ["Owner::1"] })).map((c) => c.contractId)).toEqual(["c-owner"]);
    expect((await visibleContracts(handle.db, { parties: ["Owner::1"], includeArchived: true })).map((c) => c.contractId)).toEqual([
      "c-owner",
      "c-archived",
    ]);
    expect(await visibleContracts(handle.db, { parties: ["LenderB::1"] })).toEqual([]);
    expect(await visibleContracts(handle.db, { parties: [] })).toEqual([]);
    expect(await visibleContracts(handle.db, { parties: ["Owner::1"], templateRefs: ["#collara-contracts:Other:T"] })).toEqual([]);
    expect((await visibleEvents(handle.db, { parties: ["LenderA::1"] })).map((e) => e.contractId)).toEqual(["c-lender"]);
    // Replaying the same node is rejected by the (source, update_id, node_id) key.
    await expect(
      handle.db.insert(ledgerEvents).values({ source: "p2", updateId: "u1", offset: 10, nodeId: 0, kind: "created", contractId: "c-owner", templateId: base.templateId, templateRef: base.templateRef, witnessParties: ["Owner::1"], effectiveAt: new Date() }),
    ).rejects.toThrow();
  });
});
