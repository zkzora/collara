// Dealer consent requests in the read model (daml-model.md §4.6, D9): PackageShareProposals naming the dealer and
// the PackageShares it co-signed become CaseFacts.consents (both purposes); the presenter shows them to that
// dealer (its own documents only) and to the owner; every other viewer gets nothing.
import { createHash } from "node:crypto";
import { personaActor, presentConsentRequests, VERIFICATION_GRANT_PURPOSE, type PresentContext } from "@collara/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgliteDatabase, type DbHandle } from "../client";
import { importLocalnetState } from "../bindings";
import { projectOnce, TEMPLATES as T } from "../projection";
import type { FakeLedger } from "../projection/fake-ledger";
import { cases, evidenceDocuments } from "../schema";
import { seedDemoIdentities } from "../seed";
import { buildScenario, scenarioBindingState, scenarioParties } from "./scenario-fixture";
import { loadCaseFacts, type ReadViewer } from "./index";

const P = scenarioParties();
const NOW = new Date("2026-10-01T20:00:00Z");
const DAY = 86_400_000;
const opts = { now: NOW };
const pctx: PresentContext = { now: NOW, mode: "LOCALNET", sync: { offset: null, at: null } };
const viewers = {
  borrower: { orgId: "demo-manufacturer", readableParties: [P.owner] },
  dealer: { orgId: "demo-cnc-dealer", readableParties: [P.dealer] },
  verifier: { orgId: "demo-verifier", readableParties: [P.verifier] },
  lenderA: { orgId: "demo-lender-a", readableParties: [P.lenderA] },
  lenderB: { orgId: "demo-lender-b", readableParties: [P.lenderB] },
  auditor: { orgId: "demo-auditor", readableParties: [P.auditor] },
} satisfies Record<string, ReadViewer>;
const ACTOR = {
  borrower: personaActor("manufacturer-owner"),
  dealer: personaActor("dealer-contributor"),
  verifier: personaActor("verifier-inspector"),
  lenderA: personaActor("lender-a-analyst"),
} as const;

const anchor = (version: number) => ({ packageRef: "PKG-001", manifestVersion: String(version), manifestHash: `hash-manifest-v${version}` });
const sha = (docRef: string, version: number) => createHash("sha256").update(`synthetic:${docRef}:v${version}`).digest("hex");
const dealerDoc = { docRef: "DOC-001", docVersion: "1", sha256: sha("DOC-001", 1), source: P.dealer };

let handle: DbHandle;
let ledger: FakeLedger;
let verificationProposal = "";
let lenderProposal = "";

const project = () => projectOnce(handle.db, ledger, { source: "sandbox", jsonApiUrl: "http://127.0.0.1:7575", parties: Object.values(P) });
const facts = async (viewer: ReadViewer) => loadCaseFacts(handle.db, viewer, "CL-001", opts);
const consentsOf = async (who: keyof typeof ACTOR) => {
  const f = await facts(viewers[who]);
  return f ? presentConsentRequests(f, ACTOR[who], pctx) : null;
};

beforeAll(async () => {
  handle = await createPgliteDatabase();
  await seedDemoIdentities(handle.db);
  await importLocalnetState(handle.db, scenarioBindingState());
  ledger = buildScenario("main").ledger;
  const request = (shareRef: string, recipient: string, purpose: string) => ({
    owner: P.owner,
    dealer: P.dealer,
    recipient,
    shareRef,
    purpose,
    caseRef: "CL-001",
    evidence: anchor(2),
    documents: [dealerDoc],
    permission: "VIEW_DOWNLOAD",
    expiresAt: new Date(NOW.getTime() + 10 * DAY).toISOString(),
  });
  ledger.tx((tx) => {
    // A pending verification request for the dealer's invoice, and a second lender request the dealer declines.
    verificationProposal = tx.create(T.PackageShareProposal, request("VR-002-G2-D1", P.verifier, VERIFICATION_GRANT_PURPOSE), { signatories: [P.owner], observers: [P.dealer] });
    lenderProposal = tx.create(T.PackageShareProposal, request("SHR-003", P.lenderA, "LENDER_REVIEW"), { signatories: [P.owner], observers: [P.dealer] });
  });
  ledger.tx((tx) => tx.exercise(lenderProposal, "Consent_Decline", { reason: "DECLINED_BY_CONSENTER", actorRef: "mbr:dealer-contributor" }, { actingParties: [P.dealer] }));
  await project();
  await handle.db.insert(cases).values({
    caseRef: "CL-001",
    title: "Used CNC financing",
    assetRef: "ASSET-DEMO-001",
    borrowerOrgId: "demo-manufacturer",
    dealerOrgId: "demo-cnc-dealer",
    selectedLenderOrgId: "demo-lender-a",
    requestedPrincipal: "100000.00",
    requestedCurrency: "USD",
    policyRef: "CP-2026-CNC-01",
    createdByUserId: "user-manufacturer-owner",
  });
  await handle.db.insert(evidenceDocuments).values({
    docRef: "DOC-001",
    version: 1,
    assetRef: "ASSET-DEMO-001",
    caseRef: "CL-001",
    ownerOrgId: "demo-manufacturer",
    contributorOrgId: "demo-cnc-dealer",
    uploadedByUserId: "user-dealer-contributor",
    type: "DEALER_INVOICE",
    title: "Dealer invoice",
    fileName: "invoice-v1.pdf",
    contentType: "application/pdf",
    declaredSizeBytes: 100,
    sizeBytes: 100,
    sha256: sha("DOC-001", 1),
    storageKey: "evidence/DOC-001/v1",
    status: "AVAILABLE",
    intentExpiresAt: NOW,
    uploadedAt: NOW,
    finalizedAt: NOW,
  });
});

afterAll(async () => {
  await handle?.close();
});

describe("dealer consent requests", () => {
  it("the dealer sees its requests of both purposes (pending first, then newest), with its own document's version and hash", async () => {
    const list = await consentsOf("dealer");
    expect(list?.map((r) => [r.id, r.purpose, r.recipient.id, r.state.value, r.allowedActions])).toEqual([
      ["VR-002-G2-D1", "VERIFICATION", "demo-verifier", "PENDING", ["consent.grant", "consent.decline"]],
      ["SHR-003", "LENDER_REVIEW", "demo-lender-a", "DECLINED", []],
      ["SHR-001", "LENDER_REVIEW", "demo-lender-a", "GRANTED", ["consent.withdraw"]],
    ]);
    const pending = list?.[0];
    expect(pending?.verificationRef).toBe("VR-002");
    expect(pending?.documents).toEqual([{ documentId: "DOC-001", type: "DEALER_INVOICE", title: "Dealer invoice", version: 1, sha256: sha("DOC-001", 1) }]);
    expect(pending?.expiresAt).toBe(new Date(NOW.getTime() + 10 * DAY).toISOString());
    // Only the dealer's own document: never the owner's document refs or hashes.
    const body = JSON.stringify(list);
    for (const ownerDoc of ["DOC-002", "DOC-003", "DOC-004"]) expect(body).not.toContain(ownerDoc);
  });

  it("the owner reads the same requests without actions; lender, verifier and auditor get none; Lender B no case", async () => {
    const owner = await consentsOf("borrower");
    expect(owner?.map((r) => [r.id, r.state.value, r.allowedActions.length])).toEqual([
      ["VR-002-G2-D1", "PENDING", 0],
      ["SHR-003", "DECLINED", 0],
      ["SHR-001", "GRANTED", 0],
    ]);
    expect(await consentsOf("lenderA")).toEqual([]);
    expect(await consentsOf("verifier")).toEqual([]);
    const auditor = await facts(viewers.auditor);
    expect(auditor ? presentConsentRequests(auditor, personaActor("auditor"), pctx) : null).toBeNull();
    expect(await facts(viewers.lenderB)).toBeNull();
  });

  it("follows the ledger: Consent_Grant → granted share, Share_WithdrawConsent → withdrawn", async () => {
    ledger.tx((tx) => {
      tx.exercise(verificationProposal, "Consent_Grant", { actorRef: "mbr:dealer-contributor" }, { actingParties: [P.dealer] });
      tx.create(
        T.PackageShare,
        {
          owner: P.owner,
          consenters: [P.dealer],
          recipient: P.verifier,
          shareRef: "VR-002-G2-D1",
          purpose: VERIFICATION_GRANT_PURPOSE,
          caseRef: "CL-001",
          evidence: anchor(2),
          documents: [dealerDoc],
          permission: "VIEW_DOWNLOAD",
          expiresAt: new Date(NOW.getTime() + 10 * DAY).toISOString(),
        },
        { signatories: [P.owner, P.dealer], observers: [P.verifier] },
      );
    });
    await project();
    expect((await consentsOf("dealer"))?.find((r) => r.id === "VR-002-G2-D1")?.state.value).toBe("GRANTED");

    const lenderShare = [...ledger.contracts.entries()].find(([, c]) => c.templateRef === T.PackageShare && c.signatories.includes(P.dealer) && c.observers.includes(P.lenderA));
    expect(lenderShare).toBeDefined();
    ledger.tx((tx) => tx.exercise(lenderShare![0], "Share_WithdrawConsent", { consenter: P.dealer, actorRef: "mbr:dealer-contributor" }, { actingParties: [P.dealer] }));
    await project();
    const after = await consentsOf("dealer");
    expect(after?.find((r) => r.id === "SHR-001")).toMatchObject({ state: { value: "WITHDRAWN" }, allowedActions: [] });
    // The lender's case share of the dealer's records is revoked (future access only).
    expect((await facts(viewers.lenderA))?.shares.find((s) => s.ref === "SHR-001")?.state).toBe("REVOKED");
  });
});
