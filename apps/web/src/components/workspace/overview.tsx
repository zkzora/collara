"use client";

import {
  BOUNDARY_COPY,
  EMPTY_STATE_COPY,
  FIGURE_LABELS,
  NEXT_ACTIONS,
  NOT_AVAILABLE,
  OPEN_VERIFICATION_STATES,
  type CaseSummary,
  type Me,
  type SavedView,
} from "@collara/domain";
import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { CaseTimeline } from "@/components/collara/case-timeline";
import { EmptyState } from "@/components/collara/empty-state";
import { ErrorState } from "@/components/collara/error-state";
import { LedgerSyncIndicator } from "@/components/collara/ledger-sync";
import { LoadingState } from "@/components/collara/loading-state";
import { casesHref } from "@/components/collara/navigation";
import { PageHeader } from "@/components/collara/page-header";
import { Panel } from "@/components/collara/panel";
import { StatusBadge, type StatusLike } from "@/components/collara/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useCollara } from "@/lib/collara-client";
import {
  useAccessGrants,
  useAuditEvents,
  useCaseList,
  useGovernanceProposals,
  usePledgeList,
  useReportList,
  useVerificationList,
} from "@/lib/queries";
import { useSession } from "@/lib/session";
import { nextActionHref } from "./case/links";
import { joinParts } from "@/lib/format";

type Persona = "lender" | "borrower" | "verifier" | "auditor" | "dealer" | "other";

function personaOf(me: Me): Persona {
  const roles = new Set(me.roles);
  if (roles.has("LENDER_APPROVER") || roles.has("LENDER_ANALYST")) return "lender";
  if (roles.has("BORROWER")) return "borrower";
  if (roles.has("VERIFIER")) return "verifier";
  if (roles.has("AUDITOR")) return "auditor";
  if (roles.has("DEALER")) return "dealer";
  return "other";
}

interface Tile {
  readonly label: string;
  readonly value: number | null | undefined;
  readonly footer: string;
  readonly href: string;
}

function StatTile({ tile }: { tile: Tile }) {
  return (
    <Link
      href={tile.href}
      className="group flex flex-col gap-2 rounded-lg border border-line bg-surface-1 p-4 outline-none transition-colors hover:border-line-hover focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="text-[12.5px] text-fg-muted">{tile.label}</span>
      {tile.value === undefined ? (
        <Skeleton className="h-8 w-10" />
      ) : (
        <span className="font-mono text-[26px] leading-tight font-medium tracking-[-0.02em] text-fg">{tile.value ?? "—"}</span>
      )}
      <span className="text-[12px] text-fg-subtle group-hover:text-fg-muted">
        {tile.footer} <ArrowRightIcon aria-hidden="true" className="inline size-3" />
      </span>
    </Link>
  );
}

interface ActionRow {
  readonly key: string;
  readonly ref: string;
  readonly title: string;
  readonly sub: string;
  readonly state: StatusLike | null;
  readonly href: string;
}

function ActionList({ rows }: { rows: readonly ActionRow[] }) {
  return (
    <ul className="flex flex-col">
      {rows.map((row) => (
        <li key={row.key} className="border-b border-line-subtle last:border-b-0">
          <Link
            href={row.href}
            className="grid grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-1 px-4 py-[13px] outline-none hover:bg-white/[.03] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset xs:grid-cols-[64px_minmax(0,1fr)_auto] xs:items-center"
          >
            <span className="font-mono text-[12px] text-fg-muted">{row.ref}</span>
            <span className="min-w-0">
              <span className="block text-[13.5px] text-fg">{row.title}</span>
              <span className="block truncate text-[12px] text-fg-subtle">{row.sub}</span>
            </span>
            <StatusBadge status={row.state} className="text-[12px] text-fg-muted" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

const count = (items: readonly CaseSummary[] | undefined, test: (item: CaseSummary) => boolean) => items?.filter(test).length;

function useTiles(persona: Persona): Tile[] {
  const all = useCaseList("all", { enabled: persona !== "verifier" && persona !== "other" });
  const pledges = usePledgeList(undefined, { enabled: persona === "lender" || persona === "borrower" });
  const verifications = useVerificationList({ enabled: persona === "verifier" });
  const grants = useAccessGrants(undefined, { enabled: persona === "auditor" });
  const reports = useReportList({ enabled: persona === "auditor" });
  const counts = all.data?.counts;
  const view = (v: SavedView) => counts?.[v];
  const activePledges = pledges.data?.items.filter((p) => p.lockState.value === "ACTIVE").length;
  const queue = (v: SavedView) => casesHref(v);
  const items = all.data?.items;
  // "Nearing expiry" = within 30 days of when the page was opened.
  const [soon] = useState(() => Date.now() + 30 * 86_400_000);

  switch (persona) {
    case "lender":
      return [
        { label: "Cases awaiting review", value: view("ready-for-review"), footer: "Open queue", href: queue("ready-for-review") },
        { label: "Missing evidence", value: view("needs-evidence"), footer: "Open queue", href: queue("needs-evidence") },
        { label: "Decisions awaiting approval", value: view("awaiting-approval"), footer: "Open queue", href: queue("awaiting-approval") },
        { label: "Active pledges", value: activePledges, footer: "Open pledges", href: "/app/pledges" },
        { label: "Release requests", value: view("release-requests"), footer: "Open queue", href: queue("release-requests") },
      ];
    case "borrower":
      return [
        { label: "My cases", value: view("all"), footer: "Open cases", href: queue("all") },
        { label: "Evidence requested", value: view("needs-evidence"), footer: "Open queue", href: queue("needs-evidence") },
        {
          label: "Verification pending",
          value: count(items, (c) => !!c.verification && OPEN_VERIFICATION_STATES.includes(c.verification.value)),
          footer: "Open cases",
          href: queue("all"),
        },
        {
          label: "Proposals awaiting acceptance",
          value: count(items, (c) => c.isMine && c.nextAction?.code === "RESPOND_TO_PROPOSAL"),
          footer: "Open my actions",
          href: queue("mine"),
        },
        { label: "Active pledges", value: activePledges, footer: "Open pledges", href: "/app/pledges" },
      ];
    case "verifier": {
      const list = verifications.data?.items;
      const by = (test: (v: NonNullable<typeof list>[number]) => boolean) => list?.filter(test).length;
      return [
        { label: "Assigned inspections", value: by((v) => v.state.value === "REQUESTED" || v.state.value === "IN_REVIEW"), footer: "Open verifications", href: "/app/verifications" },
        { label: "Changes awaiting response", value: by((v) => v.state.value === "CHANGES_REQUESTED"), footer: "Open verifications", href: "/app/verifications" },
        { label: "Attestations issued", value: by((v) => v.state.value === "ATTESTED"), footer: "Open verifications", href: "/app/verifications" },
        {
          label: "Attestations nearing expiry",
          value: by((v) => !!v.attestation && v.attestation.validity.value === "VALID" && Date.parse(v.attestation.validUntil) < soon),
          footer: "Open verifications",
          href: "/app/verifications",
        },
      ];
    }
    case "auditor":
      return [
        { label: "Granted cases", value: view("all"), footer: "Open cases", href: queue("all") },
        {
          label: "Expiring access",
          value: grants.data?.items.filter((g) => g.kind === "AUDIT" && g.state.value === "GRANTED" && g.expiresAt && Date.parse(g.expiresAt) < soon).length,
          footer: "Open cases",
          href: queue("all"),
        },
        { label: "Report exports", value: reports.data?.items.length, footer: "Open exports", href: "/app/audit/exports" },
      ];
    case "dealer":
      return [{ label: "Invited cases", value: view("all"), footer: "Open cases", href: queue("all") }];
    case "other":
      return [];
  }
}

function useActionRows(persona: Persona): {
  rows: ActionRow[];
  isPending: boolean;
  error: unknown;
  governanceUnavailable: boolean;
  retry: () => void;
} {
  const { me } = useSession();
  const { mode } = useCollara();
  const mine = useCaseList("mine", { enabled: persona !== "verifier" && persona !== "other" });
  const verifications = useVerificationList({ enabled: persona === "verifier" });
  const seat = me.navigation.includes("governance");
  const governance = useGovernanceProposals({ enabled: seat });

  const rows: ActionRow[] = [];
  for (const proposal of governance.data ?? []) {
    const verb = proposal.allowedActions.includes("execute") ? "Execute" : proposal.allowedActions.includes("confirm") ? "Confirm" : null;
    if (!verb) continue;
    rows.push({
      key: `gov-${proposal.ref}`,
      ref: proposal.ref,
      title: `${verb} governance proposal · ${proposal.typeLabel} ${proposal.target.orgName}`,
      sub: `BitSafe governance · ${proposal.liveConfirmations} of ${proposal.threshold} confirmations${mode === "UI_MOCK" ? " · UI simulation" : ""}`,
      state: proposal.state,
      href: `/app/governance/${encodeURIComponent(proposal.ref)}`,
    });
  }
  for (const item of mine.data?.items ?? []) {
    rows.push({
      key: item.caseId,
      ref: item.caseId,
      title: item.nextAction?.label ?? item.title,
      sub: joinParts([item.title, item.asset.equipmentClass, item.asset.ref]),
      state: item.stage,
      href: item.nextAction ? nextActionHref(item.caseId, item.nextAction.code) : `/app/cases/${encodeURIComponent(item.caseId)}/summary`,
    });
  }
  for (const v of verifications.data?.items ?? []) {
    if (v.allowedActions.length === 0) continue;
    const title =
      v.state.value === "REQUESTED" ? NEXT_ACTIONS.ACCEPT_ASSIGNMENT : v.state.value === "IN_REVIEW" ? NEXT_ACTIONS.SUBMIT_ATTESTATION : v.state.label;
    rows.push({ key: v.ref, ref: v.ref, title, sub: joinParts([v.equipmentSummary, v.assetRef]), state: v.state, href: `/app/verifications/${encodeURIComponent(v.ref)}` });
  }

  // Case and verification queues are the work list; governance rows are additive and must not hide it.
  const primary = [mine, verifications].filter((q) => q.fetchStatus !== "idle" || q.status !== "pending");
  const failed = primary.find((q) => q.isError);
  return {
    rows,
    isPending: primary.some((q) => q.isPending) || (seat && governance.isPending),
    error: failed?.error ?? null,
    governanceUnavailable: seat && governance.isError,
    retry: () => primary.forEach((q) => void q.refetch()),
  };
}

function Figure({ label, source }: { label: string; source: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[13px] text-fg-muted">{label}</p>
      <p className="text-lg text-fg-muted">{NOT_AVAILABLE}</p>
      <p className="text-[12px] leading-relaxed text-fg-subtle">{source}</p>
    </div>
  );
}

/** Overview `/app` (S §9.1): role-specific work queue, per-currency recorded figures, recent activity. */
export function Overview() {
  const { me, mode, ledgerSync } = useSession();
  const persona = personaOf(me);
  const tiles = useTiles(persona);
  const actions = useActionRows(persona);
  const recent = useAuditEvents({ limit: 5 }, { enabled: me.navigation.includes("audit") });
  const showFigures = persona === "lender" || persona === "borrower";

  return (
    <div className="flex flex-col gap-[22px]">
      <PageHeader
        title="Overview"
        description={`Work that needs a decision or an action from ${me.org.name}. Counts include only records your organization is permitted to see.`}
        meta={<LedgerSyncIndicator mode={mode} sync={ledgerSync} className="app:hidden" />}
      />

      {tiles.length > 0 ? (
        <section aria-label="Work counts" className="grid grid-cols-1 gap-3 xs:grid-cols-2 app:grid-cols-[repeat(auto-fit,minmax(170px,1fr))]">
          {tiles.map((tile) => (
            <StatTile key={tile.label} tile={tile} />
          ))}
        </section>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-3.5 app:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Panel
          title="Needs your action"
          padded={false}
          action={actions.isPending ? null : `${actions.rows.length} ${actions.rows.length === 1 ? "item" : "items"}`}
        >
          {actions.error ? (
            <ErrorState error={actions.error} onRetry={actions.retry} className="m-4" />
          ) : actions.isPending ? (
            <LoadingState variant="table" rows={3} className="p-4" label="Loading your action queue…" />
          ) : actions.rows.length === 0 ? (
            <EmptyState headingLevel={3}>{EMPTY_STATE_COPY.OVERVIEW}</EmptyState>
          ) : (
            <ActionList rows={actions.rows} />
          )}
          {actions.governanceUnavailable ? (
            <p className="border-t border-line-subtle px-4 py-3 text-[12px] text-fg-subtle">Governance proposals could not be loaded.</p>
          ) : null}
        </Panel>

        <div className="flex flex-col gap-3.5">
          {showFigures ? (
            <Panel aria-label="Recorded figures" bodyClassName="flex flex-col gap-4">
              <Figure
                label={FIGURE_LABELS.RECORDED_PRINCIPAL}
                source="Source: accepted proposals, ledger-committed · Not a valuation, balance, or TVL figure."
              />
              <div className="border-t border-line-subtle" />
              <Figure label={FIGURE_LABELS.RECORDED_VALUATION} source="Source: verifier inspection reports · dated per attestation" />
              <p className="text-[12px] text-fg-subtle">{BOUNDARY_COPY.VALUATION_PRINCIPAL_SEPARATE}</p>
            </Panel>
          ) : null}

          {me.navigation.includes("audit") ? (
            <Panel
              title="Recent activity"
              padded={false}
              action={
                <Link href="/app/audit" className="text-[12.5px] text-fg-muted hover:text-fg">
                  Audit center <ArrowRightIcon aria-hidden="true" className="inline size-3" />
                </Link>
              }
            >
              {recent.isError ? (
                <ErrorState error={recent.error} onRetry={() => void recent.refetch()} className="m-4" />
              ) : recent.isPending ? (
                <LoadingState variant="table" rows={3} className="p-4" label="Loading recent activity…" />
              ) : (
                <CaseTimeline events={recent.data.items} compact />
              )}
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}
