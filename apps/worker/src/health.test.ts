import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHealthServer } from "./health";

describe("worker health server", () => {
  const server = createHealthServer({ mode: "UI_MOCK", version: "0.0.0" });
  let base = "";

  beforeAll(async () => {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  it("answers GET /healthz", async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "ok", service: "worker", mode: "UI_MOCK", version: "0.0.0" });
  });

  it("returns 404 for anything else", async () => {
    expect((await fetch(`${base}/`)).status).toBe(404);
    expect((await fetch(`${base}/healthz`, { method: "POST" })).status).toBe(404);
  });
});

describe("worker health server (LOCALNET details)", () => {
  let details: () => Promise<{ degraded: boolean; [key: string]: unknown }> = async () => ({ degraded: false });
  const server = createHealthServer({ mode: "LOCALNET", version: "0.0.0", details: () => details() });
  let base = "";

  beforeAll(async () => {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  it("merges per-source projection state and reports degraded sources", async () => {
    details = async () => ({ degraded: false, sources: [{ source: "sandbox", status: "ACTIVE", checkpoint: 12, ledgerEnd: 12, lag: 0 }] });
    expect(await (await fetch(`${base}/healthz`)).json()).toEqual({
      status: "ok",
      service: "worker",
      mode: "LOCALNET",
      version: "0.0.0",
      sources: [{ source: "sandbox", status: "ACTIVE", checkpoint: 12, ledgerEnd: 12, lag: 0 }],
    });
    details = async () => ({ degraded: true, sources: [{ source: "sandbox", status: "RESET_DETECTED" }] });
    expect(await (await fetch(`${base}/healthz`)).json()).toMatchObject({ status: "degraded", sources: [{ status: "RESET_DETECTED" }] });
    details = async () => {
      throw new Error("database unavailable");
    };
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "degraded", error: "database unavailable" });
  });
});
