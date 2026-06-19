// ---------------------------------------------------------------------------
// Built-in Policy Rules
// ---------------------------------------------------------------------------

import type { ComplianceRequest } from "../engine/prooflink.js";
import type { PolicyRule, PolicyRuleType, RuleEvaluationResult } from "./types.js";

// ---------------------------------------------------------------------------
// ThresholdRule
// ---------------------------------------------------------------------------

export interface ThresholdRuleConfig {
  readonly id?: string;
  readonly description?: string;
  readonly priority?: number;
  readonly enabled?: boolean;
  /** "above" blocks amounts >= threshold; "below" blocks amounts <= threshold. */
  readonly direction: "above" | "below";
  readonly thresholdUsd: number;
}

export class ThresholdRule implements PolicyRule {
  readonly id: string;
  readonly description: string;
  readonly type: PolicyRuleType = "threshold";
  readonly priority: number;
  readonly enabled: boolean;
  private readonly direction: "above" | "below";
  private readonly thresholdUsd: number;

  constructor(config: ThresholdRuleConfig) {
    this.id = config.id ?? `threshold-${config.direction}-${config.thresholdUsd}`;
    this.description =
      config.description ??
      `Block transactions ${config.direction} $${config.thresholdUsd}`;
    this.priority = config.priority ?? 100;
    this.enabled = config.enabled ?? true;
    this.direction = config.direction;
    this.thresholdUsd = config.thresholdUsd;
  }

  evaluate(request: ComplianceRequest): RuleEvaluationResult {
    const blocked =
      this.direction === "above"
        ? request.amountUsd >= this.thresholdUsd
        : request.amountUsd <= this.thresholdUsd;

    return {
      ruleId: this.id,
      ruleType: this.type,
      passed: !blocked,
      reason: blocked
        ? `Amount $${request.amountUsd} is ${this.direction} threshold $${this.thresholdUsd}`
        : `Amount $${request.amountUsd} within threshold`,
      metadata: { amountUsd: request.amountUsd, thresholdUsd: this.thresholdUsd },
    };
  }
}

// ---------------------------------------------------------------------------
// JurisdictionRule
// ---------------------------------------------------------------------------

export interface JurisdictionRuleConfig {
  readonly id?: string;
  readonly description?: string;
  readonly priority?: number;
  readonly enabled?: boolean;
  /** "allow" = only listed jurisdictions pass; "deny" = listed jurisdictions fail. */
  readonly mode: "allow" | "deny";
  /** ISO 3166-1 alpha-2 codes. */
  readonly jurisdictions: readonly string[];
}

export class JurisdictionRule implements PolicyRule {
  readonly id: string;
  readonly description: string;
  readonly type: PolicyRuleType = "jurisdiction";
  readonly priority: number;
  readonly enabled: boolean;
  private readonly mode: "allow" | "deny";
  private readonly jurisdictions: ReadonlySet<string>;

  constructor(config: JurisdictionRuleConfig) {
    this.id = config.id ?? `jurisdiction-${config.mode}`;
    this.description =
      config.description ??
      `${config.mode === "allow" ? "Allow" : "Deny"} jurisdictions: ${config.jurisdictions.join(", ")}`;
    this.priority = config.priority ?? 90;
    this.enabled = config.enabled ?? true;
    this.mode = config.mode;
    this.jurisdictions = new Set(config.jurisdictions.map((j) => j.toUpperCase()));
  }

  evaluate(request: ComplianceRequest): RuleEvaluationResult {
    const relevantJurisdictions: string[] = [];
    if (request.senderJurisdiction) relevantJurisdictions.push(request.senderJurisdiction.toUpperCase());
    if (request.receiverJurisdiction) relevantJurisdictions.push(request.receiverJurisdiction.toUpperCase());

    // If no jurisdiction info, pass (cannot evaluate).
    if (relevantJurisdictions.length === 0) {
      return {
        ruleId: this.id,
        ruleType: this.type,
        passed: true,
        reason: "No jurisdiction information provided; skipping",
      };
    }

    if (this.mode === "deny") {
      const denied = relevantJurisdictions.filter((j) => this.jurisdictions.has(j));
      const passed = denied.length === 0;
      return {
        ruleId: this.id,
        ruleType: this.type,
        passed,
        reason: passed
          ? "No denied jurisdictions matched"
          : `Denied jurisdiction(s): ${denied.join(", ")}`,
        metadata: { denied },
      };
    }

    // mode === "allow"
    const notAllowed = relevantJurisdictions.filter((j) => !this.jurisdictions.has(j));
    const passed = notAllowed.length === 0;
    return {
      ruleId: this.id,
      ruleType: this.type,
      passed,
      reason: passed
        ? "All jurisdictions are allowed"
        : `Jurisdiction(s) not in allow-list: ${notAllowed.join(", ")}`,
      metadata: { notAllowed },
    };
  }
}

// ---------------------------------------------------------------------------
// AssetRule
// ---------------------------------------------------------------------------

export interface AssetRuleConfig {
  readonly id?: string;
  readonly description?: string;
  readonly priority?: number;
  readonly enabled?: boolean;
  /** "allow" = only listed assets pass; "deny" = listed assets fail. */
  readonly mode: "allow" | "deny";
  readonly assets: readonly string[];
}

export class AssetRule implements PolicyRule {
  readonly id: string;
  readonly description: string;
  readonly type: PolicyRuleType = "asset";
  readonly priority: number;
  readonly enabled: boolean;
  private readonly mode: "allow" | "deny";
  private readonly assets: ReadonlySet<string>;

  constructor(config: AssetRuleConfig) {
    this.id = config.id ?? `asset-${config.mode}`;
    this.description =
      config.description ?? `${config.mode === "allow" ? "Allow" : "Deny"} assets: ${config.assets.join(", ")}`;
    this.priority = config.priority ?? 100;
    this.enabled = config.enabled ?? true;
    this.mode = config.mode;
    this.assets = new Set(config.assets.map((a) => a.toUpperCase()));
  }

  evaluate(request: ComplianceRequest): RuleEvaluationResult {
    const asset = request.asset.toUpperCase();

    if (this.mode === "deny") {
      const blocked = this.assets.has(asset);
      return {
        ruleId: this.id,
        ruleType: this.type,
        passed: !blocked,
        reason: blocked ? `Asset ${asset} is denied` : `Asset ${asset} is not denied`,
        metadata: { asset },
      };
    }

    const allowed = this.assets.has(asset);
    return {
      ruleId: this.id,
      ruleType: this.type,
      passed: allowed,
      reason: allowed ? `Asset ${asset} is allowed` : `Asset ${asset} is not in allow-list`,
      metadata: { asset },
    };
  }
}

// ---------------------------------------------------------------------------
// TimeWindowRule
// ---------------------------------------------------------------------------

export interface TimeWindowRuleConfig {
  readonly id?: string;
  readonly description?: string;
  readonly priority?: number;
  readonly enabled?: boolean;
  /** Start hour in UTC (0-23). */
  readonly startHourUtc: number;
  /** End hour in UTC (0-23). Window wraps at midnight if end < start. */
  readonly endHourUtc: number;
  /** Days of week allowed (0=Sunday, 6=Saturday). Default: Mon-Fri [1..5]. */
  readonly allowedDays?: readonly number[];
}

export class TimeWindowRule implements PolicyRule {
  readonly id: string;
  readonly description: string;
  readonly type: PolicyRuleType = "time_window";
  readonly priority: number;
  readonly enabled: boolean;
  private readonly startHour: number;
  private readonly endHour: number;
  private readonly allowedDays: ReadonlySet<number>;

  constructor(config: TimeWindowRuleConfig) {
    this.id = config.id ?? "time-window";
    this.description =
      config.description ??
      `Allow transactions ${config.startHourUtc}:00-${config.endHourUtc}:00 UTC`;
    this.priority = config.priority ?? 200;
    this.enabled = config.enabled ?? true;
    this.startHour = config.startHourUtc;
    this.endHour = config.endHourUtc;
    this.allowedDays = new Set(config.allowedDays ?? [1, 2, 3, 4, 5]);
  }

  evaluate(_request: ComplianceRequest): RuleEvaluationResult {
    const now = new Date();
    const hour = now.getUTCHours();
    const day = now.getUTCDay();

    const dayAllowed = this.allowedDays.has(day);

    let hourAllowed: boolean;
    if (this.startHour <= this.endHour) {
      hourAllowed = hour >= this.startHour && hour < this.endHour;
    } else {
      // Wraps midnight: e.g. 22:00 - 06:00
      hourAllowed = hour >= this.startHour || hour < this.endHour;
    }

    const passed = dayAllowed && hourAllowed;
    return {
      ruleId: this.id,
      ruleType: this.type,
      passed,
      reason: passed
        ? `Transaction within allowed window (day=${day}, hour=${hour} UTC)`
        : `Transaction outside allowed window (day=${day}, hour=${hour} UTC)`,
      metadata: { day, hour, dayAllowed, hourAllowed },
    };
  }
}

// ---------------------------------------------------------------------------
// VelocityRule
// ---------------------------------------------------------------------------

interface VelocityEntry {
  readonly amountUsd: number;
  readonly timestamp: number;
}

export interface VelocityRuleConfig {
  readonly id?: string;
  readonly description?: string;
  readonly priority?: number;
  readonly enabled?: boolean;
  /** Maximum number of transactions per window. */
  readonly maxTransactions: number;
  /** Maximum cumulative USD amount per window. */
  readonly maxAmountUsd: number;
  /** Window duration in milliseconds. */
  readonly windowMs: number;
}

export class VelocityRule implements PolicyRule {
  readonly id: string;
  readonly description: string;
  readonly type: PolicyRuleType = "velocity";
  readonly priority: number;
  readonly enabled: boolean;
  private readonly maxTransactions: number;
  private readonly maxAmountUsd: number;
  private readonly windowMs: number;
  /** In-memory ledger keyed by sender address. */
  private readonly ledger = new Map<string, VelocityEntry[]>();

  constructor(config: VelocityRuleConfig) {
    this.id = config.id ?? "velocity";
    this.description =
      config.description ??
      `Max ${config.maxTransactions} txns / $${config.maxAmountUsd} per ${config.windowMs}ms`;
    this.priority = config.priority ?? 80;
    this.enabled = config.enabled ?? true;
    this.maxTransactions = config.maxTransactions;
    this.maxAmountUsd = config.maxAmountUsd;
    this.windowMs = config.windowMs;
  }

  evaluate(request: ComplianceRequest): RuleEvaluationResult {
    const now = Date.now();
    const key = request.sender.toLowerCase();
    const cutoff = now - this.windowMs;

    // Get and prune old entries
    const entries = (this.ledger.get(key) ?? []).filter((e) => e.timestamp >= cutoff);

    const txCount = entries.length;
    const totalAmount = entries.reduce((sum, e) => sum + e.amountUsd, 0);

    const countExceeded = txCount >= this.maxTransactions;
    const amountExceeded = totalAmount + request.amountUsd > this.maxAmountUsd;
    const passed = !countExceeded && !amountExceeded;

    // Record this transaction
    entries.push({ amountUsd: request.amountUsd, timestamp: now });
    this.ledger.set(key, entries);

    const reasons: string[] = [];
    if (countExceeded) reasons.push(`${txCount} txns >= max ${this.maxTransactions}`);
    if (amountExceeded) reasons.push(`$${totalAmount + request.amountUsd} > max $${this.maxAmountUsd}`);

    return {
      ruleId: this.id,
      ruleType: this.type,
      passed,
      reason: passed
        ? `Velocity OK: ${txCount + 1} txns, $${totalAmount + request.amountUsd} in window`
        : `Velocity exceeded: ${reasons.join("; ")}`,
      metadata: { txCount: txCount + 1, totalAmountUsd: totalAmount + request.amountUsd },
    };
  }

  /** Clear the in-memory ledger (useful for testing). */
  reset(): void {
    this.ledger.clear();
  }
}

// ---------------------------------------------------------------------------
// CustomRule
// ---------------------------------------------------------------------------

export interface CustomRuleConfig {
  readonly id: string;
  readonly description: string;
  readonly priority?: number;
  readonly enabled?: boolean;
  /** User-supplied evaluation function. */
  readonly evaluateFn: (request: ComplianceRequest) => RuleEvaluationResult | Promise<RuleEvaluationResult>;
}

export class CustomRule implements PolicyRule {
  readonly id: string;
  readonly description: string;
  readonly type: PolicyRuleType = "custom";
  readonly priority: number;
  readonly enabled: boolean;
  private readonly evaluateFn: CustomRuleConfig["evaluateFn"];

  constructor(config: CustomRuleConfig) {
    this.id = config.id;
    this.description = config.description;
    this.priority = config.priority ?? 500;
    this.enabled = config.enabled ?? true;
    this.evaluateFn = config.evaluateFn;
  }

  evaluate(request: ComplianceRequest): RuleEvaluationResult | Promise<RuleEvaluationResult> {
    return this.evaluateFn(request);
  }
}
