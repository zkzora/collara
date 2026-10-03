// LocalNet IT (LOCALNET_IT=1): the dealer's consent for its OWN records, end to end through the API on a fresh
// "dc-<unique>" prefix after the clean-start seed (daml-model.md §4.6, D9). Evidence bytes use IN-MEMORY storage
// (this file asserts downloads by the API's authorization answer, never by fetching the memory:// link):
//   1. the owner registers ASSET-DEMO-001 and creates a case inviting Demo CNC Dealer; the dealer uploads its invoice;
//   2. the owner shares the package with Demo Lender A (its own documents; the invoice only as a request to the
//      dealer) and requests verification including the invoice (again only a request to the dealer);
//   3. the dealer lists two pending requests with document, version, SHA-256, recipient, purpose and expiry; the
//      owner reads the same status without actions;
//   4. the dealer approves the verification request (Consent_Grant) and declines the lender one (Consent_Decline):
//      the verifier downloads the invoice only after the approval, the lender never;
//   5. Lender B, the auditor, the owner (403), the verifier and lender (no visibility) and the dealer acting on
//      another case (no invitation) are refused;
//   6. withdrawal (Share_WithdrawConsent) stops the verifier's future downloads with the approved revocation copy.
import {
  COMMAND_COPY,
  CommandStatusSchema,
  ConsentRequestSchema,
  CONSENT_COPY,
  ERROR_COPY,
  pageSchema,
  STATUS_COPY,
  VERIFICATION_GRANT_PURPOSE,
} from "@collara/domain";
import { evidenceDocuments } from "@collara/db";
import { and, eq } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { cl001Files, type SyntheticFile } from "../../src/seed/documents";
import { LOCALNET_IT_ENABLED, startLocalnetHarness, type ItSession, type LocalnetHarness } from "./harness";

const DAY = 86_400_000;
const CommandBody = z.object({ command: CommandStatusSchema, result: z.unknown().optional() });
const Steps = z.object({ steps: z.array(z.object({ step: z.string(), state: z.string(), updateId: z.string().nullable() })) });
const Consents = pageSchema(ConsentRequestSchema);

describe.skipIf(!LOCALNET_IT_ENABLED)("LocalNet: dealer consent for its own records (lender review and verification)", () => {
  let h: LocalnetHarness;
  let owner: ItSession;
  let dealer: ItSession;
  let verifier: ItSession;
  let analyst: ItSession;
  let lenderB: ItSession;
  let auditor: ItSession;
  let assetRef = "";
  let caseId = "";
  let invoice = "";
  let photos = "";
  let verificationRef = "";
  let verificationConsent = "";
  let lenderConsent = "";
  let dueAt = "";
  const facts: Record<string, unknown> = {};

  function committed(response: LightMyRequestResponse, label: string) {
    expect(response.statusCode, `${label}: ${response.body}`).toBe(200);
    const body = CommandBody.parse(response.json());
    expect(body.command, label).toMatchObject({ state: "COMMITTED", simulated: false, message: COMMAND_COPY.COMMITTED });
    expect(body.command.updateId, label).toBeTruthy();
    return body;
  }
  async function stepsOf(commandId: string): Promise<string[]> {
    return Steps.parse((await h.command(commandId))?.result).steps.map((s) => s.step);
  }
  async function storedSha(docRef: string, version: number): Promise<string> {
    const [row] = await h.db.db
      .select({ sha256: evidenceDocuments.sha256 })
      .from(evidenceDocuments)
      .where(and(eq(evidenceDocuments.docRef, docRef), eq(evidenceDocuments.version, version)));
    return row?.sha256 ?? "";
  }
  async function upload(session: ItSession, file: SyntheticFile, onAsset = assetRef, onCase: string | undefined = caseId) {
    const intent = await session.inject("POST", "/api/evidence/upload-intents", {
      body: { assetRef: onAsset, ...(onCase ? { caseId: onCase } : {}), type: file.type, title: file.title, fileName: file.fileName, contentType: file.contentType, sizeBytes: file.bytes.length },
    });
    expect([200, 201], intent.body).toContain(intent.statusCode);
    const { evidenceId } = (intent.json() as { result: { evidenceId: string } }).result;
    expect((await session.inject("PUT", `/api/evidence/${evidenceId}/content`, { body: file.bytes, headers: { "content-type": file.contentType } })).statusCode).toBe(200);
    expect((await session.inject("POST", `/api/evidence/${evidenceId}/finalize`, { body: {} })).statusCode).toBe(200);
    return evidenceId;
  }
  /** The API's download decision (status code); the short-lived link itself is not fetched (memory storage). */
  const download = async (session: ItSession, docRef: string) => {
    const response = await session.inject("GET", `/api/evidence/${docRef}/download`);
    return { status: response.statusCode, detail: response.statusCode === 200 ? null : (response.json() as { detail?: string }).detail };
  };
  const consents = async (session: ItSession, query = "") => {
    const response = await session.inject("GET", `/api/consent-requests${query}`);
    expect(response.statusCode, response.body).toBe(200);
    return Consents.parse(response.json()).items;
  };
  async function register(serialNumber: string) {
    const registered = committed(
      await owner.inject("POST", "/api/assets", {
        body: { intent: "REGISTER", equipmentClass: "CNC machining center", manufacturer: "Demo Machine Works (synthetic)", model: "DEMO-CNC-500", serialNumber, locationScope: "Demo Manufacturer facility (declared)" },
      }),
      `register ${serialNumber}`,
    );
    await h.project();
    return (registered.result as { assetRef: string }).assetRef;
  }

  beforeAll(async () => {
    h = await startLocalnetHarness({ prefixBase: "dc", storage: "memory" });
    facts.prefix = h.prefix;
    facts.storage = "memory";
    await h.seed("clean-start");
    [owner, dealer, verifier, analyst, lenderB, auditor] = await Promise.all([
      h.loginAs("manufacturer-owner"),
      h.loginAs("dealer-contributor"),
      h.loginAs("verifier-inspector"),
      h.loginAs("lender-a-analyst"),
      h.loginAs("lender-b-approver"),
      h.loginAs("auditor"),
    ]);
    await h.project();
  });

  afterAll(async () => {
    console.log(`LocalNet dealer consent IT facts: ${JSON.stringify(facts, null, 2)}`);
    await h?.close();
  });

  it("the invited dealer uploads its invoice to the owner's case; the owner adds its own documents", async () => {
    assetRef = await register("SYNTH-CNC-001");
    const created = await owner.inject("POST", "/api/cases", {
      body: { title: "Used CNC financing", assetRef, selectedLenderOrgId: "demo-lender-a", dealerOrgId: "demo-cnc-dealer", requestedPrincipal: { amount: "100000.00", currency: "USD" } },
    });
    expect(created.statusCode, created.body).toBe(201);
    caseId = (CommandBody.parse(created.json()).result as { caseId: string }).caseId;
    const files = cl001Files();
    invoice = await upload(dealer, files.invoice);
    photos = await upload(owner, files.photos);
    await upload(owner, files.inspectionV1);
    await upload(owner, files.maintenance);
    const [row] = await h.db.db.select().from(evidenceDocuments).where(eq(evidenceDocuments.docRef, invoice));
    expect(row).toMatchObject({ contributorOrgId: "demo-cnc-dealer", ownerOrgId: "demo-manufacturer", status: "AVAILABLE" });
    facts.case = { caseId, assetRef, invoice };
  });

  it("the owner's share and verification request reach the dealer only as two consent requests", async () => {
    const share = committed(await owner.inject("POST", `/api/cases/${caseId}/sharing`, { body: { recipientOrgId: "demo-lender-a", permission: "VIEW_DOWNLOAD" } }), "share");
    expect(await stepsOf(share.command.commandId)).toEqual(["manifest", "dealer-request-1", "share", "control"]);
    dueAt = new Date(Date.now() + 12 * DAY).toISOString();
    const request = committed(
      await owner.inject("POST", `/api/cases/${caseId}/verification-requests`, {
        body: { verifierRegistryRef: "VER-001", scope: ["Serial number consistency", "Document consistency"], documentIds: [photos, invoice], dueAt },
      }),
      "verification request",
    );
    verificationRef = (request.result as { verificationRef: string }).verificationRef;
    expect(await stepsOf(request.command.commandId)).toEqual(["request", "grant", "dealer-grant-1"]);
    // On the ledger: the owner's own documents are shared; the dealer's invoice is only proposed to the dealer.
    const lenderShares = await h.acsAs("lenderA", "PackageShare");
    expect(lenderShares.flatMap((s) => s.payload.documents.map((d) => d.docRef))).not.toContain(invoice);
    const verifierShares = await h.acsAs("verifier", "PackageShare", (s) => s.purpose === VERIFICATION_GRANT_PURPOSE);
    expect(verifierShares.flatMap((s) => s.payload.documents.map((d) => d.docRef))).toEqual([photos]);
    const proposals = await h.acsAs("dealer", "PackageShareProposal");
    expect(proposals.map((p) => [p.payload.purpose, p.payload.documents.map((d) => d.docRef)]).sort()).toEqual([
      ["LENDER_REVIEW", [invoice]],
      [VERIFICATION_GRANT_PURPOSE, [invoice]],
    ]);
    await h.project();
  });

  it("the dealer sees two pending requests with its document version, hash, recipient, purpose and expiry; the owner the same status", async () => {
    const items = await consents(dealer, `?caseId=${caseId}`);
    expect(items).toHaveLength(2);
    const sha = await storedSha(invoice, 1);
    for (const item of items) {
      expect(item.state.value).toBe("PENDING");
      expect(item.allowedActions).toEqual(["consent.grant", "consent.decline"]);
      expect(item.documents).toEqual([{ documentId: invoice, type: "DEALER_INVOICE", title: "Dealer invoice", version: 1, sha256: sha }]);
      expect(item.caseId).toBe(caseId);
      expect(Date.parse(item.expiresAt)).toBeGreaterThan(Date.now());
    }
    const verification = items.find((i) => i.purpose === "VERIFICATION")!;
    const lender = items.find((i) => i.purpose === "LENDER_REVIEW")!;
    verificationConsent = verification.id;
    lenderConsent = lender.id;
    expect(verification).toMatchObject({ recipient: { id: "demo-verifier" }, verificationRef, purposeLabel: "Verification" });
    expect(verification.id).toMatch(new RegExp(`^${verificationRef}-G\\d+-D1$`));
    expect(Date.parse(verification.expiresAt)).toBe(Date.parse(dueAt));
    expect(lender).toMatchObject({ recipient: { id: "demo-lender-a" }, verificationRef: null, purposeLabel: "Lender review" });
    // The dealer never receives the owner's document refs, hashes or terms.
    const body = JSON.stringify(items);
    expect(body).not.toContain(photos);
    expect(body).not.toContain("100000");
    const owner_ = await consents(owner, `?caseId=${caseId}`);
    expect(owner_.map((i) => [i.id, i.state.value, i.allowedActions])).toEqual(items.map((i) => [i.id, "PENDING", []]));
    facts.pending = items.map((i) => ({ id: i.id, purpose: i.purpose, recipient: i.recipient.name, expiresAt: i.expiresAt }));
  });

  it("before consent the verifier cannot download the invoice (its own documents it can)", async () => {
    expect(await download(verifier, photos)).toMatchObject({ status: 200 });
    expect(await download(verifier, invoice)).toMatchObject({ status: 404 });
  });

  it("refuses everyone but the dealer: Lender B, auditor, verifier, lender (404), the owner (403)", async () => {
    const unknown = await dealer.inject("POST", "/api/consent-requests/AG-999/decision", { body: { decision: "GRANT" } });
    expect(unknown.statusCode).toBe(404);
    const shape = (r: LightMyRequestResponse) => {
      const { instance: _i, ...rest } = r.json() as Record<string, unknown>;
      return rest;
    };
    for (const session of [lenderB, auditor, verifier, analyst]) {
      for (const [path, body] of [
        [`/api/consent-requests/${verificationConsent}/decision`, { decision: "GRANT" }],
        [`/api/consent-requests/${lenderConsent}/decision`, { decision: "DECLINE" }],
        [`/api/consent-requests/${verificationConsent}/withdraw`, {}],
      ] as const) {
        const response = await session.inject("POST", path, { body });
        expect(response.statusCode, `${session.personaId} ${path}`).toBe(404);
        expect(shape(response), `${session.personaId} ${path}`).toEqual(shape(unknown));
      }
      expect(await consents(session), session.personaId).toEqual([]);
    }
    for (const session of [lenderB, auditor]) {
      const filtered = await session.inject("GET", `/api/consent-requests?caseId=${caseId}`);
      expect(filtered.statusCode, session.personaId).toBe(404);
      expect(filtered.json()).toMatchObject({ detail: ERROR_COPY.UNAVAILABLE });
    }
    const asOwner = await owner.inject("POST", `/api/consent-requests/${verificationConsent}/decision`, { body: { decision: "GRANT" } });
    expect(asOwner.statusCode).toBe(403);
    // Nothing changed on the ledger.
    expect(await h.acsAs("dealer", "PackageShareProposal")).toHaveLength(2);
  });

  it("the dealer approves the verification request and declines the lender one", async () => {
    const approve = committed(
      await dealer.inject("POST", `/api/consent-requests/${verificationConsent}/decision`, { body: { decision: "GRANT" }, idempotencyKey: "dc-approve-verification-1" }),
      "approve",
    );
    expect(await stepsOf(approve.command.commandId)).toEqual([`contribute-${invoice.toLowerCase()}-v1`, "consent"]);
    const replay = committed(
      await dealer.inject("POST", `/api/consent-requests/${verificationConsent}/decision`, { body: { decision: "GRANT" }, idempotencyKey: "dc-approve-verification-1" }),
      "approve replay",
    );
    expect(replay.command.commandId).toBe(approve.command.commandId);
    const conflict = await dealer.inject("POST", `/api/consent-requests/${verificationConsent}/decision`, { body: { decision: "DECLINE" }, idempotencyKey: "dc-approve-verification-1" });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: "idempotency_conflict" });
    committed(await dealer.inject("POST", `/api/consent-requests/${lenderConsent}/decision`, { body: { decision: "DECLINE" } }), "decline");

    const granted = await h.acsAs("verifier", "PackageShare", (s) => s.shareRef === verificationConsent);
    expect(granted.map((g) => [g.payload.consenters, g.payload.documents.map((d) => d.docRef)])).toEqual([[[h.party("dealer")], [invoice]]]);
    expect(await h.acsAs("dealer", "PackageShareProposal")).toHaveLength(0);
    expect((await h.acsAs("lenderA", "PackageShare")).flatMap((s) => s.payload.documents.map((d) => d.docRef))).not.toContain(invoice);
    const [contribution] = await h.acsAs("dealer", "DealerContribution", (c) => c.docRef === invoice);
    expect(contribution?.payload).toMatchObject({ caseRef: caseId, docVersion: 1, sha256: await storedSha(invoice, 1), docType: "INVOICE" });
    await h.project();

    const items = await consents(dealer);
    expect(items.find((i) => i.id === verificationConsent)).toMatchObject({ state: { value: "GRANTED" }, allowedActions: ["consent.withdraw"] });
    expect(items.find((i) => i.id === lenderConsent)).toMatchObject({ state: { value: "DECLINED" }, allowedActions: [] });
    const owner_ = await consents(owner, `?caseId=${caseId}`);
    expect(owner_.map((i) => [i.id, i.state.value]).sort()).toEqual(
      [
        [verificationConsent, "GRANTED"],
        [lenderConsent, "DECLINED"],
      ].sort(),
    );
    // A second decision is refused with the request's copy.
    const again = await dealer.inject("POST", `/api/consent-requests/${lenderConsent}/decision`, { body: { decision: "GRANT" } });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ detail: CONSENT_COPY.NOT_PENDING });
  });

  it("only after approval the verifier downloads the invoice; the lender never (declined); Lender B and the auditor never", async () => {
    expect(await download(verifier, invoice)).toMatchObject({ status: 200 });
    expect(await download(analyst, photos)).toMatchObject({ status: 200 });
    expect(await download(analyst, invoice)).toMatchObject({ status: 404 });
    for (const session of [lenderB, auditor]) {
      expect(await download(session, invoice), session.personaId).toMatchObject({ status: 404 });
      expect((await session.inject("GET", `/api/evidence/${invoice}`)).statusCode, session.personaId).toBe(404);
    }
    facts.afterDecision = { verifierInvoice: 200, lenderInvoice: 404 };
  });

  it("a dealer acting on another case (not invited there) is refused", async () => {
    // A second asset and case of the same owner, without a dealer: the owner grants its photos to the verifier.
    const otherAsset = await register("SYNTH-CNC-002");
    const created = await owner.inject("POST", "/api/cases", { body: { title: "Second CNC financing", assetRef: otherAsset, selectedLenderOrgId: "demo-lender-a" } });
    expect(created.statusCode, created.body).toBe(201);
    const otherCase = (CommandBody.parse(created.json()).result as { caseId: string }).caseId;
    const otherPhotos = await upload(owner, cl001Files().photos, otherAsset, otherCase);
    const request = committed(
      await owner.inject("POST", `/api/cases/${otherCase}/verification-requests`, { body: { verifierRegistryRef: "VER-001", scope: ["Photos"], documentIds: [otherPhotos] } }),
      "other verification request",
    );
    const otherRef = (request.result as { verificationRef: string }).verificationRef;
    await h.project();
    const [grant] = await h.acsAs("verifier", "PackageShare", (s) => s.caseRef === otherCase);
    expect(grant).toBeDefined();
    expect((await dealer.inject("GET", `/api/consent-requests?caseId=${otherCase}`)).statusCode).toBe(404);
    expect((await dealer.inject("GET", `/api/cases/${otherCase}`)).statusCode).toBe(404);
    for (const [path, body] of [
      [`/api/consent-requests/${grant!.payload.shareRef}/decision`, { decision: "GRANT" }],
      [`/api/consent-requests/${grant!.payload.shareRef}/withdraw`, {}],
    ] as const) {
      const response = await dealer.inject("POST", path, { body });
      expect(response.statusCode, path).toBe(404);
      expect(response.json()).toMatchObject({ detail: ERROR_COPY.UNAVAILABLE });
    }
    expect(await download(dealer, otherPhotos)).toMatchObject({ status: 404 });
    expect((await consents(dealer)).every((i) => i.caseId === caseId)).toBe(true);
    facts.otherCase = { caseId: otherCase, verificationRef: otherRef };
  });

  it("withdrawing consent stops the verifier's future downloads with the approved revocation copy", async () => {
    const withdraw = committed(await dealer.inject("POST", `/api/consent-requests/${verificationConsent}/withdraw`, { body: {} }), "withdraw");
    expect(await stepsOf(withdraw.command.commandId)).toEqual(["withdraw"]);
    expect(await h.acsAs("verifier", "PackageShare", (s) => s.shareRef === verificationConsent)).toHaveLength(0);
    await h.project();
    const refused = await download(verifier, invoice);
    expect(refused).toEqual({ status: 409, detail: STATUS_COPY.ACCESS_REVOKED });
    // The owner's own grant is untouched.
    expect(await download(verifier, photos)).toMatchObject({ status: 200 });
    expect((await consents(dealer)).find((i) => i.id === verificationConsent)).toMatchObject({ state: { value: "WITHDRAWN" }, allowedActions: [] });
    expect((await consents(owner, `?caseId=${caseId}`)).find((i) => i.id === verificationConsent)?.state.value).toBe("WITHDRAWN");
    const again = await dealer.inject("POST", `/api/consent-requests/${verificationConsent}/withdraw`, { body: {} });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ detail: CONSENT_COPY.NOT_GRANTED });
    facts.afterWithdrawal = { verifierInvoice: refused };
  });
});
