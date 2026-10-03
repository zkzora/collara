import type { RuntimeMode } from "@collara/domain";
import { z } from "zod";

// Public demo gate (synthesis §1.1, CR-03/CR-04, spec-content §b.3). Pure, so it is unit-tested without a server;
// runtime.ts reads the environment at request time and calls it.
//
//   off       default. Pre-demo copy; /demo is linked nowhere.
//   ui_mock   the synthetic UI mockup is promoted. Valid only with COLLARA_MODE=UI_MOCK. Its disclosure says it is
//             a mockup with no ledger connection; the LocalNet disclosure is never used for it.
//   localnet  the LocalNet demo is promoted. Valid only with COLLARA_MODE=LOCALNET.
//
// A status whose mode does not match the running app, or an unknown value, resolves to `off`, so a
// misconfiguration can only hide the demo, never mislabel it.

export const PUBLIC_DEMO_STATUSES = ["off", "ui_mock", "localnet"] as const;
export type PublicDemoStatus = (typeof PUBLIC_DEMO_STATUSES)[number];

const PublicDemoStatusSchema = z.enum(PUBLIC_DEMO_STATUSES).catch("off");

const REQUIRED_MODE: Readonly<Record<Exclude<PublicDemoStatus, "off">, RuntimeMode>> = {
  ui_mock: "UI_MOCK",
  localnet: "LOCALNET",
};

export function resolvePublicDemo(rawStatus: string | undefined, mode: RuntimeMode): PublicDemoStatus {
  const status = PublicDemoStatusSchema.parse(rawStatus?.trim().toLowerCase());
  if (status === "off") return "off";
  return REQUIRED_MODE[status] === mode ? status : "off";
}

/** INFERRED copy (pending approval, Q-01): the disclosure next to every promotion of the UI mockup demo. */
export const UI_MOCK_DEMO_DISCLOSURE =
  "The demo is a UI mockup with synthetic data. It is not connected to a ledger, and no funds are transferred.";
