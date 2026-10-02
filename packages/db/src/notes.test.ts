// Private off-ledger note store (notes.ts) on PGlite: idempotency per command and kind, settle rules, command-state
// visibility (REJECTED/FAILED/pending never readable), the per-kind audience for every demo persona, the overlay
// through loadReadWorld over the projected scenario, and the presenters on top (auditors and Lender B see no text).
import { personaActor, presentPledge, presentReview, type CaseFacts, type PersonaId, type PresentContext } from "@collara/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importLocalnetState } from "./bindings";
import { createPgliteDatabase, type DbHandle } from "./client";
import { applyNotes, loadCommittedNotes, noteDigest, noteReadable, NoteStoreError, putPendingNote, settleNotes, settleNotesOfCommand, type CommittedNote, type NoteKind } from "./notes";
import { projectOnce } from "./projection";
import { loadReadWorld, type ReadViewer } from "./read-model";
import { buildScenario, scenarioBindingState, scenarioParties } from "./read-model/scenario-fixture";
import { cases, commands, notes } from "./schema";
import { seedDemoIdentities } from "./seed";

const P = scenarioParties();
const NOW = new Date("2026-10-01T20:00:00Z");
const LATER = new Date("2026-10-01T19:00:00Z");
const pctx: PresentContext = { now: NOW, mode: "LOCALNET", sync: { offset: null, at: null } };

const PERSONA_PARTIES: Record<PersonaId, string[]> = {
  "manufacturer-owner": [P.owner],
  "manufacturer-admin": [P.owner],
  "dealer-contributor": [P.dealer],
  "verifier-inspector": [P.verifier],
  "lender-a-analyst": [P.lenderA],
  "lender-a-approver": [P.lenderA, P.seat1, P.governance],
  "lender-b-approver": [P.lenderB, P.seat2, P.governance],
  auditor: [P.auditor, P.seat3, P.governance],
  operator: [P.registrar],
};
const viewerOf = (id: PersonaId): ReadViewer => {
  const a = personaActor(id);
  return { orgId: a.orgId, readableParties: PERSONA_PARTIES[id], roles: a.roles, mandates: a.mandates };
};

const TEXT = {
  internal: "Internal: maintenance log gap explained (synthetic).",
  shared: "Shared: evidence package complete for this review (synthetic).",
  rrNote: "Release note: external loan repaid on schedule (synthetic).",
  servicing: "SVC-SYNTH-001",
  question: "Question: please attach the payoff letter (synthetic).",
  response: "Response: payoff letter attached as DOC-099 (synthetic).",
  rejected: "Rejected command text that must never be shown (synthetic).",
  pending: "Pending command text that must not be shown yet (synthetic).",
};

let handle: DbHandle;
let counter = 0;

/** A command record in the given state (LEDGER: committed states get an update id). */
async function command(userId: string, orgId: string, status: string, options: { target?: "LEDGER" | "APPLICATION"; committedAt?: Date; updateId?: string | null } = {}) {
  counter += 1;
  const committed = ["COMMITTED", "PROJECTED", "PROJECTION_DELAYED"].includes(status);
  const target = options.target ?? "LEDGER";
  const [row] = await handle.db
    .insert(commands)
    .values({
      idempotencyKey: `notes-test-${counter}`,
      actorUserId: userId,
      orgId,
      operation: "notes.test",
      target,
      payloadHash: `hash-${counter}`,
      payload: {},
      ledgerCommandId: `collara-notes-test-${counter}`,
      status,
      updateId: options.updateId !== undefined ? options.updateId : committed && target === "LEDGER" ? `upd-${counter}` : null,
      committedAt: committed ? (options.committedAt ?? LATER) : null,
    })
    .returning();
  if (!row) throw new Error("command insert failed");
  return row;
}

async function note(kind: NoteKind, commandId: string, ownerOrgId: string, userId: string, subjectRef: string, body: string) {
  return putPendingNote(handle.db, { kind, ownerOrgId, caseRef: "CL-001", subjectRef, body, commandId, createdByUserId: userId }, LATER);
}

beforeAll(async () => {
  handle = await createPgliteDatabase();
  await seedDemoIdentities(handle.db);
  await importLocalnetState(handle.db, scenarioBindingState());
  const { ledger } = buildScenario("full");
  await projectOnce(handle.db, ledger, { source: "sandbox", jsonApiUrl: "http://127.0.0.1:7575", parties: Object.values(P) });
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
});

afterAll(async () => {
  await handle?.close();
});

describe("note store writes", () => {
  it("a replay of the same command and kind returns the same note (no duplicate)", async () => {
    const c = await command("user-lender-a-analyst", "demo-lender-a", "PREPARED");
    const first = await note("ASSESSMENT_INTERNAL", c.id, "demo-lender-a", "user-lender-a-analyst", "CA-001", "replay text");
    const again = await note("ASSESSMENT_INTERNAL", c.id, "demo-lender-a", "user-lender-a-analyst", "CA-001", "replay text");
    expect(again.id).toBe(first.id);
    const other = await note("ASSESSMENT_SHARED_FEEDBACK", c.id, "demo-lender-a", "user-lender-a-analyst", "CA-001", "replay feedback");
    expect(other.id).not.toBe(first.id);
    expect(await handle.db.select().from(notes).where(eq(notes.commandId, c.id))).toHaveLength(2);
    // The same command with a different text is a bug, never a second note.
    await expect(note("ASSESSMENT_INTERNAL", c.id, "demo-lender-a", "user-lender-a-analyst", "CA-001", "different text")).rejects.toMatchObject({ reason: "CONFLICT" });
  });

  it("a PENDING note follows the latest attempt's subject; a settled note never changes", async () => {
    const c = await command("user-manufacturer-owner", "demo-manufacturer", "FAILED");
    const first = await note("RELEASE_REQUEST_NOTE", c.id, "demo-manufacturer", "user-manufacturer-owner", "RR-801", "moving note");
    const retried = await note("RELEASE_REQUEST_NOTE", c.id, "demo-manufacturer", "user-manufacturer-owner", "RR-802", "moving note");
    expect(retried).toMatchObject({ id: first.id, subjectRef: "RR-802", state: "PENDING" });
    expect(await settleNotes(handle.db, c.id, "COMMITTED", LATER)).toBe(1);
    const settled = await note("RELEASE_REQUEST_NOTE", c.id, "demo-manufacturer", "user-manufacturer-owner", "RR-803", "moving note");
    expect(settled).toMatchObject({ id: first.id, subjectRef: "RR-802", state: "ATTACHED" });
  });

  it("settles from the command state: committed → ATTACHED, REJECTED → DISCARDED, anything else stays PENDING", async () => {
    const states: [string, string][] = [
      ["COMMITTED", "ATTACHED"],
      ["PROJECTED", "ATTACHED"],
      ["PROJECTION_DELAYED", "ATTACHED"],
      ["REJECTED", "DISCARDED"],
      ["FAILED", "PENDING"],
      ["UNKNOWN_OUTCOME", "PENDING"],
      ["SUBMITTED", "PENDING"],
      ["PREPARED", "PENDING"],
    ];
    for (const [status, expected] of states) {
      const c = await command("user-lender-a-approver", "demo-lender-a", status);
      const n = await note("RELEASE_QUESTION", c.id, "demo-lender-a", "user-lender-a-approver", "RR-900", `settle ${status}`);
      await settleNotesOfCommand(handle.db, c.id, LATER);
      const [row] = await handle.db.select().from(notes).where(eq(notes.id, n.id));
      expect(row?.state, status).toBe(expected);
    }
  });

  it("refuses non-plain or over-long text, and write errors never carry the text", async () => {
    const c = await command("user-lender-a-analyst", "demo-lender-a", "PREPARED");
    await expect(note("ASSESSMENT_INTERNAL", c.id, "demo-lender-a", "user-lender-a-analyst", "CA-001", "bell \u0007 character")).rejects.toMatchObject({ reason: "INVALID_BODY" });
    await expect(note("RELEASE_SERVICING_REF", c.id, "demo-lender-a", "user-lender-a-analyst", "RR-001", "x".repeat(121))).rejects.toMatchObject({ reason: "INVALID_BODY" });
    // Unknown command id: the foreign key fails; the error is sanitized (drizzle would embed the parameters).
    const secret = "secret text that must not reach a log (synthetic)";
    const error = await note("ASSESSMENT_INTERNAL", "00000000-0000-4000-8000-000000000000", "demo-lender-a", "user-lender-a-analyst", "CA-001", secret).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NoteStoreError);
    expect((error as NoteStoreError).reason).toBe("WRITE_FAILED");
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(String((error as Error).message)).not.toContain(secret);
    expect((error as Error).stack ?? "").not.toContain(secret);
  });

  it("digests note text for command payloads", () => {
    expect(noteDigest("a")).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(noteDigest("a")).not.toBe(noteDigest("b"));
  });
});

describe("note visibility", () => {
  beforeAll(async () => {
    const analyst = await command("user-lender-a-analyst", "demo-lender-a", "PROJECTED");
    await note("ASSESSMENT_INTERNAL", analyst.id, "demo-lender-a", "user-lender-a-analyst", "CA-001", TEXT.internal);
    await note("ASSESSMENT_SHARED_FEEDBACK", analyst.id, "demo-lender-a", "user-lender-a-analyst", "CA-001", TEXT.shared);
    await settleNotes(handle.db, analyst.id, "COMMITTED", LATER);

    const request = await command("user-manufacturer-owner", "demo-manufacturer", "COMMITTED", { committedAt: new Date("2026-10-01T19:10:00Z") });
    await note("RELEASE_REQUEST_NOTE", request.id, "demo-manufacturer", "user-manufacturer-owner", "RR-001", TEXT.rrNote);
    await note("RELEASE_SERVICING_REF", request.id, "demo-manufacturer", "user-manufacturer-owner", "RR-001", TEXT.servicing);
    const question = await command("user-lender-a-approver", "demo-lender-a", "COMMITTED", { committedAt: new Date("2026-10-01T19:20:00Z") });
    await note("RELEASE_QUESTION", question.id, "demo-lender-a", "user-lender-a-approver", "RR-001", TEXT.question);
    const response = await command("user-manufacturer-owner", "demo-manufacturer", "PROJECTION_DELAYED", { committedAt: new Date("2026-10-01T19:30:00Z") });
    await note("RELEASE_RESPONSE", response.id, "demo-manufacturer", "user-manufacturer-owner", "RR-001", TEXT.response);

    // Never readable: a rejected command, a pending one, a committed LEDGER command without an update id.
    const rejected = await command("user-lender-a-analyst", "demo-lender-a", "REJECTED");
    await note("ASSESSMENT_INTERNAL", rejected.id, "demo-lender-a", "user-lender-a-analyst", "CA-001", TEXT.rejected);
    await settleNotes(handle.db, rejected.id, "REJECTED", LATER);
    for (const status of ["SUBMITTED", "UNKNOWN_OUTCOME", "FAILED", "PREPARED"]) {
      const c = await command("user-lender-a-analyst", "demo-lender-a", status);
      await note("ASSESSMENT_SHARED_FEEDBACK", c.id, "demo-lender-a", "user-lender-a-analyst", "CA-001", `${TEXT.pending} ${status}`);
    }
    const noUpdate = await command("user-lender-a-analyst", "demo-lender-a", "COMMITTED", { updateId: null });
    await note("ASSESSMENT_SHARED_FEEDBACK", noUpdate.id, "demo-lender-a", "user-lender-a-analyst", "CA-001", `${TEXT.pending} no update id`);
  });

  it("loads only notes of committed commands (a rejected or pending command never shows its text)", async () => {
    const committed = await loadCommittedNotes(handle.db, ["CL-001"]);
    const bodies = committed.map((n) => n.body);
    expect(bodies).toEqual(expect.arrayContaining([TEXT.internal, TEXT.shared, TEXT.rrNote, TEXT.servicing, TEXT.question, TEXT.response]));
    expect(bodies.some((b) => b.startsWith(TEXT.pending) || b === TEXT.rejected)).toBe(false);
  });

  it("an APPLICATION command (no ledger) shows its note once COMMITTED", async () => {
    const app = await command("user-lender-a-analyst", "demo-lender-a", "COMMITTED", { target: "APPLICATION" });
    const n = await putPendingNote(handle.db, { kind: "ASSESSMENT_INTERNAL", ownerOrgId: "demo-lender-a", caseRef: "CL-APP", subjectRef: "CA-APP", body: "application note", commandId: app.id, createdByUserId: "user-lender-a-analyst" });
    expect((await loadCommittedNotes(handle.db, ["CL-APP"])).map((x) => x.id)).toEqual([n.id]);
  });

  it("per-kind audience for every persona (pure rule)", () => {
    const caseParties = { lenderOrgId: "demo-lender-a", borrowerOrgId: "demo-manufacturer" };
    const reader = (id: PersonaId) => ({ orgId: personaActor(id).orgId, roles: personaActor(id).roles });
    const all: PersonaId[] = ["manufacturer-owner", "manufacturer-admin", "dealer-contributor", "verifier-inspector", "lender-a-analyst", "lender-a-approver", "lender-b-approver", "auditor", "operator"];
    const who = (kind: NoteKind, ownerOrgId: string) => all.filter((id) => noteReadable({ kind, ownerOrgId }, reader(id), caseParties));
    expect(who("ASSESSMENT_INTERNAL", "demo-lender-a")).toEqual(["lender-a-analyst", "lender-a-approver"]);
    expect(who("ASSESSMENT_SHARED_FEEDBACK", "demo-lender-a")).toEqual(["manufacturer-owner", "lender-a-analyst", "lender-a-approver"]);
    for (const kind of ["RELEASE_REQUEST_NOTE", "RELEASE_SERVICING_REF", "RELEASE_QUESTION", "RELEASE_RESPONSE"] as const) {
      expect(who(kind, "demo-manufacturer"), kind).toEqual(["manufacturer-owner", "lender-a-analyst", "lender-a-approver"]);
    }
    // Authored by an organization that is not a party of the subject: nobody.
    expect(who("ASSESSMENT_SHARED_FEEDBACK", "demo-lender-b")).toEqual([]);
    expect(who("RELEASE_REQUEST_NOTE", "demo-lender-b")).toEqual([]);
    // Shared feedback must come from the lender, not the borrower.
    expect(who("ASSESSMENT_SHARED_FEEDBACK", "demo-manufacturer")).toEqual([]);
    // Roles omitted: nothing (fail closed).
    expect(noteReadable({ kind: "RELEASE_REQUEST_NOTE", ownerOrgId: "demo-manufacturer" }, { orgId: "demo-manufacturer" }, caseParties)).toBe(false);
  });

  const factsOf = async (id: PersonaId): Promise<CaseFacts | null> => (await loadReadWorld(handle.db, viewerOf(id), { now: NOW })).cases.find((c) => c.ref === "CL-001") ?? null;

  it("the selected lender reads internal notes, shared feedback and the release thread", async () => {
    for (const id of ["lender-a-analyst", "lender-a-approver"] as const) {
      const facts = await factsOf(id);
      expect(facts?.review).toMatchObject({ ref: "CA-001", internalNotes: TEXT.internal, sharedFeedback: TEXT.shared });
      const rr = facts?.releaseRequests.find((r) => r.ref === "RR-001");
      expect(rr).toMatchObject({ note: TEXT.rrNote, servicingRef: TEXT.servicing });
      expect(rr?.thread?.map((e) => [e.kind, e.body, e.authorOrgId])).toEqual([
        ["NOTE", TEXT.rrNote, "demo-manufacturer"],
        ["QUESTION", TEXT.question, "demo-lender-a"],
        ["RESPONSE", TEXT.response, "demo-manufacturer"],
      ]);
      const review = presentReview(facts!, personaActor(id), pctx);
      expect(review).toMatchObject({ internalNotes: TEXT.internal, sharedFeedback: TEXT.shared });
      const pledge = presentPledge(facts!, personaActor(id), pctx);
      expect(pledge?.releaseRequests.find((r) => r.ref === "RR-001")?.thread.map((e) => e.body)).toEqual([TEXT.rrNote, TEXT.question, TEXT.response]);
    }
  });

  it("the borrower reads shared feedback and the release thread, never internal notes", async () => {
    const facts = await factsOf("manufacturer-owner");
    expect(facts?.review.internalNotes).toBeNull();
    expect(facts?.review.sharedFeedback).toBe(TEXT.shared);
    const review = presentReview(facts!, personaActor("manufacturer-owner"), pctx);
    expect(review).toMatchObject({ internalNotes: null, sharedFeedback: TEXT.shared });
    expect(JSON.stringify(review)).not.toContain(TEXT.internal);
    const pledge = presentPledge(facts!, personaActor("manufacturer-owner"), pctx);
    expect(pledge?.releaseRequests.find((r) => r.ref === "RR-001")).toMatchObject({ note: TEXT.rrNote, servicingRef: TEXT.servicing });
  });

  it("dealer, verifier, Lender B, the auditor, the org admin and the operator read no note text", async () => {
    for (const id of ["dealer-contributor", "verifier-inspector", "lender-b-approver", "auditor", "manufacturer-admin", "operator"] as const) {
      const world = await loadReadWorld(handle.db, viewerOf(id), { now: NOW });
      const serialized = JSON.stringify(world.cases);
      for (const text of Object.values(TEXT)) expect(serialized, `${id}: ${text}`).not.toContain(text);
      for (const facts of world.cases) {
        const actor = personaActor(id);
        const presented = JSON.stringify([presentReview(facts, actor, pctx), presentPledge(facts, actor, pctx)]);
        for (const text of Object.values(TEXT)) expect(presented, `${id} presented: ${text}`).not.toContain(text);
      }
    }
  });

  it("presenters omit notes for an auditor with release and decision scopes even when the facts carry them (UI_MOCK facts are global)", async () => {
    const lenderFacts = await factsOf("lender-a-approver");
    const grant = (ref: string, grantorOrgId: string, grantorSide: "OWNER" | "LENDER") => ({
      ref,
      grantorOrgId,
      grantorSide,
      grantedByUserId: "",
      auditorOrgId: "demo-auditor",
      scopes: ["DECISION_OUTCOME" as const, "PLEDGE_RELEASE_EVENTS" as const],
      permission: "VIEW" as const,
      purpose: "Synthetic audit",
      createdAt: "2026-10-01T12:00:00Z",
      expiresAt: "2026-11-01T12:00:00Z",
      revokedAt: null,
    });
    const facts: CaseFacts = { ...lenderFacts!, auditGrants: [grant("AG-901", "demo-manufacturer", "OWNER"), grant("AG-902", "demo-lender-a", "LENDER")] };
    const pledge = presentPledge(facts, personaActor("auditor"), pctx);
    expect(pledge?.releaseRequests.length).toBeGreaterThan(0);
    for (const rr of pledge?.releaseRequests ?? []) expect(rr).toMatchObject({ note: null, servicingRef: null, informationRequest: null, thread: [] });
    const review = presentReview(facts, personaActor("auditor"), pctx);
    expect(review).toMatchObject({ internalNotes: null, sharedFeedback: null });
  });
});

describe("applyNotes precedence", () => {
  const base = (): CaseFacts => {
    const facts = { ref: "CL-001", borrowerOrgId: "demo-manufacturer", selectedLenderOrgId: "demo-lender-a", events: [], releaseRequests: [], lock: null } as unknown as CaseFacts;
    // Only the fields applyNotes reads (the cast above keeps the fixture small).
    facts.review = { ref: "", lenderOrgId: "demo-lender-a", internalNotes: null, sharedFeedback: null } as unknown as CaseFacts["review"];
    return facts;
  };
  const feedback = (at: string, body: string): CommittedNote => ({
    id: `n-${at}`,
    kind: "ASSESSMENT_SHARED_FEEDBACK",
    ownerOrgId: "demo-lender-a",
    caseRef: "CL-001",
    subjectRef: "CA-001",
    body,
    createdByUserId: "user-lender-a-analyst",
    commandId: "c",
    at,
  });
  const borrower = { orgId: "demo-manufacturer", roles: ["BORROWER"] };

  it("names the assessment for a borrower without a notice; an empty body clears the feedback", () => {
    expect(applyNotes(base(), [feedback("2026-10-01T10:00:00Z", "first")], borrower).review).toMatchObject({ ref: "CA-001", sharedFeedback: "first" });
    expect(applyNotes(base(), [feedback("2026-10-01T10:00:00Z", "first"), feedback("2026-10-01T11:00:00Z", "")], borrower).review.sharedFeedback).toBeNull();
  });

  it("a newer ledger notice wins over older saved feedback, and the other way round", () => {
    const withNotice = (at: string) => {
      const facts = base();
      facts.review.ref = "CA-001";
      facts.review.sharedFeedback = "notice text";
      facts.events = [{ type: "DECISION_RECORDED", ref: "CA-001", occurredAt: at } as unknown as CaseFacts["events"][number]];
      return facts;
    };
    expect(applyNotes(withNotice("2026-10-01T12:00:00Z"), [feedback("2026-10-01T10:00:00Z", "saved")], borrower).review.sharedFeedback).toBe("notice text");
    expect(applyNotes(withNotice("2026-10-01T09:00:00Z"), [feedback("2026-10-01T10:00:00Z", "saved")], borrower).review.sharedFeedback).toBe("saved");
    // A newer notice recorded without feedback keeps the saved feedback.
    const silent = withNotice("2026-10-01T12:00:00Z");
    silent.review.sharedFeedback = null;
    expect(applyNotes(silent, [feedback("2026-10-01T10:00:00Z", "saved")], borrower).review.sharedFeedback).toBe("saved");
  });
});
