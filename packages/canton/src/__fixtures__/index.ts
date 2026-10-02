// Responses recorded from a Canton 3.5.19 `dpm sandbox` (synthetic test parties only).
import { readFileSync } from "node:fs";

export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./${name}.json`, import.meta.url), "utf8"));
}

/** Recorded error response: { status, body }. */
export function errorFixture(name: string): { status: number; body: unknown } {
  return fixture(`errors/${name}`) as { status: number; body: unknown };
}
