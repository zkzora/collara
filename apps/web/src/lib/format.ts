// Display helpers for timestamps. Every timestamp in the workspace is shown in UTC so a demo reads
// the same on every machine (the prototype prints "2026-10-01 14:32:05 UTC" style values).
import { formatDistanceStrict } from "date-fns";

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "2026-10-01" */
export function formatUtcDate(iso: string | null | undefined): string {
  return parse(iso)?.toISOString().slice(0, 10) ?? "—";
}

/** "14:32:05 UTC" */
export function formatUtcTime(iso: string | null | undefined): string {
  const date = parse(iso);
  return date ? `${date.toISOString().slice(11, 19)} UTC` : "—";
}

/** "2026-10-01 14:32 UTC" */
export function formatUtcDateTime(iso: string | null | undefined): string {
  const date = parse(iso);
  return date ? `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)} UTC` : "—";
}

/** "2 hours ago" relative to `now` (defaults to the current time). */
export function formatRelative(iso: string | null | undefined, now: Date = new Date()): string {
  const date = parse(iso);
  if (!date) return "—";
  if (Math.abs(now.getTime() - date.getTime()) < 45_000) return "just now";
  return formatDistanceStrict(date, now, { addSuffix: true });
}

/** "7c1d…40ab" for long hashes and update ids. */
export function shortId(value: string, head = 4, tail = 4): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** "MH" from "Morgan Hale"; "DL" from "Demo Lender A". */
export function initials(name: string): string {
  const words = name.split(/\s+/).filter((word) => /^[A-Za-z]/.test(word));
  return (words.length >= 2 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : name.slice(0, 2)).toUpperCase();
}

/**
 * "CNC machining center · DEMO-CNC-500": joins the parts that have a value, so a field the viewer may not see (or
 * that is not recorded) never leaves a stray separator such as "· ·" or ", ".
 */
export function joinParts(parts: readonly (string | null | undefined | false)[], separator = " · "): string {
  return parts
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join(separator);
}

/** "CNC machining center · " before a following element, or nothing when the text is empty. */
export function withSeparator(text: string, separator = " · "): string {
  return text ? `${text}${separator}` : "";
}
