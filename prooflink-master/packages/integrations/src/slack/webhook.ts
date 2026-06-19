// ---------------------------------------------------------------------------
// Slack Incoming Webhook — compliance notifications
// ---------------------------------------------------------------------------

import type {
  ComplianceDecision,
  SanctionsCheckResult,
} from "@prooflink/shared";
import type {
  SlackAttachment,
  SlackBlock,
  SlackConfig,
  SlackHttpClient,
  SlackMessage,
} from "./types.js";

const defaultHttpClient: SlackHttpClient = {
  fetch: (url, init) => globalThis.fetch(url, init),
};

// ---------------------------------------------------------------------------
// Status colors & labels
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  APPROVED: "#28a745",
  REJECTED: "#dc3545",
  ESCALATED: "#ffc107",
};

const STATUS_LABELS: Record<string, string> = {
  APPROVED: "OK - Approved",
  REJECTED: "BLOCKED - Rejected",
  ESCALATED: "REVIEW - Escalated",
};

// ---------------------------------------------------------------------------
// Block Kit helpers
// ---------------------------------------------------------------------------

function headerBlock(text: string): SlackBlock {
  return {
    type: "header",
    text: { type: "plain_text", text },
  };
}

function sectionBlock(markdown: string): SlackBlock {
  return {
    type: "section",
    text: { type: "mrkdwn", text: markdown },
  };
}

function fieldsBlock(fields: Array<{ label: string; value: string }>): SlackBlock {
  return {
    type: "section",
    fields: fields.map((f) => ({
      type: "mrkdwn",
      text: `*${f.label}:*\n${f.value}`,
    })),
  };
}

function contextBlock(text: string): SlackBlock {
  return {
    type: "context",
    elements: [{ type: "mrkdwn", text }],
  };
}

function dividerBlock(): SlackBlock {
  return { type: "divider" };
}

// ---------------------------------------------------------------------------
// SlackNotifier
// ---------------------------------------------------------------------------

/**
 * Slack incoming webhook notifier for compliance events.
 *
 * Sends rich Block Kit formatted messages to Slack channels when
 * compliance decisions, sanctions matches, or escalations occur.
 *
 * Usage:
 * ```ts
 * import { SlackNotifier } from "@prooflink/integrations/slack";
 *
 * const notifier = new SlackNotifier({
 *   webhookUrl: process.env.SLACK_WEBHOOK_URL!,
 *   channel: "#compliance-alerts",
 * });
 *
 * await notifier.sendComplianceAlert(decision);
 * ```
 */
export class SlackNotifier {
  private readonly config: SlackConfig;
  private readonly http: SlackHttpClient;

  constructor(
    config: SlackConfig,
    http: SlackHttpClient = defaultHttpClient,
  ) {
    this.config = config;
    this.http = http;
  }

  /**
   * Send a compliance decision alert to Slack.
   *
   * Color-coded by status: green (approved), red (rejected), yellow (escalated).
   */
  async sendComplianceAlert(decision: ComplianceDecision): Promise<void> {
    const color = STATUS_COLORS[decision.status] ?? "#808080";
    const label = STATUS_LABELS[decision.status] ?? decision.status;

    const blocks: SlackBlock[] = [
      headerBlock(`Compliance Decision: ${label}`),
      fieldsBlock([
        { label: "Receipt ID", value: `\`${decision.receiptId}\`` },
        { label: "Risk Score", value: `${decision.riskScore}/100` },
        { label: "Travel Rule", value: decision.travelRuleStatus },
        { label: "Checks", value: `${decision.checks.length} performed` },
      ]),
    ];

    if (decision.blockReason) {
      blocks.push(sectionBlock(`*Block Reason:* ${decision.blockReason}`));
    }

    // Per-check breakdown
    if (decision.checks.length > 0) {
      blocks.push(dividerBlock());
      const checkLines = decision.checks
        .map((c) => `- *${c.checkType}*: ${c.result} (${c.provider})`)
        .join("\n");
      blocks.push(sectionBlock(`*Check Details:*\n${checkLines}`));
    }

    blocks.push(
      contextBlock(`Timestamp: ${decision.timestamp} | TTL: ${decision.ttl}s | Receipt Hash: \`${decision.receiptHash.slice(0, 16)}...\``),
    );

    const attachment: SlackAttachment = {
      color,
      fallback: `Compliance Decision: ${decision.status} (Risk: ${decision.riskScore})`,
      blocks,
    };

    await this.send({
      text: `Compliance Decision: ${decision.status}`,
      attachments: [attachment],
      channel: this.config.channel,
      username: this.config.username ?? "ProofLink Compliance",
      icon_emoji: this.config.iconEmoji ?? ":shield:",
    });
  }

  /**
   * Send a sanctions match alert to Slack.
   *
   * Always sent with red color since sanctions matches are critical.
   */
  async sendSanctionsAlert(match: SanctionsCheckResult): Promise<void> {
    const matchCount = match.matchDetails.length;
    const listsStr = match.listsChecked.join(", ");

    const blocks: SlackBlock[] = [
      headerBlock(`SANCTIONS ALERT: ${matchCount} Match(es) Found`),
      fieldsBlock([
        { label: "Risk Score", value: `${match.riskScore}/100` },
        { label: "Provider", value: match.provider },
        { label: "Lists Checked", value: listsStr },
        { label: "Screened At", value: match.screenedAt },
      ]),
    ];

    if (match.matchDetails.length > 0) {
      blocks.push(dividerBlock());
      for (const detail of match.matchDetails) {
        blocks.push(
          sectionBlock(
            `*Match:* ${detail.name}\n*List:* ${detail.list} | *Entry:* \`${detail.entryId}\` | *Confidence:* ${(detail.matchConfidence * 100).toFixed(0)}%`,
          ),
        );
      }
    }

    blocks.push(contextBlock("Action required: review and confirm or dismiss this alert."));

    const attachment: SlackAttachment = {
      color: "#dc3545",
      fallback: `SANCTIONS ALERT: ${matchCount} match(es) found (Risk: ${match.riskScore})`,
      blocks,
    };

    await this.send({
      text: `SANCTIONS ALERT: ${matchCount} match(es) found`,
      attachments: [attachment],
      channel: this.config.channel,
      username: this.config.username ?? "ProofLink Compliance",
      icon_emoji: this.config.iconEmoji ?? ":rotating_light:",
    });
  }

  /**
   * Send an escalation alert to Slack for decisions requiring human review.
   *
   * Yellow color with detailed context for the compliance officer.
   */
  async sendEscalation(decision: ComplianceDecision): Promise<void> {
    const blocks: SlackBlock[] = [
      headerBlock("ESCALATION: Human Review Required"),
      fieldsBlock([
        { label: "Receipt ID", value: `\`${decision.receiptId}\`` },
        { label: "Risk Score", value: `${decision.riskScore}/100` },
        { label: "Travel Rule", value: decision.travelRuleStatus },
        { label: "Status", value: decision.status },
      ]),
    ];

    if (decision.blockReason) {
      blocks.push(sectionBlock(`*Escalation Reason:* ${decision.blockReason}`));
    }

    // Check breakdown for reviewers
    if (decision.checks.length > 0) {
      blocks.push(dividerBlock());
      const failedChecks = decision.checks.filter((c) => c.result === "FAILED");
      const skippedChecks = decision.checks.filter((c) => c.result === "SKIPPED");

      if (failedChecks.length > 0) {
        const lines = failedChecks
          .map((c) => `- *${c.checkType}*: ${c.provider}${c.detail ? ` — ${c.detail}` : ""}`)
          .join("\n");
        blocks.push(sectionBlock(`*Failed Checks:*\n${lines}`));
      }

      if (skippedChecks.length > 0) {
        const lines = skippedChecks
          .map((c) => `- *${c.checkType}*: ${c.provider}${c.detail ? ` — ${c.detail}` : ""}`)
          .join("\n");
        blocks.push(sectionBlock(`*Skipped Checks:*\n${lines}`));
      }
    }

    blocks.push(
      contextBlock(`Timestamp: ${decision.timestamp} | TTL: ${decision.ttl}s | This alert requires manual review.`),
    );

    const attachment: SlackAttachment = {
      color: "#ffc107",
      fallback: `ESCALATION: Receipt ${decision.receiptId} requires human review (Risk: ${decision.riskScore})`,
      blocks,
    };

    await this.send({
      text: `ESCALATION: Receipt ${decision.receiptId} requires human review`,
      attachments: [attachment],
      channel: this.config.channel,
      username: this.config.username ?? "ProofLink Compliance",
      icon_emoji: this.config.iconEmoji ?? ":warning:",
    });
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private async send(payload: SlackMessage): Promise<void> {
    const timeoutMs = this.config.timeoutMs ?? 5_000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.http.fetch(this.config.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Slack webhook error ${response.status}: ${text}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * @deprecated Use SlackNotifier instead.
 */
export const SlackWebhook = SlackNotifier;
