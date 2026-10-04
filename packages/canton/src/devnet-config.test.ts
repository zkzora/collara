import { describe, expect, it } from "vitest";
import { DEVNET_DEFAULTS, DevnetEnvSchema, devnetGuardIssues, devnetOidcSettings } from "./devnet-config";
import { isLocalnetStatePath } from "./localnet-state";

const OK = { DATABASE_URL: "postgres://collara:x@127.0.0.1:5432/collara_devnet" };

describe("DEVNET guards", () => {
  it("accepts a dedicated devnet database and no LocalNet settings", () => {
    expect(devnetGuardIssues(OK)).toEqual([]);
  });

  it.each([
    ["the LocalNet demo database", { DATABASE_URL: "postgres://collara:x@127.0.0.1:5432/collara" }, "DATABASE_URL"],
    ["the test database", { DATABASE_URL: "postgres://collara:x@127.0.0.1:5432/collara_test" }, "DATABASE_URL"],
    ["a database without devnet in its name", { DATABASE_URL: "postgres://collara:x@127.0.0.1:5432/collara_core" }, "DATABASE_URL"],
    ["no database", {}, "DATABASE_URL"],
    ["a LocalNet state file", { ...OK, COLLARA_LOCALNET_STATE: ".local/localnet/state.json" }, "COLLARA_LOCALNET_STATE"],
    ["a DevNet state path that is a LocalNet state", { ...OK, COLLARA_DEVNET_STATE: "C:\\Collara\\.local\\localnet\\state-core.json" }, "COLLARA_DEVNET_STATE"],
    ["an HMAC secret", { ...OK, CANTON_JWT_HMAC_SECRET: "collara-local-dev-secret-change-me" }, "CANTON_JWT_HMAC_SECRET"],
  ] as const)("refuses %s", (_label, env, path) => {
    expect(devnetGuardIssues(env).map((i) => i.path)).toContain(path);
  });

  it("recognises LocalNet state paths in both separators", () => {
    expect(isLocalnetStatePath("/repo/.local/localnet/state.json")).toBe(true);
    expect(isLocalnetStatePath("C:\\repo\\.local\\localnet\\state-e2e.json")).toBe(true);
    expect(isLocalnetStatePath("C:\\repo\\.local\\devnet\\state.json")).toBe(false);
  });
});

describe("DEVNET settings", () => {
  it("defaults to the HackCanton tenant and requires https", () => {
    const env = DevnetEnvSchema.parse({ DEVNET_LEDGER_USER_ID: "c2ede6f6-team" });
    expect(env.CANTON_DEVNET_JSON_API_URL).toBe(DEVNET_DEFAULTS.jsonApiUrl);
    const settings = devnetOidcSettings({ ...env, DEVNET_LEDGER_USER_ID: "c2ede6f6-team" });
    expect(settings).toMatchObject({ clientId: DEVNET_DEFAULTS.clientId, audience: DEVNET_DEFAULTS.audience, scope: "openid daml_ledger_api offline_access" });
    expect(DevnetEnvSchema.safeParse({ CANTON_DEVNET_JSON_API_URL: "http://example.com" }).success).toBe(false);
  });
});
