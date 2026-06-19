// ---------------------------------------------------------------------------
// Demo Reporter — generates HTML report of demo run
// ---------------------------------------------------------------------------

import { writeFileSync } from "node:fs";
import type { ReceiptData } from "./display.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DemoEvent {
  readonly timestamp: string;
  readonly type: "screening" | "kya" | "travel_rule" | "payment" | "receipt" | "webhook" | "batch";
  readonly label: string;
  readonly status: "passed" | "failed" | "skipped" | "blocked";
  readonly latencyMs: number;
  readonly details?: Record<string, string | number | boolean>;
}

export interface DemoRunReport {
  readonly scenarioName: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly durationMs: number;
  readonly events: DemoEvent[];
  readonly receipts: ReceiptData[];
}

// ---------------------------------------------------------------------------
// Reporter class
// ---------------------------------------------------------------------------

export class DemoReporter {
  private readonly events: DemoEvent[] = [];
  private readonly receipts: ReceiptData[] = [];
  private readonly scenarioName: string;
  private readonly startTime: Date;

  constructor(scenarioName: string) {
    this.scenarioName = scenarioName;
    this.startTime = new Date();
  }

  addEvent(event: Omit<DemoEvent, "timestamp">): void {
    this.events.push({
      ...event,
      timestamp: new Date().toISOString(),
    });
  }

  addReceipt(receipt: ReceiptData): void {
    this.receipts.push(receipt);
  }

  generateReport(): DemoRunReport {
    const endTime = new Date();
    return {
      scenarioName: this.scenarioName,
      startTime: this.startTime.toISOString(),
      endTime: endTime.toISOString(),
      durationMs: endTime.getTime() - this.startTime.getTime(),
      events: [...this.events],
      receipts: [...this.receipts],
    };
  }

  saveHtmlReport(outputPath?: string): string {
    const report = this.generateReport();
    const filePath = outputPath ?? "/tmp/prooflink-demo-report.html";
    const html = renderHtml(report);
    writeFileSync(filePath, html, "utf-8");
    return filePath;
  }
}

// ---------------------------------------------------------------------------
// HTML rendering
// ---------------------------------------------------------------------------

function statusBadge(status: string): string {
  const colors: Record<string, string> = {
    passed: "#22c55e",
    failed: "#ef4444",
    blocked: "#ef4444",
    skipped: "#6b7280",
    COMPLIANT: "#22c55e",
    BLOCKED: "#ef4444",
    REVIEW_REQUIRED: "#eab308",
  };
  const bg = colors[status] ?? "#6b7280";
  return `<span style="background:${bg};color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;text-transform:uppercase;">${escapeHtml(status)}</span>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHtml(report: DemoRunReport): string {
  const passedCount = report.events.filter((e) => e.status === "passed").length;
  const failedCount = report.events.filter((e) => e.status === "failed" || e.status === "blocked").length;
  const totalLatency = report.events.reduce((s, e) => s + e.latencyMs, 0);

  const eventsRows = report.events
    .map(
      (e) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #1e293b;color:#94a3b8;font-size:13px;">${e.timestamp.split("T")[1]?.split(".")[0] ?? ""}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #1e293b;color:#e2e8f0;font-weight:500;">${escapeHtml(e.label)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #1e293b;">${statusBadge(e.status)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #1e293b;color:#94a3b8;text-align:right;">${e.latencyMs}ms</td>
        <td style="padding:8px 12px;border-bottom:1px solid #1e293b;color:#64748b;font-size:12px;">${escapeHtml(e.type)}</td>
      </tr>`,
    )
    .join("\n");

  const receiptCards = report.receipts
    .map(
      (r) => `
      <div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:20px;margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <span style="color:#06b6d4;font-weight:600;">Receipt: ${escapeHtml(r.receiptId)}</span>
          ${statusBadge(r.overallStatus)}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;">
          <div><span style="color:#64748b;">Risk Score:</span> <span style="color:#e2e8f0;">${r.riskScore}/100</span></div>
          <div><span style="color:#64748b;">Travel Rule:</span> <span style="color:#e2e8f0;">${escapeHtml(r.travelRuleStatus)}</span></div>
          <div><span style="color:#64748b;">Timestamp:</span> <span style="color:#e2e8f0;">${escapeHtml(r.timestamp)}</span></div>
          ${r.easAttestationUid ? `<div><span style="color:#64748b;">EAS UID:</span> <span style="color:#e2e8f0;font-size:11px;">${escapeHtml(r.easAttestationUid.slice(0, 16))}...</span></div>` : ""}
        </div>
        <table style="width:100%;margin-top:12px;border-collapse:collapse;">
          <thead>
            <tr style="border-bottom:1px solid #1e293b;">
              <th style="text-align:left;padding:6px 8px;color:#06b6d4;font-size:12px;">Check</th>
              <th style="text-align:left;padding:6px 8px;color:#06b6d4;font-size:12px;">Result</th>
              <th style="text-align:left;padding:6px 8px;color:#06b6d4;font-size:12px;">Provider</th>
              <th style="text-align:right;padding:6px 8px;color:#06b6d4;font-size:12px;">Latency</th>
            </tr>
          </thead>
          <tbody>
            ${r.checks
              .map(
                (c) => `
              <tr>
                <td style="padding:4px 8px;color:#e2e8f0;font-size:12px;">${escapeHtml(c.checkType)}</td>
                <td style="padding:4px 8px;">${statusBadge(c.result.toLowerCase())}</td>
                <td style="padding:4px 8px;color:#94a3b8;font-size:12px;">${escapeHtml(c.provider)}</td>
                <td style="padding:4px 8px;color:#94a3b8;font-size:12px;text-align:right;">${c.latencyMs}ms</td>
              </tr>`,
              )
              .join("\n")}
          </tbody>
        </table>
      </div>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ProofLink Demo Report — ${escapeHtml(report.scenarioName)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #020617; color: #e2e8f0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
    .container { max-width: 900px; margin: 0 auto; padding: 40px 20px; }
    .header { text-align: center; margin-bottom: 40px; }
    .logo { font-size: 32px; font-weight: 800; color: #06b6d4; letter-spacing: -1px; }
    .subtitle { color: #64748b; margin-top: 4px; font-size: 14px; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 32px; }
    .stat { background: #0f172a; border: 1px solid #1e293b; border-radius: 8px; padding: 16px; text-align: center; }
    .stat-value { font-size: 28px; font-weight: 700; color: #06b6d4; }
    .stat-label { font-size: 12px; color: #64748b; margin-top: 4px; text-transform: uppercase; letter-spacing: 1px; }
    .section { margin-bottom: 32px; }
    .section-title { font-size: 18px; font-weight: 600; color: #e2e8f0; margin-bottom: 16px; border-bottom: 1px solid #1e293b; padding-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; }
    .footer { text-align: center; color: #475569; font-size: 12px; margin-top: 40px; padding-top: 20px; border-top: 1px solid #1e293b; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">ProofLink</div>
      <div class="subtitle">Demo Report: ${escapeHtml(report.scenarioName)}</div>
      <div style="color:#475569;font-size:12px;margin-top:8px;">${escapeHtml(report.startTime)}</div>
    </div>

    <div class="stats">
      <div class="stat">
        <div class="stat-value">${report.events.length}</div>
        <div class="stat-label">Total Events</div>
      </div>
      <div class="stat">
        <div class="stat-value" style="color:#22c55e;">${passedCount}</div>
        <div class="stat-label">Passed</div>
      </div>
      <div class="stat">
        <div class="stat-value" style="color:#ef4444;">${failedCount}</div>
        <div class="stat-label">Blocked</div>
      </div>
      <div class="stat">
        <div class="stat-value">${totalLatency}ms</div>
        <div class="stat-label">Total Latency</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Compliance Events</div>
      <div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;overflow:hidden;">
        <table>
          <thead>
            <tr style="border-bottom:1px solid #1e293b;">
              <th style="text-align:left;padding:10px 12px;color:#06b6d4;font-size:12px;">Time</th>
              <th style="text-align:left;padding:10px 12px;color:#06b6d4;font-size:12px;">Event</th>
              <th style="text-align:left;padding:10px 12px;color:#06b6d4;font-size:12px;">Status</th>
              <th style="text-align:right;padding:10px 12px;color:#06b6d4;font-size:12px;">Latency</th>
              <th style="text-align:left;padding:10px 12px;color:#06b6d4;font-size:12px;">Type</th>
            </tr>
          </thead>
          <tbody>
            ${eventsRows}
          </tbody>
        </table>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Compliance Receipts</div>
      ${receiptCards || '<p style="color:#64748b;">No receipts generated.</p>'}
    </div>

    <div class="section">
      <div class="section-title">Run Summary</div>
      <div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:20px;font-size:13px;">
        <div style="margin-bottom:8px;"><span style="color:#64748b;">Scenario:</span> <span style="color:#e2e8f0;">${escapeHtml(report.scenarioName)}</span></div>
        <div style="margin-bottom:8px;"><span style="color:#64748b;">Started:</span> <span style="color:#e2e8f0;">${escapeHtml(report.startTime)}</span></div>
        <div style="margin-bottom:8px;"><span style="color:#64748b;">Ended:</span> <span style="color:#e2e8f0;">${escapeHtml(report.endTime)}</span></div>
        <div><span style="color:#64748b;">Duration:</span> <span style="color:#06b6d4;font-weight:600;">${(report.durationMs / 1000).toFixed(2)}s</span></div>
      </div>
    </div>

    <div class="footer">
      Generated by ProofLink Demo Runner &mdash; ${new Date().toISOString().split("T")[0]}<br>
      <a href="https://prooflink.finance" style="color:#06b6d4;text-decoration:none;">prooflink.finance</a>
    </div>
  </div>
</body>
</html>`;
}
