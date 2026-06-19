// ---------------------------------------------------------------------------
// Policy Engine Types
// ---------------------------------------------------------------------------

import type { ComplianceRequest } from "../engine/prooflink.js";

// ---------------------------------------------------------------------------
// Rule Types
// ---------------------------------------------------------------------------

/** Supported rule type discriminators. */
export type PolicyRuleType =
  | "threshold"
  | "jurisdiction"
  | "asset"
  | "time_window"
  | "velocity"
  | "custom";

/** How to combine multiple rules within a policy. */
export type RuleCombination = "AND" | "OR";

/** Outcome of evaluating a single rule. */
export interface RuleEvaluationResult {
  readonly ruleId: string;
  readonly ruleType: PolicyRuleType;
  readonly passed: boolean;
  readonly reason: string;
  /** Optional metadata attached by the rule. */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Base interface every policy rule must implement.
 *
 * Rules are evaluated in priority order (lower number = higher priority).
 * A rule returns a `RuleEvaluationResult` that the engine aggregates
 * according to the policy's `combination` strategy.
 */
export interface PolicyRule {
  /** Unique identifier for this rule instance. */
  readonly id: string;
  /** Human-readable description. */
  readonly description: string;
  /** Discriminator for the rule type. */
  readonly type: PolicyRuleType;
  /** Lower number = evaluated first. Default: 100. */
  readonly priority: number;
  /** Whether the rule is active. Inactive rules are skipped. */
  readonly enabled: boolean;
  /** Evaluate the rule against an incoming compliance request. */
  evaluate(request: ComplianceRequest): RuleEvaluationResult | Promise<RuleEvaluationResult>;
}

// ---------------------------------------------------------------------------
// Policy Evaluation
// ---------------------------------------------------------------------------

/** Aggregate result after evaluating all rules in a policy. */
export interface PolicyEvaluation {
  /** Overall pass/fail. */
  readonly passed: boolean;
  /** Per-rule results in evaluation order. */
  readonly results: readonly RuleEvaluationResult[];
  /** Which combination strategy was used. */
  readonly combination: RuleCombination;
  /** Policy ID that was evaluated. */
  readonly policyId: string;
  /** ISO-8601 timestamp of evaluation. */
  readonly evaluatedAt: string;
  /** Wall-clock evaluation time in ms. */
  readonly latencyMs: number;
}

// ---------------------------------------------------------------------------
// Policy Configuration
// ---------------------------------------------------------------------------

/** Serialisable policy configuration. */
export interface PolicyConfig {
  /** Unique policy identifier. */
  readonly id: string;
  /** Human-readable name (e.g. "GENIUS Act Policy"). */
  readonly name: string;
  /** Description of what this policy enforces. */
  readonly description: string;
  /** How to combine rule outcomes. Default: "AND". */
  readonly combination: RuleCombination;
  /** Ordered list of rules. */
  readonly rules: readonly PolicyRule[];
  /** Whether the entire policy is active. */
  readonly enabled: boolean;
  /** Optional version string for auditing. */
  readonly version?: string;
}
