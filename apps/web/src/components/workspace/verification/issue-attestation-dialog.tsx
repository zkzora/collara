"use client";

import { checkResults, CONFIRMATION_COPY, type CheckResult, type IssueAttestationRequest, type Me, type VerificationRequest } from "@collara/domain";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useCollara } from "@/lib/collara-client";
import { TrackedActionDialog as ActionDialog } from "../audit/page-command";
import { actingParty } from "../case/case-context";
import { Field, SelectInput, TextArea, TextInput } from "../form-fields";

const DAY = 86_400_000;
const isoDate = (offsetDays = 0) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

/** Ownership/lien items stay within the verifier's mandate: documents reviewed or not checked (S L647). */
const isOwnershipItem = (item: string) => /ownership|lien|title/i.test(item);
const RESULTS_FOR = (item: string): readonly CheckResult[] =>
  isOwnershipItem(item) ? ["REVIEWED_DOCUMENTS", "NOT_CHECKED"] : ["CHECKED", "CHECKED_NOTED", "NOT_CHECKED"];

const AttestationFormSchema = z
  .object({
    method: z.string().trim().min(1, "Describe the inspection method.").max(200),
    inspectedOn: z.iso.date("Enter the inspection date."),
    validUntil: z.iso.date("Enter the end of the validity period."),
    checks: z.array(z.object({ item: z.string(), finding: z.string().trim().max(500), result: z.enum(checkResults.values) })).min(1),
    limitations: z.string().trim().min(1, "State the limitations of this attestation.").max(2000),
  })
  .superRefine((v, ctx) => {
    if (v.inspectedOn > isoDate()) ctx.addIssue({ code: "custom", path: ["inspectedOn"], message: "The inspection date cannot be in the future." });
    if (v.validUntil <= v.inspectedOn || v.validUntil <= isoDate()) {
      ctx.addIssue({ code: "custom", path: ["validUntil"], message: "The validity period must end after the inspection and in the future." });
    }
  });
type AttestationForm = z.infer<typeof AttestationFormSchema>;

function defaults(vr: VerificationRequest): AttestationForm {
  return {
    method: "On-site inspection + document review",
    inspectedOn: isoDate(),
    validUntil: isoDate(180),
    checks: vr.scope.map((item) => ({ item, finding: "", result: isOwnershipItem(item) ? "REVIEWED_DOCUMENTS" : "CHECKED" })),
    limitations: "Ownership and lien status reviewed from submitted documents only. No UCC, title or registry search performed.",
  };
}

/**
 * Submit attestation (S §9.9): the checks, findings, limitations and validity period the assigned
 * verifier stands behind. Immutable once issued; a correction is a new attestation that supersedes it.
 */
export function IssueAttestationDialog({ vr, me }: { vr: VerificationRequest; me: Me }) {
  const { client } = useCollara();
  const form = useForm<AttestationForm>({ resolver: zodResolver(AttestationFormSchema), defaultValues: defaults(vr), mode: "onTouched" });
  const errors = form.formState.errors;

  async function prepare(): Promise<IssueAttestationRequest | null> {
    if (!(await form.trigger())) return null;
    const v = AttestationFormSchema.parse(form.getValues());
    return {
      method: v.method,
      inspectedAt: `${v.inspectedOn}T00:00:00.000Z`,
      validUntil: `${v.validUntil}T23:59:59.000Z`,
      checks: v.checks.map((c) => ({ item: c.item, finding: c.finding, result: c.result })),
      limitations: v.limitations,
    };
  }

  return (
    <ActionDialog
      label="Submit attestation"
      variant="primary"
      title={`Submit attestation · ${vr.ref}`}
      description={`Issues an attestation for ${vr.assetRef}${vr.equipmentSummary ? ` (${vr.equipmentSummary})` : ""} against evidence package ${vr.evidencePackage.ref} v${vr.evidencePackage.version}, as ${vr.verifier.name} (${vr.verifierRegistryRef}).`}
      facts={{ actingParty: actingParty(me), record: `${vr.ref} · ${vr.evidencePackage.ref} v${vr.evidencePackage.version}`, effect: "IN_REVIEW → ATTESTED" }}
      caveat={
        <>
          {CONFIRMATION_COPY.ATTESTATION} Registry status for {vr.verifierRegistryRef} is re-checked when the attestation is committed; a suspended verifier cannot issue new attestations.
        </>
      }
      confirmLabel="Submit attestation"
      onOpen={() => form.reset(defaults(vr))}
      prepare={prepare}
      perform={(body, options) => client.verifications.issueAttestation(vr.ref, body, options)}
    >
      <Field label="Inspection method" error={errors.method?.message}>
        {(wired) => <TextInput wired={wired} {...form.register("method")} />}
      </Field>
      <div className="grid grid-cols-1 gap-3 xs:grid-cols-2">
        <Field label="Inspected on" error={errors.inspectedOn?.message}>
          {(wired) => <TextInput wired={wired} type="date" className="font-mono" {...form.register("inspectedOn")} />}
        </Field>
        <Field label="Valid until" error={errors.validUntil?.message}>
          {(wired) => <TextInput wired={wired} type="date" className="font-mono" {...form.register("validUntil")} />}
        </Field>
      </div>
      <fieldset className="flex flex-col gap-2.5 rounded-md border border-line-subtle px-3 pt-1 pb-3">
        <legend className="px-1 text-[12.5px] font-medium text-fg-muted">Checked items</legend>
        {vr.scope.map((item, index) => (
          <div key={item} className="grid grid-cols-1 gap-2 xs:grid-cols-[minmax(0,1fr)_150px]">
            <Field label={`${item} · finding`}>
              {(wired) => <TextInput wired={wired} maxLength={500} {...form.register(`checks.${index}.finding`)} />}
            </Field>
            <Field label={`${item} · result`}>
              {(wired) => (
                <SelectInput wired={wired} {...form.register(`checks.${index}.result`)}>
                  {RESULTS_FOR(item).map((result) => (
                    <option key={result} value={result}>
                      {checkResults.label(result)}
                    </option>
                  ))}
                </SelectInput>
              )}
            </Field>
          </div>
        ))}
      </fieldset>
      <Field label="Limitations" error={errors.limitations?.message}>
        {(wired) => <TextArea wired={wired} rows={3} {...form.register("limitations")} />}
      </Field>
    </ActionDialog>
  );
}
