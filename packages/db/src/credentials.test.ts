// DEVNET refresh-token store (ledger_credentials, migrations 0004 + 0005) on PGlite: login upsert, rotation under the
// row lock, rejection erasing the dead token, serialised concurrent refreshes, a status view without the token, and
// the AES-256-GCM envelope (round trip, wrong key, row swap, key rotation, legacy plaintext rows, no key material in
// errors, rows or serialisations).
import { randomBytes } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgliteDatabase, MIGRATIONS_FOLDER, type DbHandle } from "./client";
import { CredentialCipher, CredentialCipherError } from "./credential-cipher";
import { PgRefreshTokenStore } from "./credentials";
import { ledgerCredentials } from "./schema";

const ID = "devnet:c2ede6f6-user";
const LOGIN = {
  id: ID,
  ledgerUserId: "c2ede6f6-user",
  issuer: "https://idp.example/realms/r",
  clientId: "public-client",
  refreshToken: "rt-login",
  accessTokenExpiresAt: new Date("2026-10-04T12:00:00Z"),
};

const K1 = { id: "k1", key: new Uint8Array(randomBytes(32)) };
const K2 = { id: "k2", key: new Uint8Array(randomBytes(32)) };
const b64 = (key: Uint8Array) => Buffer.from(key).toString("base64");
const cipher1 = new CredentialCipher({ current: K1, previous: [] });

async function rowOf(handle: DbHandle, id: string) {
  const [row] = await handle.db.select().from(ledgerCredentials).where(eq(ledgerCredentials.id, id));
  return row;
}

let handle: DbHandle;
let store: PgRefreshTokenStore;

beforeAll(async () => {
  handle = await createPgliteDatabase();
  store = new PgRefreshTokenStore(handle.db, { cipher: cipher1 });
});
afterAll(async () => {
  await handle.close();
});

describe("PgRefreshTokenStore", () => {
  it("stores a login encrypted and exposes only a non-secret status", async () => {
    await store.storeLogin(LOGIN);
    const status = await store.status(ID);
    expect(status).toMatchObject({ ledgerUserId: LOGIN.ledgerUserId, status: "ACTIVE", hasRefreshToken: true, keyId: "k1", rotationCount: 0 });
    expect(JSON.stringify(status)).not.toContain("rt-login");
    expect(await store.status("devnet:nobody")).toBeNull();
    // Neither the token nor the key is anywhere in the row.
    const row = JSON.stringify(await rowOf(handle, ID));
    expect(row).not.toContain("rt-login");
    expect(row).not.toContain(Buffer.from("rt-login").toString("base64"));
    expect(row).not.toContain(b64(K1.key));
    expect(await store.check(ID)).toMatchObject({ state: "OK", keyId: "k1", needsReencryption: false });
  });

  it("persists the rotated token returned by the callback (round trip through the envelope)", async () => {
    const before = await rowOf(handle, ID);
    const seen = await store.withCredential(ID, async (current) => ({
      update: { kind: "rotated", refreshToken: "rt-2", accessTokenExpiresAt: new Date("2026-10-04T15:00:00Z") },
      value: current?.refreshToken,
    }));
    expect(seen).toBe("rt-login");
    const row = await rowOf(handle, ID);
    expect(row).toMatchObject({ status: "ACTIVE", rotationCount: 1, refreshTokenKeyId: "k1" });
    // A fresh random nonce per write.
    expect(row?.refreshTokenNonce).not.toBe(before?.refreshTokenNonce);
    expect(await store.withCredential(ID, async (current) => ({ update: { kind: "unchanged" }, value: current?.refreshToken }))).toBe("rt-2");
  });

  it("serialises concurrent refreshes: each callback sees the token the previous one stored", async () => {
    const seen: (string | null)[] = [];
    await Promise.all(
      [3, 4, 5].map((n) =>
        store.withCredential(ID, async (current) => {
          seen.push(current?.refreshToken ?? null);
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { update: { kind: "rotated", refreshToken: `rt-${n}`, accessTokenExpiresAt: new Date() }, value: null };
        }),
      ),
    );
    expect(new Set(seen).size).toBe(3);
    expect(seen[0]).toBe("rt-2");
    expect((await store.status(ID))?.rotationCount).toBe(4);
  });

  it("a rejection erases the dead token and requires a new login; a login restores it", async () => {
    await store.withCredential(ID, async () => ({ update: { kind: "rejected", reason: "invalid_grant: Token is not active. Run node scripts/devnet/login.mjs again" }, value: null }));
    const status = await store.status(ID);
    expect(status).toMatchObject({ status: "REAUTH_REQUIRED", hasRefreshToken: false, keyId: null });
    expect(status?.lastError).toContain("login.mjs");
    expect((await store.check(ID)).state).toBe("REAUTH_REQUIRED");
    await store.storeLogin({ ...LOGIN, refreshToken: "rt-relogin" });
    expect(await store.status(ID)).toMatchObject({ status: "ACTIVE", hasRefreshToken: true, rotationCount: 0, lastError: null });
  });

  it("a callback that throws changes nothing", async () => {
    const before = await rowOf(handle, ID);
    await expect(store.withCredential(ID, async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await rowOf(handle, ID)).toEqual(before);
  });
});

describe("credential envelope", () => {
  it("a wrong key for the same key id fails with a clear error, leaks nothing and changes nothing", async () => {
    const wrong = new CredentialCipher({ current: { id: "k1", key: new Uint8Array(randomBytes(32)) }, previous: [] });
    const other = new PgRefreshTokenStore(handle.db, { cipher: wrong });
    const before = await rowOf(handle, ID);
    const error = await other.withCredential(ID, async () => ({ update: { kind: "rotated", refreshToken: "never", accessTokenExpiresAt: new Date() }, value: null })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CredentialCipherError);
    expect((error as CredentialCipherError).code).toBe("DECRYPT_FAILED");
    const text = `${(error as Error).message} ${inspect(error)}`;
    expect(text).toMatch(/does not decrypt with key id k1/);
    expect(text).toContain("login.mjs");
    expect(text).not.toContain(b64(K1.key));
    expect(text).not.toContain("rt-relogin");
    expect(await rowOf(handle, ID)).toEqual(before);
    expect(await other.check(ID)).toMatchObject({ state: "DECRYPT_FAILED", keyId: "k1" });
  });

  it("an unknown key id names both ids and suggests the fix", async () => {
    const unrelated = new PgRefreshTokenStore(handle.db, { cipher: new CredentialCipher({ current: K2, previous: [] }) });
    await expect(unrelated.withCredential(ID, async () => ({ update: { kind: "unchanged" }, value: null }))).rejects.toMatchObject({
      code: "KEY_UNKNOWN",
      message: expect.stringMatching(/key id k1, which is neither DEVNET_CREDENTIAL_KEY_ID \(k2\)/),
    });
  });

  it("rejects a ciphertext moved to another row (AAD binds credential id and ledger user id)", async () => {
    const victim = { ...LOGIN, id: "devnet:other-user", ledgerUserId: "other-user", refreshToken: "rt-victim" };
    await store.storeLogin(victim);
    const source = await rowOf(handle, ID);
    await handle.db
      .update(ledgerCredentials)
      .set({
        refreshTokenKeyId: source?.refreshTokenKeyId ?? null,
        refreshTokenNonce: source?.refreshTokenNonce ?? null,
        refreshTokenCiphertext: source?.refreshTokenCiphertext ?? null,
        refreshTokenTag: source?.refreshTokenTag ?? null,
      })
      .where(eq(ledgerCredentials.id, victim.id));
    await expect(store.withCredential(victim.id, async () => ({ update: { kind: "unchanged" }, value: null }))).rejects.toMatchObject({ code: "DECRYPT_FAILED" });
    // Changing only the ledger user of the original row breaks it too.
    await handle.db.update(ledgerCredentials).set({ ledgerUserId: "someone-else" }).where(eq(ledgerCredentials.id, ID));
    expect((await store.check(ID)).state).toBe("DECRYPT_FAILED");
    await handle.db.update(ledgerCredentials).set({ ledgerUserId: LOGIN.ledgerUserId }).where(eq(ledgerCredentials.id, ID));
    expect((await store.check(ID)).state).toBe("OK");
    await handle.db.delete(ledgerCredentials).where(eq(ledgerCredentials.id, victim.id));
  });

  it("rotation: decrypts with the previous key and re-encrypts with the current one on the next refresh", async () => {
    const rotated = new PgRefreshTokenStore(handle.db, { cipher: new CredentialCipher({ current: K2, previous: [K1] }) });
    expect(await rotated.check(ID)).toMatchObject({ state: "OK", keyId: "k1", needsReencryption: true });
    const seen = await rotated.withCredential(ID, async (current) => ({
      update: { kind: "rotated", refreshToken: "rt-after-rotation", accessTokenExpiresAt: new Date() },
      value: current?.refreshToken,
    }));
    expect(seen).toBe("rt-relogin");
    expect((await rowOf(handle, ID))?.refreshTokenKeyId).toBe("k2");
    expect(await rotated.check(ID)).toMatchObject({ state: "OK", keyId: "k2", needsReencryption: false });
    // The previous key can now be dropped; the old key alone no longer opens the row.
    const onlyNew = new PgRefreshTokenStore(handle.db, { cipher: new CredentialCipher({ current: K2, previous: [] }) });
    expect(await onlyNew.withCredential(ID, async (current) => ({ update: { kind: "unchanged" }, value: current?.refreshToken }))).toBe("rt-after-rotation");
    expect((await store.check(ID)).state).toBe("KEY_UNKNOWN");
  });

  it("without a key: reads and writes refuse (KEY_MISSING), status still works", async () => {
    const keyless = new PgRefreshTokenStore(handle.db);
    await expect(keyless.withCredential(ID, async () => ({ update: { kind: "unchanged" }, value: null }))).rejects.toMatchObject({ code: "KEY_MISSING" });
    await expect(keyless.storeLogin(LOGIN)).rejects.toMatchObject({ code: "KEY_MISSING" });
    expect((await keyless.status(ID))?.hasRefreshToken).toBe(true);
    expect((await keyless.check(ID)).state).toBe("KEY_MISSING");
  });

  it("the database refuses a partial envelope", async () => {
    await expect(handle.db.update(ledgerCredentials).set({ refreshTokenTag: null }).where(eq(ledgerCredentials.id, ID))).rejects.toThrow();
  });

  it("the cipher never serialises key material and uses a new nonce per seal", () => {
    const binding = { credentialId: "a", ledgerUserId: "b" };
    const one = cipher1.seal("same", binding);
    const two = cipher1.seal("same", binding);
    expect(one.nonce).not.toBe(two.nonce);
    expect(one.ciphertext).not.toBe(two.ciphertext);
    expect(cipher1.open(two, binding)).toBe("same");
    // Relabelling the key id (AAD) or flipping a ciphertext bit fails authentication.
    expect(() => cipher1.open({ ...one, tag: Buffer.alloc(16).toString("base64") }, binding)).toThrow(CredentialCipherError);
    const text = `${JSON.stringify(cipher1)} ${inspect(cipher1)} ${String(cipher1)}`;
    expect(text).toContain("k1");
    expect(text).not.toContain(b64(K1.key));
    expect(() => new CredentialCipher({ current: { id: "short", key: new Uint8Array(16) }, previous: [] })).toThrow(/not 32 bytes/);
  });
});

describe("migration 0005 and a legacy plaintext row", () => {
  let legacy: DbHandle;
  let folder: string;

  beforeAll(async () => {
    // A copy of the migrations cut after 0004 (plaintext refresh_token column).
    folder = await mkdtemp(join(tmpdir(), "collara-mig-"));
    await cp(MIGRATIONS_FOLDER, folder, { recursive: true });
    const journalPath = join(folder, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as { entries: { idx: number }[] };
    journal.entries = journal.entries.filter((e) => e.idx <= 4);
    await writeFile(journalPath, JSON.stringify(journal));
    legacy = await createPgliteDatabase({ migrate: false });
    await legacy.migrate({ migrationsFolder: folder });
  });
  afterAll(async () => {
    await legacy.close();
    await rm(folder, { recursive: true, force: true });
  });

  it("erases the plaintext token, marks the row REAUTH_REQUIRED and tells the operator to log in again", async () => {
    await legacy.db.execute(
      sql`insert into ledger_credentials (id, ledger_user_id, issuer, client_id, refresh_token) values (${ID}, ${LOGIN.ledgerUserId}, ${LOGIN.issuer}, ${LOGIN.clientId}, 'rt-plaintext-legacy')`,
    );
    await legacy.migrate();
    const columns = await legacy.db.execute<{ column_name: string }>(sql`select column_name from information_schema.columns where table_name = 'ledger_credentials'`);
    const names = (columns as unknown as { rows: { column_name: string }[] }).rows.map((r) => r.column_name);
    expect(names).not.toContain("refresh_token");
    expect(names).toEqual(expect.arrayContaining(["refresh_token_key_id", "refresh_token_nonce", "refresh_token_ciphertext", "refresh_token_tag"]));
    const legacyStore = new PgRefreshTokenStore(legacy.db, { cipher: cipher1 });
    const check = await legacyStore.check(ID);
    expect(check.state).toBe("REAUTH_REQUIRED");
    expect(check.detail).toContain("node scripts/devnet/login.mjs");
    expect(JSON.stringify(await rowOf(legacy, ID))).not.toContain("rt-plaintext-legacy");
    // The provider sees no token and a non-ACTIVE status (it reports "run login.mjs again"); a login fixes it.
    expect(await legacyStore.withCredential(ID, async (current) => ({ update: { kind: "unchanged" }, value: current }))).toMatchObject({ refreshToken: null, status: "REAUTH_REQUIRED" });
    await legacyStore.storeLogin(LOGIN);
    expect((await legacyStore.check(ID)).state).toBe("OK");
  });
});
