// Overview figures (S §9.1; synthesis §1.4.2 #13): `Recorded financing principal` and `Recorded collateral
// valuation`, computed from the viewer's own facts only (the API passes the stakeholder-filtered read model; the
// UI_MOCK client relies on the same disclosure rules). The scope is the active pledges the viewer is a party to.
// One total per currency, never a cross-currency sum; a coverage line (values recorded of pledges in scope);
// missing values are excluded and counted, never treated as 0. A figure the viewer may not see at all is null.
import { z } from "zod";
import { FIGURE_LABELS } from "./copy";
import { LastSyncSchema } from "./dto";
import type { CaseFacts } from "./facts";
import { aggregateByCurrency, MoneySchema, type Money } from "./money";
import { caseDisclosure, type PresentContext } from "./presenters";
import { hasMandate, type Actor } from "./roles";

/** INFERRED copy (needs approval): what each figure is computed from. */
export const OVERVIEW_SOURCE_COPY = {
  PRINCIPAL: "Accepted financing agreements behind active pledges",
  VALUATION: "Your organization's collateral assessments of assets under active pledges",
} as const;

export const OverviewTotalSchema = z.object({
  total: MoneySchema,
  /** Records included in this currency's total. */
  count: z.number().int().nonnegative(),
});
export type OverviewTotal = z.infer<typeof OverviewTotalSchema>;

export const OverviewFigureSchema = z.object({
  label: z.string(),
  /** One total per ISO currency, sorted by code. Never summed across currencies. */
  totals: z.array(OverviewTotalSchema),
  /** Active pledges in the viewer's scope (`of`) and how many of them have a recorded value (`included`). */
  coverage: z.object({ included: z.number().int().nonnegative(), of: z.number().int().nonnegative() }),
  source: z.string(),
  /** Dates of the included records (activation for principal, valuation date for valuation); null when none. */
  dates: z.object({ earliest: z.iso.date(), latest: z.iso.date() }).nullable(),
});
export type OverviewFigure = z.infer<typeof OverviewFigureSchema>;

export const OverviewSchema = z.object({
  /** null: loan terms are not disclosed to this viewer (borrower and selected lender only). */
  principal: OverviewFigureSchema.nullable(),
  /** null: valuations are lender-only records (the lender's own collateral assessments). */
  valuation: OverviewFigureSchema.nullable(),
  /** Projection watermark the figures were read at (LOCALNET); { null, null } in UI_MOCK. */
  lastSync: LastSyncSchema,
});
export type Overview = z.infer<typeof OverviewSchema>;

function isBorrower(viewer: Actor): boolean {
  return viewer.roles.includes("BORROWER") && hasMandate(viewer, "BORROWER");
}

function isLender(viewer: Actor): boolean {
  return (
    (viewer.roles.includes("LENDER_ANALYST") && (hasMandate(viewer, "ANALYST") || hasMandate(viewer, "APPROVER"))) ||
    (viewer.roles.includes("LENDER_APPROVER") && hasMandate(viewer, "APPROVER"))
  );
}

function toDate(value: string): string | null {
  const day = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

function figure(label: string, source: string, values: readonly (Money | null)[], dates: readonly string[]): OverviewFigure {
  const aggregate = aggregateByCurrency(values);
  const days = dates.flatMap((d) => toDate(d) ?? []).sort();
  const [earliest] = days;
  const latest = days.at(-1);
  return {
    label,
    totals: aggregate.totals.map((t) => ({ total: t.total, count: t.count })),
    coverage: { included: aggregate.included, of: values.length },
    source,
    dates: earliest && latest ? { earliest, latest } : null,
  };
}

/**
 * Per-currency recorded figures for the Overview. Principal: the accepted agreement version each active lock
 * references (borrower and selected lender, terms disclosed). Valuation: the lender's own latest collateral
 * assessment of each pledged asset (lender organizations only). Unrelated organizations (e.g. Demo Lender B)
 * have no pledge in scope, so their figures cover nothing and reveal nothing.
 */
export function presentOverview(cases: readonly CaseFacts[], viewer: Actor, pctx: PresentContext): Overview {
  const borrower = isBorrower(viewer);
  const lender = isLender(viewer);
  const principals: (Money | null)[] = [];
  const principalDates: string[] = [];
  const valuations: (Money | null)[] = [];
  const valuationDates: string[] = [];

  for (const facts of cases) {
    const lock = facts.lock;
    if (!lock || lock.state !== "ACTIVE") continue;
    const d = caseDisclosure(facts, viewer, pctx);
    const asBorrower = borrower && d.isOwner && lock.borrowerOrgId === viewer.orgId;
    const asLender = lender && d.isLender && lock.lenderOrgId === viewer.orgId;
    if (!d.pledge || (!asBorrower && !asLender)) continue;

    const agreement = d.terms
      ? facts.proposals.find((p) => p.ref === lock.proposalRef && p.version === lock.proposalVersion && p.state === "ACCEPTED")
      : undefined;
    principals.push(agreement?.principal ?? null);
    if (agreement) principalDates.push(lock.activatedAt);

    if (asLender) {
      const assessment = facts.review.lenderOrgId === viewer.orgId ? facts.review.assessment : null;
      valuations.push(assessment?.valuation ?? null);
      if (assessment) valuationDates.push(assessment.valuationDate);
    }
  }

  return {
    principal: borrower || lender ? figure(FIGURE_LABELS.RECORDED_PRINCIPAL, OVERVIEW_SOURCE_COPY.PRINCIPAL, principals, principalDates) : null,
    valuation: lender ? figure(FIGURE_LABELS.RECORDED_VALUATION, OVERVIEW_SOURCE_COPY.VALUATION, valuations, valuationDates) : null,
    lastSync: { offset: pctx.sync.offset, at: pctx.sync.at },
  };
}
