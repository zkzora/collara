// LocalNet smoke (LOCALNET_IT=1): clean-start + main seed on a fresh "core-<unique>" prefix, then assertions
// on the LEDGER (ACS as each organisation's ledger user), seed replay idempotency, projection of a command
// record, GET /api/me and GET /api/system/health through the real app with the Canton gateway.
import { commands as commandsTable } from "@collara/db";
import { CommandStatusSchema, MeSchema, SystemHealthSchema } from "@collara/domain";
import { count } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SeedReport } from "../../src/seed/localnet";
import { LOCALNET_IT_ENABLED, startLocalnetHarness, type LocalnetHarness } from "./harness";

const ASSET_ID = "ASSET-DEMO-001";

describe.skipIf(!LOCALNET_IT_ENABLED)("LocalNet smoke: clean-start + main seed", () => {
  let h: LocalnetHarness;
  let cleanStart: SeedReport;
  let main: SeedReport;
  const facts: Record<string, unknown> = {};

  beforeAll(async () => {
    h = await startLocalnetHarness({ prefixBase: "core" });
    facts.prefix = h.prefix;
    facts.namespace = h.namespace;
    facts.setup = h.timings;
  });

  afterAll(async () => {
    console.log(`LocalNet smoke facts: ${JSON.stringify(facts, null, 2)}`);
    await h?.close();
  });

  it("seeds clean-start (B1–B8), then main (M1–M18) through the workflow runner", async () => {
    cleanStart = await h.seed("clean-start");
    expect(cleanStart.steps.map((s) => s.step)).toEqual(["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8"]);
    expect(cleanStart.steps.every((s) => s.state === "COMMITTED" && !s.replayed && s.updateId)).toBe(true);

    main = await h.seed("main");
    const fresh = main.steps.filter((s) => !s.replayed);
    // The clean-start steps replay; every M step commits now with an update id.
    expect(main.steps.filter((s) => s.replayed).map((s) => s.step)).toEqual(["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8"]);
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.every((s) => s.step.startsWith("M") && s.state === "COMMITTED" && s.updateId)).toBe(true);
    expect(main.documents).toHaveLength(6);
    expect(main.documents.every((d) => /^[0-9a-f]{64}$/.test(d.sha256))).toBe(true);

    facts.cleanStart = { ms: cleanStart.totalMs, steps: cleanStart.steps.length };
    facts.main = { ms: main.totalMs, steps: main.steps.length, committedNow: fresh.length, documents: main.documents.length };
    facts.contracts = Object.fromEntries(Object.entries(main.contracts).map(([view, counts]) => [view, Object.values(counts).reduce((a, b) => a + b, 0)]));
  });

  it("ledger: ASSET-DEMO-001 is registered and control v3 is shared with Demo Lender A", async () => {
    const lenderA = h.party("lenderA");
    const asBorrower = await h.acsAs("borrower", "AssetControl", (c) => c.assetId === ASSET_ID && c.namespace === h.namespace);
    expect(asBorrower).toHaveLength(1);
    const control = asBorrower[0]!;
    expect(control.payload.controlVersion).toBe(3);
    expect(control.payload.sharedLender).toBe(lenderA);
    expect(control.payload.owner).toBe(h.party("borrower"));
    expect(control.signatories).toEqual(expect.arrayContaining([h.party("registrar"), h.party("borrower")]));

    // The selected lender sees the same control as an observer; the unrelated lender sees nothing.
    const asLenderA = await h.acsAs("lenderA", "AssetControl", (c) => c.assetId === ASSET_ID);
    expect(asLenderA.map((c) => c.contractId)).toEqual([control.contractId]);
    expect(await h.acsAs("lenderB", "AssetControl")).toHaveLength(0);

    const passports = await h.acsAs("borrower", "AssetPassport", (p) => p.assetId === ASSET_ID && p.namespace === h.namespace);
    expect(passports).toHaveLength(1);
    expect(passports[0]!.payload.equipment.serialNumber).toBe("SYNTH-CNC-001");
  });

  it("ledger: ATT-001 exists and Demo Lender A holds its AttestationDisclosure", async () => {
    const attestations = await h.acsAs("verifier", "VerificationAttestation", (a) => a.attestationRef === "ATT-001" && a.namespace === h.namespace);
    expect(attestations).toHaveLength(1);
    const attestation = attestations[0]!;
    expect(attestation.payload.assetId).toBe(ASSET_ID);
    expect(attestation.payload.verifierRef).toBe("VER-001");

    const disclosures = await h.acsAs("lenderA", "AttestationDisclosure", (d) => d.attestation.attestationRef === "ATT-001");
    expect(disclosures).toHaveLength(1);
    expect(disclosures[0]!.payload.recipient).toBe(h.party("lenderA"));
    expect(disclosures[0]!.payload.attestationCid).toBe(attestation.contractId);
    expect(disclosures[0]!.payload.attestation.evidence).toEqual(attestation.payload.evidence);

    expect(await h.acsAs("lenderB", "AttestationDisclosure")).toHaveLength(0);
    expect(await h.acsAs("lenderB", "VerificationAttestation")).toHaveLength(0);
  });

  it("ledger: the lender's CollateralAssessment is SUBMITTED (and invisible to the verifier and Lender B)", async () => {
    const assessments = await h.acsAs("lenderA", "CollateralAssessment", (a) => a.namespace === h.namespace && a.assetId === ASSET_ID);
    expect(assessments).toHaveLength(1);
    const assessment = assessments[0]!.payload;
    expect(assessment.status).toBe("SUBMITTED");
    expect(assessment.borrower).toBe(h.party("borrower"));
    expect(assessment.snapshot.attestationRef).toBe("ATT-001");
    expect(assessment.valuation).toBeNull();
    facts.assessment = { ref: assessment.assessmentRef, caseRef: assessment.caseRef, version: assessment.version };

    expect(await h.acsAs("verifier", "CollateralAssessment")).toHaveLength(0);
    expect(await h.acsAs("lenderB", "CollateralAssessment")).toHaveLength(0);
  });

  it("replaying the seed (same idempotency keys) submits nothing and creates no duplicates", async () => {
    const [before] = await h.db.db.select({ n: count() }).from(commandsTable);
    const replay = await h.seed("main");
    const [after] = await h.db.db.select({ n: count() }).from(commandsTable);

    expect(replay.steps).toHaveLength(main.steps.length);
    expect(replay.steps.every((s) => s.replayed)).toBe(true);
    // Same update ids as the original commits, no new command records, identical active-contract counts.
    expect(replay.steps.map((s) => s.updateId)).toEqual(main.steps.map((s) => s.updateId));
    expect(after?.n).toBe(before?.n);
    expect(replay.contracts).toEqual(main.contracts);
    expect(replay.documents).toEqual(main.documents);
    expect(await h.acsAs("borrower", "AssetControl", (c) => c.assetId === ASSET_ID)).toHaveLength(1);
    expect(await h.acsAs("lenderA", "CollateralAssessment")).toHaveLength(1);
    facts.replay = { ms: replay.totalMs, steps: replay.steps.length, commandRecords: after?.n };
  });

  it("a committed command record moves COMMITTED → PROJECTED after a projection pass", async () => {
    const record = await h.seedCommand("M18");
    expect(record?.status).toBe("COMMITTED");
    expect(record?.updateId).toBeTruthy();

    const started = Date.now();
    const results = await h.project();
    facts.projection = { ms: Date.now() - started, results };
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ status: "ACTIVE", complete: true });
    expect(results[0]!.transactionsApplied).toBeGreaterThan(0);

    const projected = await h.command(record!.id);
    expect(projected?.status).toBe("PROJECTED");
    expect(projected?.updateId).toBe(record?.updateId);

    // The issuing analyst sees the same state through GET /api/commands/:id; another organisation does not.
    const analyst = await h.loginAs("lender-a-analyst");
    const status = await analyst.inject("GET", `/api/commands/${record!.id}`);
    expect(status.statusCode).toBe(200);
    const dto = CommandStatusSchema.parse(status.json());
    expect(dto).toMatchObject({ state: "PROJECTED", simulated: false, updateId: record?.updateId });
    const lenderB = await h.loginAs("lender-b-approver");
    expect((await lenderB.inject("GET", `/api/commands/${record!.id}`)).statusCode).toBe(404);
  });

  it("GET /api/me as the Lender A approver returns the LOCALNET organisation and mandates", async () => {
    const approver = await h.loginAs("lender-a-approver");
    // A browser-supplied organisation header is ignored (authority comes from the session only).
    const response = await approver.inject("GET", "/api/me", { headers: { "x-collara-org": "demo-lender-b" } });
    expect(response.statusCode).toBe(200);
    const me = MeSchema.parse(response.json());
    expect(me.mode).toBe("LOCALNET");
    expect(me.org.id).toBe("demo-lender-a");
    expect(me.mandates.map((m) => m.code)).toEqual(expect.arrayContaining(["APPROVER", "GOVERNANCE_SEAT"]));
    expect(me.governanceSeat).toBe(1);
    expect(me.personaId).toBe("lender-a-approver");
  });

  it("GET /api/system/health reports the ledger reachable with the exact topology", async () => {
    const response = await h.inject("GET", "/api/system/health");
    expect(response.statusCode).toBe(200);
    const health = SystemHealthSchema.parse(response.json());
    facts.health = health;
    expect(health.mode).toBe("LOCALNET");
    expect(health.checks.database?.status).toBe("ok");
    expect(health.checks.ledger).toEqual({ status: "ok", detail: "Canton 3.5.19 dpm sandbox, 1 participant (not Splice LocalNet)" });
    // A projection pass has run, so the worker checkpoint exists.
    expect(health.checks.worker?.status).toBe("ok");
  });
});
