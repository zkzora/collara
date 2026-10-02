// Test support (import "@collara/db/testing"): an in-memory ledger that serves normalized LEDGER_EFFECTS updates
// and completions through the projection's client interfaces, and the daml-model.md §7 scenario built on it.
// Never imported by production code.
export { FakeLedger, TxBuilder } from "./projection/fake-ledger";
export {
  buildScenario,
  HINTS as SCENARIO_HINTS,
  scenarioBindingState,
  scenarioParties,
  type ScenarioParties,
  type ScenarioResult,
  type ScenarioStage,
} from "./read-model/scenario-fixture";
