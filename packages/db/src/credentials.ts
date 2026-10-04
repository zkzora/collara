// PostgreSQL store for DEVNET's rotating OIDC refresh token (table ledger_credentials). It implements the
// RefreshTokenStore interface of @collara/canton structurally (this package does not depend on it): every refresh
// runs inside one transaction holding SELECT … FOR UPDATE on the credential row, and the rotated token is written
// before COMMIT, so the API and the worker never send the same refresh token twice. The token is stored only
// AES-256-GCM encrypted (credential-cipher.ts, migration 0005) under the key in DEVNET_CREDENTIAL_KEY, bound to its
// row; every write uses the current key, so a refresh re-encrypts a row written with a previous key. Nothing here
// logs or returns a token except `withCredential`'s callback argument.
import { eq, sql } from "drizzle-orm";
import type { Db } from "./client";
import { CredentialCipherError, type CredentialCipher, type CredentialCipherErrorCode, type SealedSecret } from "./credential-cipher";
import { ledgerCredentials, type LedgerCredentialRow } from "./schema";

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
  /** Key id of the stored ciphertext (null when none is stored). */
  readonly keyId: string | null;
  readonly accessTokenExpiresAt: Date | null;
  readonly rotatedAt: Date | null;
  readonly rotationCount: number;
  readonly lastError: string | null;
  readonly updatedAt: Date;
}

/**
 * Whether this process can use the stored credential (no token in the result): OK, MISSING (nothing stored: log
 * in), REAUTH_REQUIRED (rejected or erased: log in again), KEY_MISSING (no key configured here), KEY_UNKNOWN /
 * DECRYPT_FAILED (the configured keys cannot open it: restore the key, or log in again).
 */
export interface CredentialCheck {
  readonly state: "OK" | "MISSING" | "REAUTH_REQUIRED" | CredentialCipherErrorCode;
  readonly keyId: string | null;
  /** True when the row is readable but was written with a previous key (the next refresh re-encrypts it). */
  readonly needsReencryption: boolean;
  readonly detail: string;
}

type EnvelopeRow = Pick<LedgerCredentialRow, "refreshTokenKeyId" | "refreshTokenNonce" | "refreshTokenCiphertext" | "refreshTokenTag">;

function sealedOf(row: EnvelopeRow): SealedSecret | null {
  const { refreshTokenKeyId: keyId, refreshTokenNonce: nonce, refreshTokenCiphertext: ciphertext, refreshTokenTag: tag } = row;
  return keyId && nonce && ciphertext && tag ? { keyId, nonce, ciphertext, tag } : null;
}

const envelopeColumns = (sealed: SealedSecret) => ({
  refreshTokenKeyId: sealed.keyId,
  refreshTokenNonce: sealed.nonce,
  refreshTokenCiphertext: sealed.ciphertext,
  refreshTokenTag: sealed.tag,
});

const NO_ENVELOPE = { refreshTokenKeyId: null, refreshTokenNonce: null, refreshTokenCiphertext: null, refreshTokenTag: null } as const;

export interface PgRefreshTokenStoreOptions {
  /** Required to read or write a token (DEVNET_CREDENTIAL_KEY); `status()` works without it. */
  readonly cipher?: CredentialCipher | null;
  readonly now?: () => Date;
}

export class PgRefreshTokenStore {
  readonly #db: Db;
  readonly #cipher: CredentialCipher | null;
  readonly #now: () => Date;

  constructor(db: Db, options: PgRefreshTokenStoreOptions = {}) {
    this.#db = db;
    this.#cipher = options.cipher ?? null;
    this.#now = options.now ?? (() => new Date());
  }

  #requireCipher(): CredentialCipher {
    if (!this.#cipher) {
      throw new CredentialCipherError("KEY_MISSING", "DEVNET_CREDENTIAL_KEY is not configured in this process: the stored refresh token cannot be read or written");
    }
    return this.#cipher;
  }

  /** Runs `fn` while holding the row lock; applies its update in the same transaction. */
  withCredential<T>(
    credentialId: string,
    fn: (current: StoredCredential | null) => Promise<{ readonly update: CredentialUpdate; readonly value: T }>,
  ): Promise<T> {
    let cipher: CredentialCipher;
    try {
      cipher = this.#requireCipher();
    } catch (error) {
      return Promise.reject(error);
    }
    return this.#db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          status: ledgerCredentials.status,
          ledgerUserId: ledgerCredentials.ledgerUserId,
          refreshTokenKeyId: ledgerCredentials.refreshTokenKeyId,
          refreshTokenNonce: ledgerCredentials.refreshTokenNonce,
          refreshTokenCiphertext: ledgerCredentials.refreshTokenCiphertext,
          refreshTokenTag: ledgerCredentials.refreshTokenTag,
        })
        .from(ledgerCredentials)
        .where(eq(ledgerCredentials.id, credentialId))
        .for("update");
      const binding = row ? { credentialId, ledgerUserId: row.ledgerUserId } : null;
      const sealed = row ? sealedOf(row) : null;
      // A row the configured keys cannot open throws here and the transaction rolls back: a wrong key never erases
      // or overwrites the stored credential.
      const current: StoredCredential | null =
        row && binding
          ? {
              refreshToken: sealed ? cipher.open(sealed, binding) : null,
              status: row.status === "ACTIVE" ? "ACTIVE" : "REAUTH_REQUIRED",
              ledgerUserId: row.ledgerUserId,
            }
          : null;
      const { update, value } = await fn(current);
      if (row && binding) {
        const now = this.#now();
        if (update.kind === "rotated") {
          await tx
            .update(ledgerCredentials)
            .set({
              // Always the current key: a row written with a previous key is re-encrypted here.
              ...envelopeColumns(cipher.seal(update.refreshToken, binding)),
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
            .set({ status: "REAUTH_REQUIRED", ...NO_ENVELOPE, lastError: update.reason.slice(0, 500), updatedAt: now })
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
    const { refreshToken, ...row } = input;
    const envelope = envelopeColumns(this.#requireCipher().seal(refreshToken, { credentialId: input.id, ledgerUserId: input.ledgerUserId }));
    await this.#db.transaction(async (tx) => {
      await tx.select({ id: ledgerCredentials.id }).from(ledgerCredentials).where(eq(ledgerCredentials.id, input.id)).for("update");
      await tx
        .insert(ledgerCredentials)
        .values({ ...row, ...envelope, status: "ACTIVE", rotatedAt: now, rotationCount: 0, lastError: null, updatedAt: now })
        .onConflictDoUpdate({
          target: ledgerCredentials.id,
          set: {
            ledgerUserId: input.ledgerUserId,
            issuer: input.issuer,
            clientId: input.clientId,
            ...envelope,
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
      hasRefreshToken: sealedOf(row) !== null,
      keyId: row.refreshTokenKeyId,
      accessTokenExpiresAt: row.accessTokenExpiresAt,
      rotatedAt: row.rotatedAt,
      rotationCount: row.rotationCount,
      lastError: row.lastError,
      updatedAt: row.updatedAt,
    };
  }

  /** Whether the stored credential can be used with the configured keys (decrypts in memory; returns no token). */
  async check(credentialId: string): Promise<CredentialCheck> {
    const [row] = await this.#db.select().from(ledgerCredentials).where(eq(ledgerCredentials.id, credentialId)).limit(1);
    if (!row) return { state: "MISSING", keyId: null, needsReencryption: false, detail: "no DevNet credential is stored: run node scripts/devnet/login.mjs" };
    const sealed = sealedOf(row);
    if (row.status !== "ACTIVE" || !sealed) {
      const detail = row.lastError ?? "the stored DevNet credential was rejected or erased: run node scripts/devnet/login.mjs again";
      return { state: "REAUTH_REQUIRED", keyId: row.refreshTokenKeyId, needsReencryption: false, detail: detail.slice(0, 500) };
    }
    if (!this.#cipher) return { state: "KEY_MISSING", keyId: sealed.keyId, needsReencryption: false, detail: "DEVNET_CREDENTIAL_KEY is not configured in this process" };
    try {
      this.#cipher.open(sealed, { credentialId, ledgerUserId: row.ledgerUserId });
    } catch (error) {
      if (error instanceof CredentialCipherError) return { state: error.code, keyId: sealed.keyId, needsReencryption: false, detail: error.message };
      throw error;
    }
    const needsReencryption = sealed.keyId !== this.#cipher.currentKeyId;
    return {
      state: "OK",
      keyId: sealed.keyId,
      needsReencryption,
      detail: needsReencryption
        ? `encrypted with previous key ${sealed.keyId}; the next refresh re-encrypts it with ${this.#cipher.currentKeyId}`
        : `encrypted with key ${sealed.keyId}`,
    };
  }
}
