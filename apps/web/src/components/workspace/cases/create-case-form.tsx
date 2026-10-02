"use client";

import { isApiError } from "@collara/api-client";
import { CASE_CREATE_COPY, type AssetSummary, type CreateCaseRequest, type OrgRef } from "@collara/domain";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { useForm, useWatch } from "react-hook-form";
import { CommandStatus } from "@/components/collara/command-status";
import { ErrorState } from "@/components/collara/error-state";
import { LoadingState } from "@/components/collara/loading-state";
import { PageHeader } from "@/components/collara/page-header";
import { Panel } from "@/components/collara/panel";
import { PermissionNotice } from "@/components/collara/permission-notice";
import { Button, buttonVariants } from "@/components/ui/button";
import { useCollara } from "@/lib/collara-client";
import { useCommand } from "@/lib/commands";
import { useSession } from "@/lib/session";
import { useAssetList } from "../assets/queries";
import { assetHref, caseTabHref } from "../case/links";
import { Field, SelectInput, TextArea, TextInput } from "../form-fields";
import { CASE_CURRENCIES, CREATE_CASE_DEFAULTS, CreateCaseFormSchema, fieldOfIssue, type CreateCaseForm } from "./create-case-schema";
import { offersCaseCreation, useDirectory, useSelectedAsset } from "./queries";

const readOnly = "flex min-h-9 items-center rounded-md border border-line-subtle bg-surface-sunken px-2.5 text-[13px] text-fg";

/** Where the new case opens: `Save draft` → its summary (next step); `Review sharing` → Sharing & Access. */
type Landing = "summary" | "sharing";

function AssetHint({ assetRef }: { assetRef: string }) {
  const detail = useSelectedAsset(assetRef);
  if (!assetRef) return <>Only registered assets owned by your organization are listed.</>;
  if (detail.isPending) return <>Checking the asset…</>;
  if (detail.isError || !detail.data) return <>The asset could not be loaded. The server checks it again when you save.</>;
  const asset = detail.data;
  if (!asset.allowedActions.includes("case.create")) {
    const holding = asset.cases[0];
    return (
      <>
        {CASE_CREATE_COPY.ACTIVE_CASE}{" "}
        {holding ? (
          <Link href={caseTabHref(holding.caseId, "summary")} className="text-fg underline underline-offset-4">
            Open {holding.caseId}
          </Link>
        ) : null}
      </>
    );
  }
  return (
    <>
      {asset.evidence
        ? `Evidence package ${asset.evidence.packageRef} v${asset.evidence.packageVersion} · ${asset.evidence.documentCount} documents.`
        : "No evidence package is committed yet; add evidence on the asset passport before sharing."}{" "}
      <Link href={assetHref(asset.ref)} className="text-fg underline underline-offset-4">
        Open passport
      </Link>
    </>
  );
}

function CreateCaseFields({
  assets,
  lenders,
  dealers,
  initialAssetRef,
  disabled,
}: {
  assets: readonly AssetSummary[];
  lenders: readonly OrgRef[];
  dealers: readonly OrgRef[];
  initialAssetRef: string | undefined;
  disabled: boolean;
}) {
  const { me, mode } = useSession();
  const { client } = useCollara();
  const router = useRouter();
  const landing = useRef<Landing>("summary");
  const preselected = assets.some((a) => a.ref === initialAssetRef) ? initialAssetRef : assets.length === 1 ? assets[0]?.ref : undefined;
  const form = useForm<CreateCaseForm, unknown, CreateCaseRequest>({
    resolver: zodResolver(CreateCaseFormSchema),
    defaultValues: { ...CREATE_CASE_DEFAULTS, assetRef: preselected ?? "" },
    mode: "onTouched",
  });
  const errors = form.formState.errors;
  const assetRef = useWatch({ control: form.control, name: "assetRef" });
  const selected = useSelectedAsset(assetRef);

  /** Server validation and state errors land on their field (announced with it), the first one focused. */
  function showServerProblem(error: unknown) {
    if (!isApiError(error)) return;
    if (error.code === "state_conflict") {
      form.setError("assetRef", { type: "server", message: error.message }, { shouldFocus: true });
      return;
    }
    if (error.code !== "validation_error") return;
    let first = true;
    for (const issue of error.problem?.issues ?? []) {
      const field = fieldOfIssue(issue.path);
      if (!field) continue;
      form.setError(field, { type: "server", message: issue.message }, { shouldFocus: first });
      first = false;
    }
  }

  const command = useCommand(
    async (body: CreateCaseRequest, { idempotencyKey }: { idempotencyKey: string }) => {
      try {
        return await client.cases.create(body, { idempotencyKey });
      } catch (error) {
        showServerProblem(error);
        throw error;
      }
    },
    // The ref is allocated by the server; the new case opens on its next step.
    { onSuccess: (result) => router.push(caseTabHref(result.result.caseId, landing.current)) },
  );

  const submitAs = (target: Landing) =>
    form.handleSubmit(async (body) => {
      if (selected.data && selected.data.ref === body.assetRef && !selected.data.allowedActions.includes("case.create")) {
        form.setError("assetRef", { type: "server", message: CASE_CREATE_COPY.ACTIVE_CASE }, { shouldFocus: true });
        return;
      }
      landing.current = target;
      await command.run(body);
    });

  return (
    <form noValidate onSubmit={(event) => void submitAs("sharing")(event)} aria-describedby="create-case-help">
      <fieldset disabled={disabled || command.isPending} className="flex flex-col gap-3.5">
        <Panel title="Case">
          <div className="grid grid-cols-1 gap-3.5 xs:grid-cols-2">
            <Field label="Case name" hint="Shown to the case participants, e.g. Used CNC financing." error={errors.title?.message} className="xs:col-span-2">
              {(wired) => <TextInput wired={wired} autoComplete="off" maxLength={120} aria-required="true" {...form.register("title")} />}
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-medium text-fg-muted">Borrower</span>
              <p className={readOnly}>{me.org.name}</p>
            </div>
            <Field label="Registered asset" hint={<AssetHint assetRef={assetRef} />} error={errors.assetRef?.message}>
              {(wired) => (
                <SelectInput wired={wired} aria-required="true" {...form.register("assetRef")}>
                  <option value="">Select a registered asset</option>
                  {assets.map((asset) => (
                    <option key={asset.ref} value={asset.ref}>
                      {`${asset.ref} · ${asset.equipmentClass} · ${asset.model}`}
                    </option>
                  ))}
                </SelectInput>
              )}
            </Field>
            <Field label="Equipment purpose (optional)" error={errors.purpose?.message} className="xs:col-span-2">
              {(wired) => <TextArea wired={wired} rows={2} maxLength={500} {...form.register("purpose")} />}
            </Field>
          </div>
        </Panel>

        <Panel title="Counterparties">
          <div className="grid grid-cols-1 gap-3.5 xs:grid-cols-2">
            <Field
              label="Selected lender"
              hint="Creating the case shares nothing. The evidence package is shared with this lender only after you review sharing and consent."
              error={errors.selectedLenderOrgId?.message}
            >
              {(wired) => (
                <SelectInput wired={wired} aria-required="true" {...form.register("selectedLenderOrgId")}>
                  <option value="">Select a lender</option>
                  {lenders.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </SelectInput>
              )}
            </Field>
            <Field label="Invited dealer (optional)" hint="The dealer can add its own records to this case. It never sees loan terms." error={errors.dealerOrgId?.message}>
              {(wired) => (
                <SelectInput wired={wired} {...form.register("dealerOrgId")}>
                  <option value="">No dealer invited</option>
                  {dealers.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </SelectInput>
              )}
            </Field>
          </div>
        </Panel>

        <Panel title="Requested financing">
          <div className="grid grid-cols-1 gap-3.5 xs:grid-cols-[minmax(0,1fr)_110px]">
            <Field
              label="Requested principal (optional)"
              hint="Visible to your organization and the selected lender only. It is not a valuation."
              error={errors.principalAmount?.message}
            >
              {(wired) => <TextInput wired={wired} inputMode="decimal" className="font-mono" autoComplete="off" placeholder="100000.00" {...form.register("principalAmount")} />}
            </Field>
            <Field label="Currency" error={errors.principalCurrency?.message}>
              {(wired) => (
                <SelectInput wired={wired} {...form.register("principalCurrency")}>
                  {CASE_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </SelectInput>
              )}
            </Field>
          </div>
        </Panel>

        <p id="create-case-help" className="text-[12px] text-fg-subtle">
          {`The case is an application record of ${me.org.name}: no ledger transaction is submitted and nothing is shared until you review sharing. Its reference is assigned when you save.`}
        </p>
        <CommandStatus mode={mode} command={command.command} pending={command.isPending} error={command.error} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="lg">
            Review sharing
          </Button>
          <Button type="button" size="lg" variant="outline" onClick={() => void submitAs("summary")()}>
            Save draft
          </Button>
        </div>
      </fieldset>
    </form>
  );
}

/**
 * Create Financing Case `/app/cases/new` (S §9.3): one registered asset of the borrower's organization, one
 * selected lender from the onboarded directory, an optional invited dealer and requested principal. The borrower
 * organization is the signed-in one (derived server-side, never chosen here); POST /api/cases re-checks the owner,
 * the mandate, the counterparties and the one-case-per-asset rule.
 */
export function CreateCaseForm({ initialAssetRef }: { initialAssetRef?: string }) {
  const { me } = useSession();
  const allowed = offersCaseCreation(me);
  const assets = useAssetList({ enabled: allowed });
  const lenders = useDirectory("lenders");
  const dealers = useDirectory("dealers");
  const owned = (assets.data?.items ?? []).filter((a) => a.owner?.id === me.org.id && a.lifecycle.value === "REGISTERED");
  const queries = [assets, lenders, dealers];
  const failed = queries.find((q) => q.isError);

  let body;
  if (!allowed) {
    body = (
      <PermissionNotice reason="mandate" title="Creating a case needs the borrower mandate">
        Only the equipment owner organization can create a financing case. {me.org.name} cannot create cases with your current role.
      </PermissionNotice>
    );
  } else if (failed) {
    body = <ErrorState error={failed.error} onRetry={() => queries.forEach((q) => void q.refetch())} />;
  } else if (assets.isPending || lenders.isPending || dealers.isPending) {
    body = <LoadingState variant="card" rows={5} label="Loading your registered assets and the lender directory…" />;
  } else if (owned.length === 0) {
    body = (
      <PermissionNotice reason="scope" title="No registered asset">
        A case needs a registered asset owned by {me.org.name}.{" "}
        <Link href="/app/assets/new" className="text-fg underline underline-offset-4">
          Register asset
        </Link>
      </PermissionNotice>
    );
  } else {
    body = <CreateCaseFields assets={owned} lenders={lenders.data ?? []} dealers={dealers.data ?? []} initialAssetRef={initialAssetRef} disabled={!allowed} />;
  }

  return (
    <div className="flex max-w-[860px] flex-col gap-[18px]">
      <PageHeader
        title="Create case"
        description="Coordinates one registered asset with one selected lender. Evidence review, verification and sharing follow on the case."
        actions={
          <Link href="/app/cases" className={buttonVariants({ variant: "outline" })}>
            Cancel
          </Link>
        }
      />
      {body}
    </div>
  );
}
