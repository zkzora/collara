// DEVNET bindings: Console-created parties (tenant prefix) → Collara hints, refusal lists, the DevNet state, and the
// authority path through the single tenant user (each actor still submits as exactly its own bound party).
import { importLocalnetState, type DbHandle } from "@collara/db";
import { rights } from "@collara/canton";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LedgerAccess } from "../ledger/access";
import { assertDevnetState, tenantOnly } from "../ledger/devnet";
import { seededDb } from "../test-support";
import { ensureSystemUsers, loadMemberActor, resolveSystemActor } from "../workflow/actors";
import { buildDevnetState, COLLARA_PARTIES, devnetNamespace, matchParties, matchProblems, rightsToParties, type CollaraPartyHint } from "./bindings";

const PREFIX = "c2ede6f6";
const USER = "c2ede6f6-0000-4000-8000-000000000001";
const party = (hint: string) => `${PREFIX}-${hint}::1220aa`;
const PRIMARY = `${PREFIX}-alice::1220aa`;
const ALL = COLLARA_PARTIES.map((p) => p.hint);
const fullRights = () => [...ALL.flatMap((h) => [rights.canActAs(party(h)), rights.canReadAs(party(h))]), rights.canActAs(PRIMARY)];

function state() {
  const match = matchParties(rightsToParties(fullRights()));
  return buildDevnetState({
    ledgerUserId: USER,
    primaryParty: PRIMARY,
    jsonApiUrl: "https://ledger-api-json.participant.hackcanton-01.devnet.naas.noders.services",
    participantId: "PAR::noders::1220",
    ledgerEnd: 4242,
    cantonVersion: "3.5.19",
    audience: "https://hackcanton-01.devnet.naas.noders.services",
    parties: match.matched as Record<CollaraPartyHint, string>,
    packages: [],
    namespace: devnetNamespace("r1"),
  });
}

describe("matchParties", () => {
  it("matches every hint through the tenant prefix and ignores the primary party", () => {
    const match = matchParties(rightsToParties(fullRights()));
    expect(matchProblems(match)).toBeNull();
    expect(match.matched.DemoLenderA).toBe(party("DemoLenderA"));
    expect(match.matched.GovSeat3).toBe(party("GovSeat3"));
    expect(Object.values(match.matched)).not.toContain(PRIMARY);
  });

  it("refuses with an exact list: missing, near miss, ambiguous, read-only", () => {
    const r = fullRights().filter((right) => !JSON.stringify(right).includes("DemoAuditor") && !JSON.stringify(right).includes("GovSeat2"));
    r.push(rights.canActAs(`${PREFIX}-demoauditor::1220aa`)); // wrong case
    r.push(rights.canActAs(`other-DemoLenderB::1220bb`)); // a second DemoLenderB
    r.push(rights.canReadAs(party("GovSeat2"))); // read-only
    const match = matchParties(rightsToParties(r));
    const problems = matchProblems(match) ?? "";
    expect(match.missing).toEqual(["DemoAuditor"]);
    expect(problems).toContain('missing: DemoAuditor (auditor (Demo Auditor)): create a party named exactly "DemoAuditor"');
    expect(problems).toContain(`near miss for DemoAuditor: ${PREFIX}-demoauditor::1220aa`);
    expect(problems).toContain(`ambiguous: DemoLenderB matches ${party("DemoLenderB")}, other-DemoLenderB::1220bb`);
    expect(problems).toContain(`read-only: GovSeat2 = ${party("GovSeat2")}`);
  });

  it("does not let one hint match a longer name (DemoLenderA vs DemoLenderAB)", () => {
    const r = [...fullRights(), rights.canActAs(`${PREFIX}-DemoLenderAB::1220aa`)];
    expect(matchParties(rightsToParties(r)).matched.DemoLenderA).toBe(party("DemoLenderA"));
  });
});

describe("DevNet state", () => {
  it("has one tenant user acting and reading as exactly the eleven bound parties", () => {
    const s = state();
    expect(s.topology).toBe("devnet-shared-participant");
    expect(Object.keys(s.participants)).toEqual(["devnet"]);
    expect(s.users).toHaveLength(1);
    expect(s.users[0]).toMatchObject({ id: USER, role: "tenant", primaryParty: PRIMARY });
    expect([...(s.users[0]?.actAs ?? [])].sort()).toEqual(ALL.map(party).sort());
    expect(s.users[0]?.readAs).not.toContain(PRIMARY);
    expect(s.namespace).toBe("collara-devnet-r1");
    expect(() => devnetNamespace("Bad Ref")).toThrow();
  });

  it("is checked against the configuration and never gets HMAC tokens", () => {
    const s = state();
    const env = { CANTON_DEVNET_JSON_API_URL: s.jsonApiUrl, DEVNET_LEDGER_USER_ID: USER } as Parameters<typeof assertDevnetState>[1];
    expect(() => assertDevnetState(s, env)).not.toThrow();
    expect(() => assertDevnetState(s, { ...env, DEVNET_LEDGER_USER_ID: "someone-else" })).toThrow(/imported for ledger user/);
    expect(() => assertDevnetState({ ...s, topology: "sandbox-1-participant" }, env)).toThrow(/never point DEVNET at a LocalNet state/);
    expect(() => new LedgerAccess({ state: s, secret: "unit-test-secret-0123456789" })).toThrow(/HMAC tokens are LOCALNET only/);
    const tokenProvider = { userId: USER, getToken: async () => "token" };
    const access = new LedgerAccess({ state: s, tokenProviderFor: tenantOnly(tokenProvider) });
    expect(access.userOfParty(party("DemoLenderA"))).toEqual({ id: USER, participant: "devnet" });
    expect(access.userOfParty(PRIMARY)).toBeNull();
    expect(() => access.client("registrar-svc")).toThrow(/not the DevNet tenant user/);
  });
});

describe("authority through the tenant user (DEVNET bindings)", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    vi.stubEnv("COLLARA_MODE", "DEVNET");
    handle = await seededDb();
    await ensureSystemUsers(handle.db);
    const summary = await importLocalnetState(handle.db, state());
    expect(summary.bindings).toBe(11);
    expect(summary.ledgerUsers).toBe(1);
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await handle.close();
  });

  it("each member acts as exactly its own organisation's party, through the tenant user", async () => {
    const approver = await loadMemberActor(handle.db, "user-lender-a-approver");
    expect(approver.business).toMatchObject({ party: party("DemoLenderA"), ledgerUserId: USER, source: "devnet" });
    expect(approver.seat).toMatchObject({ party: party("GovSeat1"), ledgerUserId: USER, readAs: [party("CollaraGovernance")] });
    const owner = await loadMemberActor(handle.db, "user-manufacturer-owner");
    expect(owner.business?.party).toBe(party("DemoManufacturer"));
    expect(owner.seat).toBeNull();
    expect(owner.readableParties).not.toContain(party("DemoLenderA"));
    const registrar = await resolveSystemActor(handle.db, "registrar");
    expect(registrar.business).toMatchObject({ party: party("CollaraRegistrar"), ledgerUserId: USER });
  });
});
