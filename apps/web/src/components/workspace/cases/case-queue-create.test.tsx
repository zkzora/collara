import { createMockClient } from "@collara/api-client/mock";
import { EMPTY_STATE_COPY, type PersonaId, type SeedProfile } from "@collara/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CollaraClientProvider } from "@/lib/collara-client";
import { SessionProvider } from "@/lib/session";
import { CaseQueue } from "../case-queue";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

function setup(personaId: PersonaId, profile: SeedProfile = "main") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const mock = createMockClient({ personaId, latencyMs: 0, now: new Date("2026-10-02T08:00:00Z"), profile });
  render(
    <QueryClientProvider client={queryClient}>
      <CollaraClientProvider mode="UI_MOCK" client={mock}>
        <SessionProvider pending={<p>Loading</p>} error={() => <p>Error</p>}>
          <CaseQueue view="all" />
        </SessionProvider>
      </CollaraClientProvider>
    </QueryClientProvider>,
  );
}

describe("Case Queue `Create case`", () => {
  it("is offered to the borrower in the header", async () => {
    setup("manufacturer-owner");
    await screen.findByRole("table", { name: "Cases · All" });
    expect(screen.getByRole("link", { name: "Create case" })).toHaveAttribute("href", "/app/cases/new");
  });

  it("is not offered to lenders, Lender B or the dealer", async () => {
    for (const persona of ["lender-a-approver", "lender-b-approver", "dealer-contributor"] as const) {
      setup(persona);
      await screen.findByRole("table", { name: "Cases · All" });
      expect(screen.queryByRole("link", { name: "Create case" }), persona).not.toBeInTheDocument();
      cleanup();
    }
  });

  it("leads the borrower from the empty queue to case creation", async () => {
    setup("manufacturer-owner", "clean-start");
    await waitFor(() => expect(screen.getByText(EMPTY_STATE_COPY.NEW_CASE)).toBeInTheDocument());
    expect(screen.getAllByRole("link", { name: "Create case" })).toHaveLength(2);
    expect(screen.getByRole("region", { name: "Cases · All" })).toBeInTheDocument();
  });
});
