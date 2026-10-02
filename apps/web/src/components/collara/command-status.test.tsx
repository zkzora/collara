import { ApiError } from "@collara/api-client";
import { COMMAND_COPY, ERROR_COPY, MODE_BANNERS, SIMULATED_COPY, type CommandStatus as Command } from "@collara/domain";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { commandCopy } from "@/lib/commands";
import { CommandStatus } from "./command-status";

const at = "2026-10-01T14:33:00.000Z";
function command(overrides: Partial<Command>): Command {
  return {
    commandId: "cmd-1",
    operation: "review.decide",
    target: "LEDGER",
    state: "PROJECTED",
    simulated: false,
    message: COMMAND_COPY.COMMITTED,
    submittedAt: at,
    updatedAt: at,
    ...overrides,
  };
}

describe("CommandStatus", () => {
  it("labels simulated commands and never claims ledger confirmation", () => {
    // Even a (buggy) simulated command carrying the committed copy must not show it.
    render(<CommandStatus mode="UI_MOCK" command={command({ simulated: true, message: COMMAND_COPY.COMMITTED, updateId: "u-1" })} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(SIMULATED_COPY.RECORDED_IN_MOCKUP);
    expect(status).toHaveTextContent(MODE_BANNERS.UI_MOCK);
    expect(status).not.toHaveTextContent(COMMAND_COPY.COMMITTED);
  });

  it("shows the committed copy only for a ledger commit with an update id", () => {
    const { rerender } = render(<CommandStatus mode="LOCALNET" command={command({ updateId: "1220abcdef0123456789", completionOffset: 18423 })} />);
    expect(screen.getByRole("status")).toHaveTextContent(COMMAND_COPY.COMMITTED);
    expect(screen.getByRole("status")).toHaveTextContent("offset 18423");

    rerender(<CommandStatus mode="LOCALNET" command={command({ state: "COMMITTED", updateId: undefined })} />);
    expect(screen.getByRole("status")).not.toHaveTextContent(COMMAND_COPY.COMMITTED);
    expect(screen.getByRole("status")).toHaveTextContent(COMMAND_COPY.SUBMITTED);
  });

  it("uses the lifecycle copy for delayed projection and unknown outcomes", () => {
    const { rerender } = render(
      <CommandStatus mode="LOCALNET" command={command({ state: "PROJECTION_DELAYED", message: COMMAND_COPY.PROJECTION_DELAYED, updateId: "u-2" })} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(COMMAND_COPY.PROJECTION_DELAYED);
    rerender(<CommandStatus mode="LOCALNET" command={command({ state: "UNKNOWN_OUTCOME", message: COMMAND_COPY.UNKNOWN_OUTCOME })} />);
    expect(screen.getByRole("status")).toHaveTextContent(COMMAND_COPY.UNKNOWN_OUTCOME);
  });

  it("shows mode-specific pending copy", () => {
    const { rerender } = render(<CommandStatus mode="LOCALNET" command={null} pending />);
    expect(screen.getByRole("status")).toHaveTextContent(COMMAND_COPY.SUBMITTED);
    rerender(<CommandStatus mode="UI_MOCK" command={null} pending />);
    expect(screen.getByRole("status")).not.toHaveTextContent(/ledger/i);
  });

  it("shows API errors with their user-facing copy", () => {
    render(<CommandStatus mode="LOCALNET" command={null} error={ApiError.problem("unavailable", ERROR_COPY.UNAVAILABLE)} />);
    expect(screen.getByRole("status")).toHaveTextContent(ERROR_COPY.UNAVAILABLE);
  });
});

describe("commandCopy", () => {
  it("never returns the committed copy without ledger evidence", () => {
    expect(commandCopy(command({ simulated: true }))).toBe(SIMULATED_COPY.RECORDED_IN_MOCKUP);
    expect(commandCopy(command({ target: "APPLICATION", message: SIMULATED_COPY.APPLICATION_RECORD_SAVED }))).toBe(
      SIMULATED_COPY.APPLICATION_RECORD_SAVED,
    );
    expect(commandCopy(command({ state: "FAILED", message: COMMAND_COPY.COMMITTED }))).toBe(COMMAND_COPY.LEDGER_UNAVAILABLE);
    expect(commandCopy(command({ updateId: "u-3" }))).toBe(COMMAND_COPY.COMMITTED);
  });
});
