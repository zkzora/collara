import { EyeOffIcon, InfoIcon, LockIcon, ShieldAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Why something is not shown or not actionable for this viewer: a mandate the user lacks, another
 * organization's record, a scoped grant, or a simulation boundary. Give it an `id` and point the
 * related control's `aria-describedby` at it so the reason is announced with the control.
 */
export function PermissionNotice({
  id,
  reason = "mandate",
  title,
  children,
  className,
}: {
  id?: string;
  reason?: "mandate" | "organization" | "scope" | "simulation";
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  const Icon = { mandate: LockIcon, organization: EyeOffIcon, scope: ShieldAlertIcon, simulation: InfoIcon }[reason];
  return (
    <div
      id={id}
      className={cn(
        "flex gap-2.5 rounded-md border border-line-subtle bg-surface-sunken px-3.5 py-3 text-[13px] leading-relaxed text-fg-muted",
        reason === "simulation" && "border-info/30 bg-info/5",
        className,
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
      <div className="min-w-0">
        {title ? <p className="font-medium text-fg">{title}</p> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}
