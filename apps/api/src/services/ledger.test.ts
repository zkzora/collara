import { ledgerContracts, ledgerSources, partyBindings, TEMPLATES, type DbHandle } from "@collara/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seededDb } from "../test-support";
import { createDbProjectionReader } from "./ledger";

const NS = "1220abcd";
const OWNER = `DemoManufacturer::${NS}`;
const DEALER = `DemoCncDealer::${NS}`;
const REGISTRAR = `CollaraRegistrar::${NS}`;

describe("createDbProjectionReader.assetOwnerOrgId (projected AssetPassport)", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = await seededDb();
    const db = handle.db;
    await db.insert(ledgerSources).values({ source: "sandbox", participantId: "sandbox::1220", jsonApiUrl: "http://127.0.0.1:7575" });
    await db.insert(partyBindings).values([
      { orgId: "demo-manufacturer", kind: "business", partyId: OWNER, partyHint: "DemoManufacturer", source: "sandbox", participantId: "sandbox::1220" },
      { orgId: "demo-cnc-dealer", kind: "business", partyId: DEALER, partyHint: "DemoCncDealer", source: "sandbox", participantId: "sandbox::1220" },
    ]);
    const passport = (contractId: string, offset: number) => ({
      source: "sandbox",
      contractId,
      templateId: "pkg:Collara.Registration:AssetPassport",
      templateRef: TEMPLATES.AssetPassport,
      packageName: "collara-contracts",
      payload: { owner: OWNER, registrar: REGISTRAR, namespace: "collara-localnet", assetId: "ASSET-DEMO-001", passportVersion: "1" },
      signatories: [OWNER],
      observers: [],
      witnessParties: [OWNER],
      businessRef: "ASSET-DEMO-001",
      assetRef: "ASSET-DEMO-001",
      createdUpdateId: `update-${offset}`,
      createdOffset: offset,
      createdNodeId: 0,
      createdAt: new Date(),
    });
    await db.insert(ledgerContracts).values([passport("cid-archived", 10), passport("cid-active", 20)]);
    await db.update(ledgerContracts).set({ archivedOffset: 20, archivedUpdateId: "update-20" }).where(eq(ledgerContracts.contractId, "cid-archived"));
  });

  afterAll(async () => {
    await handle.close();
  });

  it("returns the owner organization to the owner's parties (asset without a case)", async () => {
    const reader = createDbProjectionReader(handle.db);
    expect(await reader.assetOwnerOrgId("ASSET-DEMO-001", [OWNER])).toBe("demo-manufacturer");
  });

  it("returns null to parties that are not stakeholders, for unknown assets, and without parties", async () => {
    const reader = createDbProjectionReader(handle.db);
    expect(await reader.assetOwnerOrgId("ASSET-DEMO-001", [DEALER])).toBeNull();
    expect(await reader.assetOwnerOrgId("ASSET-DEMO-002", [OWNER])).toBeNull();
    expect(await reader.assetOwnerOrgId("ASSET-DEMO-001", [])).toBeNull();
  });

  it("ignores archived passports", async () => {
    await handle.db.update(ledgerContracts).set({ archivedOffset: 30, archivedUpdateId: "update-30" }).where(eq(ledgerContracts.contractId, "cid-active"));
    const reader = createDbProjectionReader(handle.db);
    expect(await reader.assetOwnerOrgId("ASSET-DEMO-001", [OWNER])).toBeNull();
  });
});
