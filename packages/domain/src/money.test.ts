import { describe, expect, it } from "vitest";
import {
  aggregateByCurrency,
  compareMoney,
  CurrencyMismatchError,
  formatAmount,
  formatMoney,
  money,
  moneyRatio,
  MoneySchema,
  NOT_AVAILABLE,
  sumMoney,
} from "./money";
import { abbreviateHash, formatRef, nextFreeRef, parseRef, formatVersionedRef, isRef } from "./refs";

describe("money", () => {
  it("normalises decimal strings to two places and formats en-US", () => {
    expect(money("150000", "USD")).toEqual({ amount: "150000.00", currency: "USD" });
    expect(formatMoney(money("100000.00", "USD"))).toBe("USD 100,000.00");
    expect(formatAmount(money("1234567.5", "EUR"))).toBe("1,234,567.50");
    expect(formatMoney(money("0.05", "USD"))).toBe("USD 0.05");
  });

  it("shows Not available for missing values, never zero", () => {
    expect(formatMoney(null)).toBe(NOT_AVAILABLE);
    expect(formatMoney(undefined)).toBe("Not available");
  });

  it("rejects floats, negatives, too many decimals and bad currencies", () => {
    expect(MoneySchema.safeParse({ amount: 100000, currency: "USD" }).success).toBe(false);
    expect(MoneySchema.safeParse({ amount: "-1.00", currency: "USD" }).success).toBe(false);
    expect(MoneySchema.safeParse({ amount: "1.005", currency: "USD" }).success).toBe(false);
    expect(MoneySchema.safeParse({ amount: "1.00", currency: "usd" }).success).toBe(false);
    expect(MoneySchema.safeParse({ amount: "1.00", currency: "ZZZ" }).success).toBe(false);
    expect(MoneySchema.safeParse({ amount: "12345678901234567.00", currency: "USD" }).success).toBe(false);
  });

  it("computes principal / valuation as 66.7% for the CL-001 fixture", () => {
    expect(moneyRatio(money("100000.00", "USD"), money("150000.00", "USD"))).toEqual({ percent: "66.7", display: "66.7%" });
    expect(moneyRatio(money("1.00", "USD"), money("0.00", "USD"))).toBeNull();
    expect(moneyRatio(null, money("1.00", "USD"))).toBeNull();
  });

  it("compares and sums only within one currency", () => {
    expect(compareMoney(money("2.00", "USD"), money("10.00", "USD"))).toBe(-1);
    expect(sumMoney([money("0.10", "USD"), money("0.20", "USD")])).toEqual({ amount: "0.30", currency: "USD" });
    expect(() => sumMoney([money("1.00", "USD"), money("1.00", "EUR")])).toThrow(CurrencyMismatchError);
    expect(() => compareMoney(money("1.00", "USD"), money("1.00", "EUR"))).toThrow(CurrencyMismatchError);
    expect(() => moneyRatio(money("1.00", "USD"), money("1.00", "EUR"))).toThrow(CurrencyMismatchError);
  });

  it("aggregates per currency with coverage instead of a cross-currency total", () => {
    const result = aggregateByCurrency([
      money("100000.00", "USD"),
      money("180000.00", "USD"),
      money("50000.00", "EUR"),
      null,
    ]);
    expect(result.totals).toEqual([
      { total: { amount: "50000.00", currency: "EUR" }, count: 1 },
      { total: { amount: "280000.00", currency: "USD" }, count: 2 },
    ]);
    expect(result.included).toBe(3);
    expect(result.unavailable).toBe(1);
    expect(aggregateByCurrency([null]).totals).toEqual([]);
  });
});

describe("display references", () => {
  it("formats and parses every fixture reference", () => {
    expect(formatRef("case", 1)).toBe("CL-001");
    expect(formatRef("asset", 1)).toBe("ASSET-DEMO-001");
    expect(formatRef("report", 1)).toBe("RPT-0001");
    expect(formatRef("verifier", 1)).toBe("VER-001");
    expect(formatVersionedRef("PKG-001", 2)).toBe("PKG-001 v2");
    expect(parseRef("governanceProposal", "GP-004")).toBe(4);
    expect(parseRef("case", "CL-1")).toBeNull();
    expect(isRef("attestation", "ATT-001")).toBe(true);
    expect(isRef("pledge", "CONTROL-ASSET-DEMO-001")).toBe(false);
  });

  it("allocates the lowest free number without the prototype's GP-0010 bug", () => {
    const used = Array.from({ length: 9 }, (_, i) => formatRef("governanceProposal", i + 1));
    expect(nextFreeRef("governanceProposal", used)).toBe("GP-010");
    expect(nextFreeRef("pledge", ["PL-003", "PL-005"])).toBe("PL-001");
  });

  it("abbreviates technical hashes", () => {
    expect(abbreviateHash("9b12aaaaaaaaaaaae7a0")).toBe("9b12…e7a0");
  });
});
