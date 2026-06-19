// ---------------------------------------------------------------------------
// Risk Assessment Module — @prooflink/core
// ---------------------------------------------------------------------------

// Risk Factors Registry
export { RiskFactorRegistry, BUILT_IN_FACTORS } from "./factors.js";
export {
  velocityFactor,
  amountFactor,
  destinationFactor,
  timeOfDayFactor,
  crossChainFactor,
} from "./factors.js";
export type {
  RiskFactor,
  RiskFactorContext,
  RiskFactorResult,
} from "./factors.js";

// Structuring Detection
export { StructuringDetector } from "./structuring.js";
export type {
  StructuringTransaction,
  StructuringAlert,
  StructuringPattern,
  StructuringDetectorConfig,
} from "./structuring.js";

// Address Risk Profile
export { AddressRiskProfile } from "./profile.js";
export type {
  ProfileTransaction,
  TransactionDirection,
  RiskTrend,
  RiskProfileSnapshot,
  RiskProfileConfig,
} from "./profile.js";

// Risk Assessment Report
export { RiskAssessmentReport } from "./report.js";
export type {
  RiskLevel,
  RiskRecommendation,
  RiskReportJSON,
  RiskReportInput,
} from "./report.js";
