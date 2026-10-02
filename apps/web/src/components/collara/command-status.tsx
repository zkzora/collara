import { errorMessage } from "@collara/api-client";
import { commandStates, MODE_BANNERS, type CommandStatus as CommandStatusValue, type RuntimeMode } from "@collara/domain";
import { CircleCheckIcon, ClockIcon, InfoIcon, LoaderCircleIcon, OctagonXIcon, TriangleAlertIcon } from "lucide-react";
import { commandCopy, isLedgerConfirmed, PENDING_COPY } from "@/lib/commands";
import { shortId } from "@/lib/format";
import { cn } from "@/lib/utils";

type Tone = "pending" | "success" | "warning" | "danger" | "neutral";

const TONE_CLASS: Readonly<Record<Tone, string>> = {
  pending: "border-pending/30 bg-pending/5",
  success: "border-success/30 bg-success/5",
  warning: "border-warning/30 bg-warning/5",
  danger: "border-danger/30 bg-danger/5",
  neutral: "border-line bg-surface-sunken",
};

/**
 * Inline lifecycle of one workspace action (S §18.2 copy). Pending → command state → error.
 * `Confirmed on the ledger.` appears only for a non-simulated ledger commit that carries an update
 * id; simulated (UI_MOCK) commands are labelled with the mode banner instead.
 */
export function CommandStatus({
  mode,
  command,
  pending = false,
  error,
  className,
}: {
  mode: RuntimeMode;
  command: CommandStatusValue | null | undefined;
  pending?: boolean;
  error?: unknown;
  className?: string;
}) {
  let tone: Tone = "neutral";
  let text: string | null = null;
  let detail: string | null = null;
  let Icon = InfoIcon;

  if (pending) {
    tone = "pending";
    text = PENDING_COPY[mode];
    Icon = LoaderCircleIcon;
  } else if (error) {
    tone = "danger";
    text = errorMessage(error);
    Icon = OctagonXIcon;
  } else if (command) {
    text = commandCopy(command);
    if (command.simulated) {
      tone = "neutral";
      detail = MODE_BANNERS.UI_MOCK;
      Icon = InfoIcon;
    } else if (isLedgerConfirmed(command)) {
      tone = "success";
      Icon = CircleCheckIcon;
      detail = `Update ${shortId(command.updateId ?? "", 6, 4)}${command.completionOffset !== undefined ? ` · offset ${command.completionOffset}` : ""}`;
    } else if (command.state === "REJECTED" || command.state === "FAILED") {
      tone = "danger";
      Icon = OctagonXIcon;
    } else if (command.state === "UNKNOWN_OUTCOME") {
      tone = "warning";
      Icon = TriangleAlertIcon;
    } else if (command.state === "PROJECTED" || command.state === "COMMITTED") {
      tone = "success";
      Icon = CircleCheckIcon;
    } else {
      tone = "pending";
      Icon = command.state === "PROJECTION_DELAYED" ? ClockIcon : LoaderCircleIcon;
    }
  }

  return (
    <div role="status" aria-live="polite" className={cn(!text && "sr-only", className)}>
      {text ? (
        <div
          data-command-state={pending ? "PENDING" : error ? "ERROR" : command?.state}
          data-simulated={command?.simulated ? "true" : undefined}
          className={cn("flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-[13px]", TONE_CLASS[tone])}
        >
          <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0 text-fg-muted", Icon === LoaderCircleIcon && "animate-spin motion-reduce:animate-none")} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-fg">{text}</p>
            {command && !pending && !error ? (
              <p className="text-[12px] text-fg-subtle">
                {command.simulated ? "Simulated" : commandStates.label(command.state)}
                {detail ? ` · ${detail}` : null}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
