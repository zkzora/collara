import { createMockClient } from "@collara/api-client/mock";
import { buildScenario, money, type PersonaId } from "@collara/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CollaraClientProvider } from "@/lib/collara-client";
import { SessionProvider } from "@/lib/session";
import { RecordedFigures } from "./recorded-figures";

const NOW = new Date("2026-10-02T08:00:00Z");

function setup(personaId: PersonaId, world = buildScenario({ now: NOW })) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const mock = createMockClient({ personaId, latencyMs: 0, now: new Date(NOW), world });
  render(
    <QueryClientProvider client={queryClient}>
      <CollaraClientProvider mode="UI_MOCK" client={mock}>
        <SessionProvider pending={<p>Loading</p>} error={() => <p>Error</p>}>
          <RecordedFigures expected />
        </SessionProvider>
      </CollaraClientProvider>
    </QueryClientProvider>,
  );
}

describe("RecordedFigures", () => {
  it("shows the lender one total per currency with coverage and source, never a cross-currency sum", async () => {
    const world = buildScenario({ now: NOW });
    const pledged = world.cases.find((c) => c.lock?.state === "ACTIVE")!;
    const eur = structuredClone(pledged);
    eur.ref = "CL-091";
    eur.lock = { ...eur.lock!, ref: "PL-091" };
    eur.proposals = eur.proposals.map((p) => ({ ...p, principal: money("50000.00", "EUR") }));
    eur.review = { ...eur.review, assessment: null };
    world.cases.push(eur);
    setup("lender-a-approver", world);

    const principal = await screen.findByRole("list", { name: "Recorded financing principal by currency" });
    expect(within(principal).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["50,000.00EUR1 pledge", "180,000.00USD1 pledge"]);
    expect(screen.getByText("2 of 2 active pledges with a recorded principal.")).toBeInTheDocument();
    // The EUR pledge has no recorded valuation: excluded and reported in the coverage, not counted as 0.
    const valuation = screen.getByRole("list", { name: "Recorded collateral valuation by currency" });
    expect(within(valuation).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["260,000.00USD"]);
    expect(screen.getByText("1 of 2 active pledges with a recorded valuation.")).toBeInTheDocument();
    expect(screen.getByText(/Source: Accepted financing agreements behind active pledges · Activated \d{4}-\d{2}-\d{2}.* · No ledger connection · UI mockup/)).toBeInTheDocument();
    expect(screen.getByText("Valuation and principal are separate fields.")).toBeInTheDocument();
  });

  it("shows the borrower `Not available` when nothing is recorded and no valuation at all", async () => {
    setup("manufacturer-owner");
    expect(await screen.findByRole("heading", { name: "Recorded financing principal" })).toBeInTheDocument();
    expect(screen.getByText("Not available")).toBeInTheDocument();
    expect(screen.getByText("No active pledges in your organization's scope.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Recorded collateral valuation" })).not.toBeInTheDocument();
    expect(screen.queryByText(/^0(\.00)?$/)).not.toBeInTheDocument();
  });

  it("renders nothing for roles that see no figures", async () => {
    setup("verifier-inspector");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("region", { name: "Recorded figures" })).not.toBeInTheDocument();
    expect(screen.queryByText("Recorded financing principal")).not.toBeInTheDocument();
  });
});
