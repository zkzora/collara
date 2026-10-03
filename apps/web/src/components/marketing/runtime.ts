import "server-only";
import { RuntimeModeSchema, type RuntimeMode } from "@collara/domain";
import { connection } from "next/server";
import { resolvePublicDemo, type PublicDemoStatus } from "./public-demo";

// Both values are read at request time (ADR-0001 §2.2), so one build serves either mode and the
// public demo gate can be switched without rebuilding. `connection()` opts the page out of
// prerendering; without it the values would be frozen at build time.

export async function getRuntimeMode(): Promise<RuntimeMode> {
  await connection();
  return RuntimeModeSchema.catch("UI_MOCK").parse(process.env.COLLARA_MODE?.trim());
}

/**
 * Which public demo is promoted (synthesis §1.1, CR-03/CR-04): `Explore the demo`, the footer `Demo` link and the
 * matching disclosure. PUBLIC_DEMO_STATUS=ui_mock counts only in UI_MOCK and =localnet only in LOCALNET; anything
 * else is `off` and keeps the approved pre-demo copy (public-demo.ts).
 */
export async function getPublicDemo(): Promise<PublicDemoStatus> {
  return resolvePublicDemo(process.env.PUBLIC_DEMO_STATUS, await getRuntimeMode());
}
