// Synthetic scenario builder. UI_MOCK uses it directly; the LOCALNET seed scripts reproduce the same
// states through real workflows (synthesis §1.6). Everything is synthetic and date-relative to `now`.
import type { AssetFacts, CaseFacts } from "../facts";
import type { GovernanceFacts } from "../governance";
import { buildExtraCases } from "./extra";
import { buildCl001Asset, buildCl001Case, buildGovernance } from "./main";
import { clock, EventLog } from "./support";

export const SEED_PROFILES = ["main", "clean-start"] as const;
export type SeedProfile = (typeof SEED_PROFILES)[number];

export interface DemoWorld {
  readonly now: string;
  readonly profile: SeedProfile;
  /** Every case's `asset` is the same object as the matching entry here. */
  assets: AssetFacts[];
  cases: CaseFacts[];
  governance: GovernanceFacts;
}

export interface ScenarioOptions {
  readonly now: Date;
  readonly profile?: SeedProfile;
  /** Include CL-002…CL-005 (main profile only). Default true. */
  readonly extraRows?: boolean;
  readonly governanceIntegration?: GovernanceFacts["integration"];
}

/**
 * main: CL-001 registered, attested, PKG-001 v2 shared with Demo Lender A, review SUBMITTED, no
 * proposal, no lock (+ CL-002…CL-005). clean-start: organizations, users and registry only.
 */
export function buildScenario(options: ScenarioOptions): DemoWorld {
  const { now, profile = "main", extraRows = true } = options;
  const governance = buildGovernance(now, options.governanceIntegration);
  if (profile === "clean-start") {
    return { now: now.toISOString(), profile, assets: [], cases: [], governance };
  }
  const c = clock(now);
  const log = new EventLog();
  const asset = buildCl001Asset(c, log);
  const cases = [buildCl001Case(c, log, asset), ...(extraRows ? buildExtraCases(c, log) : [])];
  return { now: now.toISOString(), profile, assets: cases.map((x) => x.asset), cases, governance };
}

export { clock, EventLog, PROTOTYPE_NOW, syntheticSha256 } from "./support";
export { CL001_CHECKS } from "./main";
