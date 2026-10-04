// DEVNET refresh-token store (ledger_credentials, migration 0004) on PGlite: login upsert, rotation under the row
// lock, rejection erasing the dead token, serialised concurrent refreshes, and a status view without the token.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgliteDatabase, type DbHandle } from "./client";
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

let handle: DbHandle;
let store: PgRefreshTokenStore;

beforeAll(async () => {
  handle = await createPgliteDatabase();
  store = new PgRefreshTokenStore(handle.db);
});
afterAll(async () => {
  await handle.close();
});

describe("PgRefreshTokenStore", () => {
  it("stores a login and exposes only a non-secret status", async () => {
    await store.storeLogin(LOGIN);
    const status = await store.status(ID);
    expect(status).toMatchObject({ ledgerUserId: LOGIN.ledgerUserId, status: "ACTIVE", hasRefreshToken: true, rotationCount: 0 });
    expect(JSON.stringify(status)).not.toContain("rt-login");
    expect(await store.status("devnet:nobody")).toBeNull();
  });

  it("persists the rotated token returned by the callback", async () => {
    const seen = await store.withCredential(ID, async (current) => ({
      update: { kind: "rotated", refreshToken: "rt-2", accessTokenExpiresAt: new Date("2026-10-04T15:00:00Z") },
      value: current?.refreshToken,
    }));
    expect(seen).toBe("rt-login");
    const [row] = await handle.db.select().from(ledgerCredentials).where(eq(ledgerCredentials.id, ID));
    expect(row).toMatchObject({ refreshToken: "rt-2", status: "ACTIVE", rotationCount: 1 });
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
    expect(status).toMatchObject({ status: "REAUTH_REQUIRED", hasRefreshToken: false });
    expect(status?.lastError).toContain("login.mjs");
    await store.storeLogin({ ...LOGIN, refreshToken: "rt-relogin" });
    expect(await store.status(ID)).toMatchObject({ status: "ACTIVE", hasRefreshToken: true, rotationCount: 0, lastError: null });
  });

  it("a callback that throws changes nothing", async () => {
    await expect(store.withCredential(ID, async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    const [row] = await handle.db.select({ refreshToken: ledgerCredentials.refreshToken }).from(ledgerCredentials).where(eq(ledgerCredentials.id, ID));
    expect(row?.refreshToken).toBe("rt-relogin");
  });
});
