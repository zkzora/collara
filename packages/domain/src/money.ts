// Money: decimal strings + explicit ISO 4217 currency end to end (Daml Numeric 2, numeric(18,2)).
// Valuation ≠ principal. Unavailable ≠ 0. Never sum across currencies (S §13.3).
import { Decimal } from "decimal.js";
import { z } from "zod";

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/** Shown wherever a monetary value is missing. Never render 0 for missing data. */
export const NOT_AVAILABLE = "Not available";

/** Non-negative, at most 16 integer digits and 2 fraction digits (fits numeric(18,2)). */
export const DECIMAL_AMOUNT_PATTERN = /^(0|[1-9]\d{0,15})(\.\d{1,2})?$/;

let supportedCurrencies: ReadonlySet<string> | null | undefined;
function isSupportedCurrency(code: string): boolean {
  if (supportedCurrencies === undefined) {
    try {
      supportedCurrencies = new Set(Intl.supportedValuesOf("currency"));
    } catch {
      supportedCurrencies = null; // Runtime without Intl.supportedValuesOf: fall back to the shape check.
    }
  }
  return supportedCurrencies === null || supportedCurrencies.has(code);
}

export const CurrencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, "Use a three-letter ISO 4217 currency code.")
  .refine(isSupportedCurrency, "Unknown ISO 4217 currency code.");
export type CurrencyCode = z.infer<typeof CurrencyCodeSchema>;

/** Decimal string normalised to exactly two fraction digits ("100000" → "100000.00"). */
export const DecimalAmountSchema = z
  .string()
  .trim()
  .regex(DECIMAL_AMOUNT_PATTERN, "Use a non-negative decimal amount with at most two decimal places.")
  .transform((value) => new D(value).toFixed(2));

export const MoneySchema = z.object({ amount: DecimalAmountSchema, currency: CurrencyCodeSchema });
export type Money = z.output<typeof MoneySchema>;
export type MoneyInput = z.input<typeof MoneySchema>;

export class CurrencyMismatchError extends Error {
  readonly currencies: readonly string[];
  constructor(currencies: readonly string[]) {
    super(`Refusing to combine amounts in different currencies (${currencies.join(", ")}) without an FX source.`);
    this.name = "CurrencyMismatchError";
    this.currencies = currencies;
  }
}

/** Parses and normalises; throws a ZodError for invalid input. Numbers are refused (no floats). */
export function money(amount: string, currency: string): Money {
  return MoneySchema.parse({ amount, currency });
}

export function parseMoney(input: unknown): Money {
  return MoneySchema.parse(input);
}

export function safeParseMoney(input: unknown): Money | null {
  const result = MoneySchema.safeParse(input);
  return result.success ? result.data : null;
}

function groupThousands(integerDigits: string): string {
  return integerDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** "150,000.00" (en-US grouping, two decimals, no currency). */
export function formatAmount(value: Money): string {
  const [integer = "0", fraction = "00"] = new D(value.amount).toFixed(2).split(".");
  return `${groupThousands(integer)}.${fraction}`;
}

/** "USD 150,000.00", or `Not available` for a missing value. */
export function formatMoney(value: Money | null | undefined): string {
  if (!value) return NOT_AVAILABLE;
  return `${value.currency} ${formatAmount(value)}`;
}

function assertSameCurrency(values: readonly Money[]): string {
  const currencies = [...new Set(values.map((value) => value.currency))];
  if (currencies.length > 1) throw new CurrencyMismatchError(currencies);
  const [currency] = currencies;
  if (!currency) throw new Error("No amounts given.");
  return currency;
}

/** -1 | 0 | 1. Throws CurrencyMismatchError for different currencies. */
export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency([a, b]);
  return new D(a.amount).comparedTo(new D(b.amount)) as -1 | 0 | 1;
}

export function isZero(value: Money): boolean {
  return new D(value.amount).isZero();
}

/** Sums amounts of one currency. Throws CurrencyMismatchError for mixed currencies. */
export function sumMoney(values: readonly [Money, ...Money[]]): Money {
  const currency = assertSameCurrency(values);
  const total = values.reduce((acc, value) => acc.plus(value.amount), new D(0));
  return { amount: total.toFixed(2), currency };
}

export interface Ratio {
  /** Percentage as a decimal string with one fraction digit, e.g. "66.7". */
  readonly percent: string;
  /** "66.7%" */
  readonly display: string;
}

/**
 * numerator / denominator as a percentage (e.g. principal / valuation = 66.7%).
 * Returns null when the denominator is missing or zero. Throws for different currencies.
 */
export function moneyRatio(numerator: Money | null | undefined, denominator: Money | null | undefined): Ratio | null {
  if (!numerator || !denominator) return null;
  assertSameCurrency([numerator, denominator]);
  const den = new D(denominator.amount);
  if (den.isZero()) return null;
  const percent = new D(numerator.amount).div(den).times(100).toFixed(1);
  return { percent, display: `${percent}%` };
}

export interface CurrencyTotal {
  readonly total: Money;
  /** Number of values included in this currency's total. */
  readonly count: number;
}

export interface MoneyAggregate {
  /** One total per currency, sorted by currency code. Never a cross-currency sum. */
  readonly totals: readonly CurrencyTotal[];
  /** Values that were available (counted in a total). */
  readonly included: number;
  /** Values that were missing; they are excluded, never treated as zero. */
  readonly unavailable: number;
}

/** Per-currency aggregation with coverage, for `Recorded financing principal` style figures. */
export function aggregateByCurrency(values: readonly (Money | null | undefined)[]): MoneyAggregate {
  const byCurrency = new Map<string, Money[]>();
  let unavailable = 0;
  for (const value of values) {
    if (!value) {
      unavailable += 1;
      continue;
    }
    const bucket = byCurrency.get(value.currency) ?? [];
    bucket.push(value);
    byCurrency.set(value.currency, bucket);
  }
  const totals = [...byCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, bucket]) => ({ total: sumMoney(bucket as [Money, ...Money[]]), count: bucket.length }));
  return { totals, included: values.length - unavailable, unavailable };
}
