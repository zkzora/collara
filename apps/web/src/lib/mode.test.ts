import { ENVIRONMENT_CHIPS, isLedgerMode, MODE_BANNERS } from "@collara/domain";
import { describe, expect, it } from "vitest";
import { resolvePublicDemo } from "@/components/marketing/public-demo";
import { parseRuntimeMode } from "./mode";

describe("parseRuntimeMode", () => {
  it("accepts the three modes and defaults to UI_MOCK", () => {
    expect(parseRuntimeMode(undefined)).toBe("UI_MOCK");
    expect(parseRuntimeMode(" LOCALNET ")).toBe("LOCALNET");
    expect(parseRuntimeMode("DEVNET")).toBe("DEVNET");
  });

  it("refuses an unknown mode instead of falling back to the mockup", () => {
    expect(() => parseRuntimeMode("TESTNET")).toThrow(/UI_MOCK, LOCALNET or DEVNET/);
  });
});

describe("DEVNET presentation", () => {
  it("has its own banner and chip and is a ledger mode", () => {
    expect(MODE_BANNERS.DEVNET).toBe("Synthetic demo data — Canton DevNet.");
    expect(MODE_BANNERS.DEVNET).not.toBe(MODE_BANNERS.LOCALNET);
    expect(ENVIRONMENT_CHIPS.DEVNET).toBe("DevNet");
    expect(isLedgerMode("DEVNET")).toBe(true);
    expect(isLedgerMode("UI_MOCK")).toBe(false);
  });

  it("never promotes a public demo in DEVNET", () => {
    expect(resolvePublicDemo("localnet", "DEVNET")).toBe("off");
    expect(resolvePublicDemo("ui_mock", "DEVNET")).toBe("off");
  });
});
