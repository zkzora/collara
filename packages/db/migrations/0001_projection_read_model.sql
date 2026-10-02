CREATE TABLE "ledger_updates" (
	"source" text NOT NULL,
	"update_id" text NOT NULL,
	"offset" bigint NOT NULL,
	"command_id" text,
	"workflow_id" text,
	"effective_at" timestamp with time zone NOT NULL,
	"record_time" timestamp with time zone,
	"projected_events" integer NOT NULL,
	"total_events" integer NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_updates_pk" PRIMARY KEY("source","update_id")
);
--> statement-breakpoint
ALTER TABLE "commands" ADD COLUMN "ledger_user_id" text;--> statement-breakpoint
ALTER TABLE "commands" ADD COLUMN "act_as" text[];--> statement-breakpoint
ALTER TABLE "commands" ADD COLUMN "ledger_source" text;--> statement-breakpoint
ALTER TABLE "commands" ADD COLUMN "ledger_end_at_submit" bigint;--> statement-breakpoint
ALTER TABLE "commands" ADD COLUMN "reconcile_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commands" ADD COLUMN "last_reconcile_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commands" ADD COLUMN "reconcile_note" text;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD COLUMN "lease_owner" text;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ledger_contracts" ADD COLUMN "stakeholders" text[] GENERATED ALWAYS AS (signatories || observers) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_contracts" ADD COLUMN "business_ref" text;--> statement-breakpoint
ALTER TABLE "ledger_contracts" ADD COLUMN "case_ref" text;--> statement-breakpoint
ALTER TABLE "ledger_contracts" ADD COLUMN "asset_ref" text;--> statement-breakpoint
ALTER TABLE "ledger_contracts" ADD COLUMN "archived_choice" text;--> statement-breakpoint
ALTER TABLE "ledger_contracts" ADD COLUMN "archived_node_id" integer;--> statement-breakpoint
ALTER TABLE "ledger_sources" ADD COLUMN "party_filter" text[];--> statement-breakpoint
ALTER TABLE "ledger_sources" ADD COLUMN "ledger_user_id" text;--> statement-breakpoint
ALTER TABLE "ledger_sources" ADD COLUMN "last_polled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ledger_sources" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "ledger_sources" ADD COLUMN "last_error_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ledger_updates" ADD CONSTRAINT "ledger_updates_source_ledger_sources_source_fk" FOREIGN KEY ("source") REFERENCES "public"."ledger_sources"("source") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_updates_offset_key" ON "ledger_updates" USING btree ("source","offset");--> statement-breakpoint
CREATE INDEX "ledger_updates_update_idx" ON "ledger_updates" USING btree ("update_id");--> statement-breakpoint
CREATE INDEX "ledger_contracts_stakeholders_gin" ON "ledger_contracts" USING gin ("stakeholders");--> statement-breakpoint
CREATE INDEX "ledger_contracts_case_idx" ON "ledger_contracts" USING btree ("case_ref");--> statement-breakpoint
CREATE INDEX "ledger_contracts_asset_idx" ON "ledger_contracts" USING btree ("asset_ref");--> statement-breakpoint
CREATE INDEX "ledger_contracts_business_ref_idx" ON "ledger_contracts" USING btree ("template_ref","business_ref");