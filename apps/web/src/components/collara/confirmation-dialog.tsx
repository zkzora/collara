"use client";

import { useRef, type FormEvent, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DefinitionList } from "./definition-list";

export interface ConfirmationFacts {
  /** "Demo Lender A · Lender Approver" */
  readonly actingParty: string;
  /** Record and version the action applies to, e.g. "CA-001 · assessment v1". */
  readonly record: string;
  /** What changes, e.g. "IN_REVIEW → ELIGIBLE (this lender, this case)". */
  readonly effect: string;
}

/**
 * Focus-trapped confirmation for a sensitive action (S §8.3): what changes, the acting party, the
 * record/version and the obligations that remain. Escape or Cancel closes it unless a submission is
 * in flight. `children` holds optional inputs (the dialog is a form, so Enter submits);
 * `status` is where CommandStatus goes so errors stay visible for a retry.
 */
export function ConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  facts,
  caveat,
  confirmLabel,
  cancelLabel = "Cancel",
  danger = false,
  pending = false,
  confirmDisabled = false,
  onConfirm,
  status,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  facts?: ConfirmationFacts;
  caveat?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  pending?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  status?: ReactNode;
  children?: ReactNode;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending && !confirmDisabled) onConfirm();
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return;
        onOpenChange(next);
      }}
    >
      <AlertDialogContent
        // Without inputs, start on Cancel so Enter never confirms by accident.
        initialFocus={children ? true : cancelRef}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-[22px] data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-[520px]"
      >
        <form onSubmit={submit} className="flex flex-col gap-3.5" noValidate>
          <AlertDialogTitle className="text-base font-medium text-fg">{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-[13.5px] leading-relaxed text-fg-muted md:text-pretty">{description}</AlertDialogDescription>
          {facts ? (
            <div className="rounded-md border border-line-subtle bg-surface-sunken px-3.5 py-3">
              <DefinitionList
                termWidth="sm"
                items={[
                  { term: "Acting party", description: facts.actingParty },
                  { term: "Record", description: <span className="font-mono text-[12.5px]">{facts.record}</span> },
                  { term: "Effect", description: facts.effect },
                ]}
              />
            </div>
          ) : null}
          {children}
          {caveat ? <p className="text-[12.5px] leading-relaxed text-fg-subtle">{caveat}</p> : null}
          {status}
          <div className="mt-1 flex flex-col-reverse gap-2 xs:flex-row xs:justify-end">
            <AlertDialogCancel ref={cancelRef} disabled={pending}>
              {cancelLabel}
            </AlertDialogCancel>
            <Button
              type="submit"
              disabled={pending || confirmDisabled}
              aria-disabled={pending || confirmDisabled}
              className={cn(danger && "bg-danger text-on-tone hover:bg-danger-strong")}
            >
              {pending ? "Submitting…" : confirmLabel}
            </Button>
          </div>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
