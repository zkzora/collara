import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmationDialog } from "./confirmation-dialog";

const facts = { actingParty: "Demo Lender A · Lender Approver", record: "CA-001 · assessment v1", effect: "IN_REVIEW → ELIGIBLE" };

function Harness({ onConfirm, pending = false, withInput = false }: { onConfirm: () => void; pending?: boolean; withInput?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Approve eligibility
      </button>
      <ConfirmationDialog
        open={open}
        onOpenChange={setOpen}
        title="Approve collateral eligibility · CL-001"
        description="Records the assessment outcome Eligible for this case."
        facts={facts}
        caveat="Eligible for this lender and case. Financing is not yet active."
        confirmLabel="Approve eligibility"
        pending={pending}
        onConfirm={onConfirm}
      >
        {withInput ? (
          <label>
            Feedback
            <textarea />
          </label>
        ) : null}
      </ConfirmationDialog>
    </>
  );
}

describe("ConfirmationDialog", () => {
  it("is labelled, shows the facts and starts on Cancel", async () => {
    const user = userEvent.setup();
    render(<Harness onConfirm={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Approve eligibility" }));

    const dialog = await screen.findByRole("alertdialog", { name: "Approve collateral eligibility · CL-001" });
    expect(dialog).toHaveAccessibleDescription("Records the assessment outcome Eligible for this case.");
    expect(dialog).toHaveTextContent("Demo Lender A · Lender Approver");
    expect(dialog).toHaveTextContent("CA-001 · assessment v1");
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus());
  });

  it("keeps focus inside the dialog while tabbing", async () => {
    const user = userEvent.setup();
    render(<Harness onConfirm={vi.fn()} withInput />);
    await user.click(screen.getByRole("button", { name: "Approve eligibility" }));
    const dialog = await screen.findByRole("alertdialog");
    for (let i = 0; i < 6; i += 1) {
      await user.tab();
      // Base UI's focus guards hand focus back into the popup asynchronously.
      await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    }
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<Harness onConfirm={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Approve eligibility" });
    await user.click(trigger);
    await screen.findByRole("alertdialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("calls onConfirm from the confirm button", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    await user.click(screen.getByRole("button", { name: "Approve eligibility" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(screen.getAllByRole("button", { name: "Approve eligibility" }).find((b) => dialog.contains(b))!);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("blocks confirm and Escape while a submission is pending", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} pending />);
    await user.click(screen.getByRole("button", { name: "Approve eligibility" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(screen.getByRole("button", { name: "Submitting…" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(dialog).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
