import { MODE_BANNERS, type RuntimeMode } from "@collara/domain";
import { cn } from "@/lib/utils";

/**
 * Full-width environment banner. The first sentence is the exact mode string (MP L101–102); the
 * rest is the prototype's banner sentence plus who the viewer is acting as.
 */
export function ModeBanner({ mode, viewingAs, className }: { mode: RuntimeMode; viewingAs?: string; className?: string }) {
  return (
    <div
      role="note"
      aria-label="Environment"
      data-mode={mode}
      className={cn(
        "flex flex-none flex-wrap items-center justify-center gap-x-3.5 gap-y-0.5 border-b border-pending/25 bg-pending/10 px-4 py-1.5 text-center text-[12px] text-pending-strong",
        className,
      )}
    >
      <span className="font-mono font-medium tracking-[.03em]">{MODE_BANNERS[mode]}</span>
      <span className="text-pending-strong/85">
        Synthetic organizations and fixtures. No funds are transferred.
        {viewingAs ? ` Viewing as ${viewingAs}.` : null}
      </span>
    </div>
  );
}
