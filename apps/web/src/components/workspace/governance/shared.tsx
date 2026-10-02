import { BOUNDARY_COPY, type GovernanceState } from "@collara/domain";
import { StatusBadge, type StatusLike } from "@/components/collara/status-badge";
import { cn } from "@/lib/utils";

export const governanceProposalHref = (ref: string) => `/app/governance/${encodeURIComponent(ref)}`;

export function integrationBadge(state: GovernanceState): StatusLike {
  const tone = state.integration.status === "SIMULATED" ? "pending" : state.integration.status === "UNAVAILABLE" ? "danger" : "info";
  return { label: state.integration.label, tone };
}

export const isSimulated = (state: GovernanceState) => state.integration.status === "SIMULATED";

/** INFERRED copy (adapted from the prototype's governance caveat to the DM confirm-only model, CR-28). */
export function governanceCaveat(state: GovernanceState): string {
  const scope = "Governance administers the verifier registry only; it cannot authorize collateral release.";
  return isSimulated(state) ? `UI simulation. No Decentralization Manager transaction is submitted. ${scope}` : scope;
}

/** The integration status, shown wherever governance is shown (CR-07), plus the never-releases note. */
export function GovernanceNotice({ state, className }: { state: GovernanceState; className?: string }) {
  const simulated = isSimulated(state);
  return (
    <div
      role="note"
      aria-label="Governance integration status"
      className={cn(
        "flex flex-col gap-1.5 rounded-md border px-3.5 py-3 text-[13px] leading-relaxed xs:flex-row xs:gap-3",
        simulated ? "border-info/30 bg-info/5" : "border-line bg-surface-sunken",
        className,
      )}
    >
      <span className="shrink-0">
        <StatusBadge status={integrationBadge(state)} variant="pill" />
      </span>
      <span className="text-fg-muted">
        {simulated ? "Confirmations and execution are recorded locally until the Decentralization Manager integration is implemented. " : null}
        {state.integration.status === "DM_TIER_B" ? "Three local nodes do not prove three independent organizations. " : null}
        {BOUNDARY_COPY.GOVERNANCE_SCOPE}
      </span>
    </div>
  );
}

/** n-of-seats confirmation progress with a text alternative (never color alone). */
export function ConfirmationBar({ live, seats, threshold, size = "sm" }: { live: number; seats: number; threshold: number; size?: "sm" | "md" }) {
  return (
    <span className={cn("items-center gap-2", size === "sm" ? "inline-flex" : "flex w-full")}>
      <span role="img" aria-label={`${live} of ${seats} confirmations, threshold ${threshold}`} className={cn("flex gap-1", size === "sm" ? "w-[72px]" : "w-full")}>
        {Array.from({ length: seats }, (_, i) => (
          <span
            key={i}
            className={cn("flex-1 rounded-[2px]", size === "sm" ? "h-[5px]" : "h-1.5 rounded-[3px]", i < live ? "bg-success" : "bg-line-strong")}
          />
        ))}
      </span>
      {size === "sm" ? <span aria-hidden="true" className="font-mono text-[12px] text-fg-muted">{`${live} of ${seats}`}</span> : null}
    </span>
  );
}
