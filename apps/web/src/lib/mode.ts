import { RuntimeModeSchema, type RuntimeMode } from "@collara/domain";

/**
 * COLLARA_MODE → RuntimeMode. Unset means UI_MOCK (same default as the API). An unknown value is a
 * configuration error, never a silent fallback to the mockup (ADR-0001 §2.2).
 */
export function parseRuntimeMode(value: string | undefined): RuntimeMode {
  const trimmed = value?.trim();
  if (!trimmed) return "UI_MOCK";
  const parsed = RuntimeModeSchema.safeParse(trimmed);
  if (!parsed.success) throw new Error(`COLLARA_MODE must be UI_MOCK or LOCALNET (got "${trimmed}").`);
  return parsed.data;
}
