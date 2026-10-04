import { describe, expect, it } from "vitest";
import { CAPABILITIES } from "./capabilities";
import { EVIDENCE, passCount } from "./evidence";

describe("EVIDENCE", () => {
  it("unit test total is the sum of the per-package counts", () => {
    const sum = Object.values(EVIDENCE.unitTests.byPackage).reduce((acc, n) => acc + n, 0);
    expect(sum).toBe(EVIDENCE.unitTests.total);
  });

  it("every dated entry has an ISO date", () => {
    const dates = [
      EVIDENCE.unitTests.date,
      EVIDENCE.ci.date,
      EVIDENCE.damlTests.date,
      EVIDENCE.localnetIntegration.date,
      EVIDENCE.cleanStartBrowser.date,
      EVIDENCE.privacy.date,
      EVIDENCE.governance.tierA.localnet.date,
      EVIDENCE.governance.tierA.devnet.date,
      EVIDENCE.governance.tierB.localnet.date,
      EVIDENCE.governance.tierB.devnet.date,
      EVIDENCE.deployment.web.date,
      EVIDENCE.devnet.date,
    ];
    for (const date of dates) expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("keeps the caveats that the public status relies on", () => {
    expect(EVIDENCE.privacy.operators).toBe(1);
    expect(EVIDENCE.governance.tierB.localnet.operators).toBe(1);
    expect(EVIDENCE.governance.tierB.localnet.independentOperators).toBe(false);
    expect(EVIDENCE.governance.tierB.localnet.integratedInApp).toBe(false);
    expect(EVIDENCE.governance.tierB.localnet.rerunWithContracts020).toBe(false);
    expect(EVIDENCE.deployment.web.mode).toBe("UI_MOCK");
    expect(EVIDENCE.deployment.cantonNetwork).toBe(false);
    // DevNet: code only until a real run is recorded in docs/devnet-evidence.md.
    expect(EVIDENCE.devnet.run).toBe(false);
    expect(EVIDENCE.devnet.firstCommittedUpdateId).toBeNull();
  });

  it("never reads as decentralized governance on DevNet", () => {
    const { tierA, tierB } = EVIDENCE.governance;
    // Tier A has no decentralized party anywhere; on DevNet it is only Tier A, and it has not run.
    expect(tierA.localnet.decentralizedParty).toBe(false);
    expect(tierA.devnet.decentralizedParty).toBe(false);
    expect(tierA.devnet.run).toBe(EVIDENCE.devnet.run);
    expect(EVIDENCE.devnet.governanceTier).toBe("A");
    // Tier B ran only locally; on DevNet it was not attempted.
    expect(tierB.devnet.run).toBe(false);
    expect(tierB.devnet.attempted).toBe(false);
    expect(tierB.localnet.decentralizedParty).toBe(true);
  });

  it("feeds the capability table instead of repeating its numbers", () => {
    const where = (id: string) => CAPABILITIES.find((c) => c.id === id)?.where.text ?? "";
    expect(where("daml-model")).toContain(`${EVIDENCE.damlTests.passed} Daml Script tests`);
    expect(where("localnet-demo")).toContain(passCount(EVIDENCE.localnetIntegration));
    expect(where("roles")).toContain(`${EVIDENCE.privacy.participants} participants`);
    expect(where("governance")).toContain(passCount(EVIDENCE.governance.tierB.localnet.scriptedChecks));
    expect(where("governance")).toContain("neither tier on DevNet");
    expect(where("devnet")).toContain(EVIDENCE.devnet.status);
    expect(passCount({ passed: 7, total: 9 })).toBe("7/9");
  });
});
