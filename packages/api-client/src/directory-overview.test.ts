import { describe, expect, it } from "vitest";
import { createHttpClient } from "./http";
import { createQueryKeys } from "./query-keys";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("directory and overview over HTTP", () => {
  it("reads the onboarded directory and the overview figures (GET, no idempotency key)", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const overview = {
      principal: {
        label: "Recorded financing principal",
        totals: [{ total: { amount: "100000.00", currency: "USD" }, count: 1 }],
        coverage: { included: 1, of: 1 },
        source: "Accepted financing agreements behind active pledges",
        dates: { earliest: "2026-10-01", latest: "2026-10-01" },
      },
      valuation: null,
      lastSync: { offset: 42, at: "2026-10-02T08:00:00.000Z" },
    };
    const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, init });
      return url.endsWith("/overview") ? json(overview) : json([{ id: "demo-lender-a", name: "Demo Lender A" }]);
    }) as typeof globalThis.fetch;
    const client = createHttpClient({ fetch });

    expect(await client.directory.lenders()).toEqual([{ id: "demo-lender-a", name: "Demo Lender A" }]);
    await client.directory.dealers();
    expect(await client.overview.get()).toEqual(overview);
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ["GET", "/api/directory/lenders"],
      ["GET", "/api/directory/dealers"],
      ["GET", "/api/overview"],
    ]);
    for (const call of calls) expect((call.init.headers as Record<string, string>)["idempotency-key"]).toBeUndefined();
  });

  it("rejects an overview that sums or formats money as numbers", async () => {
    const bad = { principal: { label: "x", totals: [{ total: { amount: 100000, currency: "USD" }, count: 1 }], coverage: { included: 1, of: 1 }, source: "x", dates: null }, valuation: null, lastSync: { offset: null, at: null } };
    const client = createHttpClient({ fetch: (async () => json(bad)) as typeof globalThis.fetch });
    await expect(client.overview.get()).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("scopes the new query keys by session", () => {
    const keys = createQueryKeys("mock:manufacturer-owner");
    expect(keys.directory("lenders")).toEqual(["mock:manufacturer-owner", "directory", "lenders"]);
    expect(keys.overview()).toEqual(["mock:manufacturer-owner", "overview"]);
  });
});
