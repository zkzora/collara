CREATE TABLE "ledger_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"environment" text DEFAULT 'DEVNET' NOT NULL,
	"ledger_user_id" text NOT NULL,
	"issuer" text NOT NULL,
	"client_id" text NOT NULL,
	"refresh_token" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"access_token_expires_at" timestamp with time zone,
	"rotated_at" timestamp with time zone,
	"rotation_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_credentials_status" CHECK ("ledger_credentials"."status" in ('ACTIVE', 'REAUTH_REQUIRED'))
);
