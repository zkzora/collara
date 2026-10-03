import { createMockClient, type MockCollaraClient } from "@collara/api-client/mock";
import { STATUS_COPY, type PersonaId } from "@collara/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { CollaraClientProvider } from "@/lib/collara-client";
import { SessionProvider } from "@/lib/session";
import { CaseWorkspaceContext } from "../case/case-context";
import { SharingTab } from "../case/sharing-tab";
import { DealerConsentRequests, DealerConsentStatus } from "./consent-requests";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const NOW = new Date("2026-10-02T08:00:00Z");

/** The owner's case-linked verification request (CL-001, including the dealer's invoice DOC-003). */
async function withPendingRequest(mock: MockCollaraClient): Promise<string> {
  const persona = mock.getPersona();
  mock.setPersona("manufacturer-owner");
  const vr = await mock.assets.requestVerification("ASSET-DEMO-001", { verifierRegistryRef: "VER-001", scope: ["Serial consistency"], documentIds: ["DOC-001", "DOC-003"], caseId: "CL-001" });
  mock.setPersona(persona);
  return `${vr.result.verificationRef}-G2-D1`;
}

function renderWith(mock: MockCollaraClient, children: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <CollaraClientProvider mode="UI_MOCK" client={mock}>
        <SessionProvider pending={<p>Loading</p>} error={() => <p>Error</p>}>
          {children}
        </SessionProvider>
      </CollaraClientProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const mockAs = (personaId: PersonaId) => createMockClient({ personaId, latencyMs: 0, now: new Date(NOW) });
const rowOf = (region: HTMLElement, text: string) => {
  const row = within(region)
    .getAllByRole("row")
    .find((r) => r.textContent?.includes(text));
  if (!row) throw new Error(`no row with ${text}`);
  return row;
};

describe("DealerConsentRequests (dealer)", () => {
  it("lists pending and granted requests with the dealer's own documents, version, short hash, recipient, purpose and expiry", async () => {
    const mock = mockAs("dealer-contributor");
    const pendingId = await withPendingRequest(mock);
    renderWith(mock, <DealerConsentRequests caseId="CL-001" />);
    const region = await screen.findByRole("region", { name: "Consent requests · CL-001" });
    const pending = rowOf(region, pendingId);
    expect(pending).toHaveTextContent("Dealer invoice · DOC-003 v1");
    expect(pending).toHaveTextContent(/SHA-256 [0-9a-f]{8}…[0-9a-f]{6}/);
    expect(pending).toHaveTextContent("Demo Verifier");
    expect(pending).toHaveTextContent(`Verification · ${pendingId.replace(/-G2-D1$/, "")}`);
    expect(pending).toHaveTextContent("Awaiting consent");
    expect(within(pending).getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(within(pending).getByRole("button", { name: "Decline" })).toBeInTheDocument();
    const granted = rowOf(region, "AG-001");
    expect(granted).toHaveTextContent("Demo Lender A");
    expect(granted).toHaveTextContent("Lender review");
    expect(granted).toHaveTextContent("Consent granted");
    expect(within(granted).getByRole("button", { name: "Withdraw consent" })).toBeInTheDocument();
    expect(within(granted).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    // Never the owner's documents.
    expect(region).not.toHaveTextContent(/DOC-001|DOC-002|DOC-005/);
    expect(screen.getByText("1 awaiting your consent")).toBeInTheDocument();
  });

  it("approves behind a confirmation that names the recipient, the documents and the effect", async () => {
    const mock = mockAs("dealer-contributor");
    const pendingId = await withPendingRequest(mock);
    const user = renderWith(mock, <DealerConsentRequests caseId="CL-001" />);
    const region = await screen.findByRole("region", { name: "Consent requests · CL-001" });
    await user.click(within(rowOf(region, pendingId)).getByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("alertdialog", { name: `Approve consent · ${pendingId}` });
    expect(dialog).toHaveTextContent("Shares Dealer invoice · DOC-003 v1 with Demo Verifier for verification on CL-001");
    expect(dialog).toHaveTextContent("Awaiting consent → Consent granted");
    await user.click(within(dialog).getByRole("button", { name: "Approve and share" }));
    await waitFor(() => expect(rowOf(screen.getByRole("region", { name: "Consent requests · CL-001" }), pendingId)).toHaveTextContent("Consent granted"));
    mock.setPersona("verifier-inspector");
    expect((await mock.verifications.get(pendingId.replace(/-G2-D1$/, ""))).documentIds).toContain("DOC-003");
  });

  it("declines behind a confirmation; nothing is shared", async () => {
    const mock = mockAs("dealer-contributor");
    const pendingId = await withPendingRequest(mock);
    const user = renderWith(mock, <DealerConsentRequests caseId="CL-001" />);
    const region = await screen.findByRole("region", { name: "Consent requests · CL-001" });
    await user.click(within(rowOf(region, pendingId)).getByRole("button", { name: "Decline" }));
    const dialog = await screen.findByRole("alertdialog", { name: `Decline consent · ${pendingId}` });
    expect(dialog).toHaveTextContent("Demo Verifier will not receive Dealer invoice · DOC-003 v1");
    expect(dialog).toHaveTextContent("Awaiting consent → Declined");
    await user.click(within(dialog).getByRole("button", { name: "Decline request" }));
    await waitFor(() => expect(rowOf(screen.getByRole("region", { name: "Consent requests · CL-001" }), pendingId)).toHaveTextContent("Declined"));
    mock.setPersona("verifier-inspector");
    expect((await mock.verifications.get(pendingId.replace(/-G2-D1$/, ""))).documentIds).not.toContain("DOC-003");
  });

  it("withdraws granted consent with the approved revocation copy", async () => {
    const mock = mockAs("dealer-contributor");
    const user = renderWith(mock, <DealerConsentRequests />);
    const region = await screen.findByRole("region", { name: "Consent requests · all accessible cases" });
    await user.click(within(rowOf(region, "AG-001")).getByRole("button", { name: "Withdraw consent" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Withdraw consent · AG-001" });
    expect(dialog).toHaveTextContent(STATUS_COPY.ACCESS_REVOKED);
    expect(dialog).toHaveTextContent("Consent granted → Consent withdrawn");
    await user.click(within(dialog).getByRole("button", { name: "Withdraw consent" }));
    expect(await screen.findByRole("status", { name: "" })).toHaveTextContent(`AG-001 · Demo Lender A: ${STATUS_COPY.ACCESS_REVOKED}`);
    await waitFor(() => expect(rowOf(screen.getByRole("region", { name: "Consent requests · all accessible cases" }), "AG-001")).toHaveTextContent("Consent withdrawn"));
  });
});

describe("DealerConsentStatus (owner) and the Sharing & Access tab", () => {
  it("shows the owner each dealer document's status per recipient, without actions", async () => {
    const mock = mockAs("manufacturer-owner");
    const pendingId = await withPendingRequest(mock);
    renderWith(mock, <DealerConsentStatus caseId="CL-001" />);
    const region = await screen.findByRole("region", { name: "Dealer consent · CL-001" });
    const pending = rowOf(region, pendingId);
    expect(pending).toHaveTextContent("Dealer invoice · DOC-003 v1");
    expect(pending).toHaveTextContent("Demo CNC Dealer");
    expect(pending).toHaveTextContent("Awaiting consent");
    expect(rowOf(region, "AG-001")).toHaveTextContent("Consent granted");
    expect(within(region).queryByRole("button")).not.toBeInTheDocument();
  });

  it("puts the consent requests on the dealer's tab, the status on the owner's tab, and neither on the lender's", async () => {
    for (const [persona, expected] of [
      ["dealer-contributor", "Consent requests · CL-001"],
      ["manufacturer-owner", "Dealer consent · CL-001"],
      ["lender-a-analyst", null],
    ] as const) {
      const mock = mockAs(persona);
      const detail = await mock.cases.get("CL-001");
      renderWith(
        mock,
        <CaseWorkspaceContext value={{ detail, trackCommand: () => undefined }}>
          <SharingTab />
        </CaseWorkspaceContext>,
      );
      await screen.findByRole("region", { name: "Sharing and access · CL-001" });
      if (expected) expect(await screen.findByRole("region", { name: expected }), persona).toBeInTheDocument();
      expect(screen.queryAllByRole("region", { name: /^Consent requests/ }).length > 0, persona).toBe(persona === "dealer-contributor");
      expect(screen.queryAllByRole("region", { name: /^Dealer consent/ }).length > 0, persona).toBe(persona === "manufacturer-owner");
      document.body.innerHTML = "";
    }
  });
});
