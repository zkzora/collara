// Errors from the database layer can carry user data: drizzle's DrizzleQueryError has the bound parameters in
// `params` and in its message ("params: ..."), and node-postgres errors put row values in `detail`
// ("Key (email)=(...) already exists.") and `where`. Loggers pass errors through `toLogSafeError` so that only
// the SQL text (placeholders, no values) and diagnostic codes are kept.

const PARAMS_MARKER = /\nparams: [\s\S]*$/;

/** pg error fields that never contain row values. */
const SAFE_PG_FIELDS = ["code", "severity", "table", "column", "constraint", "schema", "routine"] as const;

interface ErrorLike {
  name?: unknown;
  message?: unknown;
  stack?: unknown;
  cause?: unknown;
  [key: string]: unknown;
}

function isErrorLike(value: unknown): value is ErrorLike {
  return typeof value === "object" && value !== null && ("message" in value || value instanceof Error);
}

function stripParams(text: unknown): unknown {
  return typeof text === "string" ? text.replace(PARAMS_MARKER, "\nparams: [redacted]") : text;
}

function isDrizzleQueryError(error: ErrorLike): boolean {
  return "query" in error && "params" in error;
}

function isPgError(error: ErrorLike): boolean {
  return typeof error.code === "string" && ("severity" in error || "routine" in error);
}

/**
 * Returns an Error safe to log: drizzle query errors lose their parameters (message, stack and `params`), and
 * PostgreSQL errors keep only code/severity/table/column/constraint/schema/routine. Other errors are returned
 * unchanged. Applied recursively to `cause` (bounded depth).
 */
export function toLogSafeError(value: unknown, depth = 0): unknown {
  if (!isErrorLike(value) || depth > 4) return value;
  const drizzle = isDrizzleQueryError(value);
  const pg = isPgError(value);
  if (!drizzle && !pg && value.cause === undefined) return value;

  const safe = new Error(String(drizzle ? stripParams(value.message) : (value.message ?? "")));
  safe.name = typeof value.name === "string" ? value.name : "Error";
  if (typeof value.stack === "string") safe.stack = String(drizzle ? stripParams(value.stack) : value.stack);
  const target = safe as unknown as Record<string, unknown>;
  if (drizzle && typeof value.query === "string") target.query = value.query;
  if (pg) {
    // The message of a pg error can quote values too (e.g. invalid input syntax for type uuid: "..."), and so does
    // the first line of its stack. Keep schema names only (constraint/table are not user data).
    const where = [value.constraint && `constraint ${String(value.constraint)}`, value.table && `table ${String(value.table)}`]
      .filter(Boolean)
      .join(", ");
    safe.message = `PostgreSQL error ${String(value.code)}${where ? ` (${where})` : ""}`;
    if (typeof value.stack === "string") {
      const newline = value.stack.indexOf("\n");
      safe.stack = `${safe.name}: ${safe.message}${newline === -1 ? "" : value.stack.slice(newline)}`;
    }
    for (const field of SAFE_PG_FIELDS) if (value[field] !== undefined) target[field] = value[field];
  }
  if (value.cause !== undefined) target.cause = toLogSafeError(value.cause, depth + 1);
  return safe;
}
