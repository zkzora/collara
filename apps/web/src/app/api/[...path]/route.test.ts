// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const context = (...path: string[]) => ({ params: Promise.resolve({ path }) });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("/api proxy", () => {
  it("forwards to API_INTERNAL_ORIGIN without browser credentials or hop-by-hop headers", async () => {
    vi.stubEnv("API_INTERNAL_ORIGIN", "http://127.0.0.1:4555");
    const upstreamHeaders = new Headers({ "content-type": "application/json", "content-encoding": "gzip" });
    upstreamHeaders.append("set-cookie", "a=1; Path=/");
    upstreamHeaders.append("set-cookie", "b=2; Path=/");
    const fetchMock = vi.fn(async (_input: URL | RequestInfo, _init?: RequestInit) =>
      new Response('{"ok":true}', { status: 201, headers: upstreamHeaders }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = new NextRequest("http://localhost:3000/api/cases/CL%20001?view=mine", {
      headers: { authorization: "Bearer x", cookie: "sid=1", connection: "keep-alive, x-drop", "x-drop": "1", expect: "100-continue" },
    });
    const response = await GET(request, context("cases", "CL 001"));

    const [target, init] = fetchMock.mock.calls[0]!;
    expect(String(target)).toBe("http://127.0.0.1:4555/api/cases/CL%20001?view=mine");
    const sent = new Headers(init?.headers);
    expect(sent.get("cookie")).toBe("sid=1");
    expect(sent.get("x-forwarded-host")).toBe("localhost:3000");
    for (const name of ["authorization", "connection", "x-drop", "expect", "host"]) expect(sent.has(name)).toBe(false);

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.has("content-encoding")).toBe(false);
    expect(response.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
  });

  it("does not forward anything in UI mockup mode (no API exists there)", async () => {
    vi.stubEnv("COLLARA_MODE", "UI_MOCK");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new NextRequest("http://localhost:3000/api/system/health"), context("system", "health"));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ error: "not_available_in_ui_mockup" });
  });

  it("streams request bodies and maps an unreachable API to 502", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);

    const request = new NextRequest("http://localhost:3000/api/pilot-requests", { method: "POST", body: "{}" });
    const response = await POST(request, context("pilot-requests"));

    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({ href: "http://127.0.0.1:4000/api/pilot-requests" }),
      expect.objectContaining({ method: "POST", duplex: "half" }),
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "upstream_unavailable" });
  });

  it("maps an upstream timeout to 504", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      }),
    );

    const response = await GET(new NextRequest("http://localhost:3000/api/system/health"), context("system", "health"));

    expect(response.status).toBe(504);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ error: "upstream_timeout" });
  });
});
