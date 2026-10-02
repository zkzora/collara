import { createMockClient } from "@collara/api-client/mock";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CollaraClientProvider } from "@/lib/collara-client";
import { SessionProvider, useSession } from "@/lib/session";
import { personaSummary, DEMO_PERSONAS } from "@collara/domain";
import { joinParts } from "@/lib/format";
import { demoPersonaOption, mockPersonaOptions, PersonaSwitcher } from "./persona-switcher";

function Viewer() {
  const { me, scope } = useSession();
  return (
    <p data-testid="viewer">
      {me.user.displayName} · {scope}
    </p>
  );
}

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const clear = vi.spyOn(queryClient, "clear");
  const mock = createMockClient({ latencyMs: 0, now: new Date("2026-10-02T08:00:00Z") });
  render(
    <QueryClientProvider client={queryClient}>
      <CollaraClientProvider mode="UI_MOCK" client={mock}>
        <SessionProvider pending={<p>Loading</p>} error={() => <p>Error</p>}>
          <PersonaSwitcher />
          <Viewer />
        </SessionProvider>
      </CollaraClientProvider>
    </QueryClientProvider>,
  );
  return { queryClient, clear, mock };
}

describe("PersonaSwitcher", () => {
  it("is a labelled selector defaulting to the Lender A approver", async () => {
    setup();
    const select = await screen.findByLabelText("Demo persona (synthetic)");
    expect(select).toHaveValue("lender-a-approver");
    expect(screen.getByTestId("viewer")).toHaveTextContent("Morgan Hale · mock:lender-a-approver");
  });

  it("switches persona, clears every cached query and re-reads the viewer", async () => {
    const user = userEvent.setup();
    const { queryClient, clear, mock } = setup();
    const select = await screen.findByLabelText("Demo persona (synthetic)");
    queryClient.setQueryData(["mock:lender-a-approver", "cases", "detail", "CL-001"], { cached: true });

    await user.selectOptions(select, "lender-b-approver");

    await waitFor(() => expect(clear).toHaveBeenCalledOnce());
    expect(mock.getPersona()).toBe("lender-b-approver");
    expect(queryClient.getQueryData(["mock:lender-a-approver", "cases", "detail", "CL-001"])).toBeUndefined();
    await waitFor(() => expect(screen.getByTestId("viewer")).toHaveTextContent("Lender B approver · mock:lender-b-approver"));
  });
});

describe("persona labels", () => {
  it("names LOCALNET personas like UI_MOCK: business role, never the governance seat, short in the sidebar", () => {
    // The API lists roles in storage order; the label must still read "Lender Approver".
    const approver = { ...personaSummary(DEMO_PERSONAS["lender-a-approver"]), roleLabels: ["Governance Member", "Lender Approver"] };
    expect(demoPersonaOption(approver).label).toBe("Morgan Hale — Lender Approver");
    expect(demoPersonaOption(approver, { short: true }).label).toBe("Morgan Hale · Approver");
    const mock = mockPersonaOptions({ short: true }).find((o) => o.id === "lender-a-approver");
    expect(mock?.label).toBe(demoPersonaOption(approver, { short: true }).label);
    expect(demoPersonaOption(personaSummary(DEMO_PERSONAS.auditor), { short: true }).label).toBe("Audit lead · Auditor");
  });

  it("joins only the parts that have a value", () => {
    expect(joinParts(["CNC machining center", "DEMO-CNC-500", "ASSET-DEMO-001"])).toBe("CNC machining center · DEMO-CNC-500 · ASSET-DEMO-001");
    expect(joinParts(["", " ", null, undefined, "ASSET-DEMO-001"])).toBe("ASSET-DEMO-001");
    expect(joinParts([])).toBe("");
  });
});
