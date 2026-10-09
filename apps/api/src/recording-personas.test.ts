import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "./config";
import { hostnameOf, isLoopbackHostname, isLoopbackRequest, recordingPersonaIssues, type RecordingPersonaInput } from "./recording-personas";
import { seededDb, TEST_SECRET, testApp, type TestApp } from "./test-support";

const GOOD: RecordingPersonaInput = {
  DEVNET_RECORDING_PERSONAS: true,
  COLLARA_MODE: "DEVNET",
  NODE_ENV: "development",
  HOST: "127.0.0.1",
  PUBLIC_ORIGIN: "http://localhost:3000",
};

const DEVNET_ENV = {
  NODE_ENV: "development",
  COLLARA_MODE: "DEVNET",
  DATABASE_URL: "postgres://u:p@127.0.0.1:5432/collara_devnet",
  DEVNET_LEDGER_USER_ID: "9c376537-054a-4e15-b828-c9eb58c2c64d",
  DEVNET_CREDENTIAL_KEY: Buffer.alloc(32, 7).toString("base64"),
  DEVNET_CREDENTIAL_KEY_ID: "k1",
  SESSION_SECRET: TEST_SECRET,
  LOG_LEVEL: "silent",
};

describe("recordingPersonaIssues (start-time refusals)", () => {
  it("is silent when the flag is off, whatever else is configured", () => {
    expect(recordingPersonaIssues({ ...GOOD, DEVNET_RECORDING_PERSONAS: false, HOST: "0.0.0.0", NODE_ENV: "production" })).toEqual([]);
    expect(recordingPersonaIssues({ ...GOOD, DEVNET_RECORDING_PERSONAS: undefined, VERCEL: "1" })).toEqual([]);
  });

  it("accepts the local recording setup (IPv4 and IPv6 loopback)", () => {
    expect(recordingPersonaIssues(GOOD)).toEqual([]);
    expect(recordingPersonaIssues({ ...GOOD, HOST: "::1", PUBLIC_ORIGIN: "http://127.0.0.1:3000" })).toEqual([]);
  });

  it.each([
    ["not DevNet", { COLLARA_MODE: "LOCALNET" }],
    ["production", { NODE_ENV: "production" }],
    ["bound to all interfaces", { HOST: "0.0.0.0" }],
    ["bound to a LAN address", { HOST: "192.168.1.20" }],
    ["bound to the name localhost (not a literal)", { HOST: "localhost" }],
    ["a public origin", { PUBLIC_ORIGIN: "https://collara-devnet.vercel.app" }],
    ["a loopback-looking public origin", { PUBLIC_ORIGIN: "https://localhost.evil.example" }],
    ["a trusted proxy", { TRUST_PROXY: "127.0.0.1" }],
    ["the embedded (Vercel) API", { API_MODE: "embedded" }],
    ["running on Vercel", { VERCEL: "1" }],
  ])("refuses %s", (_name, override) => {
    expect(recordingPersonaIssues({ ...GOOD, ...override }).length).toBeGreaterThan(0);
  });

  it("is enforced by loadConfig (the server cannot start with an unsafe combination)", () => {
    expect(() => loadConfig({ ...DEVNET_ENV, DEVNET_RECORDING_PERSONAS: "true", HOST: "0.0.0.0" })).toThrow(/DEVNET_RECORDING_PERSONAS needs HOST=127\.0\.0\.1/);
    expect(() => loadConfig({ ...DEVNET_ENV, DEVNET_RECORDING_PERSONAS: "true", VERCEL: "1" })).toThrow(/refused on Vercel/);
    expect(() => loadConfig({ ...DEVNET_ENV, DEVNET_RECORDING_PERSONAS: "true", API_MODE: "embedded" })).toThrow(/API_MODE=embedded/);
    expect(loadConfig({ ...DEVNET_ENV, DEVNET_RECORDING_PERSONAS: "true" }).DEVNET_RECORDING_PERSONAS).toBe(true);
    expect(loadConfig(DEVNET_ENV).DEVNET_RECORDING_PERSONAS).toBe(false);
  });
});

describe("hostname helpers", () => {
  it("reads hosts, origins and bare IPv6 literals", () => {
    expect(hostnameOf("localhost:3000")).toBe("localhost");
    expect(hostnameOf("http://127.0.0.1:3000")).toBe("127.0.0.1");
    expect(hostnameOf("[::1]:3000")).toBe("::1");
    expect(hostnameOf("::1")).toBe("::1");
    expect(hostnameOf("")).toBeNull();
    expect(isLoopbackHostname("localhost.evil.example")).toBe(false);
    expect(isLoopbackHostname("127.0.0.1.nip.io")).toBe(false);
  });
});

function fakeRequest(remoteAddress: string | undefined, headers: Record<string, string | string[]>) {
  return { raw: { socket: { remoteAddress } }, headers } as unknown as Parameters<typeof isLoopbackRequest>[0];
}

describe("isLoopbackRequest (per request)", () => {
  const ok = { host: "localhost:3000" };

  it("accepts a browser on this machine, directly or through the Next proxy", () => {
    expect(isLoopbackRequest(fakeRequest("127.0.0.1", ok))).toBe(true);
    expect(isLoopbackRequest(fakeRequest("::ffff:127.0.0.1", { host: "127.0.0.1:4000", origin: "http://localhost:3000", "x-forwarded-host": "localhost:3000", "x-forwarded-for": "::1" }))).toBe(true);
  });

  it.each([
    ["a remote peer", fakeRequest("203.0.113.9", ok)],
    ["no socket address", fakeRequest(undefined, ok)],
    ["a public Host header", fakeRequest("127.0.0.1", { host: "collara-devnet.vercel.app" })],
    ["no Host header", fakeRequest("127.0.0.1", {})],
    ["a tunnel forwarding the public host", fakeRequest("127.0.0.1", { ...ok, "x-forwarded-host": "abc.trycloudflare.com" })],
    ["a tunnel forwarding the client address", fakeRequest("127.0.0.1", { ...ok, "x-forwarded-for": "198.51.100.7" })],
    ["a mixed forwarded-for chain", fakeRequest("127.0.0.1", { ...ok, "x-forwarded-for": "127.0.0.1, 198.51.100.7" })],
    ["cf-connecting-ip", fakeRequest("127.0.0.1", { ...ok, "cf-connecting-ip": "198.51.100.7" })],
    ["x-real-ip", fakeRequest("127.0.0.1", { ...ok, "x-real-ip": "198.51.100.7" })],
    ["a Forwarded header", fakeRequest("127.0.0.1", { ...ok, forwarded: 'for=198.51.100.7;proto=https;host=abc.example' })],
    ["a foreign Origin", fakeRequest("127.0.0.1", { ...ok, origin: "https://evil.example" })],
  ])("refuses %s", (_name, request) => {
    expect(isLoopbackRequest(request)).toBe(false);
  });
});

describe("DevNet demo personas over HTTP", () => {
  let disabled: TestApp;
  let recording: TestApp;

  beforeAll(async () => {
    disabled = await testApp({ config: loadConfig({ ...DEVNET_ENV, DEMO_SESSIONS_ENABLED: "true" }), db: await seededDb() });
    recording = await testApp({ config: loadConfig({ ...DEVNET_ENV, DEVNET_RECORDING_PERSONAS: "true" }), db: await seededDb() });
  });
  afterAll(async () => {
    await disabled.close();
    await recording.close();
    await disabled.db.close();
    await recording.db.close();
  });

  const start = (t: TestApp, remoteAddress: string, headers: Record<string, string> = {}) =>
    t.app.inject({ method: "POST", url: "/api/demo/sessions", remoteAddress, headers: { host: "localhost:4000", ...headers }, payload: { personaId: "lender-a-approver" } });

  it("stays unavailable by default, even with DEMO_SESSIONS_ENABLED=true (connecting an account mints no role)", async () => {
    expect((await start(disabled, "127.0.0.1")).statusCode).toBe(404);
    expect((await disabled.app.inject({ method: "GET", url: "/api/demo/personas", remoteAddress: "127.0.0.1", headers: { host: "localhost:4000" } })).statusCode).toBe(404);
  });

  it("opens a persona session for a loopback request when the recording opt-in is on", async () => {
    const response = await start(recording, "127.0.0.1", { origin: "http://localhost:3000" });
    expect(response.statusCode).toBe(200);
    expect(response.cookies.some((c) => /collara_sid$/.test(c.name))).toBe(true);
    const personas = await recording.app.inject({ method: "GET", url: "/api/demo/personas", remoteAddress: "::1", headers: { host: "localhost:4000" } });
    expect(personas.statusCode).toBe(200);
  });

  it("answers a tunnelled, proxied or remote request exactly like a disabled feature", async () => {
    expect((await start(recording, "203.0.113.9")).statusCode).toBe(404);
    expect((await start(recording, "127.0.0.1", { "x-forwarded-host": "abc.trycloudflare.com" })).statusCode).toBe(404);
    expect((await start(recording, "127.0.0.1", { "x-forwarded-for": "198.51.100.7" })).statusCode).toBe(404);
    expect((await start(recording, "127.0.0.1", { host: "collara-devnet.vercel.app" })).statusCode).toBe(404);
    const personas = await recording.app.inject({ method: "GET", url: "/api/demo/personas", remoteAddress: "203.0.113.9", headers: { host: "localhost:4000" } });
    expect(personas.statusCode).toBe(404);
  });
});
