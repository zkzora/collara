// Multi-participant routing of the Canton gateway: a submission goes to the participant of its source (the
// ledger user's participant from the bootstrap state), and the reset check asks that same participant.
import { create, templateId } from "@collara/canton";
import type { CommandRow } from "@collara/db";
import { describe, expect, it } from "vitest";
import { LedgerAccess } from "./access";
import { CantonLedgerGateway } from "./gateway";
import type { LedgerState } from "./state";

const P1 = "http://p1.invalid";
const P2 = "http://p2.invalid";
const BORROWER = "DemoManufacturer::1220bb";
const REGISTRAR = "CollaraRegistrar::1220aa";

const STATE: LedgerState = {
  version: 1,
  bootstrappedAt: "2026-10-01T00:00:00Z",
  topology: "sandbox-5-participants",
  audience: "https://collara.local/ledger-api",
  jsonApiUrl: P1,
  participantId: "sandbox::1220",
  participants: {
    sandbox: { jsonApiUrl: P1, participantId: "sandbox::1220", ledgerEndAtBootstrap: 0 },
    participant2: { jsonApiUrl: P2, participantId: "participant2::1220", ledgerEndAtBootstrap: 0 },
  },
  parties: {
    CollaraRegistrar: { party: REGISTRAR, participant: "sandbox", user: "registrar-svc" },
    DemoManufacturer: { party: BORROWER, participant: "participant2", user: "borrower-svc" },
  },
  users: [
    { id: "registrar-svc", participant: "sandbox", role: "org", primaryParty: REGISTRAR, actAs: [REGISTRAR], readAs: [REGISTRAR] },
    { id: "borrower-svc", participant: "participant2", role: "org", primaryParty: BORROWER, actAs: [BORROWER], readAs: [BORROWER] },
    // The same user id exists on every participant (one per node).
    { id: "projector-svc", participant: "sandbox", role: "projector", actAs: [], readAs: [REGISTRAR] },
    { id: "projector-svc", participant: "participant2", role: "projector", actAs: [], readAs: [BORROWER] },
  ],
  packages: [],
};

const COMMAND = create(templateId("collara-contracts", "Collara.Audit", "AuditGrant"), {});
const ROW = {} as CommandRow;

function transaction(updateId: string) {
  return { transaction: { updateId, commandId: "c", workflowId: "", effectiveAt: "2026-10-01T00:00:00Z", offset: 9, synchronizerId: "s", recordTime: "2026-10-01T00:00:00Z", events: [] } };
}

/** Fake JSON API: answers participant-id and submit per host; records every call as "<host> <path>". */
function fakeLedger(participantIds: Record<string, string>) {
  const calls: string[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    calls.push(`${url.origin} ${url.pathname}`);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (url.pathname === "/v2/parties/participant-id") return json({ participantId: participantIds[url.origin] });
    if (url.pathname === "/v2/commands/submit-and-wait-for-transaction") return json(transaction(`upd-${url.host}`));
    return new Response("not found", { status: 404 });
  };
  return { calls, fetch: fetchImpl as typeof fetch };
}

const submit = (gateway: CantonLedgerGateway, ledgerUserId: string, actAs: string, source?: string) =>
  gateway.submit(ROW, { commandId: "cmd-1", submissionId: "sub-1", ledgerUserId, actAs: [actAs], readAs: [], commands: [COMMAND], ...(source ? { source } : {}) });

describe("CantonLedgerGateway participant routing", () => {
  it("submits through the participant of the request's source and checks that participant for a reset", async () => {
    const ledger = fakeLedger({ [P1]: "sandbox::1220", [P2]: "participant2::1220" });
    const gateway = new CantonLedgerGateway(new LedgerAccess({ state: STATE, secret: "unit-test-secret-0123456789", fetch: ledger.fetch }));

    const borrower = await submit(gateway, "borrower-svc", BORROWER, "participant2");
    expect(borrower).toMatchObject({ kind: "committed", updateId: "upd-p2.invalid" });
    const registrar = await submit(gateway, "registrar-svc", REGISTRAR, "sandbox");
    expect(registrar).toMatchObject({ kind: "committed", updateId: "upd-p1.invalid" });
    expect(ledger.calls).toEqual([
      `${P2} /v2/parties/participant-id`,
      `${P2} /v2/commands/submit-and-wait-for-transaction`,
      `${P1} /v2/parties/participant-id`,
      `${P1} /v2/commands/submit-and-wait-for-transaction`,
    ]);
  });

  it("defaults to the ledger user's participant when the request names no source", async () => {
    const ledger = fakeLedger({ [P1]: "sandbox::1220", [P2]: "participant2::1220" });
    const gateway = new CantonLedgerGateway(new LedgerAccess({ state: STATE, secret: "unit-test-secret-0123456789", fetch: ledger.fetch }));
    expect(await submit(gateway, "borrower-svc", BORROWER)).toMatchObject({ kind: "committed", updateId: "upd-p2.invalid" });
    expect(ledger.calls.every((c) => c.startsWith(P2))).toBe(true);
  });

  it("uses the request's source for a user id that exists on several participants", async () => {
    const ledger = fakeLedger({ [P1]: "sandbox::1220", [P2]: "participant2::1220" });
    const gateway = new CantonLedgerGateway(new LedgerAccess({ state: STATE, secret: "unit-test-secret-0123456789", fetch: ledger.fetch }));
    await submit(gateway, "projector-svc", BORROWER, "participant2");
    expect(ledger.calls).toEqual([`${P2} /v2/parties/participant-id`, `${P2} /v2/commands/submit-and-wait-for-transaction`]);
  });

  it("fails with LEDGER_RESET when only the submitting participant was reset, and submits nothing there", async () => {
    const ledger = fakeLedger({ [P1]: "sandbox::1220", [P2]: "participant2::1220ffff" });
    const gateway = new CantonLedgerGateway(new LedgerAccess({ state: STATE, secret: "unit-test-secret-0123456789", fetch: ledger.fetch }));
    expect(await submit(gateway, "borrower-svc", BORROWER, "participant2")).toMatchObject({ kind: "failed", errorKind: "LEDGER_RESET" });
    expect(await submit(gateway, "registrar-svc", REGISTRAR, "sandbox")).toMatchObject({ kind: "committed" });
    expect(ledger.calls.filter((c) => c.endsWith("submit-and-wait-for-transaction"))).toEqual([`${P1} /v2/commands/submit-and-wait-for-transaction`]);
  });
});
