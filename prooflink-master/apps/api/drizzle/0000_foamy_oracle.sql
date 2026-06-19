CREATE TABLE "agent_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_did" varchar(256) NOT NULL,
	"policy" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"sync_status" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_policies_agent_did_unique" UNIQUE("agent_did")
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_did" varchar(256) NOT NULL,
	"erc8004_id" integer,
	"erc8004_registry" varchar(128),
	"name" varchar(256),
	"agent_type" varchar(32) NOT NULL,
	"wallet_address" varchar(128) NOT NULL,
	"controlling_entity_name" varchar(256) NOT NULL,
	"controlling_entity_lei" varchar(20),
	"kya_credential_hash" varchar(128),
	"compliance_score" smallint DEFAULT 0 NOT NULL,
	"delegation_scope" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"validated_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"api_key_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(128) NOT NULL,
	"key_hash" varchar(128) NOT NULL,
	"key_prefix" varchar(12) NOT NULL,
	"owner_id" varchar(256) NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rate_limit_per_minute" integer DEFAULT 60 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"log_hash" varchar(128) NOT NULL,
	"previous_log_hash" varchar(128) NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"receipt_id" uuid,
	"invoice_id" uuid,
	"agent_did" varchar(256),
	"api_key_id" uuid,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_address" varchar(128) NOT NULL,
	"receiver_address" varchar(128) NOT NULL,
	"sender_agent_did" varchar(256),
	"receiver_agent_did" varchar(256),
	"amount" numeric(38, 18) NOT NULL,
	"asset" varchar(10) NOT NULL,
	"chain" varchar(64) NOT NULL,
	"protocol" varchar(20) NOT NULL,
	"status" varchar(20) NOT NULL,
	"risk_score" smallint NOT NULL,
	"checks" jsonb NOT NULL,
	"total_duration_ms" integer,
	"api_key_id" uuid,
	"trace_id" varchar(64),
	"parent_trace_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"check_id" uuid NOT NULL,
	"receipt_hash" varchar(128) NOT NULL,
	"overall_status" varchar(20) NOT NULL,
	"risk_score" smallint NOT NULL,
	"travel_rule_status" varchar(20),
	"commitment_hash" varchar(128),
	"commitment_salt" varchar(128),
	"eas_attestation_uid" varchar(128),
	"ipfs_cid" varchar(128),
	"signature" text NOT NULL,
	"checks_performed" jsonb NOT NULL,
	"ttl" integer DEFAULT 300 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compliance_receipts_receipt_hash_unique" UNIQUE("receipt_hash")
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"escrow_id" uuid,
	"invoice_id" uuid,
	"state" varchar(20) DEFAULT 'OPEN' NOT NULL,
	"initiator_did" varchar(256) NOT NULL,
	"respondent_did" varchar(256) NOT NULL,
	"reason" text NOT NULL,
	"category" varchar(30) NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resolution" jsonb,
	"resolved_by" varchar(256),
	"trace_id" varchar(64),
	"api_key_id" uuid,
	"deadline" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "escrows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"escrow_type" varchar(20) NOT NULL,
	"state" varchar(20) DEFAULT 'CREATED' NOT NULL,
	"payer_agent_did" varchar(256) NOT NULL,
	"payee_agent_did" varchar(256) NOT NULL,
	"payer_wallet" varchar(128) NOT NULL,
	"payee_wallet" varchar(128) NOT NULL,
	"amount" numeric(38, 18) NOT NULL,
	"asset" varchar(10) NOT NULL,
	"chain" varchar(64) NOT NULL,
	"conditions" jsonb NOT NULL,
	"evaluator_address" varchar(128),
	"compliance_receipt_id" uuid,
	"trace_id" varchar(64),
	"api_key_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"funded_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"disputed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_hash" varchar(128),
	"ipfs_cid" varchar(128),
	"issuer_agent_did" varchar(256) NOT NULL,
	"recipient_agent_did" varchar(256) NOT NULL,
	"seller_wallet_address" varchar(128) NOT NULL,
	"buyer_wallet_address" varchar(128) NOT NULL,
	"currency" varchar(10) NOT NULL,
	"total_amount" numeric(38, 18) NOT NULL,
	"state" varchar(20) DEFAULT 'DRAFT' NOT NULL,
	"line_items" jsonb NOT NULL,
	"payment_protocol" varchar(20),
	"compliance_receipt_id" uuid,
	"on_chain_tx_hash" varchar(128),
	"eas_attestation_uid" varchar(128),
	"due_date" timestamp with time zone,
	"api_key_id" uuid,
	"trace_id" varchar(64),
	"invoice_data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_invoice_hash_unique" UNIQUE("invoice_hash")
);
--> statement-breakpoint
CREATE TABLE "payment_streams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payer_did" varchar(256) NOT NULL,
	"payee_did" varchar(256) NOT NULL,
	"model" varchar(20) NOT NULL,
	"rate_per_unit" numeric(38, 18) NOT NULL,
	"unit" varchar(64) NOT NULL,
	"total_budget" numeric(38, 18) NOT NULL,
	"spent" numeric(38, 18) DEFAULT '0' NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"trace_id" varchar(64),
	"api_key_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'DRAFT' NOT NULL,
	"priority" varchar(10) DEFAULT 'NORMAL' NOT NULL,
	"compliance_check_id" uuid,
	"agent_did" varchar(256),
	"trigger_reason" text NOT NULL,
	"report_data" jsonb NOT NULL,
	"filed_at" timestamp with time zone,
	"filing_reference" varchar(128),
	"reviewed_by" varchar(256),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sagas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(256) NOT NULL,
	"steps" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"trace_id" varchar(64) NOT NULL,
	"api_key_id" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "usage_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_did" varchar(256) NOT NULL,
	"action" varchar(50) NOT NULL,
	"amount_usd" numeric(18, 8) NOT NULL,
	"metadata" jsonb,
	"trace_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_receipt_id_compliance_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."compliance_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_checks" ADD CONSTRAINT "compliance_checks_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_receipts" ADD CONSTRAINT "compliance_receipts_check_id_compliance_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."compliance_checks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_escrow_id_escrows_id_fk" FOREIGN KEY ("escrow_id") REFERENCES "public"."escrows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrows" ADD CONSTRAINT "escrows_compliance_receipt_id_compliance_receipts_id_fk" FOREIGN KEY ("compliance_receipt_id") REFERENCES "public"."compliance_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrows" ADD CONSTRAINT "escrows_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_compliance_receipt_id_compliance_receipts_id_fk" FOREIGN KEY ("compliance_receipt_id") REFERENCES "public"."compliance_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_streams" ADD CONSTRAINT "payment_streams_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_compliance_check_id_compliance_checks_id_fk" FOREIGN KEY ("compliance_check_id") REFERENCES "public"."compliance_checks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sagas" ADD CONSTRAINT "sagas_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_policies_agent_did_idx" ON "agent_policies" USING btree ("agent_did");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_agent_did_idx" ON "agents" USING btree ("agent_did");--> statement-breakpoint
CREATE INDEX "agents_wallet_address_idx" ON "agents" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "agents_api_key_id_idx" ON "agents" USING btree ("api_key_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_hash_idx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_owner_id_idx" ON "api_keys" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "audit_log_event_type_created_idx" ON "audit_log" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_agent_did_idx" ON "audit_log" USING btree ("agent_did");--> statement-breakpoint
CREATE INDEX "compliance_checks_api_key_created_idx" ON "compliance_checks" USING btree ("api_key_id","created_at");--> statement-breakpoint
CREATE INDEX "compliance_checks_sender_address_idx" ON "compliance_checks" USING btree ("sender_address");--> statement-breakpoint
CREATE INDEX "compliance_checks_receiver_address_idx" ON "compliance_checks" USING btree ("receiver_address");--> statement-breakpoint
CREATE INDEX "compliance_checks_trace_id_idx" ON "compliance_checks" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "compliance_checks_status_created_idx" ON "compliance_checks" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "compliance_checks_sender_agent_did_idx" ON "compliance_checks" USING btree ("sender_agent_did");--> statement-breakpoint
CREATE INDEX "disputes_state_idx" ON "disputes" USING btree ("state");--> statement-breakpoint
CREATE INDEX "disputes_initiator_did_idx" ON "disputes" USING btree ("initiator_did");--> statement-breakpoint
CREATE INDEX "disputes_respondent_did_idx" ON "disputes" USING btree ("respondent_did");--> statement-breakpoint
CREATE INDEX "disputes_escrow_id_idx" ON "disputes" USING btree ("escrow_id");--> statement-breakpoint
CREATE INDEX "disputes_invoice_id_idx" ON "disputes" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "disputes_api_key_id_idx" ON "disputes" USING btree ("api_key_id");--> statement-breakpoint
CREATE INDEX "escrows_state_idx" ON "escrows" USING btree ("state");--> statement-breakpoint
CREATE INDEX "escrows_payer_wallet_idx" ON "escrows" USING btree ("payer_wallet");--> statement-breakpoint
CREATE INDEX "escrows_payee_wallet_idx" ON "escrows" USING btree ("payee_wallet");--> statement-breakpoint
CREATE INDEX "escrows_trace_id_idx" ON "escrows" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "escrows_api_key_id_idx" ON "escrows" USING btree ("api_key_id");--> statement-breakpoint
CREATE INDEX "invoices_state_idx" ON "invoices" USING btree ("state");--> statement-breakpoint
CREATE INDEX "invoices_seller_wallet_address_idx" ON "invoices" USING btree ("seller_wallet_address");--> statement-breakpoint
CREATE INDEX "invoices_buyer_wallet_address_idx" ON "invoices" USING btree ("buyer_wallet_address");--> statement-breakpoint
CREATE INDEX "invoices_trace_id_idx" ON "invoices" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "payment_streams_status_idx" ON "payment_streams" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payment_streams_payer_did_idx" ON "payment_streams" USING btree ("payer_did");--> statement-breakpoint
CREATE INDEX "payment_streams_payee_did_idx" ON "payment_streams" USING btree ("payee_did");--> statement-breakpoint
CREATE INDEX "payment_streams_model_idx" ON "payment_streams" USING btree ("model");--> statement-breakpoint
CREATE INDEX "payment_streams_trace_id_idx" ON "payment_streams" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "payment_streams_api_key_id_idx" ON "payment_streams" USING btree ("api_key_id");--> statement-breakpoint
CREATE INDEX "reports_type_idx" ON "reports" USING btree ("type");--> statement-breakpoint
CREATE INDEX "reports_status_idx" ON "reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reports_compliance_check_id_idx" ON "reports" USING btree ("compliance_check_id");--> statement-breakpoint
CREATE INDEX "sagas_status_idx" ON "sagas" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sagas_trace_id_idx" ON "sagas" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "sagas_api_key_id_idx" ON "sagas" USING btree ("api_key_id");--> statement-breakpoint
CREATE INDEX "usage_records_agent_did_idx" ON "usage_records" USING btree ("agent_did");--> statement-breakpoint
CREATE INDEX "usage_records_action_idx" ON "usage_records" USING btree ("action");--> statement-breakpoint
CREATE INDEX "usage_records_created_at_idx" ON "usage_records" USING btree ("created_at");