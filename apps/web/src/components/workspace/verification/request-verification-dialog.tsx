"use client";

import type { AssetDetail, CreateVerificationRequest, EvidenceDocument, Me } from "@collara/domain";
import { useId, useState } from "react";
import { useCollara } from "@/lib/collara-client";
import { TrackedActionDialog as ActionDialog } from "../audit/page-command";
import { actingParty } from "../case/case-context";
import { Field, SelectInput, TextInput } from "../form-fields";
import { useVerifiers } from "./queries";
import { joinParts } from "@/lib/format";

/** Verification checklist items (S §9.9 L647). Ownership/lien stays a document review, never "verified". */
export const VERIFICATION_SCOPE_ITEMS = [
  "Serial consistency",
  "Photos",
  "Document consistency",
  "Inspected condition",
  "Location evidence",
  "Maintenance evidence",
  "Ownership / lien",
] as const;

function Checklist({
  legend,
  options,
  selected,
  onChange,
  error,
}: {
  legend: string;
  options: readonly { value: string; label: string }[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
  error?: string;
}) {
  const id = useId();
  return (
    <fieldset aria-describedby={error ? `${id}-error` : undefined} className="flex flex-col gap-1.5">
      <legend className="mb-1 text-[12.5px] font-medium text-fg-muted">{legend}</legend>
      {options.map((option) => (
        <label key={option.value} className="flex items-center gap-2 text-[13px] text-fg">
          <input
            type="checkbox"
            className="size-4 accent-[var(--fg)]"
            checked={selected.includes(option.value)}
            onChange={(event) =>
              onChange(event.target.checked ? [...selected, option.value] : selected.filter((value) => value !== option.value))
            }
          />
          {option.label}
        </label>
      ))}
      {error ? (
        <p id={`${id}-error`} className="text-[12px] text-danger-strong">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

/**
 * Request verification (owner only, S §14.2): choose an active registry verifier, the checklist scope
 * and the documents the verifier may see. The registry status is re-checked when the request commits.
 */
export function RequestVerificationDialog({
  detail,
  me,
  documents,
  caseId,
  size,
}: {
  detail: AssetDetail;
  me: Me;
  documents: readonly EvidenceDocument[];
  caseId?: string;
  size?: "default" | "sm" | "lg";
}) {
  const { client } = useCollara();
  const verifiers = useVerifiers();
  const active = (verifiers.data ?? []).filter((v) => v.status.value === "ACTIVE");
  const available = documents.filter((doc) => doc.status.value === "AVAILABLE");
  const [verifierRef, setVerifierRef] = useState("");
  const [scope, setScope] = useState<string[]>([...VERIFICATION_SCOPE_ITEMS]);
  const [docIds, setDocIds] = useState<string[]>([]);
  const [due, setDue] = useState("");
  const [errors, setErrors] = useState<{ verifier?: string; scope?: string; docs?: string; due?: string }>({});
  const chosen = verifierRef || active[0]?.ref || "";

  function prepare(): CreateVerificationRequest | null {
    const next: typeof errors = {};
    if (!chosen) next.verifier = "No active verifier is available in the registry.";
    if (scope.length === 0) next.scope = "Select at least one checklist item.";
    if (docIds.length === 0) next.docs = "Select at least one available document.";
    const dueAt = due ? Date.parse(`${due}T23:59:59Z`) : null;
    if (dueAt !== null && (Number.isNaN(dueAt) || dueAt <= Date.now())) next.due = "Choose a future date, or leave it empty.";
    setErrors(next);
    if (Object.keys(next).length > 0) return null;
    return {
      verifierRegistryRef: chosen,
      scope,
      documentIds: docIds,
      caseId,
      dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
    };
  }

  return (
    <ActionDialog
      label="Request verification"
      size={size}
      title={`Request verification · ${detail.ref}`}
      description={`Asks the selected registry verifier to inspect ${joinParts([detail.equipmentClass, detail.model]) || detail.ref}. The verifier sees only the documents you select, never loan terms.`}
      facts={{ actingParty: actingParty(me), record: `${detail.ref} · new verification request`, effect: "— → REQUESTED" }}
      caveat="The verifier's registry status is re-checked when the request is committed and again when an attestation is submitted."
      confirmLabel="Request verification"
      onOpen={() => {
        setVerifierRef("");
        setScope([...VERIFICATION_SCOPE_ITEMS]);
        setDocIds(available.map((doc) => doc.id));
        setDue("");
        setErrors({});
      }}
      prepare={prepare}
      perform={(body, options) => client.assets.requestVerification(detail.ref, body, options)}
    >
      <Field label="Verifier (active in the registry)" error={errors.verifier}>
        {(wired) => (
          <SelectInput wired={wired} value={chosen} onChange={(event) => setVerifierRef(event.target.value)} disabled={active.length === 0}>
            {active.map((v) => (
              <option key={v.ref} value={v.ref}>
                {`${v.orgName} · ${v.ref} · ${v.scope}`}
              </option>
            ))}
          </SelectInput>
        )}
      </Field>
      <Checklist
        legend="Checklist scope"
        options={VERIFICATION_SCOPE_ITEMS.map((item) => ({ value: item, label: item }))}
        selected={scope}
        onChange={setScope}
        error={errors.scope}
      />
      <Checklist
        legend="Documents shared with the verifier"
        options={available.map((doc) => ({ value: doc.id, label: `${doc.title} · ${doc.id} v${doc.version}` }))}
        selected={docIds}
        onChange={setDocIds}
        error={errors.docs}
      />
      <Field label="Due date (optional)" error={errors.due}>
        {(wired) => <TextInput wired={wired} type="date" className="font-mono" value={due} onChange={(event) => setDue(event.target.value)} />}
      </Field>
    </ActionDialog>
  );
}
