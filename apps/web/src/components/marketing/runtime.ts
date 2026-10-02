import "server-only";
import { RuntimeModeSchema, type RuntimeMode } from "@collara/domain";
import { connection } from "next/server";
import { z } from "zod";

// Both values are read at request time (ADR-0001 §2.2), so one build serves either mode and the
// public demo gate can be switched without rebuilding. `connection()` opts the page out of
// prerendering; without it the values would be frozen at build time.

const PublicDemoStatusSchema = z.enum(["off", "localnet"]).catch("off");
export type PublicDemoStatus = z.infer<typeof PublicDemoStatusSchema>;

export async function getRuntimeMode(): Promise<RuntimeMode> {
  await connection();
  return RuntimeModeSchema.catch("UI_MOCK").parse(process.env.COLLARA_MODE?.trim());
}

/**
 * Whether the public demo is promoted (synthesis §1.1, CR-03/CR-04). `Explore the demo`, the footer
 * `Demo` link and the LocalNet disclosure are true only when PUBLIC_DEMO_STATUS=localnet **and** the
 * app really runs in LOCALNET; any other combination keeps the approved pre-demo copy.
 */
export async function isPublicDemoLive(): Promise<boolean> {
  await connection();
  const status: PublicDemoStatus = PublicDemoStatusSchema.parse(process.env.PUBLIC_DEMO_STATUS?.trim().toLowerCase());
  return status === "localnet" && (await getRuntimeMode()) === "LOCALNET";
}
