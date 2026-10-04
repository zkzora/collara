// DEVNET_CREDENTIAL_KEY parsing: exactly 32 bytes of canonical base64, a key id, optional previous keys, clear
// issues that never echo key material, and no key in any NEXT_PUBLIC_* variable.
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CredentialKeyConfigError, credentialKeyIssues, parseCredentialKeyring, publicEnvKeyLeaks } from "./credential-key";
import { devnetGuardIssues } from "./devnet-config";
import { CREDENTIAL_LOG_KEYS } from "./oidc";

const key = () => randomBytes(32).toString("base64");
const K = key();
const OLD = key();

describe("credential key settings", () => {
  it("parses the current key and previous keys", () => {
    const keyring = parseCredentialKeyring({ DEVNET_CREDENTIAL_KEY: K, DEVNET_CREDENTIAL_KEY_ID: "k2", DEVNET_CREDENTIAL_KEY_PREVIOUS: `k1:${OLD}` });
    expect(keyring.current.id).toBe("k2");
    expect(Buffer.from(keyring.current.key).toString("base64")).toBe(K);
    expect(keyring.previous.map((p) => p.id)).toEqual(["k1"]);
  });

  it.each([
    ["no key", { DEVNET_CREDENTIAL_KEY_ID: "k1" }, "DEVNET_CREDENTIAL_KEY", /gen-key\.mjs/],
    ["no key id", { DEVNET_CREDENTIAL_KEY: K }, "DEVNET_CREDENTIAL_KEY_ID", /gen-key\.mjs/],
    ["16 bytes", { DEVNET_CREDENTIAL_KEY: randomBytes(16).toString("base64"), DEVNET_CREDENTIAL_KEY_ID: "k1" }, "DEVNET_CREDENTIAL_KEY", /exactly 32 bytes/],
    ["33 bytes", { DEVNET_CREDENTIAL_KEY: randomBytes(33).toString("base64"), DEVNET_CREDENTIAL_KEY_ID: "k1" }, "DEVNET_CREDENTIAL_KEY", /exactly 32 bytes/],
    ["base64url", { DEVNET_CREDENTIAL_KEY: K.replace(/\+/g, "-").replace(/\//g, "_").replace(/=$/, ""), DEVNET_CREDENTIAL_KEY_ID: "k1" }, "DEVNET_CREDENTIAL_KEY", /standard base64/],
    ["hex", { DEVNET_CREDENTIAL_KEY: randomBytes(32).toString("hex"), DEVNET_CREDENTIAL_KEY_ID: "k1" }, "DEVNET_CREDENTIAL_KEY", /standard base64/],
    ["a bad key id", { DEVNET_CREDENTIAL_KEY: K, DEVNET_CREDENTIAL_KEY_ID: "k:1" }, "DEVNET_CREDENTIAL_KEY_ID", /1-64 characters/],
    ["a malformed previous key", { DEVNET_CREDENTIAL_KEY: K, DEVNET_CREDENTIAL_KEY_ID: "k2", DEVNET_CREDENTIAL_KEY_PREVIOUS: OLD }, "DEVNET_CREDENTIAL_KEY_PREVIOUS", /<key id>:<base64/],
    ["a previous id equal to the current id", { DEVNET_CREDENTIAL_KEY: K, DEVNET_CREDENTIAL_KEY_ID: "k1", DEVNET_CREDENTIAL_KEY_PREVIOUS: `k1:${OLD}` }, "DEVNET_CREDENTIAL_KEY_PREVIOUS", /more than once/],
    ["the current key again as previous", { DEVNET_CREDENTIAL_KEY: K, DEVNET_CREDENTIAL_KEY_ID: "k2", DEVNET_CREDENTIAL_KEY_PREVIOUS: `k1:${K}` }, "DEVNET_CREDENTIAL_KEY_PREVIOUS", /same key/],
  ] as const)("refuses %s, without echoing key material", (_label, env, path, message) => {
    const issues = credentialKeyIssues(env);
    expect(issues.map((i) => i.path)).toContain(path);
    expect(issues.map((i) => i.message).join("\n")).toMatch(message);
    const error = (() => {
      try {
        parseCredentialKeyring(env);
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(error).toBeInstanceOf(CredentialKeyConfigError);
    const text = `${(error as Error).message} ${JSON.stringify(issues)}`;
    for (const value of Object.values(env)) if (value.length >= 20) expect(text).not.toContain(value);
    expect(text).not.toContain(OLD);
  });

  it("is part of the DEVNET guards (API, worker, scripts and seed refuse to run without it)", () => {
    const db = { DATABASE_URL: "postgres://collara:x@127.0.0.1:5432/collara_devnet" };
    expect(devnetGuardIssues(db).map((i) => i.path)).toEqual(["DEVNET_CREDENTIAL_KEY", "DEVNET_CREDENTIAL_KEY_ID"]);
    expect(devnetGuardIssues({ ...db, DEVNET_CREDENTIAL_KEY: K, DEVNET_CREDENTIAL_KEY_ID: "k1" })).toEqual([]);
  });

  it("finds the key in NEXT_PUBLIC_* variables (by name or by value)", () => {
    expect(publicEnvKeyLeaks({ DEVNET_CREDENTIAL_KEY: K, NEXT_PUBLIC_COLLARA_MODE: "DEVNET" })).toEqual([]);
    expect(publicEnvKeyLeaks({ DEVNET_CREDENTIAL_KEY: K, NEXT_PUBLIC_DEVNET_CREDENTIAL_KEY: "x" })).toEqual(["NEXT_PUBLIC_DEVNET_CREDENTIAL_KEY"]);
    expect(publicEnvKeyLeaks({ DEVNET_CREDENTIAL_KEY: K, NEXT_PUBLIC_SOMETHING: `prefix-${K}` })).toEqual(["NEXT_PUBLIC_SOMETHING"]);
    expect(publicEnvKeyLeaks({ DEVNET_CREDENTIAL_KEY_PREVIOUS: `k1:${OLD}`, NEXT_PUBLIC_X: OLD })).toEqual(["NEXT_PUBLIC_X"]);
  });

  it("is redacted by the loggers", () => {
    expect(CREDENTIAL_LOG_KEYS).toEqual(expect.arrayContaining(["DEVNET_CREDENTIAL_KEY", "DEVNET_CREDENTIAL_KEY_PREVIOUS"]));
  });
});
