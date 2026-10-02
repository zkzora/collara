"use client";

import {
  ASSESSMENT_OUTCOMES,
  CREDIT_POLICY_REF,
  DECIMAL_AMOUNT_PATTERN,
  NOTE_COPY,
  reviewStates,
  type Me,
  type Review,
  type SaveAssessmentRequest,
} from "@collara/domain";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useCollara } from "@/lib/collara-client";
import { ActionDialog } from "./action-dialog";
import { actingParty } from "./case/case-context";
import { Field, SelectInput, TextArea, TextInput } from "./form-fields";

const CURRENCIES = ["USD", "EUR"] as const;

const AssessmentFormSchema = z.object({
  amount: z
    .string()
    .transform((value) => value.replaceAll(",", "").trim())
    .pipe(z.string().regex(DECIMAL_AMOUNT_PATTERN, "Enter an amount such as 150000.00 (two decimals at most).")),
  currency: z.enum(CURRENCIES),
  valuationSource: z.string().trim().min(1, "Enter the valuation source.").max(500),
  valuationDate: z.iso.date("Enter the valuation date."),
  limitations: z.string().trim().max(2000),
  internalNotes: z.string().trim().max(4000),
  sharedFeedback: z.string().trim().max(2000),
  outcome: z.enum(ASSESSMENT_OUTCOMES),
  policyRef: z.string().trim().min(1, "Enter the policy reference.").max(60),
});
type AssessmentForm = z.input<typeof AssessmentFormSchema>;

function defaults(review: Review | null): AssessmentForm {
  const a = review?.assessment;
  const outcome = a?.outcome.value;
  return {
    amount: a?.valuation.amount ?? "",
    currency: a?.valuation.currency === "EUR" ? "EUR" : "USD",
    valuationSource: a?.valuationSource ?? "",
    valuationDate: a?.valuationDate ?? new Date().toISOString().slice(0, 10),
    limitations: a?.limitations ?? "",
    internalNotes: review?.internalNotes ?? "",
    sharedFeedback: review?.sharedFeedback ?? "",
    outcome: outcome === "ELIGIBLE" || outcome === "REJECTED" ? outcome : "NEEDS_INFORMATION",
    policyRef: a?.policyRef ?? CREDIT_POLICY_REF,
  };
}

/**
 * Save (or start) the lender's collateral assessment (S §9.11). The first save on a submitted package
 * moves the review to IN_REVIEW. Saving never records a decision; the approver does that separately.
 */
export function AssessmentDialog({
  caseId,
  review,
  reviewRef,
  me,
  start,
}: {
  caseId: string;
  review: Review | null;
  reviewRef: string;
  me: Me;
  /** First save on a SUBMITTED review ("Start review"). */
  start: boolean;
}) {
  const { client } = useCollara();
  const form = useForm<AssessmentForm>({ resolver: zodResolver(AssessmentFormSchema), defaultValues: defaults(review), mode: "onTouched" });
  const errors = form.formState.errors;
  const version = (review?.assessment?.version ?? 0) + 1;
  const lender = review?.lender.name ?? me.org.name;

  async function prepare(): Promise<SaveAssessmentRequest | null> {
    if (!(await form.trigger())) return null;
    const v = AssessmentFormSchema.parse(form.getValues());
    return {
      valuation: { amount: v.amount, currency: v.currency },
      valuationSource: v.valuationSource,
      valuationDate: v.valuationDate,
      limitations: v.limitations,
      // Both note fields are always sent: "" clears a note; unchanged text is not stored again.
      internalNotes: v.internalNotes,
      sharedFeedback: v.sharedFeedback,
      outcome: v.outcome,
      policyRef: v.policyRef,
    };
  }

  return (
    <ActionDialog
      label={start ? "Start review" : "Save assessment"}
      variant={start ? "primary" : "outline"}
      title={`${start ? "Start collateral review" : "Save assessment"} · ${caseId}`}
      description={`Saves assessment v${version} for ${caseId} as a ${lender} record. Internal notes stay with ${lender}; shared feedback is visible to the borrower.`}
      facts={{
        actingParty: actingParty(me),
        record: `${reviewRef} · assessment v${version}`,
        effect: start ? "SUBMITTED → IN_REVIEW · assessment draft saved" : "Assessment draft saved",
      }}
      caveat="Saving an assessment does not record a collateral decision."
      confirmLabel={start ? "Start review" : "Save assessment"}
      onOpen={() => form.reset(defaults(review))}
      prepare={prepare}
      perform={(body, options) => client.cases.saveAssessment(caseId, body, options)}
    >
      <div className="grid grid-cols-1 gap-3 xs:grid-cols-[minmax(0,1fr)_110px]">
        <Field label="Valuation amount" error={errors.amount?.message}>
          {(wired) => <TextInput wired={wired} inputMode="decimal" autoComplete="off" className="font-mono" {...form.register("amount")} />}
        </Field>
        <Field label="Currency" error={errors.currency?.message}>
          {(wired) => (
            <SelectInput wired={wired} {...form.register("currency")}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>
      </div>
      <Field label="Valuation source" error={errors.valuationSource?.message}>
        {(wired) => <TextInput wired={wired} {...form.register("valuationSource")} />}
      </Field>
      <div className="grid grid-cols-1 gap-3 xs:grid-cols-2">
        <Field label="Valuation date" error={errors.valuationDate?.message}>
          {(wired) => <TextInput wired={wired} type="date" className="font-mono" {...form.register("valuationDate")} />}
        </Field>
        <Field label="Policy reference" error={errors.policyRef?.message}>
          {(wired) => <TextInput wired={wired} className="font-mono" {...form.register("policyRef")} />}
        </Field>
      </div>
      <Field label="Valuation limitations" error={errors.limitations?.message}>
        {(wired) => <TextArea wired={wired} rows={2} {...form.register("limitations")} />}
      </Field>
      <Field label="Internal assessment notes" tag={`Internal · ${lender} only`} hint={NOTE_COPY.STORED_OFF_LEDGER} error={errors.internalNotes?.message}>
        {(wired) => <TextArea wired={wired} rows={3} className="border-pending/30" {...form.register("internalNotes")} />}
      </Field>
      <Field label="Feedback shared with the borrower" hint={NOTE_COPY.STORED_OFF_LEDGER} error={errors.sharedFeedback?.message}>
        {(wired) => <TextArea wired={wired} rows={2} {...form.register("sharedFeedback")} />}
      </Field>
      <Field label="Collateral outcome" error={errors.outcome?.message}>
        {(wired) => (
          <SelectInput wired={wired} {...form.register("outcome")}>
            {ASSESSMENT_OUTCOMES.map((outcome) => (
              <option key={outcome} value={outcome}>
                {reviewStates.label(outcome)}
              </option>
            ))}
          </SelectInput>
        )}
      </Field>
    </ActionDialog>
  );
}
