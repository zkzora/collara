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
      EVIDENCE.tierB.date,
      EVIDENCE.deployment.web.date,
      EVIDENCE.devnet.date,
    ];
    for (const date of dates) expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("keeps the caveats that the public status relies on", () => {
    expect(EVIDENCE.privacy.operators).toBe(1);
    expect(EVIDENCE.tierB.operators).toBe(1);
    expect(EVIDENCE.tierB.integratedInApp).toBe(false);
    expect(EVIDENCE.deployment.web.mode).toBe("UI_MOCK");
    expect(EVIDENCE.deployment.cantonNetwork).toBe(false);
    // DevNet: code only until a real run is recorded in docs/devnet-evidence.md.
    expect(EVIDENCE.devnet.run).toBe(false);
    expect(EVIDENCE.devnet.firstCommittedUpdateId).toBeNull();
  });

  it("feeds the capability table instead of repeating its numbers", () => {
    const where = (id: string) => CAPABILITIES.find((c) => c.id === id)?.where.text ?? "";
    expect(where("daml-model")).toContain(`${EVIDENCE.damlTests.passed} Daml Script tests`);
    expect(where("localnet-demo")).toContain(passCount(EVIDENCE.localnetIntegration));
    expect(where("roles")).toContain(`${EVIDENCE.privacy.participants} participants`);
    expect(where("governance")).toContain(passCount(EVIDENCE.tierB.scriptedChecks));
    expect(where("devnet")).toContain(EVIDENCE.devnet.status);
    expect(passCount({ passed: 7, total: 9 })).toBe("7/9");
  });
});
