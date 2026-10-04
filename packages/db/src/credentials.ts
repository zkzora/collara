// PostgreSQL store for DEVNET's rotating OIDC refresh token (table ledger_credentials). It implements the
// RefreshTokenStore interface of @collara/canton structurally (this package does not depend on it): every refresh
// runs inside one transaction holding SELECT … FOR UPDATE on the credential row, and the rotated token is written
// before COMMIT, so the API and the worker never send the same refresh token twice. Nothing here logs or returns a
// token except `withCredential`'s callback argument.
import { eq, sql } from "drizzle-orm";
import type { Db } from "./client";
import { ledgerCredentials } from "./schema";

export type StoredCredentialStatus = "ACTIVE" | "REAUTH_REQUIRED";

/** Mirrors @collara/canton StoredLedgerCredential. */
export interface StoredCredential {
  readonly refreshToken: string | null;
  readonly status: StoredCredentialStatus;
  readonly ledgerUserId: string;
}

/** Mirrors @collara/canton LedgerCredentialUpdate. */
export type CredentialUpdate =
  | { readonly kind: "unchanged" }
  | { readonly kind: "rotated"; readonly refreshToken: string; readonly accessTokenExpiresAt: Date }
  | { readonly kind: "rejected"; readonly reason: string };

/** Non-secret view of a credential (status pages, preflight). */
export interface CredentialStatus {
  readonly id: string;
  readonly ledgerUserId: string;
  readonly issuer: string;
  readonly clientId: string;
  readonly status: StoredCredentialStatus;
  readonly hasRefreshToken: boolean;
  readonly accessTokenExpiresAt: Date | null;
  readonly rotatedAt: Date | null;
  readonly rotationCount: number;
  readonly lastError: string | null;
  readonly updatedAt: Date;
}

export class PgRefreshTokenStore {
  readonly #db: Db;
  readonly #now: () => Date;

  constructor(db: Db, now: () => Date = () => new Date()) {
    this.#db = db;
    this.#now = now;
  }

  /** Runs `fn` while holding the row lock; applies its update in the same transaction. */
  withCredential<T>(
    credentialId: string,
    fn: (current: StoredCredential | null) => Promise<{ readonly update: CredentialUpdate; readonly value: T }>,
  ): Promise<T> {
    return this.#db.transaction(async (tx) => {
      const [row] = await tx
        .select({ refreshToken: ledgerCredentials.refreshToken, status: ledgerCredentials.status, ledgerUserId: ledgerCredentials.ledgerUserId })
        .from(ledgerCredentials)
        .where(eq(ledgerCredentials.id, credentialId))
        .for("update");
      const current: StoredCredential | null = row
        ? { refreshToken: row.refreshToken, status: row.status === "ACTIVE" ? "ACTIVE" : "REAUTH_REQUIRED", ledgerUserId: row.ledgerUserId }
        : null;
      const { update, value } = await fn(current);
      if (row) {
        const now = this.#now();
        if (update.kind === "rotated") {
          await tx
            .update(ledgerCredentials)
            .set({
              refreshToken: update.refreshToken,
              status: "ACTIVE",
              accessTokenExpiresAt: update.accessTokenExpiresAt,
              rotatedAt: now,
              rotationCount: sql`${ledgerCredentials.rotationCount} + 1`,
              lastError: null,
              updatedAt: now,
            })
            .where(eq(ledgerCredentials.id, credentialId));
        } else if (update.kind === "rejected") {
          await tx
            .update(ledgerCredentials)
            .set({ status: "REAUTH_REQUIRED", refreshToken: null, lastError: update.reason.slice(0, 500), updatedAt: now })
            .where(eq(ledgerCredentials.id, credentialId));
        }
      }
      return value;
    });
  }

  /**
   * Stores the refresh token from a fresh login (scripts/devnet/login.mjs), replacing any previous one under the
   * same row lock a refresh would take.
   */
  async storeLogin(input: {
    readonly id: string;
    readonly ledgerUserId: string;
    readonly issuer: string;
    readonly clientId: string;
    readonly refreshToken: string;
    readonly accessTokenExpiresAt: Date;
  }): Promise<void> {
    const now = this.#now();
    await this.#db.transaction(async (tx) => {
      await tx.select({ id: ledgerCredentials.id }).from(ledgerCredentials).where(eq(ledgerCredentials.id, input.id)).for("update");
      await tx
        .insert(ledgerCredentials)
        .values({ ...input, status: "ACTIVE", rotatedAt: now, rotationCount: 0, lastError: null, updatedAt: now })
        .onConflictDoUpdate({
          target: ledgerCredentials.id,
          set: {
            ledgerUserId: input.ledgerUserId,
            issuer: input.issuer,
            clientId: input.clientId,
            refreshToken: input.refreshToken,
            accessTokenExpiresAt: input.accessTokenExpiresAt,
            status: "ACTIVE",
            rotatedAt: now,
            rotationCount: 0,
            lastError: null,
            updatedAt: now,
          },
        });
    });
  }

  /** Non-secret status of a credential, or null when none is stored. */
  async status(credentialId: string): Promise<CredentialStatus | null> {
    const [row] = await this.#db.select().from(ledgerCredentials).where(eq(ledgerCredentials.id, credentialId)).limit(1);
    if (!row) return null;
    return {
      id: row.id,
      ledgerUserId: row.ledgerUserId,
      issuer: row.issuer,
      clientId: row.clientId,
      status: row.status === "ACTIVE" ? "ACTIVE" : "REAUTH_REQUIRED",
      hasRefreshToken: !!row.refreshToken,
      accessTokenExpiresAt: row.accessTokenExpiresAt,
      rotatedAt: row.rotatedAt,
      rotationCount: row.rotationCount,
      lastError: row.lastError,
      updatedAt: row.updatedAt,
    };
  }
}
