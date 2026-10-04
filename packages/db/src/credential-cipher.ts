// Envelope for DEVNET's stored refresh token (ledger_credentials, migration 0005): AES-256-GCM with a fresh random
// 96-bit nonce per write, and additional authenticated data binding the ciphertext to its row (credential id,
// ledger user id, key id), so a ciphertext copied into another row, or relabelled with another key id, fails to
// decrypt. The key comes from the environment (DEVNET_CREDENTIAL_KEY, parsed by @collara/canton
// parseCredentialKeyring) and never touches the database. Errors name key ids, never key bytes or plaintext.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { inspect } from "node:util";

const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const AAD_VERSION = "collara.ledger_credentials.refresh_token.v1";

/** Mirrors @collara/canton CredentialKeyMaterial (this package does not depend on it). */
export interface CredentialKey {
  readonly id: string;
  readonly key: Uint8Array;
}

/** Mirrors @collara/canton CredentialKeyring. */
export interface CredentialKeys {
  readonly current: CredentialKey;
  readonly previous: readonly CredentialKey[];
}

/** What is stored for one encrypted secret (base64 text columns). */
export interface SealedSecret {
  readonly keyId: string;
  readonly nonce: string;
  readonly ciphertext: string;
  readonly tag: string;
}

/** The row identity the ciphertext is bound to. */
export interface SecretBinding {
  readonly credentialId: string;
  readonly ledgerUserId: string;
}

export type CredentialCipherErrorCode =
  /** No key configured in this process (DEVNET_CREDENTIAL_KEY unset). */
  | "KEY_MISSING"
  /** The row was encrypted with a key id that is neither the current nor a previous key. */
  | "KEY_UNKNOWN"
  /** Authentication failed: wrong key bytes for that key id, or the row was moved or tampered with. */
  | "DECRYPT_FAILED"
  /** A configured key is not 32 bytes. */
  | "KEY_INVALID";

export class CredentialCipherError extends Error {
  override readonly name = "CredentialCipherError";
  readonly code: CredentialCipherErrorCode;
  constructor(code: CredentialCipherErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function aad(binding: SecretBinding, keyId: string): Buffer {
  // JSON array: unambiguous field boundaries whatever characters the ids contain.
  return Buffer.from(JSON.stringify([AAD_VERSION, binding.credentialId, binding.ledgerUserId, keyId]), "utf8");
}

export class CredentialCipher {
  readonly #keys: Map<string, Buffer>;
  readonly #currentId: string;

  constructor(keys: CredentialKeys) {
    this.#keys = new Map();
    for (const { id, key } of [keys.current, ...keys.previous]) {
      if (key.length !== 32) throw new CredentialCipherError("KEY_INVALID", `credential key ${id} is not 32 bytes`);
      if (this.#keys.has(id)) throw new CredentialCipherError("KEY_INVALID", `credential key id ${id} is configured twice`);
      this.#keys.set(id, Buffer.from(key));
    }
    this.#currentId = keys.current.id;
  }

  /** The key id every write uses. */
  get currentKeyId(): string {
    return this.#currentId;
  }

  /** True when this process can decrypt rows written with `keyId`. */
  knows(keyId: string): boolean {
    return this.#keys.has(keyId);
  }

  seal(plaintext: string, binding: SecretBinding): SealedSecret {
    const key = this.#keys.get(this.#currentId);
    if (!key) throw new CredentialCipherError("KEY_MISSING", "no current credential key");
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
    cipher.setAAD(aad(binding, this.#currentId));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return {
      keyId: this.#currentId,
      nonce: nonce.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
    };
  }

  open(sealed: SealedSecret, binding: SecretBinding): string {
    const key = this.#keys.get(sealed.keyId);
    if (!key) {
      throw new CredentialCipherError(
        "KEY_UNKNOWN",
        `the stored DevNet credential was encrypted with key id ${sealed.keyId}, which is neither DEVNET_CREDENTIAL_KEY_ID (${this.#currentId}) nor in DEVNET_CREDENTIAL_KEY_PREVIOUS: configure that key, or run node scripts/devnet/login.mjs again`,
      );
    }
    try {
      const nonce = Buffer.from(sealed.nonce, "base64");
      const tag = Buffer.from(sealed.tag, "base64");
      if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES) throw new Error("bad envelope");
      const decipher = createDecipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
      decipher.setAAD(aad(binding, sealed.keyId));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64")), decipher.final()]).toString("utf8");
    } catch {
      // Node's own message ("Unsupported state or unable to authenticate data") says nothing useful to an operator.
      throw new CredentialCipherError(
        "DECRYPT_FAILED",
        `the stored DevNet credential does not decrypt with key id ${sealed.keyId}: DEVNET_CREDENTIAL_KEY for that id is not the key it was written with, or the row was copied or altered. Restore the right key, or run node scripts/devnet/login.mjs again`,
      );
    }
  }

  /** Never serialise key material. */
  toJSON(): { type: "credential-cipher"; currentKeyId: string; keyIds: string[] } {
    return { type: "credential-cipher", currentKeyId: this.#currentId, keyIds: [...this.#keys.keys()] };
  }

  [inspect.custom](): string {
    return `CredentialCipher { currentKeyId: ${this.#currentId}, keyIds: [${[...this.#keys.keys()].join(", ")}] }`;
  }
}
