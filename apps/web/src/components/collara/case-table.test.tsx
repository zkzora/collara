import { caseStages, pledgeDisplayStates, reviewStates, verificationStates, type CaseSummary } from "@collara/domain";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CaseTable } from "./case-table";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

function row(caseId: string, updatedAt: string, overrides: Partial<CaseSummary> = {}): CaseSummary {
  return {
    caseId,
    title: "Used CNC financing",
    asset: { ref: `ASSET-DEMO-${caseId.slice(-3)}`, equipmentClass: "CNC machining center", model: "DEMO-CNC-500" },
    stage: caseStages.badge("LENDER_REVIEW"),
    borrower: { id: "demo-manufacturer", name: "Demo Manufacturer" },
    verification: verificationStates.badge("ATTESTED"),
    review: reviewStates.badge("SUBMITTED"),
    pledge: pledgeDisplayStates.badge("AVAILABLE"),
    nextActor: null,
    nextAction: null,
    isMine: false,
    views: ["all"],
    updatedAt,
    ...overrides,
  };
}

const rows = [
  row("CL-002", "2026-09-30T10:00:00.000Z", { borrower: { id: "demo-machining", name: "Demo Machining Co" } }),
  row("CL-001", "2026-10-01T10:00:00.000Z"),
  row("CL-003", "2026-09-20T10:00:00.000Z", { borrower: null }),
];

const caseIds = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getAllByRole("cell")[0]?.textContent);

describe("CaseTable", () => {
  it("sorts newest first by default and marks the sorted column", () => {
    render(<CaseTable rows={rows} caption="Cases · All" />);
    expect(screen.getByRole("table", { name: "Cases · All" })).toBeInTheDocument();
    expect(caseIds()).toEqual(["CL-001", "CL-002", "CL-003"]);
    expect(screen.getByRole("columnheader", { name: /Last update/ })).toHaveAttribute("aria-sort", "descending");
  });

  it("toggles sorting from the header buttons", async () => {
    const user = userEvent.setup();
    render(<CaseTable rows={rows} caption="Cases · All" />);
    await user.click(screen.getByRole("button", { name: /Case ID/ }));
    expect(screen.getByRole("columnheader", { name: /Case ID/ })).toHaveAttribute("aria-sort", "ascending");
    expect(caseIds()).toEqual(["CL-001", "CL-002", "CL-003"]);
    await user.click(screen.getByRole("button", { name: /Case ID/ }));
    expect(caseIds()).toEqual(["CL-003", "CL-002", "CL-001"]);
  });

  it("renders a real link per row and undisclosed values as —", () => {
    render(<CaseTable rows={rows} caption="Cases · All" />);
    expect(screen.getByRole("link", { name: "CL-001" })).toHaveAttribute("href", "/app/cases/CL-001/summary");
    const cl003 = screen.getByRole("link", { name: "CL-003" }).closest("tr")!;
    expect(within(cl003).getAllByText("Not available").length).toBeGreaterThan(0);
  });

  it("opens the case when a pointer user clicks elsewhere on the row", async () => {
    const user = userEvent.setup();
    render(<CaseTable rows={rows} caption="Cases · All" />);
    await user.click(screen.getByText("Demo Machining Co"));
    expect(push).toHaveBeenCalledWith("/app/cases/CL-002/summary");
  });

  it("shows the empty message inside the table", () => {
    render(<CaseTable rows={[]} caption="Cases · My actions" empty="No cases require your action." />);
    expect(screen.getByText("No cases require your action.")).toBeInTheDocument();
  });
});
