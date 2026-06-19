import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createProofLinkMCPServer } from "../server.js";
import type { ProofLinkMCPHandle } from "../server.js";

describe("ProofLink MCP Server", () => {
  let handle: ProofLinkMCPHandle;
  let client: Client;

  beforeAll(async () => {
    handle = await createProofLinkMCPServer();
    client = new Client({ name: "test-client", version: "1.0.0" });

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await handle.server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    await handle.close();
  });

  // -------------------------------------------------------------------------
  // Tool discovery
  // -------------------------------------------------------------------------

  it("lists all 11 tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "batch_compliance_check",
      "check_sanctions",
      "create_compliant_invoice",
      "get_compliance_metrics",
      "get_compliance_receipt",
      "get_risk_report",
      "list_invoices",
      "pay_with_compliance",
      "register_agent",
      "submit_travel_rule",
      "verify_kya",
    ]);
  });

  // -------------------------------------------------------------------------
  // check_sanctions
  // -------------------------------------------------------------------------

  describe("check_sanctions", () => {
    it("clears a valid address", async () => {
      const result = await client.callTool({
        name: "check_sanctions",
        arguments: {
          address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
          chain: "ethereum",
        },
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);

      const textContent = result.content as Array<{
        type: string;
        text: string;
      }>;
      expect(textContent[0]?.text).toContain("cleared");

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        expect(data.cleared).toBe(true);
        expect(data.risk_score).toBeDefined();
        expect(data.receipt_id).toBeDefined();
        expect(Array.isArray(data.lists_checked)).toBe(true);
      }
    });

    it("returns error when address provided without chain", async () => {
      const result = await client.callTool({
        name: "check_sanctions",
        arguments: {
          address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
        },
      });

      expect(result.isError).toBe(true);
      const textContent = result.content as Array<{
        type: string;
        text: string;
      }>;
      expect(textContent[0]?.text).toContain("chain");
    });

    it("returns error when neither address nor entity_name provided", async () => {
      const result = await client.callTool({
        name: "check_sanctions",
        arguments: {},
      });

      expect(result.isError).toBe(true);
    });

    it("returns error when both address and entity_name provided", async () => {
      const result = await client.callTool({
        name: "check_sanctions",
        arguments: {
          address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
          entity_name: "Test Entity",
          chain: "ethereum",
        },
      });

      expect(result.isError).toBe(true);
      const textContent = result.content as Array<{
        type: string;
        text: string;
      }>;
      expect(textContent[0]?.text).toContain("mutually exclusive");
    });

    it("accepts entity_name without chain", async () => {
      const result = await client.callTool({
        name: "check_sanctions",
        arguments: { entity_name: "Acme Corporation" },
      });

      expect(result.isError).toBeFalsy();
    });
  });

  // -------------------------------------------------------------------------
  // verify_kya
  // -------------------------------------------------------------------------

  describe("verify_kya", () => {
    it("verifies a registered agent", async () => {
      // Uses agent_001 from the seeded agent registry
      const result = await client.callTool({
        name: "verify_kya",
        arguments: {
          agent_id: "agent_001",
        },
      });

      expect(result.isError).toBeFalsy();
      const textContent = result.content as Array<{
        type: string;
        text: string;
      }>;
      expect(textContent[0]?.text).toContain("verified");

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        expect(data.verified).toBe(true);
        expect(data.trust_score).toBeDefined();
        expect(data.agent_metadata).toBeDefined();
        expect(data.receipt_id).toBeDefined();
      }
    });

    it("includes spending limits when requested", async () => {
      const result = await client.callTool({
        name: "verify_kya",
        arguments: {
          agent_id: "agent_001",
          check_spending_limits: true,
        },
      });

      expect(result.isError).toBeFalsy();

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        expect(data.spending_limits).toBeDefined();
      }
    });

    it("fails for unregistered agent", async () => {
      const result = await client.callTool({
        name: "verify_kya",
        arguments: {
          agent_id: "agent_nonexistent",
        },
      });

      expect(result.isError).toBe(true);
      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        expect(data.verified).toBe(false);
        expect(data.trust_score).toBe(0);
      }
    });
  });

  // -------------------------------------------------------------------------
  // create_compliant_invoice
  // -------------------------------------------------------------------------

  describe("create_compliant_invoice", () => {
    it("creates an invoice with line items", async () => {
      const result = await client.callTool({
        name: "create_compliant_invoice",
        arguments: {
          seller: { wallet_address: "0xSeller123" },
          buyer: { wallet_address: "0xBuyer456" },
          line_items: [
            {
              description: "API calls - March 2026",
              quantity: 1000,
              unit_price_usd: 0.01,
              service_category: "api_call",
            },
            {
              description: "Data processing",
              quantity: 5,
              unit_price_usd: 2.0,
            },
          ],
          currency: "USDC",
        },
      });

      expect(result.isError).toBeFalsy();

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        expect(data.invoice_id).toBeDefined();
        expect(data.total_amount).toBe(20); // 1000*0.01 + 5*2.0
        expect(data.currency).toBe("USDC");
        expect(data.compliance_stamp).toBeDefined();
        expect(data.receipt_id).toBeDefined();
      }
    });

    it("flags travel rule when total exceeds threshold", async () => {
      const result = await client.callTool({
        name: "create_compliant_invoice",
        arguments: {
          seller: { wallet_address: "0xSeller123" },
          buyer: { wallet_address: "0xBuyer456" },
          line_items: [
            {
              description: "Enterprise data analysis",
              quantity: 1,
              unit_price_usd: 5000,
            },
          ],
          currency: "USDC",
        },
      });

      expect(result.isError).toBeFalsy();

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        const stamp = data.compliance_stamp as Record<string, unknown>;
        expect(stamp.travel_rule_required).toBe(true);
      }
    });
  });

  // -------------------------------------------------------------------------
  // submit_travel_rule
  // -------------------------------------------------------------------------

  describe("submit_travel_rule", () => {
    it("submits travel rule data for qualifying transaction", async () => {
      const result = await client.callTool({
        name: "submit_travel_rule",
        arguments: {
          transaction: {
            amount_usd: 5000,
            asset: "USDC",
            chain: "base",
            direction: "outgoing",
          },
          originator: {
            wallet_address: "0xOriginator123",
            name: "Alice Corp",
          },
          beneficiary: {
            wallet_address: "0xBeneficiary456",
            name: "Bob LLC",
          },
        },
      });

      expect(result.isError).toBeFalsy();

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        expect(data.submitted).toBe(true);
        expect(data.threshold_exceeded).toBe(true);
        expect(data.travel_rule_id).toBeDefined();
        expect(data.receipt_id).toBeDefined();
      }
    });

    it("skips submission for below-threshold amounts", async () => {
      const result = await client.callTool({
        name: "submit_travel_rule",
        arguments: {
          transaction: {
            amount_usd: 50,
            asset: "USDC",
            chain: "base",
            direction: "outgoing",
          },
          originator: { wallet_address: "0xOriginator123" },
          beneficiary: { wallet_address: "0xBeneficiary456" },
        },
      });

      expect(result.isError).toBeFalsy();

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        expect(data.submitted).toBe(false);
        expect(data.threshold_exceeded).toBe(false);
      }
    });
  });

  // -------------------------------------------------------------------------
  // get_compliance_receipt
  // -------------------------------------------------------------------------

  describe("get_compliance_receipt", () => {
    it("retrieves receipt by tx_hash", async () => {
      const result = await client.callTool({
        name: "get_compliance_receipt",
        arguments: {
          tx_hash: "0xabc123def456",
        },
      });

      expect(result.isError).toBeFalsy();

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        expect(data.receipt_id).toBeDefined();
        expect(data.overall_status).toBe("COMPLIANT");
        expect(data.checks_performed).toBeDefined();
        expect(data.receipt_signature).toBeDefined();
      }
    });

    it("retrieves receipt by receipt_id", async () => {
      const result = await client.callTool({
        name: "get_compliance_receipt",
        arguments: {
          receipt_id: "rcpt_test123",
        },
      });

      expect(result.isError).toBeFalsy();

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        expect(data.receipt_id).toBe("rcpt_test123");
      }
    });

    it("errors when neither tx_hash nor receipt_id provided", async () => {
      const result = await client.callTool({
        name: "get_compliance_receipt",
        arguments: {},
      });

      expect(result.isError).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // pay_with_compliance
  // -------------------------------------------------------------------------

  describe("pay_with_compliance", () => {
    it("executes a compliant payment", async () => {
      const result = await client.callTool({
        name: "pay_with_compliance",
        arguments: {
          recipient: {
            wallet_address: "0xRecipient789",
          },
          amount: { value: 100, currency: "USDC" },
          chain: "base",
        },
      });

      expect(result.isError).toBeFalsy();

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        expect(data.status).toBe("COMPLETED");
        expect(data.tx_hash).toBeDefined();
        expect(data.receipt_id).toBeDefined();

        const summary = data.compliance_summary as Record<string, unknown>;
        expect(summary.sanctions_cleared).toBe(true);
      }
    });

    it("runs dry_run without executing payment", async () => {
      const result = await client.callTool({
        name: "pay_with_compliance",
        arguments: {
          recipient: {
            wallet_address: "0xRecipient789",
            agent_id: "agent_001",
          },
          amount: { value: 2000, currency: "USDC" },
          chain: "ethereum",
          dry_run: true,
        },
      });

      expect(result.isError).toBeFalsy();

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        expect(data.status).toBe("DRY_RUN_PASSED");
        expect(data.tx_hash).toBeNull();

        const summary = data.compliance_summary as Record<string, unknown>;
        expect(summary.travel_rule_required).toBe(true);
        expect(summary.kya_verified).toBe(true);
      }
    });

    it("blocks payment when require_kya is true and no agent_id", async () => {
      const result = await client.callTool({
        name: "pay_with_compliance",
        arguments: {
          recipient: { wallet_address: "0xRecipient789" },
          amount: { value: 500, currency: "USDC" },
          chain: "base",
          require_kya: true,
        },
      });

      expect(result.isError).toBe(true);

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        expect(data.status).toBe("BLOCKED");
        expect(data.block_reason).toContain("KYA_REQUIRED");
      }
    });

    it("verifies KYA when recipient has agent_id", async () => {
      const result = await client.callTool({
        name: "pay_with_compliance",
        arguments: {
          recipient: {
            wallet_address: "0xRecipient789",
            agent_id: "agent_001",
          },
          amount: { value: 50, currency: "USDT" },
          chain: "polygon",
        },
      });

      expect(result.isError).toBeFalsy();

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        expect(data.status).toBe("COMPLETED");

        const summary = data.compliance_summary as Record<string, unknown>;
        expect(summary.kya_verified).toBe(true);
        expect(summary.travel_rule_required).toBe(false);
      }
    });
  });

  // -------------------------------------------------------------------------
  // batch_compliance_check
  // -------------------------------------------------------------------------

  describe("batch_compliance_check", () => {
    it("screens multiple addresses and returns per-address results", async () => {
      const result = await client.callTool({
        name: "batch_compliance_check",
        arguments: {
          addresses: [
            { address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", chain: "ethereum" },
            { address: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD68", chain: "base" },
          ],
        },
      });

      expect(result.isError).toBeFalsy();

      const textContent = result.content as Array<{ type: string; text: string }>;
      expect(textContent[0]?.text).toContain("2 addresses screened");

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        expect(data.batch_id).toBeDefined();
        expect(data.total).toBe(2);
        expect(data.cleared).toBe(2);
        expect(data.blocked).toBe(0);
        expect(Array.isArray(data.lists_checked)).toBe(true);
        expect(data.screened_at).toBeDefined();
        const results = data.results as Array<Record<string, unknown>>;
        expect(results).toHaveLength(2);
        expect(results[0]?.address).toBe("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
        expect(results[0]?.cleared).toBe(true);
        expect(results[0]?.risk_score).toBeDefined();
      }
    });

    it("accepts optional label per address", async () => {
      const result = await client.callTool({
        name: "batch_compliance_check",
        arguments: {
          addresses: [
            {
              address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
              chain: "ethereum",
              label: "treasury",
            },
          ],
        },
      });

      expect(result.isError).toBeFalsy();

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        const results = data.results as Array<Record<string, unknown>>;
        expect(results[0]?.label).toBe("treasury");
      }
    });

    it("runs with include_indirect flag set to true", async () => {
      const result = await client.callTool({
        name: "batch_compliance_check",
        arguments: {
          addresses: [
            { address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", chain: "base" },
          ],
          include_indirect: true,
        },
      });

      expect(result.isError).toBeFalsy();
    });

    it("returns error when addresses array is empty (zod min(1))", async () => {
      const result = await client.callTool({
        name: "batch_compliance_check",
        arguments: {
          addresses: [],
        },
      });

      expect(result.isError).toBe(true);
    });

    it("includes all four sanctions lists in lists_checked", async () => {
      const result = await client.callTool({
        name: "batch_compliance_check",
        arguments: {
          addresses: [
            { address: "0xABCDEF1234567890abcdef1234567890ABCDEF12", chain: "ethereum" },
          ],
        },
      });

      expect(result.isError).toBeFalsy();

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        const lists = data.lists_checked as string[];
        expect(lists).toContain("OFAC_SDN");
        expect(lists).toContain("EU_CONSOLIDATED");
        expect(lists).toContain("UN_CONSOLIDATED");
        expect(lists).toContain("HMT");
      }
    });
  });

  // -------------------------------------------------------------------------
  // get_risk_report
  // -------------------------------------------------------------------------

  describe("get_risk_report", () => {
    it("generates a standard risk report with transaction patterns and counterparty exposure", async () => {
      const result = await client.callTool({
        name: "get_risk_report",
        arguments: {
          address: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD68",
          chain: "ethereum",
        },
      });

      expect(result.isError).toBeFalsy();

      const textContent = result.content as Array<{ type: string; text: string }>;
      expect(textContent[0]?.text).toContain("Risk report");
      expect(textContent[0]?.text).toContain("Recommendation");

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        expect(data.report_id).toBeDefined();
        expect(data.address).toBe("0x742d35Cc6634C0532925a3b844Bc9e7595f2bD68");
        expect(data.chain).toBe("ethereum");
        expect(data.depth).toBe("standard");
        expect(data.time_range_days).toBe(90);
        expect(data.sanctions).toBeDefined();
        expect(data.risk_score).toBeDefined();
        expect(data.transaction_patterns).toBeDefined();
        expect(data.counterparty_exposure).toBeDefined();
        expect(data.behavioral_flags).toBeUndefined(); // standard depth excludes this
        expect(data.recommendation).toMatch(/^(ALLOW|BLOCK)$/);
        expect(data.eas_attestation_uid).toBeDefined();
      }
    });

    it("returns only sanctions and risk_score at basic depth", async () => {
      const result = await client.callTool({
        name: "get_risk_report",
        arguments: {
          address: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD68",
          chain: "base",
          depth: "basic",
        },
      });

      expect(result.isError).toBeFalsy();

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        expect(data.depth).toBe("basic");
        expect(data.transaction_patterns).toBeUndefined();
        expect(data.counterparty_exposure).toBeUndefined();
        expect(data.behavioral_flags).toBeUndefined();
      }
    });

    it("includes behavioral_flags at enhanced depth", async () => {
      const result = await client.callTool({
        name: "get_risk_report",
        arguments: {
          address: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD68",
          chain: "ethereum",
          depth: "enhanced",
        },
      });

      expect(result.isError).toBeFalsy();

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        expect(data.depth).toBe("enhanced");
        expect(data.transaction_patterns).toBeDefined();
        expect(data.counterparty_exposure).toBeDefined();
        expect(data.behavioral_flags).toBeDefined();
        const flags = data.behavioral_flags as Record<string, unknown>;
        expect(flags.structuring_detected).toBeDefined();
        expect(flags.velocity_anomaly).toBeDefined();
      }
    });

    it("accepts custom time_range_days", async () => {
      const result = await client.callTool({
        name: "get_risk_report",
        arguments: {
          address: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD68",
          chain: "ethereum",
          time_range_days: 30,
        },
      });

      expect(result.isError).toBeFalsy();

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        expect(data.time_range_days).toBe(30);
      }
    });

    it("returns error when address is missing", async () => {
      const result = await client.callTool({
        name: "get_risk_report",
        arguments: {
          chain: "ethereum",
        },
      });

      expect(result.isError).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // list_invoices
  // -------------------------------------------------------------------------

  describe("list_invoices", () => {
    it("returns invoices with default pagination", async () => {
      const result = await client.callTool({
        name: "list_invoices",
        arguments: {},
      });

      expect(result.isError).toBeFalsy();

      const textContent = result.content as Array<{ type: string; text: string }>;
      expect(textContent[0]?.text).toContain("Found");

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        expect(Array.isArray(data.invoices)).toBe(true);
        expect(data.total).toBeTypeOf("number");
        expect(data.limit).toBe(20);
        expect(data.offset).toBe(0);
        expect(data.has_more).toBeDefined();
        const invoices = data.invoices as Array<Record<string, unknown>>;
        if (invoices.length > 0) {
          expect(invoices[0]?.invoice_id).toBeDefined();
          expect(invoices[0]?.state).toBeDefined();
          expect(invoices[0]?.compliance_stamp).toBeDefined();
        }
      }
    });

    it("filters by status", async () => {
      const result = await client.callTool({
        name: "list_invoices",
        arguments: {
          status: "PAID",
        },
      });

      expect(result.isError).toBeFalsy();

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        const filters = data.filters_applied as Record<string, unknown>;
        expect(filters.status).toBe("PAID");
        const invoices = data.invoices as Array<Record<string, unknown>>;
        for (const inv of invoices) {
          expect(inv.state).toBe("PAID");
        }
      }
    });

    it("filters by seller_wallet", async () => {
      const sellerWallet = "0xSeller1234567890abcdef";
      const result = await client.callTool({
        name: "list_invoices",
        arguments: { seller_wallet: sellerWallet },
      });

      expect(result.isError).toBeFalsy();

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        const filters = data.filters_applied as Record<string, unknown>;
        expect(filters.seller_wallet).toBe(sellerWallet);
      }
    });

    it("filters by currency", async () => {
      const result = await client.callTool({
        name: "list_invoices",
        arguments: { currency: "USDT" },
      });

      expect(result.isError).toBeFalsy();

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        const filters = data.filters_applied as Record<string, unknown>;
        expect(filters.currency).toBe("USDT");
      }
    });

    it("respects limit and offset", async () => {
      const result = await client.callTool({
        name: "list_invoices",
        arguments: { limit: 5, offset: 10 },
      });

      expect(result.isError).toBeFalsy();

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        expect(data.limit).toBe(5);
        expect(data.offset).toBe(10);
      }
    });

    it("filters by date range", async () => {
      const result = await client.callTool({
        name: "list_invoices",
        arguments: {
          date_from: "2026-01-01T00:00:00Z",
          date_to: "2026-12-31T23:59:59Z",
        },
      });

      expect(result.isError).toBeFalsy();

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        const filters = data.filters_applied as Record<string, unknown>;
        expect(filters.date_from).toBe("2026-01-01T00:00:00Z");
        expect(filters.date_to).toBe("2026-12-31T23:59:59Z");
      }
    });

    it("filters by amount range", async () => {
      const result = await client.callTool({
        name: "list_invoices",
        arguments: { min_amount: 100, max_amount: 5000 },
      });

      expect(result.isError).toBeFalsy();

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        const filters = data.filters_applied as Record<string, unknown>;
        expect(filters.min_amount).toBe(100);
        expect(filters.max_amount).toBe(5000);
      }
    });
  });

  // -------------------------------------------------------------------------
  // get_compliance_metrics
  // -------------------------------------------------------------------------

  describe("get_compliance_metrics", () => {
    it("returns metrics for default 24h time range", async () => {
      const result = await client.callTool({
        name: "get_compliance_metrics",
        arguments: {},
      });

      expect(result.isError).toBeFalsy();

      const textContent = result.content as Array<{ type: string; text: string }>;
      expect(textContent[0]?.text).toContain("Metrics (24h)");

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        expect(data.time_range).toBe("24h");
        expect(data.generated_at).toBeDefined();
        expect(data.sanctions_screening).toBeDefined();
        expect(data.kya_verification).toBeDefined();
        expect(data.travel_rule).toBeDefined();
        expect(data.payments).toBeDefined();
        expect(data.system).toBeDefined();
      }
    });

    it("returns metrics for each supported time range", async () => {
      const timeRanges = ["1h", "6h", "24h", "7d", "30d"] as const;

      for (const time_range of timeRanges) {
        const result = await client.callTool({
          name: "get_compliance_metrics",
          arguments: { time_range },
        });

        expect(result.isError).toBeFalsy();

        if (result.structuredContent) {
          const data = result.structuredContent as Record<string, unknown>;
          expect(data.time_range).toBe(time_range);
        }
      }
    });

    it("omits latency_percentiles by default", async () => {
      const result = await client.callTool({
        name: "get_compliance_metrics",
        arguments: { time_range: "7d" },
      });

      expect(result.isError).toBeFalsy();

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        const sanctions = data.sanctions_screening as Record<string, unknown>;
        expect(sanctions.latency_percentiles).toBeUndefined();
      }
    });

    it("includes latency_percentiles when requested", async () => {
      const result = await client.callTool({
        name: "get_compliance_metrics",
        arguments: { include_latency_percentiles: true },
      });

      expect(result.isError).toBeFalsy();

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        const sanctions = data.sanctions_screening as Record<string, unknown>;
        expect(sanctions.latency_percentiles).toBeDefined();
        const percentiles = sanctions.latency_percentiles as Record<string, number>;
        expect(percentiles.p50).toBeTypeOf("number");
        expect(percentiles.p95).toBeTypeOf("number");
        expect(percentiles.p99).toBeTypeOf("number");
        const kya = data.kya_verification as Record<string, unknown>;
        expect(kya.latency_percentiles).toBeDefined();
        const travelRule = data.travel_rule as Record<string, unknown>;
        expect(travelRule.latency_percentiles).toBeDefined();
      }
    });

    it("returns system metrics with expected shape", async () => {
      const result = await client.callTool({
        name: "get_compliance_metrics",
        arguments: {},
      });

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        const system = data.system as Record<string, unknown>;
        expect(system.uptime_seconds).toBeTypeOf("number");
        expect(system.api_requests_total).toBeTypeOf("number");
        expect(system.error_rate).toBeTypeOf("number");
        expect(system.active_agents).toBeTypeOf("number");
      }
    });
  });

  // -------------------------------------------------------------------------
  // register_agent
  // -------------------------------------------------------------------------

  describe("register_agent", () => {
    it("registers a new agent and returns agent_id and DID", async () => {
      const result = await client.callTool({
        name: "register_agent",
        arguments: {
          name: "PaymentBot-v2",
          type: "semi-autonomous",
          wallet_address: "0xABC123DEF456abc123def456ABC123DEF456abc1",
          operator: {
            name: "Acme Corp",
            did: "did:web:acme.com",
          },
          delegation_scope: {
            max_transaction_usd: 10000,
            daily_limit_usd: 50000,
            allowed_chains: ["base", "ethereum"],
            allowed_currencies: ["USDC"],
          },
        },
      });

      expect(result.isError).toBeFalsy();

      const textContent = result.content as Array<{ type: string; text: string }>;
      expect(textContent[0]?.text).toContain("PaymentBot-v2");
      expect(textContent[0]?.text).toContain("registered");

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        expect(data.agent_id).toBeDefined();
        expect(data.did).toMatch(/^did:prooflink:/);
        expect(data.name).toBe("PaymentBot-v2");
        expect(data.type).toBe("semi-autonomous");
        expect(data.wallet_address).toBe("0xABC123DEF456abc123def456ABC123DEF456abc1");
        expect(data.status).toBe("ACTIVE");
        expect(data.reputation_score).toBe(50);
        expect(data.registered_at).toBeDefined();
      }
    });

    it("registers agent with all three type values", async () => {
      const types = ["autonomous", "semi-autonomous", "human-supervised"] as const;

      for (const type of types) {
        const result = await client.callTool({
          name: "register_agent",
          arguments: {
            name: `TestAgent-${type}`,
            type,
            wallet_address: "0xABC123DEF456abc123def456ABC123DEF456abc1",
            operator: { name: "Test Corp" },
            delegation_scope: { max_transaction_usd: 1000 },
          },
        });

        expect(result.isError).toBeFalsy();

        if (result.structuredContent) {
          const data = result.structuredContent as Record<string, unknown>;
          expect(data.type).toBe(type);
        }
      }
    });

    it("defaults daily_limit_usd to 5x max_transaction_usd when not provided", async () => {
      const result = await client.callTool({
        name: "register_agent",
        arguments: {
          name: "SimpleAgent",
          type: "autonomous",
          wallet_address: "0xABC123DEF456abc123def456ABC123DEF456abc1",
          operator: { name: "Test Corp" },
          delegation_scope: { max_transaction_usd: 2000 },
        },
      });

      expect(result.isError).toBeFalsy();

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        const scope = data.delegation_scope as Record<string, unknown>;
        expect(scope.daily_limit_usd).toBe(10000); // 2000 * 5
      }
    });

    it("defaults allowed_chains to [base] when not provided", async () => {
      const result = await client.callTool({
        name: "register_agent",
        arguments: {
          name: "ChainDefaultAgent",
          type: "human-supervised",
          wallet_address: "0xABC123DEF456abc123def456ABC123DEF456abc1",
          operator: { name: "Test Corp" },
          delegation_scope: { max_transaction_usd: 500 },
        },
      });

      expect(result.isError).toBeFalsy();

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        const scope = data.delegation_scope as Record<string, unknown>;
        expect(scope.allowed_chains).toEqual(["base"]);
        expect(scope.allowed_currencies).toEqual(["USDC"]);
      }
    });

    it("sets kyc_verified=true when operator DID is provided", async () => {
      const result = await client.callTool({
        name: "register_agent",
        arguments: {
          name: "VerifiedAgent",
          type: "semi-autonomous",
          wallet_address: "0xABC123DEF456abc123def456ABC123DEF456abc1",
          operator: {
            name: "Verified Corp",
            did: "did:web:verified.com",
          },
          delegation_scope: { max_transaction_usd: 5000 },
        },
      });

      expect(result.isError).toBeFalsy();

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        const operator = data.operator as Record<string, unknown>;
        const screening = operator.screening as Record<string, unknown>;
        expect(screening.kyc_verified).toBe(true);
        expect(screening.sanctions_cleared).toBe(true);
      }
    });

    it("sets kyc_verified=false when operator DID is absent", async () => {
      const result = await client.callTool({
        name: "register_agent",
        arguments: {
          name: "UnverifiedAgent",
          type: "semi-autonomous",
          wallet_address: "0xABC123DEF456abc123def456ABC123DEF456abc1",
          operator: { name: "Unverified Corp" }, // no DID
          delegation_scope: { max_transaction_usd: 500 },
        },
      });

      expect(result.isError).toBeFalsy();

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        const operator = data.operator as Record<string, unknown>;
        const screening = operator.screening as Record<string, unknown>;
        expect(screening.kyc_verified).toBe(false);
      }
    });

    it("enables x402_support flag", async () => {
      const result = await client.callTool({
        name: "register_agent",
        arguments: {
          name: "X402Agent",
          type: "autonomous",
          wallet_address: "0xABC123DEF456abc123def456ABC123DEF456abc1",
          operator: { name: "X402 Corp" },
          delegation_scope: { max_transaction_usd: 1000 },
          x402_support: true,
        },
      });

      expect(result.isError).toBeFalsy();

      if (result.structuredContent) {
        const data = result.structuredContent as Record<string, unknown>;
        expect(data.x402_support).toBe(true);
      }
    });

    it("returns error for missing name", async () => {
      const result = await client.callTool({
        name: "register_agent",
        arguments: {
          type: "autonomous",
          wallet_address: "0xABC123",
          operator: { name: "Test Corp" },
          delegation_scope: { max_transaction_usd: 1000 },
        },
      });

      expect(result.isError).toBe(true);
    });

    it("returns error for missing operator", async () => {
      const result = await client.callTool({
        name: "register_agent",
        arguments: {
          name: "NoOperatorAgent",
          type: "autonomous",
          wallet_address: "0xABC123",
          delegation_scope: { max_transaction_usd: 1000 },
        },
      });

      expect(result.isError).toBe(true);
    });
  });
});
