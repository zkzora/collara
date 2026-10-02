import { createServer } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { fixture } from "./__fixtures__";
import { HmacTokenProvider, StaticTokenProvider } from "./auth";
import { LedgerClient } from "./client";
import { create, templateId } from "./commands";
import { LedgerError } from "./errors";

const BASE = "http://ledger.test:7575";
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fakeFetch(handler: (request: Request) => Response | Promise<Response>) {
  const calls: Request[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    calls.push(request.clone());
    return handler(request);
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const T = templateId("collara-canton-it", "It", "Notice");
const submit = { commandId: "cmd-1", actAs: ["P::1220ab"], commands: [create(T, {})] };

describe("LedgerClient", () => {
  it("sends the bearer token and a fresh submissionId, and normalizes the transaction", async () => {
    const tokens = new StaticTokenProvider("secret-token-value");
    const { fetch, calls } = fakeFetch(() => json(200, fixture("submit-and-wait-for-transaction")));
    const client = new LedgerClient({ baseUrl: `${BASE}/`, tokenProvider: tokens, fetch });

    const tx = await client.submitAndWaitForTransaction(submit);

    expect(tx.events[0]?.kind).toBe("created");
    const request = calls[0]!;
    expect(request.url).toBe(`${BASE}/v2/commands/submit-and-wait-for-transaction`);
    expect(request.headers.get("authorization")).toBe("Bearer secret-token-value");
    const body = (await request.json()) as { commands: { submissionId: string; commandId: string } };
    expect(body.commands.commandId).toBe("cmd-1");
    expect(body.commands.submissionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("throws a classified LedgerError that does not contain the token", async () => {
    const { fetch } = fakeFetch(() => json(404, (fixture("errors/contract-not-found") as { body: unknown }).body));
    const client = new LedgerClient({ baseUrl: BASE, tokenProvider: new StaticTokenProvider("secret-token-value"), fetch });

    const error = await client.submitAndWait(submit).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LedgerError);
    expect((error as LedgerError).info).toMatchObject({ kind: "CONTRACT_NOT_FOUND", commandState: "REJECTED" });
    expect(JSON.stringify((error as LedgerError).info)).not.toContain("secret-token-value");
    expect(String((error as LedgerError).message)).not.toContain("secret-token-value");
  });

  it("retries once with a fresh token after a 401", async () => {
    const tokens = new HmacTokenProvider("borrower-svc", { secret: "unit-test-secret-not-for-use", audience: "aud" });
    const invalidate = vi.spyOn(tokens, "invalidate");
    let n = 0;
    const { fetch, calls } = fakeFetch(() => (n++ === 0 ? json(401, { code: "NA", cause: "x", grpcCodeValue: 16 }) : json(200, { offset: 12 })));
    const client = new LedgerClient({ baseUrl: BASE, tokenProvider: tokens, fetch });

    expect(await client.ledgerEnd()).toBe(12);
    expect(calls).toHaveLength(2);
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it("gives up after the retry when the token is still rejected", async () => {
    const tokens = new HmacTokenProvider("borrower-svc", { secret: "unit-test-secret-not-for-use", audience: "aud" });
    const { fetch, calls } = fakeFetch(() => json(401, (fixture("errors/unauthenticated-no-token") as { body: unknown }).body));
    const client = new LedgerClient({ baseUrl: BASE, tokenProvider: tokens, fetch });

    await expect(client.ledgerEnd()).rejects.toMatchObject({ info: { kind: "UNAUTHENTICATED", commandState: "FAILED" } });
    expect(calls).toHaveLength(2);
  });

  it("classifies a request timeout as UNKNOWN_OUTCOME", async () => {
    const fetch = ((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal ?? (_input instanceof Request ? _input.signal : undefined);
        signal?.addEventListener("abort", () => reject(signal.reason));
      })) as typeof globalThis.fetch;
    const client = new LedgerClient({ baseUrl: BASE, fetch, submitTimeoutMs: 20 });

    await expect(client.submitAndWait(submit)).rejects.toMatchObject({
      info: { kind: "TIMEOUT", commandState: "UNKNOWN_OUTCOME", definite: false, retryable: true },
    });
  });

  it("classifies an unreachable ledger as FAILED (nothing was recorded)", async () => {
    const port = await new Promise<number>((resolve) => {
      const server = createServer().listen(0, "127.0.0.1", () => {
        const address = server.address();
        server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
      });
    });
    const client = new LedgerClient({ baseUrl: `http://127.0.0.1:${port}` });
    await expect(client.ledgerEnd()).rejects.toMatchObject({
      info: { kind: "UNAVAILABLE", commandState: "FAILED", definite: true },
    });
    expect((await client.readyz()).ready).toBe(false);
  });

  it("pages through active contracts at the ledger end", async () => {
    const page = fixture("active-contracts-page") as { activeContracts: unknown[]; activeAtOffset: number };
    const bodies: unknown[] = [];
    const { fetch } = fakeFetch(async (request) => {
      if (request.url.endsWith("/v2/state/ledger-end")) return json(200, { offset: 70 });
      const body = (await request.json()) as { pageToken?: string };
      bodies.push(body);
      return json(200, body.pageToken ? { ...page, activeAtOffset: 70 } : { ...page, activeAtOffset: 70, nextPageToken: "p2" });
    });
    const client = new LedgerClient({ baseUrl: BASE, fetch });

    const result = await client.activeContracts({ parties: ["P::1220ab"], templateIds: [T] });

    expect(result.activeAtOffset).toBe(70);
    expect(result.contracts).toHaveLength(2);
    expect(bodies[0]).toMatchObject({
      activeAtOffset: 70,
      eventFormat: { filtersByParty: { "P::1220ab": { cumulative: [{ identifierFilter: { TemplateFilter: { value: { templateId: T } } } }] } } },
    });
    expect(bodies[1]).toMatchObject({ pageToken: "p2" });
  });

  it("polls updates up to the ledger end and reports where to continue", async () => {
    const recorded = fixture("updates-ledger-effects-observer") as unknown[];
    const { fetch, calls } = fakeFetch((request) =>
      request.url.endsWith("/v2/state/ledger-end") ? json(200, { offset: 80 }) : json(200, recorded),
    );
    const client = new LedgerClient({ baseUrl: BASE, fetch });

    const full = await client.updates({ beginExclusive: 60, parties: ["P::1220ab"], shape: "LEDGER_EFFECTS" });
    expect(full).toMatchObject({ endInclusive: 80, nextBeginExclusive: 80, complete: true });
    expect(full.updates).toHaveLength(2);
    const query = new URL(calls[1]!.url).searchParams;
    expect(query.get("limit")).toBe("200");
    expect(((await calls[1]!.json()) as { updateFormat: unknown }).updateFormat).toMatchObject({
      includeTransactions: { transactionShape: "TRANSACTION_SHAPE_LEDGER_EFFECTS" },
    });

    const partial = await client.updates({ beginExclusive: 60, endInclusive: 80, parties: ["P::1220ab"], limit: 2 });
    expect(partial.complete).toBe(false);
    expect(partial.nextBeginExclusive).toBe(67);

    expect(await client.updates({ beginExclusive: 80, endInclusive: 80, parties: ["P::1220ab"] })).toMatchObject({
      updates: [],
      complete: true,
    });
  });

  it("parses command completions", async () => {
    const { fetch } = fakeFetch(() => json(200, fixture("command-completions")));
    const client = new LedgerClient({ baseUrl: BASE, fetch });

    const { completions } = await client.commandCompletions({ parties: ["P::1220ab"], beginExclusive: 0 });

    expect(completions.map((c) => c.commandId)).toEqual(["fx-create", "fx-withdraw"]);
    expect(completions[0]).toMatchObject({ submissionId: "fx-sub-1", status: { code: 0 } });
    expect(completions[0]?.updateId).toMatch(/^1220/);
  });

  it("returns null for a missing user", async () => {
    const { fetch } = fakeFetch(() => json(404, (fixture("errors/user-not-found") as { body: unknown }).body));
    expect(await new LedgerClient({ baseUrl: BASE, fetch }).getUser("nobody")).toBeNull();
  });
});
