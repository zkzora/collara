import { createMockClient } from "@collara/api-client/mock";
import type { PersonaId } from "@collara/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CollaraClientProvider } from "@/lib/collara-client";
import { SessionProvider } from "@/lib/session";
import { CaseWorkspaceContext } from "./case-context";
import { EvidenceTab } from "./evidence-tab";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

async function setup(personaId: PersonaId) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const mock = createMockClient({ personaId, latencyMs: 0, now: new Date("2026-10-02T08:00:00Z") });
  const detail = await mock.cases.get("CL-001");
  render(
    <QueryClientProvider client={queryClient}>
      <CollaraClientProvider mode="UI_MOCK" client={mock}>
        <SessionProvider pending={<p>Loading</p>} error={() => <p>Error</p>}>
          <CaseWorkspaceContext value={{ detail, trackCommand: () => undefined }}>
            <EvidenceTab />
          </CaseWorkspaceContext>
        </SessionProvider>
      </CollaraClientProvider>
    </QueryClientProvider>,
  );
  await screen.findByRole("region", { name: /^Evidence documents · CL-001/ });
  return detail;
}

describe("case Evidence tab `Add evidence`", () => {
  it("is offered to the owner and the invited dealer (its own records), when the server allows the upload", async () => {
    for (const persona of ["manufacturer-owner", "dealer-contributor"] as const) {
      const detail = await setup(persona);
      expect(detail.allowedActions, persona).toContain("evidence.upload");
      expect(screen.getByRole("button", { name: "Add evidence" }), persona).toBeInTheDocument();
      cleanup();
    }
  });

  it("is not offered to the lender", async () => {
    const detail = await setup("lender-a-analyst");
    expect(detail.allowedActions).not.toContain("evidence.upload");
    expect(screen.queryByRole("button", { name: "Add evidence" })).not.toBeInTheDocument();
  });
});
