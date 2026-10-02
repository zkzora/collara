// Shared setup of the financing IT files (LOCALNET_IT=1): a fresh prefix, the main seed (ledger-only documents),
// then review → eligible → proposal → accept → authorize through the API, so the case is ready for activation.
import type { LightMyRequestResponse } from "fastify";
import { expect } from "vitest";
import { startLocalnetHarness, type ItSession, type LocalnetHarness } from "./harness";

export const CASE = "CL-001";
export const ASSET = "ASSET-DEMO-001";
export const PRINCIPAL = { amount: "100000.00", currency: "USD" } as const;

export interface AuthorizedWorld {
  readonly h: LocalnetHarness;
  readonly approver: ItSession;
  readonly borrower: ItSession;
  readonly ms: number;
}

export function expectOk(response: LightMyRequestResponse, label: string) {
  expect(response.statusCode, `${label}: ${response.body}`).toBe(200);
  return response.json();
}

/** Main seed + API steps up to an AUTHORIZED activation (FP-001 v1 accepted, AUTH for control v3). */
export async function authorizedWorld(prefixBase: string): Promise<AuthorizedWorld> {
  const started = Date.now();
  const h = await startLocalnetHarness({ prefixBase });
  try {
    await h.seed("main", { skipDocuments: true });
    await h.project();
    const approver = await h.loginAs("lender-a-approver");
    const borrower = await h.loginAs("manufacturer-owner");
    const post = async (session: ItSession, path: string, body: unknown, label: string) => {
      const json = expectOk(await session.inject("POST", path, { body }), label);
      await h.project();
      return json;
    };
    await post(
      approver,
      `/api/cases/${CASE}/assessments`,
      { valuation: { amount: "150000.00", currency: "USD" }, valuationSource: "Synthetic desk valuation (demo)", valuationDate: new Date().toISOString().slice(0, 10), limitations: "", outcome: "ELIGIBLE", policyRef: "CP-2026-CNC-01" },
      "save assessment",
    );
    await post(approver, "/api/reviews/CA-001/decision", { outcome: "ELIGIBLE" }, "decide eligible (submit + approve)");
    await post(approver, `/api/cases/${CASE}/proposals`, { intent: "ISSUE", principal: PRINCIPAL }, "issue proposal");
    await post(borrower, "/api/proposals/FP-001/acceptance", { expectedVersion: 1 }, "accept v1");
    await post(borrower, "/api/proposals/FP-001/activation-authorization", { expectedVersion: 1 }, "authorize activation");
    return { h, approver, borrower, ms: Date.now() - started };
  } catch (error) {
    await h.close();
    throw error;
  }
}

/** Active locks / controls of the demo asset as an organisation's ledger user sees them right now. */
export const ledgerTokens = async (h: LocalnetHarness) => ({
  locksLender: (await h.acsAs("lenderA", "CollateralLock", (l) => l.namespace === h.namespace && l.assetId === ASSET)).length,
  locksBorrower: (await h.acsAs("borrower", "CollateralLock", (l) => l.namespace === h.namespace && l.assetId === ASSET)).length,
  controls: (await h.acsAs("borrower", "AssetControl", (c) => c.namespace === h.namespace && c.assetId === ASSET)).length,
});
