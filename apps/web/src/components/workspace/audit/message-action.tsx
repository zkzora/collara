"use client";

import type { MutationOptions } from "@collara/api-client";
import type { CommandStatus } from "@collara/domain";
import { useState, type ReactNode } from "react";
import type { ConfirmationFacts } from "@/components/collara/confirmation-dialog";
import type { ActionVariant } from "../action-dialog";
import { TrackedActionDialog as ActionDialog } from "./page-command";
import { Field, TextArea } from "../form-fields";

/**
 * An ActionDialog with one required (or optional) free-text field: decline/reject reasons,
 * change and information requests, responses. The text is validated before submission.
 */
export function MessageAction({
  label,
  variant = "outline",
  danger = false,
  title,
  description,
  facts,
  caveat,
  confirmLabel,
  fieldLabel,
  hint,
  required = true,
  requiredMessage = "Enter a message.",
  maxLength = 1000,
  perform,
  onSuccess,
  size,
  className,
}: {
  label: string;
  variant?: ActionVariant;
  danger?: boolean;
  title: string;
  description: ReactNode;
  facts?: ConfirmationFacts;
  caveat?: ReactNode;
  confirmLabel: string;
  fieldLabel: string;
  hint?: string;
  required?: boolean;
  requiredMessage?: string;
  maxLength?: number;
  perform: (text: string, options: MutationOptions) => Promise<{ command: CommandStatus }>;
  onSuccess?: (command: CommandStatus) => void;
  size?: "default" | "sm" | "lg";
  className?: string;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | undefined>();
  return (
    <ActionDialog
      label={label}
      variant={variant}
      danger={danger}
      size={size}
      className={className}
      title={title}
      description={description}
      facts={facts}
      caveat={caveat}
      confirmLabel={confirmLabel}
      onOpen={() => {
        setText("");
        setError(undefined);
      }}
      prepare={() => {
        const value = text.trim();
        if (required && !value) {
          setError(requiredMessage);
          return null;
        }
        setError(undefined);
        return { text: value };
      }}
      perform={(payload, options) => perform(payload.text, options)}
      onSuccess={onSuccess}
    >
      <Field label={fieldLabel} hint={hint} error={error}>
        {(wired) => <TextArea wired={wired} rows={3} value={text} maxLength={maxLength} onChange={(event) => setText(event.target.value)} />}
      </Field>
    </ActionDialog>
  );
}
