import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// API Keys
// ---------------------------------------------------------------------------

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 128 }).notNull(),
  keyHash: varchar("key_hash", { length: 128 }).notNull(),
  keyPrefix: varchar("key_prefix", { length: 12 }).notNull(),
  ownerId: varchar("owner_id", { length: 256 }).notNull(),
  scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
  rateLimitPerMinute: integer("rate_limit_per_minute").notNull().default(60),
  isActive: boolean("is_active").notNull().default(true),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("api_keys_key_hash_idx").on(table.keyHash),
  index("api_keys_owner_id_idx").on(table.ownerId),
]);

// ---------------------------------------------------------------------------
// Agents (KYA records)
// ---------------------------------------------------------------------------

export const agents = pgTable("agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentDid: varchar("agent_did", { length: 256 }).notNull(),
  erc8004Id: integer("erc8004_id"),
  erc8004Registry: varchar("erc8004_registry", { length: 128 }),
  name: varchar("name", { length: 256 }),
  agentType: varchar("agent_type", { length: 32 }).notNull(),
  walletAddress: varchar("wallet_address", { length: 128 }).notNull(),
  controllingEntityName: varchar("controlling_entity_name", { length: 256 }).notNull(),
  controllingEntityLei: varchar("controlling_entity_lei", { length: 20 }),
  kyaCredentialHash: varchar("kya_credential_hash", { length: 128 }),
  complianceScore: smallint("compliance_score").notNull().default(0),
  delegationScope: jsonb("delegation_scope").$type<Record<string, unknown>>(),
  isActive: boolean("is_active").notNull().default(true),
  validatedAt: timestamp("validated_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  apiKeyId: uuid("api_key_id").references(() => apiKeys.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("agents_agent_did_idx").on(table.agentDid),
  index("agents_wallet_address_idx").on(table.walletAddress),
  index("agents_api_key_id_idx").on(table.apiKeyId),
]);

// ---------------------------------------------------------------------------
// Compliance Checks (pipeline runs)
// ---------------------------------------------------------------------------

export const complianceChecks = pgTable("compliance_checks", {
  id: uuid("id").primaryKey().defaultRandom(),
  senderAddress: varchar("sender_address", { length: 128 }).notNull(),
  receiverAddress: varchar("receiver_address", { length: 128 }).notNull(),
  senderAgentDid: varchar("sender_agent_did", { length: 256 }),
  receiverAgentDid: varchar("receiver_agent_did", { length: 256 }),
  amount: numeric("amount", { precision: 38, scale: 18 }).notNull(),
  asset: varchar("asset", { length: 10 }).notNull(),
  chain: varchar("chain", { length: 64 }).notNull(),
  protocol: varchar("protocol", { length: 20 }).notNull(),
  status: varchar("status", { length: 20 }).notNull(), // APPROVED, REJECTED, ESCALATED
  riskScore: smallint("risk_score").notNull(),
  checks: jsonb("checks").$type<Record<string, unknown>[]>().notNull(),
  totalDurationMs: integer("total_duration_ms"),
  apiKeyId: uuid("api_key_id").references(() => apiKeys.id),
  traceId: varchar("trace_id", { length: 64 }),
  parentTraceId: varchar("parent_trace_id", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("compliance_checks_api_key_created_idx").on(table.apiKeyId, table.createdAt),
  index("compliance_checks_sender_address_idx").on(table.senderAddress),
  index("compliance_checks_receiver_address_idx").on(table.receiverAddress),
  index("compliance_checks_trace_id_idx").on(table.traceId),
  index("compliance_checks_status_created_idx").on(table.status, table.createdAt),
  index("compliance_checks_sender_agent_did_idx").on(table.senderAgentDid),
]);

// ---------------------------------------------------------------------------
// Compliance Receipts
// ---------------------------------------------------------------------------

export const complianceReceipts = pgTable("compliance_receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  checkId: uuid("check_id")
    .notNull()
    .references(() => complianceChecks.id),
  receiptHash: varchar("receipt_hash", { length: 128 }).notNull().unique(),
  overallStatus: varchar("overall_status", { length: 20 }).notNull(),
  riskScore: smallint("risk_score").notNull(),
  travelRuleStatus: varchar("travel_rule_status", { length: 20 }),
  commitmentHash: varchar("commitment_hash", { length: 128 }),
  commitmentSalt: varchar("commitment_salt", { length: 128 }),
  easAttestationUid: varchar("eas_attestation_uid", { length: 128 }),
  ipfsCid: varchar("ipfs_cid", { length: 128 }),
  signature: text("signature").notNull(),
  checksPerformed: jsonb("checks_performed").$type<Record<string, unknown>[]>().notNull(),
  ttl: integer("ttl").notNull().default(300),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceHash: varchar("invoice_hash", { length: 128 }).unique(),
  ipfsCid: varchar("ipfs_cid", { length: 128 }),
  issuerAgentDid: varchar("issuer_agent_did", { length: 256 }).notNull(),
  recipientAgentDid: varchar("recipient_agent_did", { length: 256 }).notNull(),
  sellerWalletAddress: varchar("seller_wallet_address", { length: 128 }).notNull(),
  buyerWalletAddress: varchar("buyer_wallet_address", { length: 128 }).notNull(),
  currency: varchar("currency", { length: 10 }).notNull(),
  totalAmount: numeric("total_amount", { precision: 38, scale: 18 }).notNull(),
  state: varchar("state", { length: 20 }).notNull().default("DRAFT"),
  lineItems: jsonb("line_items").$type<Record<string, unknown>[]>().notNull(),
  paymentProtocol: varchar("payment_protocol", { length: 20 }),
  complianceReceiptId: uuid("compliance_receipt_id").references(() => complianceReceipts.id),
  onChainTxHash: varchar("on_chain_tx_hash", { length: 128 }),
  easAttestationUid: varchar("eas_attestation_uid", { length: 128 }),
  dueDate: timestamp("due_date", { withTimezone: true }),
  apiKeyId: uuid("api_key_id").references(() => apiKeys.id),
  traceId: varchar("trace_id", { length: 64 }),
  invoiceData: jsonb("invoice_data").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("invoices_state_idx").on(table.state),
  index("invoices_seller_wallet_address_idx").on(table.sellerWalletAddress),
  index("invoices_buyer_wallet_address_idx").on(table.buyerWalletAddress),
  index("invoices_trace_id_idx").on(table.traceId),
]);

// ---------------------------------------------------------------------------
// Regulatory Reports (SAR / CTR / TRAVEL_RULE)
// ---------------------------------------------------------------------------

export const reports = pgTable("reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: varchar("type", { length: 20 }).notNull(), // "SAR" | "CTR" | "TRAVEL_RULE"
  status: varchar("status", { length: 20 }).notNull().default("DRAFT"), // DRAFT, SUBMITTED, FILED, REJECTED
  priority: varchar("priority", { length: 10 }).notNull().default("NORMAL"), // LOW, NORMAL, HIGH, CRITICAL
  complianceCheckId: uuid("compliance_check_id").references(() => complianceChecks.id),
  agentDid: varchar("agent_did", { length: 256 }),
  triggerReason: text("trigger_reason").notNull(),
  reportData: jsonb("report_data").$type<Record<string, unknown>>().notNull(),
  filedAt: timestamp("filed_at", { withTimezone: true }),
  filingReference: varchar("filing_reference", { length: 128 }),
  reviewedBy: varchar("reviewed_by", { length: 256 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("reports_type_idx").on(table.type),
  index("reports_status_idx").on(table.status),
  index("reports_compliance_check_id_idx").on(table.complianceCheckId),
]);

// ---------------------------------------------------------------------------
// Escrows (outcome-based escrow state machine)
// ---------------------------------------------------------------------------

export const escrows = pgTable("escrows", {
  id: uuid("id").primaryKey().defaultRandom(),
  escrowType: varchar("escrow_type", { length: 20 }).notNull(), // "PAYMENT" | "SERVICE" | "MILESTONE"
  state: varchar("state", { length: 20 }).notNull().default("CREATED"), // CREATED, FUNDED, ACTIVE, COMPLETED, DISPUTED, REFUNDED, EXPIRED
  payerAgentDid: varchar("payer_agent_did", { length: 256 }).notNull(),
  payeeAgentDid: varchar("payee_agent_did", { length: 256 }).notNull(),
  payerWallet: varchar("payer_wallet", { length: 128 }).notNull(),
  payeeWallet: varchar("payee_wallet", { length: 128 }).notNull(),
  amount: numeric("amount", { precision: 38, scale: 18 }).notNull(),
  asset: varchar("asset", { length: 10 }).notNull(),
  chain: varchar("chain", { length: 64 }).notNull(),
  conditions: jsonb("conditions").$type<Record<string, unknown>>().notNull(),
  evaluatorAddress: varchar("evaluator_address", { length: 128 }),
  complianceReceiptId: uuid("compliance_receipt_id").references(() => complianceReceipts.id),
  traceId: varchar("trace_id", { length: 64 }),
  apiKeyId: uuid("api_key_id").references(() => apiKeys.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  fundedAt: timestamp("funded_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  disputedAt: timestamp("disputed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("escrows_state_idx").on(table.state),
  index("escrows_payer_wallet_idx").on(table.payerWallet),
  index("escrows_payee_wallet_idx").on(table.payeeWallet),
  index("escrows_trace_id_idx").on(table.traceId),
  index("escrows_api_key_id_idx").on(table.apiKeyId),
]);

// ---------------------------------------------------------------------------
// Disputes
// ---------------------------------------------------------------------------

export const disputes = pgTable("disputes", {
  id: uuid("id").primaryKey().defaultRandom(),
  escrowId: uuid("escrow_id").references(() => escrows.id),
  invoiceId: uuid("invoice_id").references(() => invoices.id),
  state: varchar("state", { length: 20 }).notNull().default("OPEN"), // OPEN, EVIDENCE, ARBITRATION, RESOLVED, CLOSED
  initiatorDid: varchar("initiator_did", { length: 256 }).notNull(),
  respondentDid: varchar("respondent_did", { length: 256 }).notNull(),
  reason: text("reason").notNull(),
  category: varchar("category", { length: 30 }).notNull(), // SERVICE_QUALITY, NON_DELIVERY, UNAUTHORIZED, OVERCHARGE, OTHER
  evidence: jsonb("evidence").$type<Record<string, unknown>[]>().notNull().default([]),
  resolution: jsonb("resolution").$type<Record<string, unknown>>(),
  resolvedBy: varchar("resolved_by", { length: 256 }),
  traceId: varchar("trace_id", { length: 64 }),
  apiKeyId: uuid("api_key_id").references(() => apiKeys.id),
  deadline: timestamp("deadline", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("disputes_state_idx").on(table.state),
  index("disputes_initiator_did_idx").on(table.initiatorDid),
  index("disputes_respondent_did_idx").on(table.respondentDid),
  index("disputes_escrow_id_idx").on(table.escrowId),
  index("disputes_invoice_id_idx").on(table.invoiceId),
  index("disputes_api_key_id_idx").on(table.apiKeyId),
]);

// ---------------------------------------------------------------------------
// Payment Streams (event-driven streaming payments)
// ---------------------------------------------------------------------------

export const paymentStreams = pgTable("payment_streams", {
  id: uuid("id").primaryKey().defaultRandom(),
  payerDid: varchar("payer_did", { length: 256 }).notNull(),
  payeeDid: varchar("payee_did", { length: 256 }).notNull(),
  model: varchar("model", { length: 20 }).notNull(), // PER_REQUEST, PER_SECOND, PER_TOKEN, PER_RESULT, MILESTONE
  ratePerUnit: numeric("rate_per_unit", { precision: 38, scale: 18 }).notNull(),
  unit: varchar("unit", { length: 64 }).notNull(),
  totalBudget: numeric("total_budget", { precision: 38, scale: 18 }).notNull(),
  spent: numeric("spent", { precision: 38, scale: 18 }).notNull().default("0"),
  status: varchar("status", { length: 20 }).notNull().default("ACTIVE"), // ACTIVE, PAUSED, SETTLED, EXHAUSTED
  traceId: varchar("trace_id", { length: 64 }),
  apiKeyId: uuid("api_key_id").references(() => apiKeys.id),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("payment_streams_status_idx").on(table.status),
  index("payment_streams_payer_did_idx").on(table.payerDid),
  index("payment_streams_payee_did_idx").on(table.payeeDid),
  index("payment_streams_model_idx").on(table.model),
  index("payment_streams_trace_id_idx").on(table.traceId),
  index("payment_streams_api_key_id_idx").on(table.apiKeyId),
]);

// ---------------------------------------------------------------------------
// Usage Records (metered billing)
// ---------------------------------------------------------------------------

export const usageRecords = pgTable("usage_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentDid: varchar("agent_did", { length: 256 }).notNull(),
  action: varchar("action", { length: 50 }).notNull(), // compliance_check, screen, invoice, escrow, dispute
  amountUsd: numeric("amount_usd", { precision: 18, scale: 8 }).notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  traceId: varchar("trace_id", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("usage_records_agent_did_idx").on(table.agentDid),
  index("usage_records_action_idx").on(table.action),
  index("usage_records_created_at_idx").on(table.createdAt),
]);

// ---------------------------------------------------------------------------
// Agent Policies (cross-chain policy synchronization)
// ---------------------------------------------------------------------------

export const agentPolicies = pgTable("agent_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentDid: varchar("agent_did", { length: 256 }).notNull().unique(),
  policy: jsonb("policy").$type<Record<string, unknown>>().notNull(),
  version: integer("version").notNull().default(1),
  syncStatus: jsonb("sync_status").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("agent_policies_agent_did_idx").on(table.agentDid),
]);

// ---------------------------------------------------------------------------
// Sagas (multi-step payment workflow orchestration)
// ---------------------------------------------------------------------------

export const sagas = pgTable("sagas", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 256 }).notNull(),
  steps: jsonb("steps").$type<Record<string, unknown>[]>().notNull(),
  status: varchar("status", { length: 20 }).notNull().default("PENDING"), // PENDING, RUNNING, COMPLETED, COMPENSATING, COMPENSATED, FAILED
  currentStep: integer("current_step").notNull().default(0),
  traceId: varchar("trace_id", { length: 64 }).notNull(),
  apiKeyId: uuid("api_key_id").references(() => apiKeys.id),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  index("sagas_status_idx").on(table.status),
  index("sagas_trace_id_idx").on(table.traceId),
  index("sagas_api_key_id_idx").on(table.apiKeyId),
]);

// ---------------------------------------------------------------------------
// Audit Log (append-only with hash chain)
// ---------------------------------------------------------------------------

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  logHash: varchar("log_hash", { length: 128 }).notNull(),
  previousLogHash: varchar("previous_log_hash", { length: 128 }).notNull(),
  eventType: varchar("event_type", { length: 50 }).notNull(),
  receiptId: uuid("receipt_id").references(() => complianceReceipts.id),
  invoiceId: uuid("invoice_id").references(() => invoices.id),
  agentDid: varchar("agent_did", { length: 256 }),
  apiKeyId: uuid("api_key_id").references(() => apiKeys.id),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("audit_log_event_type_created_idx").on(table.eventType, table.createdAt),
  index("audit_log_agent_did_idx").on(table.agentDid),
]);

// ---------------------------------------------------------------------------
// Type exports for select/insert
// ---------------------------------------------------------------------------

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;

export type ComplianceCheck = typeof complianceChecks.$inferSelect;
export type NewComplianceCheck = typeof complianceChecks.$inferInsert;

export type ComplianceReceiptRow = typeof complianceReceipts.$inferSelect;
export type NewComplianceReceipt = typeof complianceReceipts.$inferInsert;

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;

export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;

export type Escrow = typeof escrows.$inferSelect;
export type NewEscrow = typeof escrows.$inferInsert;

export type Dispute = typeof disputes.$inferSelect;
export type NewDispute = typeof disputes.$inferInsert;

export type UsageRecord = typeof usageRecords.$inferSelect;
export type NewUsageRecord = typeof usageRecords.$inferInsert;

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;

export type AgentPolicyRow = typeof agentPolicies.$inferSelect;
export type NewAgentPolicy = typeof agentPolicies.$inferInsert;

export type PaymentStream = typeof paymentStreams.$inferSelect;
export type NewPaymentStream = typeof paymentStreams.$inferInsert;

export type Saga = typeof sagas.$inferSelect;
export type NewSaga = typeof sagas.$inferInsert;
