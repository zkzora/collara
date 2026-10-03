import { MODE_BANNERS } from "@collara/domain";
import { describe, expect, it } from "vitest";
import { PUBLIC_DEMO_STATUSES, UI_MOCK_DEMO_DISCLOSURE, resolvePublicDemo } from "./public-demo";

describe("resolvePublicDemo", () => {
  it("defaults to off when unset, empty or unknown", () => {
    for (const raw of [undefined, "", "  ", "on", "true", "LocalNet demo", "ui-mock"]) {
      expect(resolvePublicDemo(raw, "UI_MOCK")).toBe("off");
      expect(resolvePublicDemo(raw, "LOCALNET")).toBe("off");
    }
  });

  it("promotes the UI mockup only in UI_MOCK", () => {
    expect(resolvePublicDemo("ui_mock", "UI_MOCK")).toBe("ui_mock");
    expect(resolvePublicDemo(" UI_MOCK ", "UI_MOCK")).toBe("ui_mock");
    expect(resolvePublicDemo("ui_mock", "LOCALNET")).toBe("off");
  });

  it("promotes the LocalNet demo only in LOCALNET", () => {
    expect(resolvePublicDemo("localnet", "LOCALNET")).toBe("localnet");
    expect(resolvePublicDemo("LOCALNET", "LOCALNET")).toBe("localnet");
    // A UI mockup must never be presented as the LocalNet demo.
    expect(resolvePublicDemo("localnet", "UI_MOCK")).toBe("off");
  });

  it("keeps off as off in both modes", () => {
    expect(resolvePublicDemo("off", "UI_MOCK")).toBe("off");
    expect(resolvePublicDemo("off", "LOCALNET")).toBe("off");
    expect(PUBLIC_DEMO_STATUSES).toEqual(["off", "ui_mock", "localnet"]);
  });
});

describe("UI mockup disclosure", () => {
  it("states the mockup without claiming a ledger connection", () => {
    expect(UI_MOCK_DEMO_DISCLOSURE).toContain("UI mockup");
    expect(UI_MOCK_DEMO_DISCLOSURE).toContain("not connected to a ledger");
    expect(UI_MOCK_DEMO_DISCLOSURE).not.toMatch(/LocalNet|Canton|Confirmed on the ledger/);
    expect(UI_MOCK_DEMO_DISCLOSURE).not.toBe(MODE_BANNERS.LOCALNET);
  });
});
