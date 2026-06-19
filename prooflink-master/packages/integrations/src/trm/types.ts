// ---------------------------------------------------------------------------
// TRM Labs AML — API types
// ---------------------------------------------------------------------------

/** Configuration for the TRM Labs API client. */
export interface TRMConfig {
  /** TRM Labs API key */
  apiKey: string;
  /** Base URL for TRM Labs API */
  baseUrl?: string;
  /** Request timeout in milliseconds (default: 10_000) */
  timeoutMs?: number;
}

/** Risk category as classified by TRM Labs. */
export type TRMRiskCategory =
  | "sanctions"
  | "terrorism_financing"
  | "severe_risk"
  | "high_risk"
  | "medium_risk"
  | "low_risk"
  | "no_risk"
  | "unknown";

/** Individual risk indicator from TRM analysis. */
export interface TRMRiskIndicator {
  category: string;
  categoryRiskScoreLevel: number;
  incomingVolumeUsd: string;
  outgoingVolumeUsd: string;
  totalVolumeUsd: string;
  riskType: string;
}

/** Address ownership information from TRM. */
export interface TRMAddressOwner {
  name: string;
  url?: string;
  type: string;
  subtype?: string;
}

/** Single address screening result from TRM. */
export interface TRMScreeningResult {
  address: string;
  chain: string;
  /** Overall risk score 0-100 */
  riskScore: number;
  riskCategory: TRMRiskCategory;
  /** Whether this address appears on any sanctions list */
  isSanctioned: boolean;
  riskIndicators: TRMRiskIndicator[];
  addressOwners: TRMAddressOwner[];
  screenedAt: string;
}

/** Full address report with detailed exposure analysis. */
export interface TRMAddressReport {
  address: string;
  chain: string;
  riskScore: number;
  riskCategory: TRMRiskCategory;
  isSanctioned: boolean;
  riskIndicators: TRMRiskIndicator[];
  addressOwners: TRMAddressOwner[];
  /** Counterparty exposure breakdown */
  counterpartyExposure: {
    category: string;
    inboundUsd: string;
    outboundUsd: string;
  }[];
  /** Volume statistics */
  volumeStats: {
    totalInboundUsd: string;
    totalOutboundUsd: string;
    transactionCount: number;
    firstSeen: string;
    lastSeen: string;
  };
  generatedAt: string;
}

/** Shape of errors returned by TRM Labs API. */
export interface TRMApiError {
  statusCode: number;
  message: string;
  details?: string;
}
