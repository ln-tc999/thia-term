import { describe, expect, it, vi } from "vitest";
import { SlackWebhook } from "../webhook.js";
import type { ComplianceDecision, SanctionsCheckResult } from "@prooflink/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHttpClient(fetchFn: ReturnType<typeof vi.fn>) {
  return { fetch: fetchFn as unknown as (url: string, init: RequestInit) => Promise<Response> };
}

function okResponse(): Response {
  return new Response("ok", { status: 200 });
}

function errorResponse(status: number, text: string): Response {
  return new Response(text, { status });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WEBHOOK_URL = "https://hooks.slack.com/services/T000/B000/xxxx";

const APPROVED_DECISION: ComplianceDecision = {
  status: "APPROVED",
  riskScore: 12,
  receiptId: "rcpt_001",
  receiptHash: "0xabc",
  checks: [
    {
      checkType: "SANCTIONS_SCREENING",
      result: "PASSED",
      performedAt: "2026-01-01T00:00:00Z",
      provider: "chainalysis",
    },
  ],
  travelRuleStatus: "NOT_REQUIRED",
  timestamp: "2026-01-01T00:00:00Z",
  ttl: 300,
};

const REJECTED_DECISION: ComplianceDecision = {
  ...APPROVED_DECISION,
  status: "REJECTED",
  riskScore: 100,
  receiptId: "rcpt_rejected",
  blockReason: "Sanctioned address: OFAC SDN match",
};

const ESCALATED_DECISION: ComplianceDecision = {
  ...APPROVED_DECISION,
  status: "ESCALATED",
  riskScore: 55,
  receiptId: "rcpt_escalated",
};

const SANCTIONS_MATCH: SanctionsCheckResult = {
  matched: true,
  listsChecked: ["OFAC_SDN", "EU_CONSOLIDATED"],
  matchDetails: [
    {
      list: "OFAC_SDN",
      entryId: "entry-001",
      name: "Evil Corp",
      matchConfidence: 0.97,
    },
  ],
  riskScore: 100,
  screenedAt: "2026-01-01T00:00:00Z",
  provider: "trm",
};

const NO_MATCH_SANCTIONS: SanctionsCheckResult = {
  matched: false,
  listsChecked: ["OFAC_SDN"],
  matchDetails: [],
  riskScore: 0,
  screenedAt: "2026-01-01T00:00:00Z",
  provider: "chainalysis_free",
};

// ---------------------------------------------------------------------------
// SlackWebhook — construction
// ---------------------------------------------------------------------------

describe("SlackWebhook", () => {
  describe("constructor", () => {
    it("constructs without error with minimal config", () => {
      expect(() => new SlackWebhook({ webhookUrl: WEBHOOK_URL })).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // sendComplianceAlert
  // -------------------------------------------------------------------------

  describe("sendComplianceAlert", () => {
    it("POSTs to the configured webhook URL", async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse());
      const webhook = new SlackWebhook(
        { webhookUrl: WEBHOOK_URL },
        makeHttpClient(fetchMock),
      );

      await webhook.sendComplianceAlert(APPROVED_DECISION);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(WEBHOOK_URL);
      expect(init.method).toBe("POST");
    });

    it("sends Content-Type: application/json", async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse());
      const webhook = new SlackWebhook(
        { webhookUrl: WEBHOOK_URL },
        makeHttpClient(fetchMock),
      );

      await webhook.sendComplianceAlert(APPROVED_DECISION);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers["Content-Type"]).toBe("application/json");
    });

    it("sends valid JSON body", async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse());
      const webhook = new SlackWebhook(
        { webhookUrl: WEBHOOK_URL },
        makeHttpClient(fetchMock),
      );

      await webhook.sendComplianceAlert(APPROVED_DECISION);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(() => JSON.parse(init.body as string)).not.toThrow();
    });

    it("includes APPROVED status in fallback text", async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse());
      const webhook = new SlackWebhook(
        { webhookUrl: WEBHOOK_URL },
        makeHttpClient(fetchMock),
      );

      await webhook.sendComplianceAlert(APPROVED_DECISION);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      const attachments = body.attachments as Array<Record<string, unknown>>;
      expect((attachments[0]?.fallback as string)).toContain("APPROVED");
    });

    it("uses green color for APPROVED status", async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse());
      const webhook = new SlackWebhook(
        { webhookUrl: WEBHOOK_URL },
        makeHttpClient(fetchMock),
      );

      await webhook.sendComplianceAlert(APPROVED_DECISION);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      const attachments = body.attachments as Array<Record<string, unknown>>;
      expect(attachments[0]?.color).toBe("#28a745");
    });

    it("uses red color for REJECTED status", async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse());
      const webhook = new SlackWebhook(
        { webhookUrl: WEBHOOK_URL },
        makeHttpClient(fetchMock),
      );

      await webhook.sendComplianceAlert(REJECTED_DECISION);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      const attachments = body.attachments as Array<Record<string, unknown>>;
      expect(attachments[0]?.color).toBe("#dc3545");
    });

    it("uses yellow color for ESCALATED status", async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse());
      const webhook = new SlackWebhook(
        { webhookUrl: WEBHOOK_URL },
        makeHttpClient(fetchMock),
      );

      await webhook.sendComplianceAlert(ESCALATED_DECISION);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      const attachments = body.attachments as Array<Record<string, unknown>>;
      expect(attachments[0]?.color).toBe("#ffc107");
    });

    it("uses default username ProofLink Compliance when none configured", async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse());
      const webhook = new SlackWebhook(
        { webhookUrl: WEBHOOK_URL },
        makeHttpClient(fetchMock),
      );

      await webhook.sendComplianceAlert(APPROVED_DECISION);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body.username).toBe("ProofLink Compliance");
    });

    it("uses configured username override", async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse());
      const webhook = new SlackWebhook(
        { webhookUrl: WEBHOOK_URL, username: "Custom Bot" },
        makeHttpClient(fetchMock),
      );

      await webhook.sendComplianceAlert(APPROVED_DECISION);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body.username).toBe("Custom Bot");
    });

    it("uses configured channel override when provided", async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse());
      const webhook = new SlackWebhook(
        { webhookUrl: WEBHOOK_URL, channel: "#compliance-alerts" },
        makeHttpClient(fetchMock),
      );

      await webhook.sendComplianceAlert(APPROVED_DECISION);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body.channel).toBe("#compliance-alerts");
    });

    it("includes receiptId in message blocks", async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse());
      const webhook = new SlackWebhook(
        { webhookUrl: WEBHOOK_URL },
        makeHttpClient(fetchMock),
      );

      await webhook.sendComplianceAlert(APPROVED_DECISION);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const bodyStr = init.body as string;
      expect(bodyStr).toContain("rcpt_001");
    });

    it("includes riskScore in message blocks", async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse());
      const webhook = new SlackWebhook(
        { webhookUrl: WEBHOOK_URL },
        makeHttpClient(fetchMock),
      );

      await webhook.sendComplianceAlert(APPROVED_DECISION);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const bodyStr = init.body as string;
      expect(bodyStr).toContain("12");
    });

    it("includes blockReason section when decision has blockReason", async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse());
      const webhook = new SlackWebhook(
        { webhookUrl: WEBHOOK_URL },
        makeHttpClient(fetchMock),
      );

      await webhook.sendComplianceAlert(REJECTED_DECISION);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const bodyStr = init.body as string;
      expect(bodyStr).toContain("Sanctioned address: OFAC SDN match");
    });

    it("omits blockReason section when decision has no blockReason", async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse());
      const webhook = new SlackWebhook(
        { webhookUrl: WEBHOOK_URL },
        makeHttpClient(fetchMock),
      );

      await webhook.sendComplianceAlert(APPROVED_DECISION);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      const attachments = body.attachments as Array<Record<string, unknown>>;
      const blocks = attachments[0]?.blocks as Array<Record<string, unknown>>;
      const hasBlockReasonSection = blocks.some(
        (b) =>
          b.type === "section" &&
          (b.text as Record<string, string> | undefined)?.text?.includes("Block Reason"),
      );
      expect(hasBlockReasonSection).toBe(false);
    });

    it("uses custom iconEmoji when configured", async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse());
      const webhook = new SlackWebhook(
        { webhookUrl: WEBHOOK_URL, iconEmoji: ":robot_face:" },
        makeHttpClient(fetchMock),
      );

      await webhook.sendComplianceAlert(APPROVED_DECISION);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body.icon_emoji).toBe(":robot_face:");
    });

    it("throws on non-2xx webhook response", async () => {
      const fetchMock = vi.fn().mockResolvedValue(errorResponse(400, "channel_not_found"));
      const webhook = new SlackWebhook(
        { webhookUrl: WEBHOOK_URL },
        makeHttpClient(fetchMock),
      );

      await expect(webhook.sendComplianceAlert(APPROVED_DECISION)).rejects.toThrow(
        /Slack webhook error 400/,
      );
    });

    it("throws on network error", async () => {
      const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
      const webhook = new SlackWebhook(
        { webhookUrl: WEBHOOK_URL },
        makeHttpClient(fetchMock),
      );

      await expect(webhook.sendComplianceAlert(APPROVED_DECISION)).rejects.toThrow(TypeError);
    });
  });

  // -------------------------------------------------------------------------
  // sendSanctionsAlert
  // -------------------------------------------------------------------------

  describe("sendSanctionsAlert", () => {
    it("POSTs to the configured webhook URL", async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse());
      const webhook = new SlackWebhook(
        { webhookUrl: WEBHOOK_URL },
        makeHttpClient(fetchMock),
      );

      await webhook.sendSanctionsAlert(SANCTIONS_MATCH);

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(WEBHOOK_URL);
    });

    it("always uses red color (#dc3545) for sanctions alerts", async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse());
      const webhook = new SlackWebhook(
        { webhookUrl: WEBHOOK_URL },
        makeHttpClient(fetchMock),
      );

      await webhook.sendSanctionsAlert(SANCTIONS_MATCH);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      const attachments = body.attachments as Array<Record<string, unknown>>;
      expect(attachments[0]?.color).toBe("#dc3545");
    });

    it("includes match count in fallback text", async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse());
      const webhook = new SlackWebhook(
        { webhookUrl: WEBHOOK_URL },
        makeHttpClient(fetchMock),
      );

      await webhook.sendSanctionsAlert(SANCTIONS_MATCH);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      const attachments = body.attachments as Array<Record<string, unknown>>;
      expect((attachments[0]?.fallback as string)).toContain("1 match");
    });

    it("includes lists checked in message body", async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse());
      const webhook = new SlackWebhook(
        { webhookUrl: WEBHOOK_URL },
        makeHttpClient(fetchMock),
      );

      await webhook.sendSanctionsAlert(SANCTIONS_MATCH);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const bodyStr = init.body as string;
      expect(bodyStr).toContain("OFAC_SDN");
      expect(bodyStr).toContain("EU_CONSOLIDATED");
    });

    it("includes match name in message body", async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse());
      const webhook = new SlackWebhook(
        { webhookUrl: WEBHOOK_URL },
        makeHttpClient(fetchMock),
      );

      await webhook.sendSanctionsAlert(SANCTIONS_MATCH);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const bodyStr = init.body as string;
      expect(bodyStr).toContain("Evil Corp");
    });

    it("formats match confidence as percentage", async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse());
      const webhook = new SlackWebhook(
        { webhookUrl: WEBHOOK_URL },
        makeHttpClient(fetchMock),
      );

      await webhook.sendSanctionsAlert(SANCTIONS_MATCH);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const bodyStr = init.body as string;
      expect(bodyStr).toContain("97%");
    });

    it("includes provider in message body", async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse());
      const webhook = new SlackWebhook(
        { webhookUrl: WEBHOOK_URL },
        makeHttpClient(fetchMock),
      );

      await webhook.sendSanctionsAlert(SANCTIONS_MATCH);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const bodyStr = init.body as string;
      expect(bodyStr).toContain("trm");
    });

    it("uses default icon :rotating_light: for sanctions alerts", async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse());
      const webhook = new SlackWebhook(
        { webhookUrl: WEBHOOK_URL },
        makeHttpClient(fetchMock),
      );

      await webhook.sendSanctionsAlert(SANCTIONS_MATCH);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body.icon_emoji).toBe(":rotating_light:");
    });

    it("handles zero match details without error", async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse());
      const webhook = new SlackWebhook(
        { webhookUrl: WEBHOOK_URL },
        makeHttpClient(fetchMock),
      );

      // NO_MATCH_SANCTIONS has no matchDetails — should not crash
      await expect(webhook.sendSanctionsAlert(NO_MATCH_SANCTIONS)).resolves.toBeUndefined();
    });

    it("includes multiple match detail blocks for multiple matches", async () => {
      const multiMatch: SanctionsCheckResult = {
        ...SANCTIONS_MATCH,
        matchDetails: [
          { list: "OFAC_SDN", entryId: "e1", name: "Entity One", matchConfidence: 0.9 },
          { list: "EU_CONSOLIDATED", entryId: "e2", name: "Entity Two", matchConfidence: 0.75 },
        ],
      };
      const fetchMock = vi.fn().mockResolvedValue(okResponse());
      const webhook = new SlackWebhook(
        { webhookUrl: WEBHOOK_URL },
        makeHttpClient(fetchMock),
      );

      await webhook.sendSanctionsAlert(multiMatch);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const bodyStr = init.body as string;
      expect(bodyStr).toContain("Entity One");
      expect(bodyStr).toContain("Entity Two");
    });

    it("throws on non-2xx webhook response", async () => {
      const fetchMock = vi.fn().mockResolvedValue(errorResponse(500, "server_error"));
      const webhook = new SlackWebhook(
        { webhookUrl: WEBHOOK_URL },
        makeHttpClient(fetchMock),
      );

      await expect(webhook.sendSanctionsAlert(SANCTIONS_MATCH)).rejects.toThrow(
        /Slack webhook error 500/,
      );
    });
  });
});
