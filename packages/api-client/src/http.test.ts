import { describe, expect, it } from "vitest";
import { buildScenario, personaActor, presentCaseDetail } from "@collara/domain";
import { API_ENDPOINTS, endpointPath } from "./client";
import { ApiError, errorMessage } from "./errors";
import { createHttpClient } from "./http";
import { createQueryKeys, sessionScope } from "./query-keys";

interface Captured {
  url: string;
  init: RequestInit;
}

function fakeFetch(responder: (url: string, init: RequestInit) => Response) {
  const calls: Captured[] = [];
  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    return responder(url, init);
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}

const json = (status: number, body: unknown, type = "application/json") =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": type } });

const command = {
  commandId: "cmd-1",
  operation: "review.decide",
  target: "LEDGER",
  state: "COMMITTED",
  simulated: false,
  updateId: "1220abcd",
  completionOffset: 42,
  message: "Confirmed on the ledger.",
  submittedAt: "2026-11-15T12:00:00.000Z",
  updatedAt: "2026-11-15T12:00:01.000Z",
};

describe("createHttpClient", () => {
  it("sends mutations with an Idempotency-Key and parses the command status", async () => {
    const { calls, fetch } = fakeFetch(() => json(200, { command }));
    const client = createHttpClient({ fetch, createIdempotencyKey: () => "generated-key-0001" });
    const res = await client.reviews.decide("CA-001", { outcome: "ELIGIBLE" });
    expect(res.command.updateId).toBe("1220abcd");
    expect(calls[0]?.url).toBe("/api/reviews/CA-001/decision");
    expect(calls[0]?.init.method).toBe("POST");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("generated-key-0001");
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ outcome: "ELIGIBLE" });

    await client.reviews.decide("CA-001", { outcome: "ELIGIBLE" }, { idempotencyKey: "retry-same-key-1" });
    expect((calls[1]?.init.headers as Record<string, string>)["idempotency-key"]).toBe("retry-same-key-1");
  });

  it("generates a UUID key by default and never sends one on reads", async () => {
    const { calls, fetch } = fakeFetch((url) => (url.includes("/commands/") ? json(200, command) : json(200, { command })));
    const client = createHttpClient({ fetch });
    await client.proposals.accept("FP-001", { expectedVersion: 2 });
    expect((calls[0]?.init.headers as Record<string, string>)["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    await client.commands.get("cmd-1");
    expect((calls[1]?.init.headers as Record<string, string>)["idempotency-key"]).toBeUndefined();
  });

  it("encodes path params and query strings against the base URL", async () => {
    const world = buildScenario({ now: new Date("2026-11-15T12:00:00Z") });
    const detail = presentCaseDetail(world.cases[0]!, personaActor("lender-a-analyst"), {
      now: new Date("2026-11-15T12:00:00Z"),
      mode: "LOCALNET",
      sync: { offset: 18422, at: "2026-11-15T12:00:00.000Z" },
    });
    const { calls, fetch } = fakeFetch((url) =>
      url.includes("/audit/events") ? json(200, { items: [], nextCursor: null }) : json(200, detail),
    );
    const client = createHttpClient({ fetch, baseUrl: "http://127.0.0.1:4000/api/" });
    const parsed = await client.cases.get("CL-001");
    expect(parsed.lastSync.offset).toBe(18422);
    await client.audit.events({ caseId: "CL-001", kind: "COMMITTED", cursor: undefined, limit: 20 });
    expect(calls[0]?.url).toBe("http://127.0.0.1:4000/api/cases/CL-001");
    expect(calls[1]?.url).toBe("http://127.0.0.1:4000/api/audit/events?caseId=CL-001&kind=COMMITTED&limit=20");
    expect(endpointPath("evidence.download", "DOC 1/2")).toBe("/evidence/DOC%201%2F2/download");
  });

  it("maps problem+json to ApiError without revealing existence", async () => {
    const { fetch } = fakeFetch(() =>
      json(
        404,
        { type: "urn:collara:problem:unavailable", title: "Unavailable", status: 404, code: "unavailable", detail: "This record is unavailable to your account." },
        "application/problem+json",
      ),
    );
    const client = createHttpClient({ fetch });
    const error = await client.cases.get("CL-001").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: "unavailable" });
    expect(errorMessage(error)).toBe("This record is unavailable to your account.");
  });

  it("normalises the API validation shape and the proxy's upstream errors", async () => {
    const validation = createHttpClient({
      fetch: fakeFetch(() => json(400, { error: "validation_error", issues: [{ path: "principal.amount", message: "Invalid" }] })).fetch,
    });
    const v = await validation.cases.createProposal("CL-001", { intent: "ISSUE", principal: { amount: "1.00", currency: "USD" } }).catch((e: unknown) => e);
    expect(v).toMatchObject({ code: "validation_error", problem: { issues: [{ path: "principal.amount", message: "Invalid" }] } });

    const proxy = createHttpClient({ fetch: fakeFetch(() => json(502, { error: "upstream_unavailable" })).fetch });
    await expect(proxy.me()).rejects.toMatchObject({ status: 502, code: "upstream_unavailable" });

    const ledger = createHttpClient({ fetch: fakeFetch(() => json(503, { error: "ledger_unavailable" })).fetch });
    const l = await ledger.cases.activatePledge("CL-001").catch((e: unknown) => e);
    expect(errorMessage(l)).toBe("The ledger is unavailable. No confirmed state change has been recorded.");
  });

  it("reports network failures and unexpected shapes", async () => {
    const offline = createHttpClient({
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof globalThis.fetch,
    });
    await expect(offline.me()).rejects.toMatchObject({ status: 0, code: "network_error" });

    const wrong = createHttpClient({ fetch: fakeFetch(() => json(200, { hello: "world" })).fetch });
    await expect(wrong.me()).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("uploads raw bytes with the file's content type", async () => {
    const { calls, fetch } = fakeFetch(() => json(500, { error: "internal_error" }));
    const client = createHttpClient({ fetch });
    const file = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: "application/pdf" });
    await client.evidence.uploadContent("DOC-006", file).catch(() => undefined);
    expect(calls[0]?.url).toBe("/api/evidence/DOC-006/content");
    expect(calls[0]?.init.method).toBe("PUT");
    expect((calls[0]?.init.headers as Record<string, string>)["content-type"]).toBe("application/pdf");
    expect(calls[0]?.init.body).toBe(file);
  });

  it("keeps every endpoint under the API base with a known method", () => {
    for (const [name, endpoint] of Object.entries(API_ENDPOINTS)) {
      expect(endpoint.path.startsWith("/"), name).toBe(true);
      expect(["GET", "POST", "PUT"]).toContain(endpoint.method);
    }
  });
});

describe("query keys", () => {
  it("prefix every key with the session scope", () => {
    expect(sessionScope({ userId: "user-1", orgId: "demo-lender-a" })).toBe("user-1:demo-lender-a");
    expect(sessionScope({ personaId: "lender-b-approver" })).toBe("mock:lender-b-approver");
    const keys = createQueryKeys("mock:lender-a-approver");
    expect(keys.cases.detail("CL-001")).toEqual(["mock:lender-a-approver", "cases", "detail", "CL-001"]);
    expect(keys.cases.list({ view: "mine", cursor: undefined })).toEqual(["mock:lender-a-approver", "cases", "list", { view: "mine" }]);
    expect(createQueryKeys("mock:auditor").cases.detail("CL-001")).not.toEqual(keys.cases.detail("CL-001"));
  });
});
