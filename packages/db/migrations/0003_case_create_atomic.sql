ALTER TABLE "cases" ADD COLUMN "create_command_id" uuid;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "cases_create_command_key" ON "cases" USING btree ("create_command_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cases_active_asset_key" ON "cases" USING btree ("asset_ref") WHERE "cases"."cancelled_at" is null and "cases"."closed_at" is null and "cases"."superseded_at" is null;