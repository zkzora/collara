"use client";

import type { MutationOptions } from "@collara/api-client";
import type { CommandStatus as CommandStatusValue } from "@collara/domain";
import { useState, type ReactNode } from "react";
import { CommandStatus } from "@/components/collara/command-status";
import { ConfirmationDialog, type ConfirmationFacts } from "@/components/collara/confirmation-dialog";
import { Button } from "@/components/ui/button";
import { useCollara } from "@/lib/collara-client";
import { useCommand } from "@/lib/commands";
import { cn } from "@/lib/utils";
import { useOptionalCaseWorkspace } from "./case/case-context";

export type ActionVariant = "primary" | "outline" | "danger";

const TRIGGER: Readonly<Record<ActionVariant, { variant: "default" | "outline"; className?: string }>> = {
  primary: { variant: "default" },
  outline: { variant: "outline" },
  danger: { variant: "outline", className: "border-danger/40 text-danger-strong hover:bg-danger/10 hover:text-danger-strong" },
};

/**
 * Button + ConfirmationDialog + command lifecycle for one workspace action (the pattern Part B
 * reuses). `prepare` validates inputs and returns the request payload (null blocks submission);
 * `perform` calls the client with the idempotency key. Errors stay in the dialog for a safe retry
 * with the same key; on success the dialog closes, the scoped cache is invalidated, a toast
 * announces the outcome and, inside a case, the case header keeps the live command status.
 */
export function ActionDialog<TPayload>({
  label,
  variant = "outline",
  size = "default",
  title,
  description,
  facts,
  caveat,
  confirmLabel,
  danger = false,
  prepare,
  perform,
  onOpen,
  onSuccess,
  children,
  className,
}: {
  label: string;
  variant?: ActionVariant;
  size?: "default" | "sm" | "lg";
  title: string;
  description: ReactNode;
  facts?: ConfirmationFacts;
  caveat?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** Validate and build the payload; return null to keep the dialog open (field errors shown by the form). */
  prepare: () => TPayload | null | Promise<TPayload | null>;
  perform: (payload: TPayload, options: MutationOptions) => Promise<{ command: CommandStatusValue }>;
  /** Reset form state when the dialog opens. */
  onOpen?: () => void;
  onSuccess?: (command: CommandStatusValue) => void;
  children?: ReactNode;
  className?: string;
}) {
  const { mode } = useCollara();
  const workspace = useOptionalCaseWorkspace();
  const [open, setOpen] = useState(false);
  const command = useCommand((payload: TPayload, options: MutationOptions) => perform(payload, options), {
    onSuccess: (result) => {
      workspace?.trackCommand(result.command);
      onSuccess?.(result.command);
    },
  });
  const trigger = TRIGGER[variant];

  async function confirm() {
    const payload = await prepare();
    if (payload === null) return;
    if (await command.run(payload)) setOpen(false);
  }

  return (
    <>
      <Button
        type="button"
        variant={trigger.variant}
        size={size}
        className={cn(trigger.className, className)}
        onClick={() => {
          command.reset();
          onOpen?.();
          setOpen(true);
        }}
      >
        {label}
      </Button>
      <ConfirmationDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        facts={facts}
        caveat={caveat}
        confirmLabel={confirmLabel}
        danger={danger}
        pending={command.isPending}
        onConfirm={() => void confirm()}
        status={<CommandStatus mode={mode} command={null} pending={command.isPending} error={command.error} />}
      >
        {children}
      </ConfirmationDialog>
    </>
  );
}

/** Payload-free actions: `prepare` always passes. */
export const noPayload = (): Record<string, never> => ({});
