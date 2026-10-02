"use client";

import { createHttpClient, isApiError, randomId, type CollaraClient } from "@collara/api-client";
import {
  CASES_PER_MONTH,
  CASES_PER_MONTH_LABELS,
  COMPANY_TYPES,
  COMPANY_TYPE_LABELS,
  ENVIRONMENT_CHIPS,
  ERROR_COPY,
  MODE_BANNERS,
  PILOT_COPY,
  PilotRequestSchema,
  type RuntimeMode,
} from "@collara/domain";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useForm, type FieldError } from "react-hook-form";
import type { z } from "zod";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type FormInput = z.input<typeof PilotRequestSchema>;
type FormOutput = z.output<typeof PilotRequestSchema>;
type FieldName = keyof FormInput;

// Field-level messages. INFERRED copy (S §6.1 defines labels, not validation text); needs approval.
const FIELD_MESSAGES: Readonly<Record<FieldName, string>> = {
  fullName: "Enter your full name.",
  workEmail: "Enter a valid work email address.",
  company: "Enter your company name.",
  role: "Enter your role.",
  companyType: "Choose a company type.",
  country: "Enter your country.",
  equipmentCategory: "Enter the equipment category.",
  casesPerMonth: "Choose an approximate number of cases, or Unknown.",
  workflowChallenge: "Describe your current workflow challenge.",
  currentSystems: "Keep this answer shorter.",
  consent: "Confirm that we may contact you about this request.",
  website: "Leave this field empty.",
};

/** Visual (DOM) order, used to focus the first invalid field after a failed submit. */
const FIELD_ORDER: readonly FieldName[] = [
  "fullName",
  "workEmail",
  "company",
  "role",
  "companyType",
  "country",
  "equipmentCategory",
  "casesPerMonth",
  "workflowChallenge",
  "currentSystems",
  "consent",
];

function messageFor(name: FieldName, error: FieldError | undefined): string | undefined {
  if (!error) return undefined;
  if (error.type === "too_big") return "This answer is too long.";
  return FIELD_MESSAGES[name];
}

// One client per page load; the mock is code-split and loaded only in UI_MOCK (ADR-0001 §2.2).
let clientPromise: Promise<CollaraClient> | null = null;
function getClient(mode: RuntimeMode): Promise<CollaraClient> {
  clientPromise ??=
    mode === "UI_MOCK"
      ? import("@collara/api-client/mock").then(({ createMockClient }) => createMockClient({ latencyMs: 400 }))
      : Promise.resolve(createHttpClient());
  return clientPromise;
}

type Outcome = { kind: "idle" } | { kind: "error" } | { kind: "simulated" } | { kind: "received" };

const controlClass =
  "h-10 rounded-md px-3 text-[15px] md:text-[15px] aria-invalid:border-danger aria-invalid:ring-0";
const selectClass = cn(
  "w-full min-w-0 border border-input bg-surface-sunken text-fg outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
  controlClass,
);

export function PilotForm({ mode }: { mode: RuntimeMode }) {
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  // Reused for retries of the same submission; renewed after a stored request.
  const [idempotencyKey, setIdempotencyKey] = useState(randomId);
  const resultRef = useRef<HTMLParagraphElement>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, submitCount },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(PilotRequestSchema),
    // Focus is moved in DOM order by onInvalid below.
    shouldFocusError: false,
    defaultValues: {
      fullName: "",
      workEmail: "",
      company: "",
      role: "",
      country: "",
      equipmentCategory: "",
      workflowChallenge: "",
      currentSystems: "",
      website: "",
    },
  });

  useEffect(() => {
    if (outcome.kind === "simulated" || outcome.kind === "received") resultRef.current?.focus();
  }, [outcome.kind]);

  function onInvalid(invalid: Partial<Record<FieldName, unknown>>) {
    const first = FIELD_ORDER.find((name) => invalid[name]);
    if (first) document.getElementById(`pilot-${first}`)?.focus();
  }

  async function onSubmit(values: FormOutput) {
    setOutcome({ kind: "idle" });
    try {
      const client = await getClient(mode);
      const response = await client.pilotRequests.create(
        { ...values, currentSystems: values.currentSystems || undefined },
        { idempotencyKey },
      );
      if (response.command.simulated) {
        setOutcome({ kind: "simulated" });
      } else if (response.result) {
        // Success copy only after the API reports the request as stored (S §6.1).
        setIdempotencyKey(randomId());
        setOutcome({ kind: "received" });
      } else {
        setOutcome({ kind: "error" });
      }
    } catch (error) {
      for (const issue of isApiError(error) ? (error.problem?.issues ?? []) : []) {
        const name = issue.path.split(".")[0] as FieldName;
        if (name in FIELD_MESSAGES) setError(name, { type: "server", message: FIELD_MESSAGES[name] });
      }
      setOutcome({ kind: "error" });
    }
  }

  if (outcome.kind === "received") {
    return (
      <ResultPanel>
        <p ref={resultRef} tabIndex={-1} className="text-[17px] leading-[1.6] text-fg outline-none">
          {PILOT_COPY.SUCCESS}
        </p>
      </ResultPanel>
    );
  }

  if (outcome.kind === "simulated") {
    return (
      <ResultPanel>
        <span className="w-fit rounded-[5px] border border-white/18 px-[7px] py-0.5 font-mono text-[11px] tracking-[0.06em] text-fg-soft uppercase">
          {ENVIRONMENT_CHIPS.UI_MOCK}
        </span>
        {/* INFERRED copy: a mock submission must never read as a real one. */}
        <p ref={resultRef} tabIndex={-1} className="text-[17px] leading-[1.6] text-fg outline-none">
          This request was simulated in the UI mockup. It was not sent or stored, and no one will contact you.
        </p>
        <p className="text-[13px] text-fg-subtle">{MODE_BANNERS.UI_MOCK}</p>
        <button
          type="button"
          onClick={() => setOutcome({ kind: "idle" })}
          className="w-fit cursor-pointer rounded-[9px] border border-white/14 px-[18px] py-[11px] text-[15px] text-fg hover:border-white/22 hover:bg-hover"
        >
          Edit request
        </button>
      </ResultPanel>
    );
  }

  const field = (name: FieldName, hint?: boolean) => {
    const message = messageFor(name, errors[name]);
    const describedBy = [hint ? `pilot-${name}-hint` : null, message ? `pilot-${name}-error` : null]
      .filter(Boolean)
      .join(" ");
    return {
      id: `pilot-${name}`,
      "aria-invalid": message ? true : undefined,
      "aria-describedby": describedBy || undefined,
      message,
    };
  };

  const hasErrors = Object.keys(errors).length > 0;

  return (
    <form
      noValidate
      onSubmit={handleSubmit(onSubmit, onInvalid)}
      aria-label="Request a pilot"
      className="flex flex-col gap-6 rounded-lg border border-line bg-surface-1 p-6 site:p-8"
    >
      {submitCount > 0 && hasErrors ? (
        <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-[14px] text-danger-strong">
          {ERROR_COPY.VALIDATION}
        </p>
      ) : null}

      <div className="grid gap-5 xs:grid-cols-2">
        <TextField label="Full name" {...field("fullName")}>
          {(props) => <Input {...props} {...register("fullName")} autoComplete="name" maxLength={120} aria-required="true" className={controlClass} />}
        </TextField>
        <TextField label="Work email" {...field("workEmail")}>
          {(props) => (
            <Input
              {...props}
              {...register("workEmail")}
              type="email"
              autoComplete="email"
              inputMode="email"
              maxLength={200}
              aria-required="true"
              className={controlClass}
            />
          )}
        </TextField>
        <TextField label="Company" {...field("company")}>
          {(props) => <Input {...props} {...register("company")} autoComplete="organization" maxLength={160} aria-required="true" className={controlClass} />}
        </TextField>
        <TextField label="Role" {...field("role")}>
          {(props) => <Input {...props} {...register("role")} autoComplete="organization-title" maxLength={120} aria-required="true" className={controlClass} />}
        </TextField>
        <TextField label="Company type" {...field("companyType")}>
          {(props) => (
            <select {...props} {...register("companyType")} defaultValue="" aria-required="true" className={selectClass}>
              <option value="" disabled>
                Select
              </option>
              {COMPANY_TYPES.map((value) => (
                <option key={value} value={value}>
                  {COMPANY_TYPE_LABELS[value]}
                </option>
              ))}
            </select>
          )}
        </TextField>
        <TextField label="Country" {...field("country")}>
          {(props) => <Input {...props} {...register("country")} autoComplete="country-name" maxLength={80} aria-required="true" className={controlClass} />}
        </TextField>
        <TextField label="Equipment category" {...field("equipmentCategory")}>
          {(props) => <Input {...props} {...register("equipmentCategory")} maxLength={120} aria-required="true" className={controlClass} />}
        </TextField>
        <TextField label="Approximate cases per month" {...field("casesPerMonth")}>
          {(props) => (
            <select {...props} {...register("casesPerMonth")} defaultValue="" aria-required="true" className={selectClass}>
              <option value="" disabled>
                Select
              </option>
              {CASES_PER_MONTH.map((value) => (
                <option key={value} value={value}>
                  {CASES_PER_MONTH_LABELS[value]}
                </option>
              ))}
            </select>
          )}
        </TextField>
      </div>

      <TextField
        label="Current workflow challenge"
        hint="Describe the workflow only. Do not include borrower information or financial documents."
        {...field("workflowChallenge", true)}
      >
        {(props) => (
          <Textarea {...props} {...register("workflowChallenge")} rows={5} maxLength={2000} aria-required="true" className="min-h-28 px-3 text-[15px] md:text-[15px] aria-invalid:border-danger aria-invalid:ring-0" />
        )}
      </TextField>

      <TextField label="Current systems" optional {...field("currentSystems")}>
        {(props) => <Textarea {...props} {...register("currentSystems")} rows={2} maxLength={500} className="min-h-16 px-3 text-[15px] md:text-[15px] aria-invalid:border-danger aria-invalid:ring-0" />}
      </TextField>

      {/* Honeypot: hidden from people and assistive technology; bots that fill it are rejected. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor="pilot-website">Website</label>
        <input id="pilot-website" type="text" tabIndex={-1} autoComplete="off" {...register("website")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-start gap-3">
          <input
            id="pilot-consent"
            type="checkbox"
            {...register("consent")}
            aria-required="true"
            aria-invalid={errors.consent ? true : undefined}
            aria-describedby={["pilot-consent-hint", errors.consent ? "pilot-consent-error" : null].filter(Boolean).join(" ")}
            className="mt-0.5 size-[18px] flex-none cursor-pointer accent-[var(--fg)]"
          />
          <label htmlFor="pilot-consent" className="cursor-pointer text-[15px] font-medium">
            Consent to be contacted
          </label>
        </div>
        {/* INFERRED copy; the consent wording itself is a blocked legal input (BPD-1). */}
        <p id="pilot-consent-hint" className="pl-[30px] text-[13px] leading-[1.6] text-fg-subtle">
          The consent wording and retention period are pending legal review. See{" "}
          <Link href="/privacy" className="border-b border-white/20 text-fg-soft hover:text-fg">
            Privacy
          </Link>
          .
        </p>
        {errors.consent ? (
          <p id="pilot-consent-error" className="pl-[30px] text-[13px] text-danger-strong">
            {messageFor("consent", errors.consent)}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-3.5 border-t border-white/7 pt-6">
        {mode === "UI_MOCK" ? (
          <p className="flex flex-wrap items-baseline gap-2 text-[13px] leading-[1.6] text-fg-muted">
            <span className="rounded-[5px] border border-white/18 px-[7px] py-0.5 font-mono text-[11px] tracking-[0.06em] text-fg-soft uppercase">
              {ENVIRONMENT_CHIPS.UI_MOCK}
            </span>
            {/* INFERRED copy. */}
            <span>This form is not connected to the API in the UI mockup. Submissions are simulated and not sent.</span>
          </p>
        ) : null}
        <p className="text-[13px] leading-[1.6] text-fg-subtle">{PILOT_COPY.DISCLAIMER}</p>
        {outcome.kind === "error" ? (
          <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-[14px] text-danger-strong">
            {PILOT_COPY.ERROR}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-fit cursor-pointer rounded-[9px] bg-fg px-5 py-3 text-[15px] font-medium text-on-primary transition-colors hover:bg-fg-strong disabled:cursor-progress disabled:opacity-70 motion-reduce:transition-none"
        >
          {PILOT_COPY.SUBMIT}
        </button>
        <p aria-live="polite" className="sr-only">
          {isSubmitting ? "Submitting" : ""}
        </p>
      </div>
    </form>
  );
}

interface ControlProps {
  id: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

function TextField({
  label,
  optional = false,
  hint,
  message,
  children,
  ...control
}: ControlProps & {
  label: string;
  optional?: boolean;
  hint?: string;
  message?: string;
  children: (props: ControlProps) => ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={control.id} className="text-[14px] font-medium">
        {label}
        {optional ? <span className="font-normal text-fg-subtle"> (optional)</span> : null}
      </label>
      {hint ? (
        <p id={`${control.id}-hint`} className="-mt-1 text-[13px] leading-[1.5] text-fg-subtle">
          {hint}
        </p>
      ) : null}
      {children(control)}
      {message ? (
        <p id={`${control.id}-error`} className="text-[13px] text-danger-strong">
          {message}
        </p>
      ) : null}
    </div>
  );
}

function ResultPanel({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="flex flex-col gap-4 rounded-lg border border-line bg-surface-1 p-6 site:p-8">
      {children}
    </div>
  );
}
