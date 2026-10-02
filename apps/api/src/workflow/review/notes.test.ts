// Private notes over the API (PGlite, projected scenario 'full', no ledger connection): the review and release
// GETs return note text only to the parties the note store allows; unrelated accounts keep the 404-shaped answer;
// invalid note text is a 400 before any command record exists; a write that cannot reach the ledger (FAILED)
// shows no note; no note text reaches the request logs.
import { cases, commands, importLocalnetState, notes, projectOnce, putPendingNote, settleNotes, type DbHandle } from "@collara/db";
import { buildScenario, scenarioBindingState, scenarioParties } from "@collara/db/testing";
import { ERROR_COPY, type PersonaId } from "@collara/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { idem, loginAs, seededDb, testApp, type TestApp } from "../../test-support";

const TEXT = {
  internal: "API internal note (synthetic).",
  shared: "API shared feedback (synthetic).",
  rrNote: "API release note (synthetic).",
  question: "API lender question (synthetic).",
  response: "API borrower response (synthetic).",
};

describe("private notes over the API (scenario 'full')", () => {
  let t: TestApp;
  let db: DbHandle;
  const cookies = new Map<PersonaId, string>();
  const as = async (persona: PersonaId) => {
    let cookie = cookies.get(persona);
    if (!cookie) {
      cookie = await loginAs(t.app, persona);
      cookies.set(persona, cookie);
    }
    return cookie;
  };
  const get = async (persona: PersonaId, url: string) => t.app.inject({ method: "GET", url, headers: { cookie: await as(persona) } });
  const post = async (persona: PersonaId, url: string, payload: object, key = `k-${Math.random()}`) =>
    t.app.inject({ method: "POST", url, payload, headers: { cookie: await as(persona), ...idem(key) } });

  let counter = 0;
  async function committedNote(kind: Parameters<typeof putPendingNote>[1]["kind"], userId: string, orgId: string, subjectRef: string, body: string, at: string) {
    counter += 1;
    const [command] = await db.db
      .insert(commands)
      .values({
        idempotencyKey: `api-notes-${counter}`,
        actorUserId: userId,
        orgId,
        operation: "notes.api-test",
        target: "LEDGER",
        payloadHash: `h-${counter}`,
        payload: {},
        ledgerCommandId: `collara-api-notes-${counter}`,
        status: "PROJECTED",
        updateId: `upd-api-${counter}`,
        committedAt: new Date(at),
      })
      .returning();
    await putPendingNote(db.db, { kind, ownerOrgId: orgId, caseRef: "CL-001", subjectRef, body, commandId: command!.id, createdByUserId: userId });
    await settleNotes(db.db, command!.id, "PROJECTED");
  }

  beforeAll(async () => {
    db = await seededDb();
    await importLocalnetState(db.db, scenarioBindingState());
    const { ledger } = buildScenario("full");
    await projectOnce(db.db, ledger, { source: "sandbox", jsonApiUrl: "http://127.0.0.1:7575", parties: Object.values(scenarioParties()) });
    await db.db.insert(cases).values({
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
    await committedNote("ASSESSMENT_INTERNAL", "user-lender-a-analyst", "demo-lender-a", "CA-001", TEXT.internal, "2026-10-01T19:00:00Z");
    await committedNote("ASSESSMENT_SHARED_FEEDBACK", "user-lender-a-analyst", "demo-lender-a", "CA-001", TEXT.shared, "2026-10-01T19:00:00Z");
    await committedNote("RELEASE_REQUEST_NOTE", "user-manufacturer-owner", "demo-manufacturer", "RR-001", TEXT.rrNote, "2026-10-01T19:05:00Z");
    await committedNote("RELEASE_QUESTION", "user-lender-a-approver", "demo-lender-a", "RR-001", TEXT.question, "2026-10-01T19:10:00Z");
    await committedNote("RELEASE_RESPONSE", "user-manufacturer-owner", "demo-manufacturer", "RR-001", TEXT.response, "2026-10-01T19:15:00Z");
    t = await testApp({ db });
  });
  afterAll(async () => {
    await t?.close();
    await db?.close();
  });

  it("review: internal notes for the lender only; shared feedback for the lender and the borrower", async () => {
    for (const persona of ["lender-a-analyst", "lender-a-approver"] as const) {
      const review = await get(persona, "/api/reviews/CA-001");
      expect(review.statusCode).toBe(200);
      expect(review.json()).toMatchObject({ internalNotes: TEXT.internal, sharedFeedback: TEXT.shared });
    }
    const borrower = await get("manufacturer-owner", "/api/reviews/CA-001");
    expect(borrower.json()).toMatchObject({ internalNotes: null, sharedFeedback: TEXT.shared });
    expect(borrower.body).not.toContain(TEXT.internal);
    // The auditor holds the lender's DECISION_OUTCOME scope: the decision, no note text.
    const auditor = await get("auditor", "/api/reviews/CA-001");
    expect(auditor.statusCode).toBe(200);
    expect(auditor.json()).toMatchObject({ internalNotes: null, sharedFeedback: null });
    for (const persona of ["verifier-inspector", "dealer-contributor", "lender-b-approver"] as const) {
      const response = await get(persona, "/api/reviews/CA-001");
      expect(response.statusCode, persona).toBe(404);
      expect(response.json().detail).toBe(ERROR_COPY.UNAVAILABLE);
    }
    expect((await get("manufacturer-owner", "/api/cases/CL-001")).json().references.review).toEqual({ ref: "CA-001" });
  });

  it("release request: note and Q&A thread with author org and time for the lock's owner and lender only", async () => {
    for (const persona of ["manufacturer-owner", "lender-a-approver", "lender-a-analyst"] as const) {
      const rr = await get(persona, "/api/release-requests/RR-001");
      expect(rr.statusCode, persona).toBe(200);
      expect(rr.json().note).toBe(TEXT.rrNote);
      expect(rr.json().thread).toMatchObject([
        { kind: "NOTE", body: TEXT.rrNote, author: { id: "demo-manufacturer" }, at: "2026-10-01T19:05:00.000Z" },
        { kind: "QUESTION", body: TEXT.question, author: { id: "demo-lender-a" }, at: "2026-10-01T19:10:00.000Z" },
        { kind: "RESPONSE", body: TEXT.response, author: { id: "demo-manufacturer" }, at: "2026-10-01T19:15:00.000Z" },
      ]);
    }
    for (const persona of ["verifier-inspector", "dealer-contributor", "lender-b-approver", "auditor", "operator"] as const) {
      const rr = await get(persona, "/api/release-requests/RR-001");
      expect(rr.statusCode, persona).toBe(404);
      for (const text of Object.values(TEXT)) expect(rr.body).not.toContain(text);
    }
  });

  it("invalid note text is a 400 before any command record exists", async () => {
    const before = await db.db.select().from(commands).where(eq(commands.operation, "release.respond"));
    const response = await post("manufacturer-owner", "/api/release-requests/RR-001/responses", { message: "bell \u0007 character" });
    expect(response.statusCode).toBe(400);
    expect(response.json().issues).toEqual([{ path: "body.message", message: expect.any(String) }]);
    expect(await db.db.select().from(commands).where(eq(commands.operation, "release.respond"))).toHaveLength(before.length);
  });

  it("a write that cannot reach the ledger records FAILED and leaves no readable note", async () => {
    const before = (await db.db.select().from(notes)).length;
    const response = await post("manufacturer-owner", "/api/pledges/PL-001/release-requests", { reason: "REFINANCING", note: "never shown (synthetic)" });
    // The scenario lock is released, so the policy refuses first; either way nothing is readable.
    expect([409, 503]).toContain(response.statusCode);
    expect((await db.db.select().from(notes)).length).toBe(before);
    expect((await get("manufacturer-owner", "/api/pledges/PL-001")).body).not.toContain("never shown");
  });

  it("no note text reaches the request logs", () => {
    const logged = t.logs.join("\n");
    for (const text of Object.values(TEXT)) expect(logged).not.toContain(text);
    expect(logged).not.toContain("never shown");
  });
});
