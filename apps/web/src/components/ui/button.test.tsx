import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  it("renders an accessible button and handles clicks", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Request a pilot</Button>);

    const button = screen.getByRole("button", { name: "Request a pilot" });
    expect(button).toBeEnabled();
    await userEvent.setup().click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
