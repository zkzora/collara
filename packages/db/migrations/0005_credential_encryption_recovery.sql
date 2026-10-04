-- Refresh tokens are stored AES-256-GCM encrypted (key id, nonce, ciphertext, tag) with a key held outside the
-- database (DEVNET_CREDENTIAL_KEY). SQL cannot encrypt without that key, so a plaintext refresh token left by 0004 is
-- ERASED here and its row marked REAUTH_REQUIRED: the owner runs node scripts/devnet/login.mjs again, and no
-- plaintext token survives this migration. ledger_sources gains history_floor_offset (DevNet pruning recovery).
UPDATE "ledger_credentials" SET "status" = 'REAUTH_REQUIRED', "last_error" = 'Migration 0005 erased the plaintext refresh token (refresh tokens are now stored encrypted with DEVNET_CREDENTIAL_KEY). Run node scripts/devnet/login.mjs again.', "updated_at" = now() WHERE "refresh_token" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_credentials" DROP COLUMN "refresh_token";--> statement-breakpoint
ALTER TABLE "ledger_credentials" ADD COLUMN "refresh_token_key_id" text;--> statement-breakpoint
ALTER TABLE "ledger_credentials" ADD COLUMN "refresh_token_nonce" text;--> statement-breakpoint
ALTER TABLE "ledger_credentials" ADD COLUMN "refresh_token_ciphertext" text;--> statement-breakpoint
ALTER TABLE "ledger_credentials" ADD COLUMN "refresh_token_tag" text;--> statement-breakpoint
ALTER TABLE "ledger_sources" ADD COLUMN "history_floor_offset" bigint;--> statement-breakpoint
ALTER TABLE "ledger_credentials" ADD CONSTRAINT "ledger_credentials_envelope" CHECK (("ledger_credentials"."refresh_token_key_id" is null and "ledger_credentials"."refresh_token_nonce" is null and "ledger_credentials"."refresh_token_ciphertext" is null and "ledger_credentials"."refresh_token_tag" is null) or ("ledger_credentials"."refresh_token_key_id" is not null and "ledger_credentials"."refresh_token_nonce" is not null and "ledger_credentials"."refresh_token_ciphertext" is not null and "ledger_credentials"."refresh_token_tag" is not null));
