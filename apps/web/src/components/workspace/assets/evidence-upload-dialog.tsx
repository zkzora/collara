"use client";

import {
  BOUNDARY_COPY,
  DOCUMENT_TYPE_LABELS,
  DOCUMENT_TYPES,
  EVIDENCE_CONTENT_TYPES,
  EVIDENCE_MAX_BYTES,
  type DocumentType,
  type EvidenceContentType,
  type EvidenceDocument,
  type Me,
} from "@collara/domain";
import { randomId } from "@collara/api-client";
import { useState } from "react";
import { useCollara } from "@/lib/collara-client";
import { TrackedActionDialog as ActionDialog } from "../audit/page-command";
import { actingParty } from "../case/case-context";
import { Field, SelectInput, TextInput } from "../form-fields";

interface UploadPayload {
  readonly type: DocumentType;
  readonly title: string;
  readonly file: File;
  readonly contentType: EvidenceContentType;
  readonly replacesDocumentId?: string;
  /** Makes the intent fingerprint differ per file (a File serializes to {}), so a new file is a new intent. */
  readonly fileSignature: string;
}

const isContentType = (value: string): value is EvidenceContentType => (EVIDENCE_CONTENT_TYPES as readonly string[]).includes(value);

/**
 * Add evidence (S §9.6–9.7): upload intent → bytes into quarantine → server-side finalize (hash,
 * type and size checks, version). Each step has its own idempotency key derived from the intent key,
 * so a retry resumes instead of creating a second document. Nothing is virus-scanned in this demo.
 * From a case (`caseId`), the document is recorded for that case: the invited dealer contributes there.
 */
export function EvidenceUploadDialog({
  assetRef,
  caseId,
  me,
  documents,
  size,
}: {
  assetRef: string;
  caseId?: string;
  me: Me;
  documents: readonly EvidenceDocument[];
  size?: "default" | "sm" | "lg";
}) {
  const { client } = useCollara();
  const [type, setType] = useState<DocumentType>("EQUIPMENT_PHOTOS");
  const [title, setTitle] = useState("");
  const [replaces, setReplaces] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<{ title?: string; file?: string }>({});
  const replaceable = documents.filter((doc) => doc.source.id === me.org.id);

  function prepare(): UploadPayload | null {
    const next: typeof errors = {};
    const replaced = replaceable.find((doc) => doc.id === replaces);
    const name = replaced ? replaced.title : title.trim();
    if (!name) next.title = "Enter a document title.";
    if (!file) next.file = "Choose a PDF, JPEG or PNG file.";
    else if (!isContentType(file.type)) next.file = "Only PDF, JPEG and PNG files are accepted.";
    else if (file.size > EVIDENCE_MAX_BYTES) next.file = "Files are limited to 20 MB.";
    else if (file.size === 0) next.file = "The file is empty.";
    setErrors(next);
    if (Object.keys(next).length > 0 || !file || !isContentType(file.type)) return null;
    return {
      type: replaced?.type ?? type,
      title: name,
      file,
      contentType: file.type,
      replacesDocumentId: replaced?.id,
      fileSignature: `${file.name}:${file.size}:${file.lastModified}`,
    };
  }

  return (
    <ActionDialog
      label="Add evidence"
      variant="primary"
      size={size}
      title={`Add evidence · ${caseId ?? assetRef}`}
      description={`Uploads a document to the ${assetRef} passport${caseId ? ` for case ${caseId}` : ""} as a ${me.org.name} record. The server hashes the bytes (SHA-256), checks type and size, and assigns the version. Sharing with lenders or verifiers is a separate step.`}
      facts={{ actingParty: actingParty(me), record: `${caseId ? `${caseId} · ` : ""}${assetRef} · evidence`, effect: "Upload → pending validation → available" }}
      caveat={`${BOUNDARY_COPY.NOT_SCANNED} PDF, JPEG or PNG, up to 20 MB per file. Do not upload real financial documents.`}
      confirmLabel="Upload document"
      onOpen={() => {
        setType("EQUIPMENT_PHOTOS");
        setTitle("");
        setReplaces("");
        setFile(null);
        setErrors({});
      }}
      prepare={prepare}
      perform={async (payload, { idempotencyKey, signal }) => {
        const key = idempotencyKey ?? randomId();
        const intent = await client.evidence.createUploadIntent(
          {
            assetRef,
            caseId,
            type: payload.type,
            title: payload.title,
            fileName: payload.file.name,
            contentType: payload.contentType,
            sizeBytes: payload.file.size,
            replacesDocumentId: payload.replacesDocumentId,
          },
          { idempotencyKey: `${key}:intent`, signal },
        );
        const id = intent.result.evidenceId;
        await client.evidence.uploadContent(id, payload.file, { idempotencyKey: `${key}:content`, signal });
        return client.evidence.finalize(id, { idempotencyKey: `${key}:finalize`, signal });
      }}
    >
      {replaceable.length > 0 ? (
        <Field label="Document">
          {(wired) => (
            <SelectInput wired={wired} value={replaces} onChange={(event) => setReplaces(event.target.value)}>
              <option value="">New document</option>
              {replaceable.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {`New version of ${doc.title} (${doc.id} v${doc.version})`}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>
      ) : null}
      {replaces ? null : (
        <div className="grid grid-cols-1 gap-3 xs:grid-cols-2">
          <Field label="Document type">
            {(wired) => (
              <SelectInput wired={wired} value={type} onChange={(event) => setType(event.target.value as DocumentType)}>
                {DOCUMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {DOCUMENT_TYPE_LABELS[t]}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
          <Field label="Title" error={errors.title}>
            {(wired) => <TextInput wired={wired} value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />}
          </Field>
        </div>
      )}
      <Field label="File" hint="PDF, JPEG or PNG · up to 20 MB" error={errors.file}>
        {(wired) => (
          <input
            id={wired.id}
            type="file"
            accept={EVIDENCE_CONTENT_TYPES.join(",")}
            aria-describedby={wired.describedBy}
            aria-invalid={wired.invalid || undefined}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="w-full rounded-md border border-line-input bg-surface-sunken px-2.5 py-1.5 text-[13px] text-fg file:mr-3 file:rounded-sm file:border-0 file:bg-surface-2 file:px-2.5 file:py-1 file:text-[12.5px] file:text-fg focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          />
        )}
      </Field>
    </ActionDialog>
  );
}
