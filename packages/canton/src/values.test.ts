import { describe, expect, it } from "vitest";
import {
  damlMap,
  damlSchemas,
  damlSet,
  date,
  decimal,
  decodeMap,
  decodeNestedOptional,
  decodeSet,
  int64,
  nestedOptional,
  numeric,
  optional,
  party,
  time,
  variant,
} from "./values";

const PARTY = "DemoManufacturer::12202a0352d255a3da1d6c590fe12ed440c7a66931afdad579c996573e7069ae5bda";

describe("Daml JSON encoders", () => {
  it("encodes Int as a string within Int64", () => {
    expect(int64(42)).toBe("42");
    expect(int64("-9223372036854775808")).toBe("-9223372036854775808");
    expect(int64(9223372036854775807n)).toBe("9223372036854775807");
    expect(() => int64(9223372036854775808n)).toThrow(RangeError);
    expect(() => int64(1.5)).toThrow(RangeError);
    expect(() => int64("1e3")).toThrow(RangeError);
  });

  it("encodes Numeric as a decimal string padded to its scale", () => {
    expect(numeric("100000", 2)).toBe("100000.00");
    expect(numeric("150000.5", 2)).toBe("150000.50");
    expect(numeric("-0.25", 2)).toBe("-0.25");
    expect(numeric(7n, 0)).toBe("7");
    expect(decimal("0.6666666667")).toBe("0.6666666667");
    expect(() => numeric("1.234", 2)).toThrow(/more than 2 decimal places/);
    expect(() => numeric("1e3", 2)).toThrow(RangeError);
    expect(() => numeric("12,50", 2)).toThrow(RangeError);
    expect(() => numeric("1".repeat(37), 2)).toThrow(/does not fit/);
  });

  it("encodes Time with at most microsecond precision", () => {
    expect(time(new Date(Date.UTC(2026, 9, 2, 8, 30, 0, 123)))).toBe("2026-10-02T08:30:00.123Z");
    expect(time("2026-10-02T08:30:00.123456Z")).toBe("2026-10-02T08:30:00.123456Z");
    expect(time("2026-10-02T10:30:00+02:00")).toBe("2026-10-02T10:30:00+02:00");
    expect(() => time("2026-10-02T08:30:00.123456789Z")).toThrow(/microseconds/);
    expect(() => time("2026-10-02 08:30")).toThrow(RangeError);
  });

  it("encodes Date as YYYY-MM-DD and rejects impossible dates", () => {
    expect(date("2028-02-29")).toBe("2028-02-29");
    expect(date(new Date(Date.UTC(2026, 9, 2, 23, 59)))).toBe("2026-10-02");
    expect(() => date("2026-02-29")).toThrow(RangeError);
    expect(() => date("2026-10-2")).toThrow(RangeError);
  });

  it("encodes Optional: null for None, nested as [] / [[]] / [[x]]", () => {
    expect(optional(undefined)).toBeNull();
    expect(optional("hi")).toBe("hi");
    expect(nestedOptional(null)).toEqual([]);
    expect(nestedOptional({ some: null })).toEqual([[]]);
    expect(nestedOptional({ some: "7" })).toEqual([["7"]]);
    expect(decodeNestedOptional([])).toBeNull();
    expect(decodeNestedOptional([[]])).toEqual({ some: null });
    expect(decodeNestedOptional([["7"]])).toEqual({ some: "7" });
    expect(() => decodeNestedOptional(null)).toThrow(TypeError);
  });

  it("encodes DA.Set as {map: [[x, {}]]} and DA.Map as [[k, v]]", () => {
    expect(damlSet([PARTY, PARTY, "Other::1220ab"])).toEqual({ map: [[PARTY, {}], ["Other::1220ab", {}]] });
    expect(decodeSet({ map: [[PARTY, {}]] })).toEqual([PARTY]);
    expect(damlMap(new Map([["x", "1"], ["y", "2"]]))).toEqual([["x", "1"], ["y", "2"]]);
    expect(decodeMap([["a", "1"]])).toEqual([["a", "1"]]);
    expect(() => decodeSet([PARTY])).toThrow();
  });

  it("encodes variants and validates party ids", () => {
    expect(variant("Circle", { radius: "1.50" })).toEqual({ tag: "Circle", value: { radius: "1.50" } });
    expect(party(PARTY)).toBe(PARTY);
    expect(() => party("DemoManufacturer")).toThrow(RangeError);
    expect(() => party("a b::1220ab")).toThrow(RangeError);
  });
});

describe("damlSchemas", () => {
  it("decodes ledger payload fields", () => {
    const schema = damlSchemas.set(damlSchemas.party);
    expect(schema.parse({ map: [[PARTY, {}]] })).toEqual([PARTY]);
    expect(damlSchemas.numeric(2).safeParse("100.00").success).toBe(true);
    expect(damlSchemas.numeric(2).safeParse("1.234").success).toBe(false);
    expect(damlSchemas.optional(damlSchemas.int64).parse(null)).toBeNull();
    expect(damlSchemas.map(damlSchemas.party, damlSchemas.int64).parse([[PARTY, "1"]])).toEqual([[PARTY, "1"]]);
  });
});
