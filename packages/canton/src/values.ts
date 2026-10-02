import { z } from "zod";

/**
 * Daml values in the JSON Ledger API v2 encoding, as observed on Canton 3.5.19
 * (test/integration/ledger.it.test.ts re-checks every encoder against a live participant):
 *
 * | Daml type              | JSON                                  | Notes                                     |
 * |------------------------|---------------------------------------|-------------------------------------------|
 * | Party, Text, ContractId| string                                |                                           |
 * | Int                    | string "42"                           | a JSON number is rejected (HTTP 500)      |
 * | Numeric n / Decimal    | string "100.00"                       | echoed padded to scale; more decimals than n -> 400 |
 * | Bool                   | true / false                          | "true" is rejected                        |
 * | Time                   | "2026-10-02T08:30:00.123456Z"         | offsets normalised to UTC; > 6 decimals truncated |
 * | Date                   | "2026-10-02"                          | invalid dates -> HTTP 500                 |
 * | Optional a             | null / value                          |                                           |
 * | Optional (Optional a)  | [] / [[]] / [[value]]                 | None / Some None / Some (Some x); null -> 500 |
 * | [a]                    | array                                 |                                           |
 * | DA.Set.Set a           | {"map": [[x, {}], ...]}               | deduplicated and sorted by the ledger     |
 * | DA.Map.Map k v         | [[k, v], ...]                         | sorted by key; duplicate keys: last wins  |
 * | record / unit          | object / {}                           |                                           |
 * | variant                | {"tag": "Ctor", "value": ...}         |                                           |
 * | enum                   | "Ctor"                                |                                           |
 */
export type DamlJson = string | boolean | null | DamlJson[] | { [key: string]: DamlJson };

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;
const NUMERIC_RE = /^-?\d+(?:\.(\d+))?$/;
const TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d{1,9}))?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const PARTY_RE = /^[^:\s]+(?::[^:\s]+)*::[0-9a-f]{2,}$/;

export function party(id: string): string {
  if (id.length > 255 || !PARTY_RE.test(id)) throw new RangeError(`not a party id: ${JSON.stringify(id)}`);
  return id;
}

export function contractId(id: string): string {
  if (!/^[0-9a-f]{2,}$/.test(id)) throw new RangeError(`not a contract id: ${JSON.stringify(id)}`);
  return id;
}

/** Daml Int (64-bit), always encoded as a string. */
export function int64(value: bigint | number | string): string {
  let n: bigint;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new RangeError(`not a safe integer: ${value}`);
    n = BigInt(value);
  } else if (typeof value === "string") {
    if (!/^-?\d+$/.test(value)) throw new RangeError(`not an integer string: ${JSON.stringify(value)}`);
    n = BigInt(value);
  } else {
    n = value;
  }
  if (n < INT64_MIN || n > INT64_MAX) throw new RangeError(`outside Int64: ${n}`);
  return n.toString();
}

/**
 * Daml `Numeric scale` from a decimal string (e.g. decimal.js `toFixed()`), padded to the scale
 * so payloads are deterministic. Rejects more decimals than the scale (the ledger would 400).
 * Money is `Numeric 2` with an explicit currency field next to it.
 */
export function numeric(value: string | bigint, scale: number): string {
  if (!Number.isInteger(scale) || scale < 0 || scale > 37) throw new RangeError(`invalid Numeric scale ${scale}`);
  const text = typeof value === "bigint" ? value.toString() : value;
  if (!NUMERIC_RE.test(text)) throw new RangeError(`not a decimal string: ${JSON.stringify(text)}`);
  const [whole = "", fraction = ""] = text.split(".");
  if (fraction.length > scale) throw new RangeError(`${text} has more than ${scale} decimal places`);
  if (whole.replace(/^-?0*(?=\d)/, "").length > 38 - scale) throw new RangeError(`${text} does not fit Numeric ${scale}`);
  return scale === 0 ? whole : `${whole}.${fraction.padEnd(scale, "0")}`;
}

/** Daml `Decimal` (= `Numeric 10`). */
export const decimal = (value: string | bigint): string => numeric(value, 10);

/** Daml `Time` (microsecond precision, UTC). Rejects more than 6 fractional digits. */
export function time(value: Date | string): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new RangeError("invalid Date");
    return value.toISOString();
  }
  const match = TIME_RE.exec(value);
  if (!match || Number.isNaN(Date.parse(value))) throw new RangeError(`not an RFC 3339 timestamp: ${JSON.stringify(value)}`);
  if ((match[1]?.length ?? 0) > 6) throw new RangeError(`${value} is more precise than microseconds`);
  return value;
}

/** Daml `Date` ("YYYY-MM-DD"). A JS Date is converted using its UTC calendar date. */
export function date(value: Date | string): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new RangeError("invalid Date");
    return value.toISOString().slice(0, 10);
  }
  const match = DATE_RE.exec(value);
  const valid =
    match !== null &&
    new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).toISOString().slice(0, 10) === value;
  if (!valid) throw new RangeError(`not a calendar date: ${JSON.stringify(value)}`);
  return value;
}

/** `Optional a` where `a` is not itself Optional: None is null. */
export function optional<T extends DamlJson>(value: T | null | undefined): T | null {
  return value ?? null;
}

/** `Optional (Optional a)`: null = None, { some: null } = Some None, { some: x } = Some (Some x). */
export function nestedOptional<T extends DamlJson>(value: { some: T | null } | null): DamlJson {
  if (value === null) return [];
  return value.some === null ? [[]] : [[value.some]];
}

export function decodeNestedOptional<T extends DamlJson>(value: unknown): { some: T | null } | null {
  if (!Array.isArray(value) || value.length > 1) throw new TypeError("not a nested Optional");
  if (value.length === 0) return null;
  const inner: unknown = value[0];
  if (!Array.isArray(inner) || inner.length > 1) throw new TypeError("not a nested Optional");
  return { some: inner.length === 0 ? null : (inner[0] as T) };
}

/** `DA.Set.Set a` (a record wrapping a Map to unit). Duplicates are dropped. */
export function damlSet(items: Iterable<DamlJson>): { map: [DamlJson, Record<string, never>][] } {
  const seen = new Map<string, DamlJson>();
  for (const item of items) seen.set(JSON.stringify(item), item);
  return { map: [...seen.values()].map((item) => [item, {}]) };
}

export function decodeSet<T = unknown>(value: unknown): T[] {
  const parsed = z.object({ map: z.array(z.tuple([z.unknown(), z.unknown()])) }).parse(value);
  return parsed.map.map(([item]) => item as T);
}

/** `DA.Map.Map k v` as [[k, v], ...]. */
export function damlMap<K extends DamlJson, V extends DamlJson>(
  entries: Iterable<readonly [K, V]> | ReadonlyMap<K, V>,
): [K, V][] {
  return [...entries].map(([key, value]) => [key, value]);
}

export function decodeMap<K = unknown, V = unknown>(value: unknown): [K, V][] {
  return z.array(z.tuple([z.unknown(), z.unknown()])).parse(value) as [K, V][];
}

/** Variant constructor. Enum constructors are plain strings. */
export function variant<T extends DamlJson>(tag: string, value: T): { tag: string; value: T } {
  return { tag, value };
}

/** Unit, and the argument of a choice without parameters. */
export const unit: Record<string, never> = Object.freeze({}) as Record<string, never>;

/** Zod schemas for decoding contract payloads read from the ledger. */
export const damlSchemas = {
  party: z.string().regex(PARTY_RE, "not a party id"),
  contractId: z.string().regex(/^[0-9a-f]{2,}$/, "not a contract id"),
  int64: z.string().regex(/^-?\d+$/, "not an Int64 string"),
  numeric: (scale: number) =>
    z
      .string()
      .regex(NUMERIC_RE, "not a Numeric string")
      .refine((s) => (s.split(".")[1]?.length ?? 0) <= scale, `more than ${scale} decimal places`),
  time: z.string().regex(TIME_RE, "not a Daml Time"),
  date: z.string().regex(DATE_RE, "not a Daml Date"),
  optional: <T extends z.ZodType>(inner: T) => inner.nullable(),
  set: <T extends z.ZodType>(item: T) =>
    z.object({ map: z.array(z.tuple([item, z.object({})])) }).transform((s) => s.map.map(([x]) => x)),
  map: <K extends z.ZodType, V extends z.ZodType>(key: K, value: V) => z.array(z.tuple([key, value])),
} as const;
