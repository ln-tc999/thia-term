// ---------------------------------------------------------------------------
// Compliance Policy Engine
// ---------------------------------------------------------------------------

import type { ComplianceRequest } from "../engine/prooflink.js";
import type {
  PolicyConfig,
  PolicyEvaluation,
  PolicyRule,
  RuleCombination,
  RuleEvaluationResult,
} from "./types.js";

/**
 * Composable, configurable compliance policy engine.
 *
 * Evaluates an ordered set of {@link PolicyRule}s against an incoming
 * {@link ComplianceRequest} and produces an aggregate {@link PolicyEvaluation}.
 *
 * Multiple policies can be chained by creating separate engine instances
 * or by merging rules into a single {@link PolicyConfig}.
 */
export class CompliancePolicyEngine {
  private readonly policies: PolicyConfig[] = [];

  // -----------------------------------------------------------------------
  // Policy management
  // -----------------------------------------------------------------------

  /** Register a policy configuration. */
  addPolicy(policy: PolicyConfig): this {
    this.policies.push(policy);
    return this;
  }

  /** Remove a policy by its ID. Returns `true` if found and removed. */
  removePolicy(policyId: string): boolean {
    const idx = this.policies.findIndex((p) => p.id === policyId);
    if (idx === -1) return false;
    this.policies.splice(idx, 1);
    return true;
  }

  /** Replace an existing policy (matched by `id`). Throws if not found. */
  replacePolicy(policy: PolicyConfig): this {
    const idx = this.policies.findIndex((p) => p.id === policy.id);
    if (idx === -1) {
      throw new Error(`Policy "${policy.id}" not found — cannot replace`);
    }
    this.policies[idx] = policy;
    return this;
  }

  /** Return a snapshot of all registered policies. */
  getPolicies(): readonly PolicyConfig[] {
    return [...this.policies];
  }

  /** Get a single policy by ID. */
  getPolicy(policyId: string): PolicyConfig | undefined {
    return this.policies.find((p) => p.id === policyId);
  }

  // -----------------------------------------------------------------------
  // Evaluation
  // -----------------------------------------------------------------------

  /**
   * Evaluate a single policy against a compliance request.
   *
   * Rules are sorted by priority (ascending) and evaluated in order.
   * The `combination` strategy determines how individual results are
   * aggregated:
   *
   * - **AND**: all enabled rules must pass.
   * - **OR**: at least one enabled rule must pass.
   */
  async evaluatePolicy(
    policyId: string,
    request: ComplianceRequest,
  ): Promise<PolicyEvaluation> {
    const policy = this.policies.find((p) => p.id === policyId);
    if (!policy) {
      throw new Error(`Policy "${policyId}" not found`);
    }

    if (!policy.enabled) {
      return this.buildSkippedEvaluation(policy);
    }

    return this.runEvaluation(policy, request);
  }

  /**
   * Evaluate **all** enabled policies against a compliance request.
   *
   * Returns evaluations for every registered policy. The overall result
   * is `passed` only if every individual policy passes (implicit AND
   * across policies).
   */
  async evaluateAll(request: ComplianceRequest): Promise<{
    readonly passed: boolean;
    readonly evaluations: readonly PolicyEvaluation[];
  }> {
    const evaluations: PolicyEvaluation[] = [];

    for (const policy of this.policies) {
      if (!policy.enabled) {
        evaluations.push(this.buildSkippedEvaluation(policy));
        continue;
      }
      evaluations.push(await this.runEvaluation(policy, request));
    }

    const passed = evaluations.every((e) => e.passed);
    return { passed, evaluations };
  }

  // -----------------------------------------------------------------------
  // Static helpers
  // -----------------------------------------------------------------------

  /**
   * Build a {@link PolicyConfig} from a set of rules and options.
   * Convenience factory for creating policy configs inline.
   */
  static createPolicy(opts: {
    id: string;
    name: string;
    description?: string;
    combination?: RuleCombination;
    rules: PolicyRule[];
    enabled?: boolean;
    version?: string;
  }): PolicyConfig {
    return {
      id: opts.id,
      name: opts.name,
      description: opts.description ?? "",
      combination: opts.combination ?? "AND",
      rules: opts.rules,
      enabled: opts.enabled ?? true,
      version: opts.version,
    };
  }

  /**
   * Merge multiple policies into a single policy.
   *
   * Rules from all source policies are concatenated and re-sorted by
   * priority. The resulting policy uses the given combination strategy.
   */
  static mergePolicies(
    id: string,
    name: string,
    combination: RuleCombination,
    ...policies: PolicyConfig[]
  ): PolicyConfig {
    const allRules: PolicyRule[] = [];
    for (const p of policies) {
      allRules.push(...p.rules);
    }

    return CompliancePolicyEngine.createPolicy({
      id,
      name,
      description: `Merged from: ${policies.map((p) => p.id).join(", ")}`,
      combination,
      rules: allRules,
      enabled: true,
    });
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private async runEvaluation(
    policy: PolicyConfig,
    request: ComplianceRequest,
  ): Promise<PolicyEvaluation> {
    const start = Date.now();
    const sortedRules = [...policy.rules]
      .filter((r) => r.enabled)
      .sort((a, b) => a.priority - b.priority);

    const results: RuleEvaluationResult[] = [];

    for (const rule of sortedRules) {
      const result = await rule.evaluate(request);
      results.push(result);

      // Short-circuit: for AND, stop on first failure; for OR, stop on first pass
      if (policy.combination === "AND" && !result.passed) break;
      if (policy.combination === "OR" && result.passed) break;
    }

    const passed = this.aggregate(policy.combination, results);

    return {
      passed,
      results,
      combination: policy.combination,
      policyId: policy.id,
      evaluatedAt: new Date().toISOString(),
      latencyMs: Date.now() - start,
    };
  }

  private aggregate(
    combination: RuleCombination,
    results: readonly RuleEvaluationResult[],
  ): boolean {
    if (results.length === 0) return true;

    if (combination === "AND") {
      return results.every((r) => r.passed);
    }
    // OR
    return results.some((r) => r.passed);
  }

  private buildSkippedEvaluation(policy: PolicyConfig): PolicyEvaluation {
    return {
      passed: true,
      results: [],
      combination: policy.combination,
      policyId: policy.id,
      evaluatedAt: new Date().toISOString(),
      latencyMs: 0,
    };
  }
}
