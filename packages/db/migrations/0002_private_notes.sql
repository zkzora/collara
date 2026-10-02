CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"owner_org_id" text NOT NULL,
	"audience" text NOT NULL,
	"case_ref" text NOT NULL,
	"subject_ref" text NOT NULL,
	"body" text NOT NULL,
	"command_id" uuid NOT NULL,
	"created_by_user_id" text NOT NULL,
	"state" text DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notes_kind" CHECK ("notes"."kind" in ('ASSESSMENT_INTERNAL', 'ASSESSMENT_SHARED_FEEDBACK', 'RELEASE_REQUEST_NOTE', 'RELEASE_SERVICING_REF', 'RELEASE_QUESTION', 'RELEASE_RESPONSE')),
	CONSTRAINT "notes_audience" CHECK (("notes"."kind" = 'ASSESSMENT_INTERNAL') = ("notes"."audience" = 'ORG_ONLY') and "notes"."audience" in ('ORG_ONLY', 'CASE_COUNTERPARTIES')),
	CONSTRAINT "notes_state" CHECK ("notes"."state" in ('PENDING', 'ATTACHED', 'DISCARDED')),
	CONSTRAINT "notes_body_length" CHECK (char_length("notes"."body") <= 4000)
);
--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_owner_org_id_organizations_id_fk" FOREIGN KEY ("owner_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_command_id_commands_id_fk" FOREIGN KEY ("command_id") REFERENCES "public"."commands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notes_command_kind_key" ON "notes" USING btree ("command_id","kind");--> statement-breakpoint
CREATE INDEX "notes_case_idx" ON "notes" USING btree ("case_ref","subject_ref");