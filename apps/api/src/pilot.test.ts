import { pilotRequests } from "@collara/db";
import { ApiProblemSchema, PilotRequestReceiptSchema } from "@collara/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { idem, testApp, type TestApp } from "./test-support";

const VALID = {
  fullName: "Synthetic Person",
  workEmail: "pilot@example.test",
  company: "Synthetic Equipment Finance",
  role: "Credit operations",
  companyType: "LENDER",
  country: "US",
  equipmentCategory: "CNC machining centers",
  casesPerMonth: "UNKNOWN",
  workflowChallenge: "Collecting inspection evidence takes several follow-ups per case.",
  consent: true,
};

describe("POST /api/pilot-requests", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await testApp({ env: { PILOT_RATE_LIMIT_MAX: "5", PILOT_RATE_LIMIT_WINDOW_MS: "60000" } });
  });

  afterAll(async () => {
    await t.close();
  });

  it("persists a valid request before answering and reports RECEIVED", async () => {
    const res = await t.app.inject({ method: "POST", url: "/api/pilot-requests", headers: idem("pilot-key-1"), payload: VALID });
    expect(res.statusCode).toBe(201);
    const receipt = PilotRequestReceiptSchema.parse(res.json());
    expect(receipt.state).toEqual({ value: "RECEIVED", label: "Received", tone: "success" });
    const rows = await t.db.db.select().from(pilotRequests);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: receipt.id, workEmail: "pilot@example.test", status: "RECEIVED", notifyAttempts: 0, currentSystems: null });

    // A double submit with the same Idempotency-Key stores one request.
    const replay = await t.app.inject({ method: "POST", url: "/api/pilot-requests", headers: idem("pilot-key-1"), payload: VALID });
    expect(PilotRequestReceiptSchema.parse(replay.json()).id).toBe(receipt.id);
    expect(await t.db.db.select().from(pilotRequests)).toHaveLength(1);
  });

  it("rejects invalid input with a validation problem listing the fields", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/api/pilot-requests",
      payload: { ...VALID, workEmail: "not-an-email", consent: false, casesPerMonth: "LOTS" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toMatch(/^application\/problem\+json/);
    const problem = ApiProblemSchema.parse(res.json());
    expect(problem.code).toBe("validation_error");
    expect(problem.issues?.map((issue) => issue.path).sort()).toEqual(["body.casesPerMonth", "body.consent", "body.workEmail"]);
  });

  it("discards honeypot submissions without storing them", async () => {
    const before = (await t.db.db.select().from(pilotRequests)).length;
    const res = await t.app.inject({ method: "POST", url: "/api/pilot-requests", payload: { ...VALID, website: "http://spam.example" } });
    expect(res.statusCode).toBe(201);
    PilotRequestReceiptSchema.parse(res.json());
    expect(await t.db.db.select().from(pilotRequests)).toHaveLength(before);
  });

  it("rate-limits per client address with a 429 problem", async () => {
    // Earlier tests in this file used 4 of the 5 allowed requests from the same address (invalid ones count).
    const ok = await t.app.inject({ method: "POST", url: "/api/pilot-requests", payload: VALID });
    expect(ok.statusCode).toBe(201);
    const limited = await t.app.inject({ method: "POST", url: "/api/pilot-requests", payload: VALID });
    expect(limited.statusCode).toBe(429);
    expect(ApiProblemSchema.parse(limited.json()).code).toBe("rate_limited");
    // Another address has its own bucket.
    const other = await t.app.inject({ method: "POST", url: "/api/pilot-requests", payload: VALID, remoteAddress: "10.0.0.9" });
    expect(other.statusCode).toBe(201);
  });
});
