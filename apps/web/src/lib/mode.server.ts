import "server-only";
import type { RuntimeMode } from "@collara/domain";
import { connection } from "next/server";
import { parseRuntimeMode } from "./mode";

/**
 * Reads COLLARA_MODE at request time (never baked into the build), so one build can serve either
 * mode. Callers render dynamically; pass the result to CollaraClientProvider.
 */
export async function readRuntimeMode(): Promise<RuntimeMode> {
  await connection();
  return parseRuntimeMode(process.env.COLLARA_MODE);
}
