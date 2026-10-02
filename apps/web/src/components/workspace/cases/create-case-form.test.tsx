import { ApiError } from "@collara/api-client";
import { createMockClient, type MockCollaraClient } from "@collara/api-client/mock";
import { CASE_CREATE_COPY, caseHoldsAsset, type PersonaId } from "@collara/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CollaraClientProvider } from "@/lib/collara-client";
import { SessionProvider } from "@/lib/session";
import { CreateCaseForm } from "./create-case-form";
import { CREATE_CASE_DEFAULTS, CREATE_CASE_MESSAGES, CreateCaseFormSchema, fieldOfIssue } from "./create-case-schema";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const NOW = new Date("2026-10-02T08:00:00Z");

function setup(personaId: PersonaId = "manufacturer-owner", initialAssetRef?: string) {
  push.mockReset();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const mock = createMockClient({ personaId, latencyMs: 0, now: new Date(NOW) });
  render(
    <QueryClientProvider client={queryClient}>
      <CollaraClientProvider mode="UI_MOCK" client={mock}>
        <SessionProvider pending={<p>Loading</p>} error={() => <p>Error</p>}>
          <CreateCaseForm initialAssetRef={initialAssetRef} />
        </SessionProvider>
      </CollaraClientProvider>
    </QueryClientProvider>,
  );
  return { mock, user: userEvent.setup() };
}

/** The borrower's registered assets: one held by an active case (CL-001) and one free (CL-005 was released). */
function borrowerAssets(mock: MockCollaraClient) {
  const owned = mock.world.assets.filter((a) => a.ownerOrgId === "demo-manufacturer" && a.lifecycle === "REGISTERED");
  const holds = (ref: string) => mock.world.cases.some((c) => c.asset.ref === ref && caseHoldsAsset(c));
  const free = owned.find((a) => !holds(a.ref));
  const held = owned.find((a) => holds(a.ref));
  if (!free || !held) throw new Error("fixture changed: expected a free and a held asset");
  return { free: free.ref, held: held.ref };
}

/** The field's error is its accessible description, and the control is marked invalid. */
function expectFieldError(label: string | RegExp, message: string) {
  const control = screen.getByLabelText(label);
  expect(control).toHaveAttribute("aria-invalid", "true");
  expect(control).toHaveAccessibleDescription(expect.stringContaining(message));
}

describe("CreateCaseFormSchema", () => {
  const base = { ...CREATE_CASE_DEFAULTS, title: " Used CNC financing ", assetRef: "ASSET-DEMO-005", selectedLenderOrgId: "demo-lender-a" };

  it("builds the POST /api/cases body with decimal-string money and drops empty optionals", () => {
    expect(CreateCaseFormSchema.parse({ ...base, principalAmount: "100,000", principalCurrency: "EUR", dealerOrgId: "demo-cnc-dealer", purpose: "Retooling" })).toEqual({
      title: "Used CNC financing",
      assetRef: "ASSET-DEMO-005",
      selectedLenderOrgId: "demo-lender-a",
      dealerOrgId: "demo-cnc-dealer",
      purpose: "Retooling",
      requestedPrincipal: { amount: "100000.00", currency: "EUR" },
    });
    // No amount means "not requested": the field is absent, never 0.
    expect(CreateCaseFormSchema.parse(base)).toEqual({ title: "Used CNC financing", assetRef: "ASSET-DEMO-005", selectedLenderOrgId: "demo-lender-a" });
  });

  it("refuses amounts that are not decimal strings with at most two decimals", () => {
    for (const amount of ["1.005", "-5", "12e3", "1,00.0.0", "abc", "12345678901234567"]) {
      const result = CreateCaseFormSchema.safeParse({ ...base, principalAmount: amount });
      expect(result.success, amount).toBe(false);
    }
    expect(CreateCaseFormSchema.safeParse({ ...base, principalAmount: "0.5" }).data?.requestedPrincipal).toEqual({ amount: "0.50", currency: "USD" });
  });

  it("maps server issue paths to form fields", () => {
    expect(fieldOfIssue("body.selectedLenderOrgId")).toBe("selectedLenderOrgId");
    expect(fieldOfIssue("body.requestedPrincipal.amount")).toBe("principalAmount");
    expect(fieldOfIssue("body.requestedPrincipal.currency")).toBe("principalCurrency");
    expect(fieldOfIssue("body.unknown")).toBeNull();
  });
});

describe("CreateCaseForm", () => {
  it("labels every field and announces errors with the field, focusing the first invalid one", async () => {
    const { user } = setup();
    await screen.findByRole("heading", { level: 1, name: "Create case" });
    const title = await screen.findByLabelText("Case name");
    for (const label of ["Registered asset", "Equipment purpose (optional)", "Selected lender", "Invited dealer (optional)", "Requested principal (optional)", "Currency"]) {
      expect(screen.getByLabelText(label), label).toBeInTheDocument();
    }
    expect(screen.getByText("Demo Manufacturer")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expectFieldError("Case name", CREATE_CASE_MESSAGES.TITLE));
    expectFieldError("Registered asset", CREATE_CASE_MESSAGES.ASSET);
    expectFieldError("Selected lender", CREATE_CASE_MESSAGES.LENDER);
    expect(title).toHaveFocus();
    expect(push).not.toHaveBeenCalled();
  });

  it("parses the requested principal, creates the case and opens it under the server-allocated ref", async () => {
    const { mock, user } = setup();
    const { free } = borrowerAssets(mock);
    const before = mock.world.cases.length;
    await user.type(await screen.findByLabelText("Case name"), "Second CNC financing");
    await user.selectOptions(screen.getByLabelText("Registered asset"), free);
    await user.selectOptions(screen.getByLabelText("Selected lender"), "demo-lender-a");
    await user.selectOptions(screen.getByLabelText("Invited dealer (optional)"), "demo-cnc-dealer");
    const amount = screen.getByLabelText("Requested principal (optional)");

    await user.type(amount, "1.005");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expectFieldError("Requested principal (optional)", CREATE_CASE_MESSAGES.AMOUNT));
    expect(mock.world.cases).toHaveLength(before);

    await user.clear(amount);
    await user.type(amount, "100,000");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(push).toHaveBeenCalledOnce());
    const created = mock.world.cases.at(-1)!;
    expect(mock.world.cases).toHaveLength(before + 1);
    expect(created.ref).toMatch(/^CL-\d{3}$/);
    expect(created.ref).not.toBe("CL-001");
    expect(created).toMatchObject({
      title: "Second CNC financing",
      selectedLenderOrgId: "demo-lender-a",
      dealerOrgId: "demo-cnc-dealer",
      requestedPrincipal: { amount: "100000.00", currency: "USD" },
    });
    expect(push).toHaveBeenCalledWith(`/app/cases/${created.ref}/summary`);
  });

  it("opens Sharing & Access with Review sharing", async () => {
    const { mock, user } = setup();
    const { free } = borrowerAssets(mock);
    await user.type(await screen.findByLabelText("Case name"), "Shared next");
    await user.selectOptions(screen.getByLabelText("Registered asset"), free);
    await user.selectOptions(screen.getByLabelText("Selected lender"), "demo-lender-b");
    await user.click(screen.getByRole("button", { name: "Review sharing" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/app/cases/${mock.world.cases.at(-1)!.ref}/sharing`));
  });

  it("shows why a held asset cannot start a case and does not submit", async () => {
    const { mock, user } = setup();
    const { held } = borrowerAssets(mock);
    const create = vi.spyOn(mock.cases, "create");
    await user.type(await screen.findByLabelText("Case name"), "Again");
    await user.selectOptions(screen.getByLabelText("Registered asset"), held);
    await waitFor(() => expect(screen.getByLabelText("Registered asset")).toHaveAccessibleDescription(expect.stringContaining(CASE_CREATE_COPY.ACTIVE_CASE)));
    await user.selectOptions(screen.getByLabelText("Selected lender"), "demo-lender-a");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expectFieldError("Registered asset", CASE_CREATE_COPY.ACTIVE_CASE));
    expect(create).not.toHaveBeenCalled();
  });

  it("puts server validation issues on their field", async () => {
    const { mock, user } = setup();
    const { free } = borrowerAssets(mock);
    vi.spyOn(mock.cases, "create").mockRejectedValueOnce(
      ApiError.problem("validation_error", "Check the highlighted fields.", [{ path: "body.selectedLenderOrgId", message: "Select a lender organization." }]),
    );
    await user.type(await screen.findByLabelText("Case name"), "Server says no");
    await user.selectOptions(screen.getByLabelText("Registered asset"), free);
    await user.selectOptions(screen.getByLabelText("Selected lender"), "demo-lender-b");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expectFieldError("Selected lender", "Select a lender organization."));
    expect(screen.getByLabelText("Selected lender")).toHaveFocus();
    expect(push).not.toHaveBeenCalled();
  });

  it("preselects the asset passed from the passport", async () => {
    const probe = createMockClient({ personaId: "manufacturer-owner", latencyMs: 0, now: new Date(NOW) });
    const { free } = borrowerAssets(probe);
    setup("manufacturer-owner", free);
    await waitFor(() => expect(screen.getByLabelText("Registered asset")).toHaveValue(free));
  });

  it("offers nothing to an organization without the borrower mandate", async () => {
    setup("lender-a-approver");
    expect(await screen.findByText("Creating a case needs the borrower mandate")).toBeInTheDocument();
    expect(screen.queryByLabelText("Case name")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save draft" })).not.toBeInTheDocument();
  });
});
