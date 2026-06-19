// ---------------------------------------------------------------------------
// Risk Assessment Report — Detailed risk report generation
// ---------------------------------------------------------------------------

import type { RiskProfileSnapshot } from "./profile.js";
import type { StructuringAlert } from "./structuring.js";
import type { RiskFactorResult } from "./factors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Risk level classification. */
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/** A recommendation for the compliance team. */
export interface RiskRecommendation {
  /** Action to take */
  readonly action: "APPROVE" | "REVIEW" | "ESCALATE" | "BLOCK";
  /** Human-readable reason for the recommendation */
  readonly reason: string;
  /** Priority level */
  readonly priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
}

/** Serializable JSON representation of a risk report. */
export interface RiskReportJSON {
  readonly reportId: string;
  readonly address: string;
  readonly riskScore: number;
  readonly riskLevel: RiskLevel;
  readonly generatedAt: string;
  readonly factors: ReadonlyArray<{
    readonly name: string;
    readonly score: number;
    readonly triggered: boolean;
    readonly detail: string;
  }>;
  readonly structuringAlerts: readonly StructuringAlert[];
  readonly profile: RiskProfileSnapshot | null;
  readonly recommendations: readonly RiskRecommendation[];
  readonly summary: string;
}

/** Input data for generating a risk assessment report. */
export interface RiskReportInput {
  /** Address being assessed */
  readonly address: string;
  /** Composite risk score (0-100) */
  readonly riskScore: number;
  /** Individual factor results (from RiskFactorRegistry.evaluateAll) */
  readonly factorResults: ReadonlyMap<string, RiskFactorResult>;
  /** Structuring alerts (from StructuringDetector.analyze) */
  readonly structuringAlerts?: readonly StructuringAlert[];
  /** Address risk profile snapshot (from AddressRiskProfile.getSnapshot) */
  readonly profile?: RiskProfileSnapshot;
}

// ---------------------------------------------------------------------------
// RiskAssessmentReport
// ---------------------------------------------------------------------------

/**
 * Generates detailed risk assessment reports for an address.
 *
 * Combines data from the risk factor registry, structuring detector,
 * and address risk profile to produce a comprehensive report with:
 * - Composite risk score and level classification
 * - Individual factor breakdown
 * - Structuring alerts
 * - Historical context from address profile
 * - Actionable recommendations
 *
 * Output formats: JSON (toJSON) and HTML (toHTML).
 *
 * @example
 * ```ts
 * const report = new RiskAssessmentReport({
 *   address: "0xabc...",
 *   riskScore: 72,
 *   factorResults: registry.evaluateAll(context),
 *   structuringAlerts: detector.analyze("0xabc..."),
 *   profile: profile.getSnapshot(),
 * });
 *
 * const json = report.toJSON();
 * const html = report.toHTML();
 * ```
 */
export class RiskAssessmentReport {
  /** Unique report identifier. */
  readonly reportId: string;
  /** Address being assessed. */
  readonly address: string;
  /** Composite risk score (0-100). */
  readonly riskScore: number;
  /** Classified risk level. */
  readonly riskLevel: RiskLevel;
  /** ISO 8601 timestamp when report was generated. */
  readonly generatedAt: string;

  private readonly factorResults: ReadonlyMap<string, RiskFactorResult>;
  private readonly structuringAlerts: readonly StructuringAlert[];
  private readonly profile: RiskProfileSnapshot | null;
  private readonly recommendations: readonly RiskRecommendation[];

  constructor(input: RiskReportInput) {
    this.reportId = RiskAssessmentReport.generateReportId();
    this.address = input.address;
    this.riskScore = input.riskScore;
    this.riskLevel = RiskAssessmentReport.classifyRiskLevel(input.riskScore);
    this.generatedAt = new Date().toISOString();
    this.factorResults = input.factorResults;
    this.structuringAlerts = input.structuringAlerts ?? [];
    this.profile = input.profile ?? null;
    this.recommendations = this.generateRecommendations();
  }

  /**
   * Serialize the report to a plain JSON-compatible object.
   *
   * @returns Immutable JSON representation of the report
   */
  toJSON(): RiskReportJSON {
    const factors: Array<{
      readonly name: string;
      readonly score: number;
      readonly triggered: boolean;
      readonly detail: string;
    }> = [];
    for (const [name, result] of this.factorResults) {
      factors.push({
        name,
        score: result.score,
        triggered: result.triggered,
        detail: result.detail,
      });
    }

    return {
      reportId: this.reportId,
      address: this.address,
      riskScore: this.riskScore,
      riskLevel: this.riskLevel,
      generatedAt: this.generatedAt,
      factors,
      structuringAlerts: this.structuringAlerts,
      profile: this.profile,
      recommendations: this.recommendations,
      summary: this.generateSummary(),
    };
  }

  /**
   * Render the report as an HTML string.
   *
   * Produces a self-contained HTML document suitable for email reports,
   * dashboards, or compliance record archives.
   *
   * @returns Complete HTML document string
   */
  toHTML(): string {
    const factors = Array.from(this.factorResults.entries());
    const triggeredFactors = factors.filter(([, r]) => r.triggered);

    const levelColor = this.getLevelColor();

    const factorRows = factors
      .map(
        ([name, result]) =>
          `<tr>
            <td>${this.escapeHtml(name)}</td>
            <td>${(result.score * 100).toFixed(0)}%</td>
            <td>${result.triggered ? '<span style="color:#dc2626">Yes</span>' : '<span style="color:#16a34a">No</span>'}</td>
            <td>${this.escapeHtml(result.detail)}</td>
          </tr>`,
      )
      .join("\n");

    const alertRows =
      this.structuringAlerts.length > 0
        ? this.structuringAlerts
            .map(
              (alert) =>
                `<tr>
              <td><span style="color:${this.getSeverityColor(alert.severity)}">${alert.severity}</span></td>
              <td>${this.escapeHtml(alert.pattern)}</td>
              <td>${this.escapeHtml(alert.description)}</td>
              <td>$${alert.totalAmountUsd.toFixed(2)}</td>
              <td>${(alert.confidence * 100).toFixed(0)}%</td>
            </tr>`,
            )
            .join("\n")
        : '<tr><td colspan="5">No structuring alerts</td></tr>';

    const profileSection = this.profile
      ? `<table>
          <tr><th>Metric</th><th>Value</th></tr>
          <tr><td>Total Volume</td><td>$${this.profile.totalVolumeUsd.toFixed(2)}</td></tr>
          <tr><td>Transaction Count</td><td>${this.profile.transactionCount}</td></tr>
          <tr><td>Average Amount</td><td>$${this.profile.averageAmountUsd.toFixed(2)}</td></tr>
          <tr><td>Unique Counterparties</td><td>${this.profile.uniqueCounterparties}</td></tr>
          <tr><td>Unique Chains</td><td>${this.profile.uniqueChains}</td></tr>
          <tr><td>Frequency</td><td>${this.profile.frequencyPerDay} tx/day</td></tr>
          <tr><td>Risk Trend</td><td>${this.profile.riskTrend}</td></tr>
          <tr><td>First Seen</td><td>${this.profile.firstSeen}</td></tr>
          <tr><td>Last Seen</td><td>${this.profile.lastSeen}</td></tr>
        </table>`
      : "<p>No historical profile data available.</p>";

    const recRows = this.recommendations
      .map(
        (rec) =>
          `<tr>
          <td><strong>${this.escapeHtml(rec.action)}</strong></td>
          <td>${this.escapeHtml(rec.reason)}</td>
          <td>${this.escapeHtml(rec.priority)}</td>
        </tr>`,
      )
      .join("\n");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Risk Assessment Report — ${this.escapeHtml(this.address)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 2rem; color: #1a1a1a; }
  h1, h2, h3 { margin-top: 1.5rem; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { border: 1px solid #d1d5db; padding: 0.5rem 0.75rem; text-align: left; }
  th { background: #f3f4f6; }
  .score-badge { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 4px; color: white; font-weight: bold; }
  .summary { background: #f9fafb; border-left: 4px solid ${levelColor}; padding: 1rem; margin: 1rem 0; }
</style>
</head>
<body>
<h1>Risk Assessment Report</h1>
<p><strong>Report ID:</strong> ${this.escapeHtml(this.reportId)}</p>
<p><strong>Address:</strong> <code>${this.escapeHtml(this.address)}</code></p>
<p><strong>Generated:</strong> ${this.escapeHtml(this.generatedAt)}</p>
<p><strong>Risk Score:</strong> <span class="score-badge" style="background:${levelColor}">${this.riskScore} / 100 (${this.riskLevel})</span></p>

<div class="summary">
  <h3>Summary</h3>
  <p>${this.escapeHtml(this.generateSummary())}</p>
</div>

<h2>Risk Factors (${triggeredFactors.length}/${factors.length} triggered)</h2>
<table>
  <tr><th>Factor</th><th>Score</th><th>Triggered</th><th>Detail</th></tr>
  ${factorRows}
</table>

<h2>Structuring Alerts (${this.structuringAlerts.length})</h2>
<table>
  <tr><th>Severity</th><th>Pattern</th><th>Description</th><th>Amount</th><th>Confidence</th></tr>
  ${alertRows}
</table>

<h2>Historical Profile</h2>
${profileSection}

<h2>Recommendations</h2>
<table>
  <tr><th>Action</th><th>Reason</th><th>Priority</th></tr>
  ${recRows}
</table>

<hr>
<p style="color:#6b7280; font-size:0.85rem">Generated by ProofLink ProofLink Engine</p>
</body>
</html>`;
  }

  // -------------------------------------------------------------------------
  // Static helpers
  // -------------------------------------------------------------------------

  /**
   * Classify a numeric risk score into a risk level.
   *
   * @param score - Risk score (0-100)
   * @returns Risk level classification
   */
  static classifyRiskLevel(score: number): RiskLevel {
    if (score >= 80) return "CRITICAL";
    if (score >= 60) return "HIGH";
    if (score >= 30) return "MEDIUM";
    return "LOW";
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Generate a unique report ID. */
  private static generateReportId(): string {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    return `rr-${ts}-${rand}`;
  }

  /** Generate human-readable summary text. */
  private generateSummary(): string {
    const triggered = Array.from(this.factorResults.entries()).filter(
      ([, r]) => r.triggered,
    );
    const parts: string[] = [];

    parts.push(
      `Risk score ${this.riskScore}/100 (${this.riskLevel}).`,
    );

    if (triggered.length > 0) {
      const names = triggered.map(([n]) => n).join(", ");
      parts.push(
        `${triggered.length} risk factor(s) triggered: ${names}.`,
      );
    } else {
      parts.push("No risk factors triggered.");
    }

    if (this.structuringAlerts.length > 0) {
      const critical = this.structuringAlerts.filter(
        (a) => a.severity === "CRITICAL" || a.severity === "HIGH",
      );
      parts.push(
        `${this.structuringAlerts.length} structuring alert(s) detected` +
          (critical.length > 0
            ? ` (${critical.length} high/critical).`
            : "."),
      );
    }

    if (this.profile) {
      parts.push(
        `Historical profile: ${this.profile.transactionCount} transactions, ` +
          `$${this.profile.totalVolumeUsd.toFixed(2)} total volume, ` +
          `trend ${this.profile.riskTrend}.`,
      );
    }

    return parts.join(" ");
  }

  /** Generate action recommendations based on risk data. */
  private generateRecommendations(): RiskRecommendation[] {
    const recs: RiskRecommendation[] = [];

    // Primary recommendation based on risk score
    if (this.riskScore >= 80) {
      recs.push({
        action: "BLOCK",
        reason: `Risk score ${this.riskScore} exceeds critical threshold (80)`,
        priority: "URGENT",
      });
    } else if (this.riskScore >= 60) {
      recs.push({
        action: "ESCALATE",
        reason: `Risk score ${this.riskScore} exceeds high threshold (60)`,
        priority: "HIGH",
      });
    } else if (this.riskScore >= 30) {
      recs.push({
        action: "REVIEW",
        reason: `Risk score ${this.riskScore} is in medium-risk range (30-59)`,
        priority: "MEDIUM",
      });
    } else {
      recs.push({
        action: "APPROVE",
        reason: `Risk score ${this.riskScore} is within acceptable range`,
        priority: "LOW",
      });
    }

    // Structuring-specific recommendations
    const criticalAlerts = this.structuringAlerts.filter(
      (a) => a.severity === "CRITICAL",
    );
    if (criticalAlerts.length > 0) {
      recs.push({
        action: "BLOCK",
        reason: `${criticalAlerts.length} critical structuring alert(s) detected`,
        priority: "URGENT",
      });
    }

    const highAlerts = this.structuringAlerts.filter(
      (a) => a.severity === "HIGH",
    );
    if (highAlerts.length > 0) {
      recs.push({
        action: "ESCALATE",
        reason: `${highAlerts.length} high-severity structuring alert(s) detected`,
        priority: "HIGH",
      });
    }

    // Profile-based recommendations
    if (this.profile) {
      if (this.profile.riskTrend === "worsening") {
        recs.push({
          action: "REVIEW",
          reason: "Risk trend is worsening — enhanced monitoring recommended",
          priority: "MEDIUM",
        });
      }

      if (this.profile.uniqueCounterparties > 50) {
        recs.push({
          action: "REVIEW",
          reason: `High counterparty diversity (${this.profile.uniqueCounterparties} unique addresses) — potential money mule activity`,
          priority: "MEDIUM",
        });
      }
    }

    return recs;
  }

  /** Escape HTML special characters. */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /** Map risk level to display color. */
  private getLevelColor(): string {
    switch (this.riskLevel) {
      case "CRITICAL":
        return "#dc2626";
      case "HIGH":
        return "#ea580c";
      case "MEDIUM":
        return "#ca8a04";
      case "LOW":
        return "#16a34a";
    }
  }

  /** Map alert severity to display color. */
  private getSeverityColor(severity: StructuringAlert["severity"]): string {
    switch (severity) {
      case "CRITICAL":
        return "#dc2626";
      case "HIGH":
        return "#ea580c";
      case "MEDIUM":
        return "#ca8a04";
      case "LOW":
        return "#16a34a";
    }
  }
}
