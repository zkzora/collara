// Evidence byte handling: magic-byte type detection and capped, hashed reads.
import { createHash } from "node:crypto";
import type { EvidenceContentType } from "@collara/domain";

/** Leading bytes per allowed type (PDF "%PDF-", PNG signature, JPEG SOI + marker). */
export const MAGIC_BYTES: Readonly<Record<EvidenceContentType, readonly number[]>> = {
  "application/pdf": [0x25, 0x50, 0x44, 0x46, 0x2d],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/jpeg": [0xff, 0xd8, 0xff],
};

export function detectContentType(bytes: Uint8Array): EvidenceContentType | null {
  for (const [type, magic] of Object.entries(MAGIC_BYTES) as [EvidenceContentType, readonly number[]][]) {
    if (bytes.length >= magic.length && magic.every((byte, i) => bytes[i] === byte)) return type;
  }
  return null;
}

export type CappedRead =
  | { readonly ok: true; readonly bytes: Buffer; readonly size: number; readonly sha256: string }
  | { readonly ok: false; readonly reason: "too_large"; readonly size: number };

/**
 * Reads a stream into memory while hashing it, stopping as soon as `maxBytes` is exceeded (the rest of the
 * stream is not consumed). Evidence files are capped at 20 MB, so buffering is bounded.
 */
export async function readCapped(source: AsyncIterable<Uint8Array>, maxBytes: number): Promise<CappedRead> {
  const hash = createHash("sha256");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of source) {
    size += chunk.byteLength;
    if (size > maxBytes) return { ok: false, reason: "too_large", size };
    const buffer = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    hash.update(buffer);
    chunks.push(buffer);
  }
  return { ok: true, bytes: Buffer.concat(chunks, size), size, sha256: hash.digest("hex") };
}

export function isAsyncIterable(value: unknown): value is AsyncIterable<Uint8Array> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

/** Copy used for upload validation errors (matches the UI_MOCK client; INFERRED, needs copy approval). */
export const EVIDENCE_ERRORS = {
  TOO_LARGE: "Files are limited to 20 MB.",
  EMPTY: "The file is empty.",
  TYPE_MISMATCH: "The file content does not match its declared type.",
  HEADER_MISMATCH: "The file type does not match the upload request.",
  NOT_UPLOADED: "Upload the file content before finalizing.",
  ALREADY_UPLOADED: "The file content for this upload was already received.",
  INTENT_EXPIRED: "This upload request has expired. Start a new upload.",
  STORAGE_UNAVAILABLE: "Document storage is unavailable. No file was stored.",
} as const;
