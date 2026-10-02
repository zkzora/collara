"use client";

import { ASSET_NAMESPACE, DECIMAL_AMOUNT_PATTERN, STATUS_COPY, type RegisterAssetRequest } from "@collara/domain";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { CommandStatus } from "@/components/collara/command-status";
import { ConfirmationDialog } from "@/components/collara/confirmation-dialog";
import { PageHeader } from "@/components/collara/page-header";
import { Panel } from "@/components/collara/panel";
import { PermissionNotice } from "@/components/collara/permission-notice";
import { Button, buttonVariants } from "@/components/ui/button";
import { useCollara } from "@/lib/collara-client";
import { useCommand } from "@/lib/commands";
import { useSession } from "@/lib/session";
import { actingParty } from "../case/case-context";
import { assetHref } from "../case/links";
import { Field, SelectInput, TextInput } from "../form-fields";

const CURRENCIES = ["USD", "EUR"] as const;
const THIS_YEAR = new Date().getUTCFullYear();

const RegisterFormSchema = z
  .object({
    equipmentClass: z.string().trim().min(1, "Enter the equipment class.").max(120),
    manufacturer: z.string().trim().min(1, "Enter the manufacturer.").max(120),
    model: z.string().trim().min(1, "Enter the model.").max(120),
    serialNumber: z.string().trim().min(1, "Enter the serial number.").max(120),
    yearOfManufacture: z
      .string()
      .trim()
      .refine((value) => value === "" || (/^\d{4}$/.test(value) && Number(value) >= 1950 && Number(value) <= THIS_YEAR), {
        message: `Enter a year between 1950 and ${THIS_YEAR}, or leave it empty.`,
      }),
    locationScope: z.string().trim().min(1, "Enter where the equipment is located.").max(200),
    claimedAmount: z
      .string()
      .transform((value) => value.replaceAll(",", "").trim())
      .refine((value) => value === "" || DECIMAL_AMOUNT_PATTERN.test(value), { message: "Enter an amount such as 150000.00, or leave it empty." }),
    claimedCurrency: z.enum(CURRENCIES),
  })
  .transform(
    (v): Omit<RegisterAssetRequest, "intent"> => ({
      equipmentClass: v.equipmentClass,
      manufacturer: v.manufacturer,
      model: v.model,
      serialNumber: v.serialNumber,
      yearOfManufacture: v.yearOfManufacture ? Number(v.yearOfManufacture) : undefined,
      locationScope: v.locationScope,
      claimedAcquisitionValue: v.claimedAmount ? { amount: v.claimedAmount, currency: v.claimedCurrency } : undefined,
    }),
  );
type RegisterForm = z.input<typeof RegisterFormSchema>;

const DEFAULTS: RegisterForm = {
  equipmentClass: "",
  manufacturer: "",
  model: "",
  serialNumber: "",
  yearOfManufacture: "",
  locationScope: "",
  claimedAmount: "",
  claimedCurrency: "USD",
};

/**
 * Register Asset `/app/assets/new` (S §9.5). The owner organization is the signed-in organization
 * (derived server-side, never chosen here). `Register passport` is committed only after the ledger
 * command succeeds; a duplicate held by another party is declined generically and never revealed.
 */
export function RegisterAssetForm() {
  const { me, mode } = useSession();
  const { client } = useCollara();
  const router = useRouter();
  const [confirming, setConfirming] = useState<Omit<RegisterAssetRequest, "intent"> | null>(null);
  const form = useForm<RegisterForm, unknown, Omit<RegisterAssetRequest, "intent">>({
    resolver: zodResolver(RegisterFormSchema),
    defaultValues: DEFAULTS,
    mode: "onTouched",
  });
  const errors = form.formState.errors;
  const command = useCommand(
    (body: RegisterAssetRequest, { idempotencyKey }) => client.assets.register(body, { idempotencyKey }),
    { onSuccess: (result) => router.push(assetHref(result.result.assetRef)) },
  );
  const canRegister = me.roles.includes("BORROWER");

  const saveDraft = form.handleSubmit(async (values) => {
    await command.run({ ...values, intent: "DRAFT" });
  });
  const review = form.handleSubmit((values) => {
    command.reset();
    setConfirming(values);
  });

  return (
    <div className="flex max-w-[860px] flex-col gap-[18px]">
      <PageHeader
        title="Register asset"
        description="Creates an asset passport for equipment your organization owns. Evidence (purchase documents, photos) is added on the passport after registration."
        actions={
          <Link href="/app/assets" className={buttonVariants({ variant: "outline" })}>
            Cancel
          </Link>
        }
      />
      <p className="rounded-md border border-warning/30 bg-warning/5 px-3.5 py-3 text-[13px] text-warning-strong">{STATUS_COPY.REGISTER_ASSET_WARNING}</p>
      {!canRegister ? (
        <PermissionNotice reason="mandate" title="Registration needs the owner's borrower mandate">
          Only the equipment owner organization can register a passport. {me.org.name} cannot register assets with your current role.
        </PermissionNotice>
      ) : null}
      <form noValidate onSubmit={(event) => void review(event)} aria-describedby="register-help">
        <fieldset disabled={!canRegister || command.isPending} className="flex flex-col gap-3.5">
          <Panel title="Equipment identity">
            <div className="grid grid-cols-1 gap-3.5 xs:grid-cols-2">
              <Field label="Equipment class" hint="e.g. CNC machining center" error={errors.equipmentClass?.message}>
                {(wired) => <TextInput wired={wired} {...form.register("equipmentClass")} />}
              </Field>
              <Field label="Manufacturer" error={errors.manufacturer?.message}>
                {(wired) => <TextInput wired={wired} {...form.register("manufacturer")} />}
              </Field>
              <Field label="Model" error={errors.model?.message}>
                {(wired) => <TextInput wired={wired} className="font-mono" {...form.register("model")} />}
              </Field>
              <Field
                label="Serial number"
                hint="Checked for duplicates within your organization only. Other parties' registrations are never shown."
                error={errors.serialNumber?.message}
              >
                {(wired) => <TextInput wired={wired} className="font-mono" autoComplete="off" {...form.register("serialNumber")} />}
              </Field>
              <Field label="Year of manufacture (optional)" error={errors.yearOfManufacture?.message}>
                {(wired) => <TextInput wired={wired} inputMode="numeric" className="font-mono" {...form.register("yearOfManufacture")} />}
              </Field>
              <Field label="Location scope" hint="Declared location, e.g. facility and region." error={errors.locationScope?.message}>
                {(wired) => <TextInput wired={wired} {...form.register("locationScope")} />}
              </Field>
            </div>
          </Panel>
          <Panel title="Ownership">
            <div className="grid grid-cols-1 gap-3.5 xs:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_110px]">
              <div className="flex flex-col gap-1.5">
                <span className="text-[12.5px] font-medium text-fg-muted">Owner organization</span>
                <p className="flex h-9 items-center rounded-md border border-line-subtle bg-surface-sunken px-2.5 text-[13px] text-fg">{me.org.name}</p>
              </div>
              <Field label="Claimed acquisition value (optional)" error={errors.claimedAmount?.message}>
                {(wired) => <TextInput wired={wired} inputMode="decimal" className="font-mono" autoComplete="off" {...form.register("claimedAmount")} />}
              </Field>
              <Field label="Currency">
                {(wired) => (
                  <SelectInput wired={wired} {...form.register("claimedCurrency")}>
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </SelectInput>
                )}
              </Field>
            </div>
            <p className="mt-3 text-[12px] text-fg-subtle">
              The claimed value is the owner&apos;s statement. It is not a valuation.
            </p>
          </Panel>
          <p id="register-help" className="text-[12px] text-fg-subtle">
            {`Passport ids are issued in the ${ASSET_NAMESPACE} namespace. A draft stays private to ${me.org.name} until you register it.`}
          </p>
          <CommandStatus mode={mode} command={confirming ? null : command.command} pending={!confirming && command.isPending} error={confirming ? null : command.error} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="lg">
              Register passport
            </Button>
            <Button type="button" size="lg" variant="outline" onClick={() => void saveDraft()}>
              Save draft
            </Button>
          </div>
        </fieldset>
      </form>
      <ConfirmationDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title="Register asset passport"
        description={
          confirming
            ? `Registers ${confirming.equipmentClass} · ${confirming.model} · serial ${confirming.serialNumber} as an asset passport owned by ${me.org.name}.`
            : ""
        }
        facts={{ actingParty: actingParty(me), record: `New passport · ${ASSET_NAMESPACE}`, effect: "DRAFT → REGISTERED" }}
        caveat={STATUS_COPY.REGISTER_ASSET_WARNING}
        confirmLabel="Register passport"
        pending={command.isPending}
        onConfirm={() => {
          if (confirming) void command.run({ ...confirming, intent: "REGISTER" });
        }}
        status={<CommandStatus mode={mode} command={null} pending={command.isPending} error={command.error} />}
      />
    </div>
  );
}
