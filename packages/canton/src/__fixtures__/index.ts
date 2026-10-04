// Responses recorded from a Canton 3.5.19 `dpm sandbox` (synthetic test parties only).
import { readFileSync } from "node:fs";

export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./${name}.json`, import.meta.url), "utf8"));
}

/** Recorded error response: { status, body }. */
export function errorFixture(name: string): { status: number; body: unknown } {
  return fixture(`errors/${name}`) as { status: number; body: unknown };
}

/**
 * SYNTHETIC error response: { status, body }, NOT recorded from a participant. Built from the JsCantonError schema
 * and an error id named in the committed OpenAPI or the Canton error-code reference, for error kinds a sandbox
 * cannot produce on demand (pruning). Replace with a recorded body when one is observed.
 */
export function syntheticErrorFixture(name: string): { status: number; body: unknown } {
  return fixture(`errors-synthetic/${name}`) as { status: number; body: unknown };
}
