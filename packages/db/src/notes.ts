// Private off-ledger note store (`notes` table; synthesis §1.4.2 item 5).
//
// Write side (the API): a note is created PENDING inside the command that carries it (putPendingNote, unique per
// command and kind, so a replay or a retry with the same Idempotency-Key never duplicates it) and settled from the
// command outcome (settleNotes: committed → ATTACHED, REJECTED → DISCARDED; FAILED, PREPARED, SUBMITTED and
// UNKNOWN_OUTCOME leave it PENDING because a retry with the same key may still commit it).
//
// Read side (the read model): a note is readable only while its command is COMMITTED/PROJECTED/PROJECTION_DELAYED
// (a LEDGER command also needs an update id; an APPLICATION command has none) and it is not DISCARDED. Visibility
// therefore follows the command record, not the note state: a command that the worker settles later (UNKNOWN_OUTCOME
// reconciliation) shows its note without an API round trip. Who may read it (noteReadable):
//   ASSESSMENT_INTERNAL         the authoring lender org's lender members (analyst/approver) only; never the
//                               borrower, verifier, dealer, another lender, an auditor (no audit scope covers lender
//                               internal notes; policy `lenderInternal.view` is "unsupported" for AUDITOR) or an
//                               org admin/operator.
//   ASSESSMENT_SHARED_FEEDBACK  the case's lender members and the case's borrower members.
//   RELEASE_*                   the lock's owner (borrower members) and its designated lender (lender members).
// The overlay (withNotes) copies only readable text into the reader's own CaseFacts; the domain presenters still omit
// fields by role and mandate. The text never goes on the ledger (only the note id, as an opaque ref), into logs
// (write errors are rethrown without the query parameters) or into notifications.
import { createHash } from "node:crypto";
import type { CaseFacts, ReleaseRequestFacts, ReleaseThreadEntryFacts } from "@collara/domain";
import { and, asc, eq, inArray, isNotNull, ne, or } from "drizzle-orm";
import type { DbOrTx } from "./client";
import { commands, notes, type NoteRow } from "./schema";

export const NOTE_KINDS = [
  "ASSESSMENT_INTERNAL",
  "ASSESSMENT_SHARED_FEEDBACK",
  "RELEASE_REQUEST_NOTE",
  "RELEASE_SERVICING_REF",
  "RELEASE_QUESTION",
  "RELEASE_RESPONSE",
] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
export type NoteAudience = "ORG_ONLY" | "CASE_COUNTERPARTIES";
export type NoteState = "PENDING" | "ATTACHED" | "DISCARDED";

/** Audience and maximum length per kind (the request schemas use the same limits). */
export const NOTE_RULES: Readonly<Record<NoteKind, { readonly audience: NoteAudience; readonly maxLength: number }>> = {
  ASSESSMENT_INTERNAL: { audience: "ORG_ONLY", maxLength: 4000 },
  ASSESSMENT_SHARED_FEEDBACK: { audience: "CASE_COUNTERPARTIES", maxLength: 2000 },
  RELEASE_REQUEST_NOTE: { audience: "CASE_COUNTERPARTIES", maxLength: 2000 },
  RELEASE_SERVICING_REF: { audience: "CASE_COUNTERPARTIES", maxLength: 120 },
  RELEASE_QUESTION: { audience: "CASE_COUNTERPARTIES", maxLength: 2000 },
  RELEASE_RESPONSE: { audience: "CASE_COUNTERPARTIES", maxLength: 2000 },
};

/** Command states whose notes are readable (a LEDGER command also needs an update id). */
const READABLE_COMMAND_STATES = ["COMMITTED", "PROJECTED", "PROJECTION_DELAYED"];

/** A write failure. The message never contains the note text (drizzle errors embed the query parameters). */
export class NoteStoreError extends Error {
  constructor(
    readonly reason: "INVALID_BODY" | "CONFLICT" | "WRITE_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "NoteStoreError";
  }
}

/** "sha256:<hex>" of a note body: what command payloads carry instead of the text (idempotency without a copy). */
export function noteDigest(body: string): string {
  return `sha256:${createHash("sha256").update(body, "utf8").digest("hex")}`;
}

export interface PendingNoteInput {
  readonly kind: NoteKind;
  /** The author's organization (server-side authority). */
  readonly ownerOrgId: string;
  readonly caseRef: string;
  /** CA-… for assessment notes, RR-… for release notes. */
  readonly subjectRef: string;
  /** Plain text; "" records that the author cleared the text. */
  readonly body: string;
  /** The command (record id) that carries the note. */
  readonly commandId: string;
  readonly createdByUserId: string;
}

// NUL cannot be stored in PostgreSQL text; other control characters except tab/CR/LF are not plain text.
// eslint-disable-next-line no-control-regex -- deliberately matching control characters
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** Plain text within the kind's length limit (check it before starting the command: a 400, not a failed write). */
export function isValidNoteBody(kind: NoteKind, body: string): boolean {
  return body.length <= NOTE_RULES[kind].maxLength && !CONTROL_CHARACTERS.test(body);
}

function validBody(kind: NoteKind, body: string): void {
  if (!isValidNoteBody(kind, body)) {
    throw new NoteStoreError("INVALID_BODY", `note body is not valid plain text within ${NOTE_RULES[kind].maxLength} characters`);
  }
}

async function guarded<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof NoteStoreError) throw error;
    // Drop the original error: its message and `params` would carry the note text into logs.
    const code = (error as { cause?: { code?: unknown }; code?: unknown }).cause?.code ?? (error as { code?: unknown }).code;
    throw new NoteStoreError("WRITE_FAILED", `${what} failed${typeof code === "string" ? ` (${code})` : ""}`);
  }
}

/**
 * Creates the PENDING note of (command, kind), or returns the existing one: a replay or a retry with the same
 * Idempotency-Key never duplicates it. A PENDING note follows the subject ref of the latest attempt (a retry after a
 * FAILED submission may allocate a new release request ref); a settled note is never changed.
 */
export async function putPendingNote(db: DbOrTx, input: PendingNoteInput, now: Date = new Date()): Promise<NoteRow> {
  validBody(input.kind, input.body);
  return guarded("note write", async () => {
    const [inserted] = await db
      .insert(notes)
      .values({
        kind: input.kind,
        ownerOrgId: input.ownerOrgId,
        audience: NOTE_RULES[input.kind].audience,
        caseRef: input.caseRef,
        subjectRef: input.subjectRef,
        body: input.body,
        commandId: input.commandId,
        createdByUserId: input.createdByUserId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: [notes.commandId, notes.kind] })
      .returning();
    if (inserted) return inserted;
    const [existing] = await db
      .select()
      .from(notes)
      .where(and(eq(notes.commandId, input.commandId), eq(notes.kind, input.kind)))
      .limit(1);
    if (!existing) throw new NoteStoreError("WRITE_FAILED", "note write conflicted but no existing note was found");
    // The same command carries the same text (its payload hash covers the digest); anything else is a bug.
    if (existing.body !== input.body || existing.ownerOrgId !== input.ownerOrgId || existing.createdByUserId !== input.createdByUserId) {
      throw new NoteStoreError("CONFLICT", "a different note is already recorded for this command");
    }
    if (existing.state === "PENDING" && existing.subjectRef !== input.subjectRef) {
      const [moved] = await db.update(notes).set({ subjectRef: input.subjectRef, updatedAt: now }).where(and(eq(notes.id, existing.id), eq(notes.state, "PENDING"))).returning();
      return moved ?? existing;
    }
    return existing;
  });
}

/**
 * Settles the notes of a command from its state: COMMITTED/PROJECTED/PROJECTION_DELAYED → ATTACHED, REJECTED →
 * DISCARDED (never readable). Any other state leaves them PENDING. Returns the number of notes changed.
 */
export async function settleNotes(db: DbOrTx, commandId: string, commandState: string, now: Date = new Date()): Promise<number> {
  const to: NoteState | null = READABLE_COMMAND_STATES.includes(commandState) ? "ATTACHED" : commandState === "REJECTED" ? "DISCARDED" : null;
  if (!to) return 0;
  return guarded("note settle", async () => {
    const rows = await db
      .update(notes)
      .set({ state: to, settledAt: now, updatedAt: now })
      .where(and(eq(notes.commandId, commandId), eq(notes.state, "PENDING")))
      .returning({ id: notes.id });
    return rows.length;
  });
}

/** settleNotes from the command record as stored now (after an error thrown out of the runner). */
export async function settleNotesOfCommand(db: DbOrTx, commandId: string, now: Date = new Date()): Promise<number> {
  const [row] = await db.select({ status: commands.status }).from(commands).where(eq(commands.id, commandId)).limit(1);
  return row ? settleNotes(db, commandId, row.status, now) : 0;
}

/** A note whose command committed (readable subject to noteReadable), with its effective time. */
export interface CommittedNote {
  readonly id: string;
  readonly kind: NoteKind;
  readonly ownerOrgId: string;
  readonly caseRef: string;
  readonly subjectRef: string;
  readonly body: string;
  readonly createdByUserId: string;
  readonly commandId: string;
  /** When the carrying command committed (falls back to the note's creation time). */
  readonly at: string;
}

/** Notes of the given cases whose command committed and that were not discarded, oldest first. */
export async function loadCommittedNotes(db: DbOrTx, caseRefs: readonly string[]): Promise<CommittedNote[]> {
  if (caseRefs.length === 0) return [];
  const rows = await db
    .select({ note: notes, committedAt: commands.committedAt })
    .from(notes)
    .innerJoin(commands, eq(commands.id, notes.commandId))
    .where(
      and(
        inArray(notes.caseRef, [...new Set(caseRefs)]),
        ne(notes.state, "DISCARDED"),
        inArray(commands.status, READABLE_COMMAND_STATES),
        or(eq(commands.target, "APPLICATION"), isNotNull(commands.updateId)),
      ),
    )
    .orderBy(asc(commands.committedAt), asc(notes.createdAt), asc(notes.id));
  return rows.flatMap(({ note, committedAt }) =>
    (NOTE_KINDS as readonly string[]).includes(note.kind)
      ? [
          {
            id: note.id,
            kind: note.kind as NoteKind,
            ownerOrgId: note.ownerOrgId,
            caseRef: note.caseRef,
            subjectRef: note.subjectRef,
            body: note.body,
            createdByUserId: note.createdByUserId,
            commandId: note.commandId,
            at: (committedAt ?? note.createdAt).toISOString(),
          },
        ]
      : [],
  );
}

/** Who reads: the session's organization and roles (server-side authority only). */
export interface NoteReader {
  readonly orgId: string;
  /** Omitted roles read nothing (fail closed). */
  readonly roles?: readonly string[];
}

/** The two parties of a note's subject, taken from the reader's own stakeholder-filtered facts. */
export interface NoteSubjectParties {
  /** The case's lender (assessment notes) or the lock's designated lender (release notes). */
  readonly lenderOrgId: string | null;
  /** The case's borrower (assessment notes) or the lock's owner (release notes). */
  readonly borrowerOrgId: string | null;
}

/** The read rule of one note for one reader (see the file header). Pure; the overlay and the tests use it. */
export function noteReadable(note: Pick<CommittedNote, "kind" | "ownerOrgId">, reader: NoteReader, parties: NoteSubjectParties): boolean {
  const roles = reader.roles ?? [];
  const lenderMember = roles.includes("LENDER_ANALYST") || roles.includes("LENDER_APPROVER");
  const borrowerMember = roles.includes("BORROWER");
  const asLender = parties.lenderOrgId !== null && parties.lenderOrgId !== "" && reader.orgId === parties.lenderOrgId && lenderMember;
  const asBorrower = parties.borrowerOrgId !== null && parties.borrowerOrgId !== "" && reader.orgId === parties.borrowerOrgId && borrowerMember;
  // The author must itself be one of the subject's two parties.
  if (note.ownerOrgId !== parties.lenderOrgId && note.ownerOrgId !== parties.borrowerOrgId) return false;
  switch (note.kind) {
    case "ASSESSMENT_INTERNAL":
      return asLender && note.ownerOrgId === reader.orgId;
    case "ASSESSMENT_SHARED_FEEDBACK":
      return note.ownerOrgId === parties.lenderOrgId && (asLender || asBorrower);
    case "RELEASE_REQUEST_NOTE":
    case "RELEASE_SERVICING_REF":
    case "RELEASE_QUESTION":
    case "RELEASE_RESPONSE":
      return asLender || asBorrower;
  }
}

const THREAD_KIND: Partial<Record<NoteKind, ReleaseThreadEntryFacts["kind"]>> = {
  RELEASE_REQUEST_NOTE: "NOTE",
  RELEASE_QUESTION: "QUESTION",
  RELEASE_RESPONSE: "RESPONSE",
};

const NOTICE_EVENTS = new Set(["INFORMATION_REQUESTED", "DECISION_RECORDED"]);

/** The reader's facts of one case with the readable notes applied (input facts are not modified). */
export function applyNotes(facts: CaseFacts, caseNotes: readonly CommittedNote[], reader: NoteReader): CaseFacts {
  if (caseNotes.length === 0) return facts;
  const caseParties: NoteSubjectParties = {
    lenderOrgId: facts.review.lenderOrgId || facts.selectedLenderOrgId || null,
    borrowerOrgId: facts.borrowerOrgId || null,
  };
  const review = { ...facts.review };
  const assessmentNotes = caseNotes.filter(
    (n) => (n.kind === "ASSESSMENT_INTERNAL" || n.kind === "ASSESSMENT_SHARED_FEEDBACK") && (review.ref === "" || n.subjectRef === review.ref) && noteReadable(n, reader, caseParties),
  );
  const internal = assessmentNotes.filter((n) => n.kind === "ASSESSMENT_INTERNAL").at(-1);
  if (internal) review.internalNotes = internal.body || null;
  const feedback = assessmentNotes.filter((n) => n.kind === "ASSESSMENT_SHARED_FEEDBACK").at(-1);
  if (feedback) {
    // The newest of the saved feedback and the lender's ledger notice (information request or decision) wins; a
    // notice recorded without feedback does not erase saved feedback.
    const noticeAt = Math.max(
      Number.NEGATIVE_INFINITY,
      ...facts.events
        .filter((e) => NOTICE_EVENTS.has(e.type) && (review.ref === "" || e.ref === review.ref))
        .map((e) => Date.parse(e.occurredAt))
        .filter(Number.isFinite),
    );
    if (Date.parse(feedback.at) > noticeAt || !review.sharedFeedback) review.sharedFeedback = feedback.body || null;
    // The borrower has no ledger view of the assessment before a notice: the feedback names it.
    if (review.ref === "") review.ref = feedback.subjectRef;
  }

  const lockParties: NoteSubjectParties = { lenderOrgId: facts.lock?.lenderOrgId ?? null, borrowerOrgId: facts.lock?.borrowerOrgId ?? null };
  const releaseRequests = facts.releaseRequests.map((rr): ReleaseRequestFacts => {
    const own = caseNotes.filter((n) => n.subjectRef === rr.ref && n.kind.startsWith("RELEASE_") && noteReadable(n, reader, lockParties));
    if (own.length === 0) return rr;
    const next: ReleaseRequestFacts = { ...rr };
    const note = own.filter((n) => n.kind === "RELEASE_REQUEST_NOTE").at(-1);
    if (note) next.note = note.body || null;
    const servicing = own.filter((n) => n.kind === "RELEASE_SERVICING_REF").at(-1);
    if (servicing) next.servicingRef = servicing.body || null;
    next.thread = own.flatMap((n) => {
      const kind = THREAD_KIND[n.kind];
      return kind && n.body ? [{ kind, body: n.body, authorOrgId: n.ownerOrgId, authorUserId: n.createdByUserId, at: n.at }] : [];
    });
    const question = own.filter((n) => n.kind === "RELEASE_QUESTION").at(-1);
    if (question && rr.state === "INFORMATION_REQUESTED") next.informationRequest = question.body;
    return next;
  });
  return { ...facts, review, releaseRequests };
}

/** Overlays the notes the reader may read onto its case facts (one query for all cases). */
export async function withNotes(db: DbOrTx, reader: NoteReader, cases: readonly CaseFacts[]): Promise<CaseFacts[]> {
  if (cases.length === 0 || (reader.roles ?? []).length === 0) return [...cases];
  const committed = await loadCommittedNotes(
    db,
    cases.map((c) => c.ref),
  );
  if (committed.length === 0) return [...cases];
  return cases.map((facts) => applyNotes(facts, committed.filter((n) => n.caseRef === facts.ref), reader));
}
