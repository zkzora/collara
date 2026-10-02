// Request-time checks of private note text (packages/db notes.ts), shared by the review and release workflows.
import { isValidNoteBody, type NoteKind } from "@collara/db";
import { NOTE_COPY } from "@collara/domain";
import { problems } from "../../errors";

/** 400 before any command record exists when a note is not plain text within its kind's limit. */
export function assertNoteText(fields: readonly (readonly [NoteKind, string | undefined, string])[]): void {
  const issues = fields
    .filter(([kind, body]) => body !== undefined && !isValidNoteBody(kind, body))
    .map(([, , path]) => ({ path, message: NOTE_COPY.PLAIN_TEXT_ONLY }));
  if (issues.length > 0) throw problems.validation(issues);
}
