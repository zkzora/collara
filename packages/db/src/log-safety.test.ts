import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import { toLogSafeError } from "./log-safety";

const SECRET = "ada.lovelace@example.test";

function pgUniqueViolation(): Error {
  return Object.assign(new Error(`duplicate key value violates unique constraint "pilot_requests_email_key"`), {
    code: "23505",
    severity: "ERROR",
    detail: `Key (email)=(${SECRET}) already exists.`,
    table: "pilot_requests",
    constraint: "pilot_requests_email_key",
    schema: "public",
    routine: "_bt_check_unique",
  });
}

/** Everything a logger could serialize: own enumerable fields plus message and stack, recursively. */
function dump(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v instanceof Error ? { ...v, name: v.name, message: v.message, stack: v.stack, cause: (v as { cause?: unknown }).cause } : v,
  );
}

describe("toLogSafeError", () => {
  it("drops drizzle query parameters from message, stack and fields but keeps the SQL text", () => {
    const err = new DrizzleQueryError('insert into "pilot_requests" ("email") values ($1)', [SECRET], pgUniqueViolation());
    expect(dump(err)).toContain(SECRET);
    const safe = toLogSafeError(err);
    const text = dump(safe);
    expect(text).not.toContain(SECRET);
    expect(text).toContain('insert into \\"pilot_requests\\"');
    expect(text).toContain("params: [redacted]");
    expect(text).toContain("23505");
    expect(text).toContain("pilot_requests_email_key");
  });

  it("drops the row values of a PostgreSQL error (detail, message) and keeps diagnostic codes", () => {
    const safe = toLogSafeError(pgUniqueViolation()) as Record<string, unknown>;
    expect(dump(safe)).not.toContain(SECRET);
    expect(safe.detail).toBeUndefined();
    expect(safe.code).toBe("23505");
    expect(safe.table).toBe("pilot_requests");
  });

  it("does not keep a value quoted in a PostgreSQL message or the first line of its stack", () => {
    const err = Object.assign(new Error(`invalid input syntax for type uuid: "${SECRET}"`), { code: "22P02", severity: "ERROR", routine: "string_to_uuid" });
    expect(dump(toLogSafeError(err))).not.toContain(SECRET);
  });

  it("leaves unrelated errors untouched", () => {
    const err = new Error("ledger unavailable");
    expect(toLogSafeError(err)).toBe(err);
    expect(toLogSafeError("not an error")).toBe("not an error");
  });
});
