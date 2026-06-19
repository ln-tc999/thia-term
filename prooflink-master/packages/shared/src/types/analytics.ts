import { z } from "zod";

// ---------------------------------------------------------------------------
// Time Period
// ---------------------------------------------------------------------------

export const TimePeriod = z.enum([
  "1h",
  "24h",
  "7d",
  "30d",
  "90d",
  "1y",
  "all",
]);
export type TimePeriod = z.infer<typeof TimePeriod>;

// ---------------------------------------------------------------------------
// Volume Stats
// ---------------------------------------------------------------------------

export const VolumeStats = z.object({
  period: TimePeriod,
  totalTransactions: z.number().int().nonnegative(),
  totalVolumeUsd: z.number().nonnegative(),
  averageTransactionUsd: z.number().nonnegative(),
  uniqueSenders: z.number().int().nonnegative(),
  uniqueReceivers: z.number().int().nonnegative(),
  byChain: z.record(
    z.string(),
    z.object({
      transactions: z.number().int().nonnegative(),
      volumeUsd: z.number().nonnegative(),
    }),
  ),
  byToken: z.record(
    z.string(),
    z.object({
      transactions: z.number().int().nonnegative(),
      volumeUsd: z.number().nonnegative(),
    }),
  ),
  computedAt: z.string().datetime(),
});
export type VolumeStats = z.infer<typeof VolumeStats>;

// ---------------------------------------------------------------------------
// Risk Distribution
// ---------------------------------------------------------------------------

export const RiskBucket = z.object({
  rangeMin: z.number().int().min(0).max(100),
  rangeMax: z.number().int().min(0).max(100),
  label: z.enum(["low", "medium", "high", "critical"]),
  count: z.number().int().nonnegative(),
  percentage: z.number().min(0).max(100),
});
export type RiskBucket = z.infer<typeof RiskBucket>;

export const RiskDistribution = z.object({
  period: TimePeriod,
  totalScreened: z.number().int().nonnegative(),
  averageRiskScore: z.number().min(0).max(100),
  buckets: z.array(RiskBucket),
  sanctionsMatches: z.number().int().nonnegative(),
  escalations: z.number().int().nonnegative(),
  rejections: z.number().int().nonnegative(),
  computedAt: z.string().datetime(),
});
export type RiskDistribution = z.infer<typeof RiskDistribution>;

// ---------------------------------------------------------------------------
// Compliance Breakdown
// ---------------------------------------------------------------------------

export const ComplianceBreakdown = z.object({
  period: TimePeriod,
  totalChecks: z.number().int().nonnegative(),
  byCheckType: z.record(
    z.string(),
    z.object({
      passed: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      skipped: z.number().int().nonnegative(),
    }),
  ),
  travelRule: z.object({
    required: z.number().int().nonnegative(),
    transmitted: z.number().int().nonnegative(),
    acknowledged: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  kyaVerifications: z.object({
    total: z.number().int().nonnegative(),
    verified: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  averageLatencyMs: z.number().nonnegative(),
  computedAt: z.string().datetime(),
});
export type ComplianceBreakdown = z.infer<typeof ComplianceBreakdown>;

// ---------------------------------------------------------------------------
// Analytics Dashboard (aggregate)
// ---------------------------------------------------------------------------

export const AnalyticsDashboard = z.object({
  volume: VolumeStats,
  risk: RiskDistribution,
  compliance: ComplianceBreakdown,
});
export type AnalyticsDashboard = z.infer<typeof AnalyticsDashboard>;
