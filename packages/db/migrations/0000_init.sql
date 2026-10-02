CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" text,
	"org_id" text,
	"action" text NOT NULL,
	"resource_type" text,
	"resource_ref" text,
	"outcome" text NOT NULL,
	"request_id" text,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_ref" text NOT NULL,
	"title" text NOT NULL,
	"purpose" text,
	"asset_ref" text NOT NULL,
	"borrower_org_id" text NOT NULL,
	"dealer_org_id" text,
	"selected_lender_org_id" text,
	"requested_principal" numeric(18, 2),
	"requested_currency" char(3),
	"policy_ref" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"cancelled_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cases_money_pair" CHECK (("cases"."requested_principal" is null) = ("cases"."requested_currency" is null) and ("cases"."requested_currency" is null or "cases"."requested_currency" ~ '^[A-Z]{3}$')),
	CONSTRAINT "cases_principal_positive" CHECK ("cases"."requested_principal" is null or "cases"."requested_principal" > 0)
);
--> statement-breakpoint
CREATE TABLE "commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"org_id" text NOT NULL,
	"operation" text NOT NULL,
	"target" text NOT NULL,
	"payload_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'PREPARED' NOT NULL,
	"ledger_command_id" text NOT NULL,
	"submission_id" text,
	"update_id" text,
	"completion_offset" bigint,
	"error_kind" text,
	"error_code" text,
	"error_message" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"resource_ref" text,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"committed_at" timestamp with time zone,
	"projected_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commands_target" CHECK ("commands"."target" in ('LEDGER', 'APPLICATION'))
);
--> statement-breakpoint
CREATE TABLE "evidence_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_ref" text NOT NULL,
	"version" integer NOT NULL,
	"asset_ref" text NOT NULL,
	"case_ref" text,
	"owner_org_id" text NOT NULL,
	"contributor_org_id" text NOT NULL,
	"uploaded_by_user_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"declared_size_bytes" bigint NOT NULL,
	"size_bytes" bigint,
	"upload_sha256" text,
	"sha256" text,
	"storage_key" text,
	"status" text DEFAULT 'UPLOAD_PENDING' NOT NULL,
	"scan_status" text DEFAULT 'NOT_SCANNED' NOT NULL,
	"rejection_reason" text,
	"intent_expires_at" timestamp with time zone NOT NULL,
	"intent_command_id" uuid,
	"uploaded_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_documents_version_positive" CHECK ("evidence_documents"."version" > 0),
	CONSTRAINT "evidence_documents_sha256_hex" CHECK ("evidence_documents"."sha256" is null or "evidence_documents"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "export_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_ref" text NOT NULL,
	"case_ref" text NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"org_id" text NOT NULL,
	"format" text DEFAULT 'JSON' NOT NULL,
	"scope" jsonb NOT NULL,
	"state" text DEFAULT 'QUEUED' NOT NULL,
	"cutoff_offset" bigint,
	"watermark" jsonb,
	"schema_version" text NOT NULL,
	"checksum_sha256" text,
	"storage_key" text,
	"size_bytes" bigint,
	"error_message" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"generated_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"org_id" text NOT NULL,
	"email" text NOT NULL,
	"roles" text[] NOT NULL,
	"mandates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" text DEFAULT 'PENDING' NOT NULL,
	"invited_by_user_id" text,
	"accepted_by_user_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_contracts" (
	"source" text NOT NULL,
	"contract_id" text NOT NULL,
	"template_id" text NOT NULL,
	"template_ref" text NOT NULL,
	"package_name" text NOT NULL,
	"payload" jsonb NOT NULL,
	"signatories" text[] NOT NULL,
	"observers" text[] DEFAULT '{}'::text[] NOT NULL,
	"witness_parties" text[] NOT NULL,
	"created_update_id" text NOT NULL,
	"created_offset" bigint NOT NULL,
	"created_node_id" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"archived_update_id" text,
	"archived_offset" bigint,
	"archived_at" timestamp with time zone,
	CONSTRAINT "ledger_contracts_pk" PRIMARY KEY("source","contract_id")
);
--> statement-breakpoint
CREATE TABLE "ledger_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"update_id" text NOT NULL,
	"offset" bigint NOT NULL,
	"node_id" integer NOT NULL,
	"kind" text NOT NULL,
	"contract_id" text NOT NULL,
	"template_id" text NOT NULL,
	"template_ref" text NOT NULL,
	"choice" text,
	"consuming" boolean,
	"acting_parties" text[] DEFAULT '{}'::text[] NOT NULL,
	"witness_parties" text[] NOT NULL,
	"command_id" text,
	"effective_at" timestamp with time zone NOT NULL,
	"record_time" timestamp with time zone,
	"detail" jsonb,
	"projected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_sources" (
	"source" text PRIMARY KEY NOT NULL,
	"participant_id" text NOT NULL,
	"json_api_url" text NOT NULL,
	"checkpoint_offset" bigint DEFAULT 0 NOT NULL,
	"last_update_id" text,
	"last_applied_at" timestamp with time zone,
	"ledger_end_seen" bigint,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"reset_detected_at" timestamp with time zone,
	"reset_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text,
	"ledger_user_id" text NOT NULL,
	"source" text NOT NULL,
	"role" text NOT NULL,
	"primary_party" text,
	"act_as" text[] DEFAULT '{}'::text[] NOT NULL,
	"read_as" text[] DEFAULT '{}'::text[] NOT NULL,
	"environment" text DEFAULT 'LOCALNET' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mandates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"org_id" text NOT NULL,
	"code" text NOT NULL,
	"seat" smallint DEFAULT 0 NOT NULL,
	"label" text NOT NULL,
	"state" text DEFAULT 'ACTIVE' NOT NULL,
	"granted_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "mandates_seat_range" CHECK ("mandates"."seat" between 0 and 3)
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"org_id" text NOT NULL,
	"role" text NOT NULL,
	"state" text DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_user_id" text,
	"recipient_org_id" text NOT NULL,
	"event_type" text NOT NULL,
	"resource_type" text,
	"resource_ref" text,
	"link_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"country" char(2),
	"state" text DEFAULT 'ACTIVE' NOT NULL,
	"hosting_mode" text,
	"is_synthetic" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_country_iso" CHECK ("organizations"."country" is null or "organizations"."country" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "party_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"kind" text NOT NULL,
	"governance_seat" smallint,
	"party_id" text NOT NULL,
	"party_hint" text NOT NULL,
	"source" text NOT NULL,
	"participant_id" text NOT NULL,
	"environment" text DEFAULT 'LOCALNET' NOT NULL,
	"state" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "party_bindings_kind" CHECK ("party_bindings"."kind" in ('business', 'governance-member', 'governance'))
);
--> statement-breakpoint
CREATE TABLE "pilot_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"work_email" text NOT NULL,
	"company" text NOT NULL,
	"role" text NOT NULL,
	"company_type" text NOT NULL,
	"country" text NOT NULL,
	"equipment_category" text NOT NULL,
	"cases_per_month" text NOT NULL,
	"workflow_challenge" text NOT NULL,
	"current_systems" text,
	"consent_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'RECEIVED' NOT NULL,
	"notify_attempts" integer DEFAULT 0 NOT NULL,
	"last_notify_error" text,
	"notified_at" timestamp with time zone,
	"idempotency_key" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ref_counters" (
	"kind" text PRIMARY KEY NOT NULL,
	"value" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"active_org_id" text,
	"persona_id" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"data" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"display_name" text NOT NULL,
	"title" text,
	"oidc_issuer" text,
	"oidc_subject" text,
	"persona_id" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"disabled_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_borrower_org_id_organizations_id_fk" FOREIGN KEY ("borrower_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_dealer_org_id_organizations_id_fk" FOREIGN KEY ("dealer_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_selected_lender_org_id_organizations_id_fk" FOREIGN KEY ("selected_lender_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commands" ADD CONSTRAINT "commands_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commands" ADD CONSTRAINT "commands_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_documents" ADD CONSTRAINT "evidence_documents_owner_org_id_organizations_id_fk" FOREIGN KEY ("owner_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_documents" ADD CONSTRAINT "evidence_documents_contributor_org_id_organizations_id_fk" FOREIGN KEY ("contributor_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_documents" ADD CONSTRAINT "evidence_documents_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_contracts" ADD CONSTRAINT "ledger_contracts_source_ledger_sources_source_fk" FOREIGN KEY ("source") REFERENCES "public"."ledger_sources"("source") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_events" ADD CONSTRAINT "ledger_events_source_ledger_sources_source_fk" FOREIGN KEY ("source") REFERENCES "public"."ledger_sources"("source") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_users" ADD CONSTRAINT "ledger_users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_org_id_organizations_id_fk" FOREIGN KEY ("recipient_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_bindings" ADD CONSTRAINT "party_bindings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_org_id_organizations_id_fk" FOREIGN KEY ("active_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_resource_idx" ON "audit_events" USING btree ("resource_ref");--> statement-breakpoint
CREATE INDEX "audit_events_org_idx" ON "audit_events" USING btree ("org_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cases_ref_key" ON "cases" USING btree ("case_ref");--> statement-breakpoint
CREATE INDEX "cases_asset_idx" ON "cases" USING btree ("asset_ref");--> statement-breakpoint
CREATE INDEX "cases_borrower_idx" ON "cases" USING btree ("borrower_org_id");--> statement-breakpoint
CREATE INDEX "cases_lender_idx" ON "cases" USING btree ("selected_lender_org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commands_idempotency_key" ON "commands" USING btree ("actor_user_id","org_id","operation","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "commands_ledger_command_key" ON "commands" USING btree ("ledger_command_id");--> statement-breakpoint
CREATE INDEX "commands_status_idx" ON "commands" USING btree ("status");--> statement-breakpoint
CREATE INDEX "commands_update_idx" ON "commands" USING btree ("update_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_documents_ref_version_key" ON "evidence_documents" USING btree ("doc_ref","version");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_documents_intent_command_key" ON "evidence_documents" USING btree ("intent_command_id");--> statement-breakpoint
CREATE INDEX "evidence_documents_asset_idx" ON "evidence_documents" USING btree ("asset_ref");--> statement-breakpoint
CREATE INDEX "evidence_documents_owner_idx" ON "evidence_documents" USING btree ("owner_org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "export_jobs_ref_key" ON "export_jobs" USING btree ("report_ref");--> statement-breakpoint
CREATE INDEX "export_jobs_state_idx" ON "export_jobs" USING btree ("state");--> statement-breakpoint
CREATE INDEX "export_jobs_case_idx" ON "export_jobs" USING btree ("case_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_key" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_org_idx" ON "invitations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "ledger_contracts_template_idx" ON "ledger_contracts" USING btree ("template_ref","archived_offset");--> statement-breakpoint
CREATE INDEX "ledger_contracts_witness_gin" ON "ledger_contracts" USING gin ("witness_parties");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_events_node_key" ON "ledger_events" USING btree ("source","update_id","node_id");--> statement-breakpoint
CREATE INDEX "ledger_events_offset_idx" ON "ledger_events" USING btree ("source","offset");--> statement-breakpoint
CREATE INDEX "ledger_events_contract_idx" ON "ledger_events" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "ledger_events_witness_gin" ON "ledger_events" USING gin ("witness_parties");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_users_source_user_key" ON "ledger_users" USING btree ("environment","source","ledger_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mandates_user_org_code_seat_key" ON "mandates" USING btree ("user_id","org_id","code","seat");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_user_org_role_key" ON "memberships" USING btree ("user_id","org_id","role");--> statement-breakpoint
CREATE INDEX "memberships_org_idx" ON "memberships" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("recipient_org_id","recipient_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "party_bindings_party_key" ON "party_bindings" USING btree ("environment","party_id");--> statement-breakpoint
CREATE INDEX "party_bindings_org_idx" ON "party_bindings" USING btree ("org_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "pilot_requests_idempotency_key" ON "pilot_requests" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "pilot_requests_status_idx" ON "pilot_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_oidc_identity_key" ON "users" USING btree ("oidc_issuer","oidc_subject");--> statement-breakpoint
CREATE UNIQUE INDEX "users_persona_key" ON "users" USING btree ("persona_id");