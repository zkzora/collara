// LocalNet (LOCALNET_IT=1): private off-ledger notes on the real sandbox, from the main seed of a fresh
// "notes-<unique>" prefix.
//   review: the analyst saves the assessment with internal notes + shared feedback → a new session reads them back;
//           the borrower reads the shared feedback only; verifier, dealer, Lender B and the auditor read neither;
//           a replay with the same key does not duplicate notes; no note text is on the ledger.
//   release: request note + servicing reference → lender question → borrower response round-trip with real text for
//           the lock's owner and lender only; the ledger noteRef equals the stored note id at every step; a command the
//           ledger REJECTS discards its note (never readable).
import { notes, putPendingNote, settleNotes } from "@collara/db";
import { COMMAND_COPY, ERROR_COPY, type PersonaId } from "@collara/domain";
import { and, eq } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ledgerCommands as L } from "../../src/ledger";
import { CASE, PRINCIPAL } from "./financing-fixture";
import { LOCALNET_IT_ENABLED, startLocalnetHarness, type ItSession, type LocalnetHarness } from "./harness";

const TEXT = {
  internal: "IT internal note: maintenance log gap explained by the dealer (synthetic).",
  shared: "IT shared feedback: the evidence package is complete for this review (synthetic).",
  rrNote: "IT release note: the external loan was repaid on schedule (synthetic).",
  servicing: "SVC-SYNTH-IT-001",
  question: "IT lender question: please confirm the payoff date (synthetic).",
  response: "IT borrower response: paid off on the agreed date (synthetic).",
  rejected: "IT rejected question that must never be shown (synthetic).",
};
const OUTSIDERS: readonly PersonaId[] = ["verifier-inspector", "dealer-contributor", "lender-b-approver", "auditor"];

function committed(response: LightMyRequestResponse, label: string) {
  expect(response.statusCode, `${label}: ${response.body}`).toBe(200);
  const body = response.json();
  expect(body.command, label).toMatchObject({ state: "COMMITTED", message: COMMAND_COPY.COMMITTED });
  return body;
}

describe.skipIf(!LOCALNET_IT_ENABLED)("LocalNet private notes (review and release)", () => {
  let h: LocalnetHarness;
  const sessions = new Map<PersonaId, ItSession>();
  const as = async (persona: PersonaId) => {
    let s = sessions.get(persona);
    if (!s) {
      s = await h.loginAs(persona);
      sessions.set(persona, s);
    }
    return s;
  };
  const facts: Record<string, unknown> = {};
  const step = async (persona: PersonaId, path: string, body: unknown, label: string, idempotencyKey?: string) => {
    const json = committed(await (await as(persona)).inject("POST", path, { body, ...(idempotencyKey ? { idempotencyKey } : {}) }), label);
    await h.project();
    return json;
  };
  const noteRows = (kind: string) => h.db.db.select().from(notes).where(eq(notes.kind, kind));
  /** Everything an outsider can read about the case: none of it may contain note text. */
  const outsiderReads = async (persona: PersonaId) => {
    const s = await as(persona);
    const paths = ["/api/cases", "/api/reviews", "/api/pledges", `/api/cases/${CASE}`, `/api/audit/events?caseId=${CASE}`, "/api/reviews/CA-001", "/api/release-requests/RR-001", "/api/pledges/PL-001"];
    return Promise.all(paths.map(async (path) => ({ path, response: await s.inject("GET", path) })));
  };

  beforeAll(async () => {
    h = await startLocalnetHarness({ prefixBase: "notes" });
    const started = Date.now();
    await h.seed("main", { skipDocuments: true });
    await h.project();
    facts.prefix = h.prefix;
    facts.seedMs = Date.now() - started;
  });
  afterAll(async () => {
    console.log(`LocalNet notes facts: ${JSON.stringify(facts, null, 2)}`);
    await h?.close();
  });

  it("review: the analyst's notes are persisted and read back in a new session; audiences are enforced", async () => {
    const body = {
      valuation: { amount: "150000.00", currency: "USD" },
      valuationSource: "Synthetic desk valuation (demo)",
      valuationDate: new Date().toISOString().slice(0, 10),
      limitations: "",
      internalNotes: TEXT.internal,
      sharedFeedback: TEXT.shared,
      outcome: "ELIGIBLE",
      policyRef: "CP-2026-CNC-01",
    };
    const saved = await step("lender-a-analyst", `/api/cases/${CASE}/assessments`, body, "save with notes", "notes-it-save-1");
    // The response already carries the read-back.
    expect(saved.result).toMatchObject({ ref: "CA-001", internalNotes: TEXT.internal, sharedFeedback: TEXT.shared });
    const [internal] = await noteRows("ASSESSMENT_INTERNAL");
    const [shared] = await noteRows("ASSESSMENT_SHARED_FEEDBACK");
    expect(internal).toMatchObject({ state: "ATTACHED", ownerOrgId: "demo-lender-a", audience: "ORG_ONLY", subjectRef: "CA-001", body: TEXT.internal });
    expect(shared).toMatchObject({ state: "ATTACHED", audience: "CASE_COUNTERPARTIES", body: TEXT.shared });
    const record = await h.command(internal!.commandId);
    expect(record).toMatchObject({ operation: "review.saveAssessment", status: "PROJECTED" });
    // The command record keeps digests, never the text.
    expect(JSON.stringify(record?.payload)).not.toContain(TEXT.internal);
    expect(JSON.stringify(record?.payload)).toContain("sha256:");

    // Replay with the same key: same outcome, no second note.
    const replay = await (await as("lender-a-analyst")).inject("POST", `/api/cases/${CASE}/assessments`, { body, idempotencyKey: "notes-it-save-1" });
    expect(replay.statusCode).toBe(200);
    expect(await noteRows("ASSESSMENT_INTERNAL")).toHaveLength(1);
    expect(await noteRows("ASSESSMENT_SHARED_FEEDBACK")).toHaveLength(1);

    // A new session (log in again) reads the notes back.
    const fresh = await h.loginAs("lender-a-analyst");
    expect((await fresh.inject("GET", "/api/reviews/CA-001")).json()).toMatchObject({ internalNotes: TEXT.internal, sharedFeedback: TEXT.shared });
    expect((await (await as("lender-a-approver")).inject("GET", "/api/reviews/CA-001")).json()).toMatchObject({ internalNotes: TEXT.internal, sharedFeedback: TEXT.shared });

    // The borrower: shared feedback (the case names the review), never the internal notes.
    const borrower = await as("manufacturer-owner");
    expect((await borrower.inject("GET", `/api/cases/${CASE}`)).json().references.review).toEqual({ ref: "CA-001" });
    const borrowerReview = await borrower.inject("GET", "/api/reviews/CA-001");
    expect(borrowerReview.statusCode).toBe(200);
    expect(borrowerReview.json()).toMatchObject({ internalNotes: null, sharedFeedback: TEXT.shared });
    expect(borrowerReview.body).not.toContain(TEXT.internal);

    for (const persona of OUTSIDERS) {
      for (const { path, response } of await outsiderReads(persona)) {
        expect(response.body, `${persona} ${path}`).not.toContain(TEXT.internal);
        expect(response.body, `${persona} ${path}`).not.toContain(TEXT.shared);
      }
      const review = await (await as(persona)).inject("GET", "/api/reviews/CA-001");
      expect(review.statusCode, persona).toBe(404);
      expect(review.json().detail).toBe(ERROR_COPY.UNAVAILABLE);
    }

    // No note text on the ledger (the assessment carries valuation and policy only).
    const ledger = JSON.stringify(await h.acsAs("lenderA", "CollateralAssessment", (a) => a.caseRef === CASE));
    expect(ledger).not.toContain(TEXT.internal);
    expect(ledger).not.toContain(TEXT.shared);
    facts.review = { internalNoteId: internal!.id, sharedNoteId: shared!.id, commandId: record?.id };
  });

  it("decision without feedback keeps the saved feedback; then proposal → activation", async () => {
    await step("lender-a-approver", "/api/reviews/CA-001/decision", { outcome: "ELIGIBLE" }, "decide eligible");
    expect((await (await as("manufacturer-owner")).inject("GET", "/api/reviews/CA-001")).json()).toMatchObject({ state: { value: "ELIGIBLE" }, sharedFeedback: TEXT.shared, internalNotes: null });
    expect((await (await as("lender-a-analyst")).inject("GET", "/api/reviews/CA-001")).json()).toMatchObject({ internalNotes: TEXT.internal });
    await step("lender-a-approver", `/api/cases/${CASE}/proposals`, { intent: "ISSUE", principal: PRINCIPAL }, "issue FP-001");
    await step("manufacturer-owner", "/api/proposals/FP-001/acceptance", { expectedVersion: 1 }, "accept FP-001");
    await step("manufacturer-owner", "/api/proposals/FP-001/activation-authorization", { expectedVersion: 1 }, "authorize activation");
    const activated = await step("lender-a-approver", `/api/cases/${CASE}/pledge-activation`, {}, "activate");
    expect(activated.result).toEqual({ pledgeRef: "PL-001" });
  });

  it("release: note, question and response round-trip for the lock's owner and lender; the ledger carries note ids only", async () => {
    const rrOnLedger = async () => (await h.acsAs("lenderA", "ReleaseRequest", (r) => r.lockRef === "PL-001" && r.namespace === h.namespace))[0];

    const requested = await step("manufacturer-owner", "/api/pledges/PL-001/release-requests", { reason: "EXTERNAL_LOAN_COMPLETION", note: TEXT.rrNote, servicingRef: TEXT.servicing }, "request release");
    expect(requested.result).toEqual({ releaseRequestRef: "RR-001" });
    const [rrNote] = await noteRows("RELEASE_REQUEST_NOTE");
    const [servicing] = await noteRows("RELEASE_SERVICING_REF");
    expect(rrNote).toMatchObject({ state: "ATTACHED", ownerOrgId: "demo-manufacturer", subjectRef: "RR-001", body: TEXT.rrNote });
    expect(servicing).toMatchObject({ state: "ATTACHED", subjectRef: "RR-001", body: TEXT.servicing });
    const v1 = await rrOnLedger();
    expect(v1?.payload.noteRef).toBe(rrNote!.id);
    const v1Cid = v1!.contractId;

    await step("lender-a-approver", "/api/release-requests/RR-001/information-requests", { message: TEXT.question }, "ask", "notes-it-question-1");
    const [question] = await noteRows("RELEASE_QUESTION");
    expect(question).toMatchObject({ state: "ATTACHED", ownerOrgId: "demo-lender-a", body: TEXT.question });
    expect(await rrOnLedger()).toMatchObject({ payload: { status: "INFORMATION_REQUESTED", noteRef: question!.id } });
    // Replay with the same key: no second question.
    expect((await (await as("lender-a-approver")).inject("POST", "/api/release-requests/RR-001/information-requests", { body: { message: TEXT.question }, idempotencyKey: "notes-it-question-1" })).statusCode).toBe(200);
    expect(await noteRows("RELEASE_QUESTION")).toHaveLength(1);
    // The borrower reads the open question.
    expect((await (await as("manufacturer-owner")).inject("GET", "/api/release-requests/RR-001")).json()).toMatchObject({ state: { value: "INFORMATION_REQUESTED" }, informationRequest: TEXT.question });

    await step("manufacturer-owner", "/api/release-requests/RR-001/responses", { message: TEXT.response }, "respond");
    const [response] = await noteRows("RELEASE_RESPONSE");
    expect(response).toMatchObject({ state: "ATTACHED", ownerOrgId: "demo-manufacturer", body: TEXT.response });
    const v3 = await rrOnLedger();
    expect(v3).toMatchObject({ payload: { status: "REQUESTED", noteRef: response!.id } });
    // No note text on the ledger, at any version visible to either party.
    for (const role of ["lenderA", "borrower"] as const) {
      const ledger = JSON.stringify(await h.acsAs(role, "ReleaseRequest", (r) => r.lockRef === "PL-001"));
      for (const text of [TEXT.rrNote, TEXT.servicing, TEXT.question, TEXT.response]) expect(ledger).not.toContain(text);
    }

    // A command the ledger rejects (exercise on the archived first version): its note is discarded, never readable.
    const approver = await h.actor("lender-a-approver");
    const rejected = await h.workflow.run({
      actor: approver,
      operation: "notes-it.rejected-question",
      idempotencyKey: `notes-it-rejected-${h.prefix}`,
      payload: { releaseRequestRef: "RR-001" },
      resourceRef: "RR-001",
      prepare: async (ctx) => {
        const n = await putPendingNote(h.db.db, { kind: "RELEASE_QUESTION", ownerOrgId: approver.orgId, caseRef: CASE, subjectRef: "RR-001", body: TEXT.rejected, commandId: ctx.record.id, createdByUserId: approver.userId });
        return { commands: [L.releaseRequestInformation(v1Cid, { questionRef: n.id, actorRef: ctx.actorRef })] };
      },
    });
    expect(rejected.record.status).toBe("REJECTED");
    await settleNotes(h.db.db, rejected.record.id, rejected.record.status);
    const [discarded] = await h.db.db.select().from(notes).where(and(eq(notes.kind, "RELEASE_QUESTION"), eq(notes.body, TEXT.rejected)));
    expect(discarded?.state).toBe("DISCARDED");
    await h.project();

    const thread = [
      { kind: "NOTE", body: TEXT.rrNote, author: { id: "demo-manufacturer" } },
      { kind: "QUESTION", body: TEXT.question, author: { id: "demo-lender-a" } },
      { kind: "RESPONSE", body: TEXT.response, author: { id: "demo-manufacturer" } },
    ];
    for (const persona of ["manufacturer-owner", "lender-a-approver", "lender-a-analyst"] as const) {
      const rr = await (await as(persona)).inject("GET", "/api/release-requests/RR-001");
      expect(rr.statusCode, persona).toBe(200);
      expect(rr.json(), persona).toMatchObject({ note: TEXT.rrNote, servicingRef: TEXT.servicing, state: { value: "REQUESTED" }, thread });
      for (const entry of rr.json().thread as { at: string }[]) expect(Number.isNaN(Date.parse(entry.at))).toBe(false);
      expect(rr.body).not.toContain(TEXT.rejected);
      const pledge = await (await as(persona)).inject("GET", "/api/pledges/PL-001");
      expect(pledge.json().releaseRequests[0], persona).toMatchObject({ ref: "RR-001", thread });
    }
    for (const persona of OUTSIDERS) {
      for (const { path, response } of await outsiderReads(persona)) {
        for (const text of Object.values(TEXT)) expect(response.body, `${persona} ${path}`).not.toContain(text);
      }
      expect((await (await as(persona)).inject("GET", "/api/release-requests/RR-001")).statusCode, persona).toBe(404);
    }
    facts.release = { noteRef: rrNote!.id, questionRef: question!.id, responseNoteRef: response!.id, rejectedCommand: rejected.record.id };
  });
});
