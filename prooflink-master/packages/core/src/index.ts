// ---------------------------------------------------------------------------
// @prooflink/core — ProofLink Compliance Decision Engine
// ---------------------------------------------------------------------------

// Engine
export { ProofLinkEngine } from "./engine/prooflink.js";
export type { ComplianceRequest } from "./engine/prooflink.js";

// Events
export { TypedEventEmitter } from "./events/emitter.js";
export type {
  ProofLinkEvents,
  ProofLinkEventName,
  ProofLinkEventListener,
} from "./events/emitter.js";

// Sanctions
export {
  SanctionsScreener,
  SanctionsScreeningError,
  ChainalysisProvider,
  TRMLabsProvider,
} from "./sanctions/screener.js";
export type {
  SanctionsProvider,
  SanctionsProviderResult,
  ProviderHealthStatus,
} from "./sanctions/screener.js";
export {
  isKnownSanctionedAddress,
  getAllKnownSanctionedAddresses,
  OFAC_SDN_ETH_ADDRESSES,
  OFAC_SDN_BTC_ADDRESSES,
} from "./sanctions/lists.js";

// AML
export { AMLScorer } from "./aml/scorer.js";
export type { TransactionContext, ScoringRule } from "./aml/scorer.js";

// Travel Rule
export {
  TravelRuleChecker,
  NotabeneProvider,
  MockNotabeneProvider,
} from "./travel-rule/checker.js";
export type {
  TravelRuleResult,
  TravelRuleProvider,
  IVMS101Message,
  IVMS101NameIdentifier,
} from "./travel-rule/checker.js";

// Identity (KYA)
export { KYAVerifier } from "./identity/kya-verifier.js";
export type {
  VerifiableCredential,
  KYACredentialSubject,
  DelegationScope,
  KYAVerificationResult,
} from "./identity/kya-verifier.js";

// Receipts
export { ReceiptIssuer, generateReceiptId } from "./receipts/issuer.js";
export {
  InMemoryStorage,
  FileStorage,
} from "./receipts/storage.js";
export type {
  ReceiptStorage,
  ReceiptListOptions,
} from "./receipts/storage.js";

// Telemetry
export { ComplianceMetrics } from "./telemetry/metrics.js";
export type {
  MetricsSnapshot,
  MetricReporter,
} from "./telemetry/metrics.js";

// Plugins
export { PluginManager } from "./plugins/index.js";
export type {
  ProofLinkPlugin,
  PluginContext,
  PluginDecisionContext,
} from "./plugins/index.js";

// Config
export { loadConfig, ProofLinkConfigSchema } from "./config.js";
export type { ProofLinkConfig } from "./config.js";

// Webhooks
export { WebhookManager } from "./webhooks/manager.js";
export type { WebhookManagerOptions } from "./webhooks/manager.js";
export {
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_EVENT_DESCRIPTIONS,
  isValidEventType,
} from "./webhooks/events.js";
export type { WebhookEventType } from "./webhooks/events.js";
export type {
  WebhookEvent,
  WebhookConfig,
  WebhookDelivery,
  WebhookDeliveryRecord,
} from "./webhooks/types.js";

// Policy Engine
export { CompliancePolicyEngine } from "./policy/engine.js";
export {
  ThresholdRule,
  JurisdictionRule,
  AssetRule,
  TimeWindowRule,
  VelocityRule,
  CustomRule,
} from "./policy/rules.js";
export type {
  ThresholdRuleConfig,
  JurisdictionRuleConfig,
  AssetRuleConfig,
  TimeWindowRuleConfig,
  VelocityRuleConfig,
  CustomRuleConfig,
} from "./policy/rules.js";
export type {
  PolicyRule,
  PolicyRuleType,
  RuleCombination,
  RuleEvaluationResult,
  PolicyEvaluation,
  PolicyConfig,
} from "./policy/types.js";
export {
  GENIUS_ACT_POLICY,
  MICA_POLICY,
  FATF_TRAVEL_RULE_POLICY,
  CONSERVATIVE_POLICY,
  PERMISSIVE_POLICY,
} from "./policy/defaults.js";

// Health
export {
  HealthChecker,
  httpCheck,
  customCheck,
} from "./health/checker.js";
export type {
  HealthCheck,
  HealthCheckResult,
  HealthCheckerOptions,
  HealthStatus,
} from "./health/checker.js";
export { SystemMonitor } from "./health/monitor.js";
export type {
  MemorySnapshot,
  SystemSnapshot,
  SystemMonitorEvents,
  SystemMonitorOptions,
} from "./health/monitor.js";

// Prometheus
export { PrometheusExporter } from "./telemetry/prometheus.js";

// Risk Assessment
export {
  RiskFactorRegistry,
  BUILT_IN_FACTORS,
  velocityFactor,
  amountFactor,
  destinationFactor,
  timeOfDayFactor,
  crossChainFactor,
} from "./risk/index.js";
export type {
  RiskFactor,
  RiskFactorContext,
  RiskFactorResult,
} from "./risk/index.js";
export { StructuringDetector } from "./risk/index.js";
export type {
  StructuringTransaction,
  StructuringAlert,
  StructuringPattern,
  StructuringDetectorConfig,
} from "./risk/index.js";
export { AddressRiskProfile } from "./risk/index.js";
export type {
  ProfileTransaction,
  TransactionDirection,
  RiskTrend,
  RiskProfileSnapshot,
  RiskProfileConfig,
} from "./risk/index.js";
export { RiskAssessmentReport } from "./risk/index.js";
export type {
  RiskLevel,
  RiskRecommendation,
  RiskReportJSON,
  RiskReportInput,
} from "./risk/index.js";

// Cache
export { LRUCache } from "./cache.js";
