import { describe, expect, it } from "vitest";
import { RequestFinanceAdapter } from "../adapter.js";
import type { AgentInvoice } from "@prooflink/shared/types";
import type { RequestNetworkInvoice } from "../types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProofLinkInvoice(
  overrides?: Partial<AgentInvoice>,
): AgentInvoice {
  return {
    "@context": [
      "https://schema.org",
      "https://prooflink.io/invoices/v1",
    ],
    "@type": "Invoice",
    invoiceId: "fl-inv-001",
    state: "ISSUED",
    seller: {
      agentId: "agent:seller-1",
      walletAddress: "0xSeller1234567890abcdef1234567890abcdef",
      legalName: "Agent Corp",
      taxId: "US-12-3456789",
    },
    buyer: {
      agentId: "agent:buyer-1",
      walletAddress: "0xBuyer1234567890abcdef1234567890abcdef0",
      legalName: "Buyer LLC",
    },
    lineItems: [
      {
        description: "GPT-4o API calls (1000 requests)",
        quantity: 1000,
        unit: "request",
        unitPrice: 0.03,
        total: 30.0,
        serviceCategory: "api_call",
      },
      {
        description: "Data processing pipeline execution",
        quantity: 5,
        unit: "unit",
        unitPrice: 10.0,
        total: 50.0,
        serviceCategory: "compute",
      },
    ],
    currency: "USDC",
    totalAmount: 80.0,
    anchoredOnChain: false,
    dueDate: "2026-04-15T00:00:00.000Z",
    createdAt: "2026-03-21T10:00:00.000Z",
    updatedAt: "2026-03-21T10:00:00.000Z",
    complianceStamp: {
      proofLinkReceiptId: "receipt-abc-123",
      sanctionsCleared: true,
      travelRuleTransmitted: false,
      amlRiskScore: 12,
      easAttestationUid: "0xeas123",
    },
    ...overrides,
  };
}

function makeRNInvoice(
  overrides?: Partial<RequestNetworkInvoice>,
): RequestNetworkInvoice {
  return {
    requestId: "rn-req-001",
    version: "0.62.0",
    state: "created",
    payee: {
      type: "ethereumAddress",
      value: "0xPayee1234567890abcdef1234567890abcdef0",
    },
    payer: {
      type: "ethereumAddress",
      value: "0xPayer1234567890abcdef1234567890abcdef0",
    },
    currency: {
      type: "ERC20",
      value: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      network: "mainnet",
      decimals: 6,
    },
    expectedAmount: "150000000", // 150 USDC (6 decimals)
    timestamp: 1711018800,
    creationDate: "2026-03-21T10:00:00.000Z",
    paymentDueDate: "2026-04-15T00:00:00.000Z",
    contentData: {
      reason: "Infrastructure services",
      createdWith: "RequestFinance",
      invoiceNumber: "RF-2026-042",
      invoiceItems: [
        {
          name: "Cloud compute (March 2026)",
          quantity: 1,
          unitPrice: "15000", // $150.00 in cents
          currency: "USDC",
        },
      ],
      sellerInfo: {
        businessName: "Infra Provider Inc",
        taxRegistration: "GB-123456789",
      },
      buyerInfo: {
        businessName: "DeFi Protocol DAO",
      },
      prooflinkCompliance: {
        proofLinkReceiptId: "receipt-xyz-456",
        complianceStatus: "verified",
        sanctionsCleared: true,
        travelRuleTransmitted: true,
        amlRiskScore: 8,
        easAttestationUid: "0xeas456",
      },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RequestFinanceAdapter", () => {
  const adapter = new RequestFinanceAdapter();

  // -----------------------------------------------------------------------
  // ProofLink → Request Network
  // -----------------------------------------------------------------------

  describe("toRequestNetwork", () => {
    it("should convert a ProofLink invoice to RN format", () => {
      const fl = makeProofLinkInvoice();
      const rn = adapter.toRequestNetwork(fl);

      expect(rn.requestId).toBe("fl-fl-inv-001");
      expect(rn.state).toBe("created"); // ISSUED → created
      expect(rn.payee.value).toBe(fl.seller.walletAddress);
      expect(rn.payer.value).toBe(fl.buyer.walletAddress);
      expect(rn.currency.type).toBe("ERC20");
      expect(rn.currency.network).toBe("mainnet");
      // 80 USDC = 80_000_000 in 6 decimal representation
      expect(rn.expectedAmount).toBe("80000000");
      expect(rn.paymentDueDate).toBe("2026-04-15T00:00:00.000Z");
    });

    it("should include line items in contentData", () => {
      const fl = makeProofLinkInvoice();
      const rn = adapter.toRequestNetwork(fl);

      expect(rn.contentData?.invoiceItems).toHaveLength(2);
      expect(rn.contentData?.invoiceItems?.[0]?.name).toBe(
        "GPT-4o API calls (1000 requests)",
      );
      expect(rn.contentData?.invoiceItems?.[0]?.quantity).toBe(1000);
    });

    it("should map compliance stamp to prooflinkCompliance extension", () => {
      const fl = makeProofLinkInvoice();
      const rn = adapter.toRequestNetwork(fl);

      expect(rn.contentData?.prooflinkCompliance).toBeDefined();
      expect(
        rn.contentData?.prooflinkCompliance?.proofLinkReceiptId,
      ).toBe("receipt-abc-123");
      expect(rn.contentData?.prooflinkCompliance?.sanctionsCleared).toBe(
        true,
      );
      expect(rn.contentData?.prooflinkCompliance?.amlRiskScore).toBe(12);
      expect(
        rn.contentData?.prooflinkCompliance?.easAttestationUid,
      ).toBe("0xeas123");
    });

    it("should include seller and buyer info", () => {
      const fl = makeProofLinkInvoice();
      const rn = adapter.toRequestNetwork(fl);

      expect(rn.contentData?.sellerInfo?.businessName).toBe("Agent Corp");
      expect(rn.contentData?.sellerInfo?.taxRegistration).toBe(
        "US-12-3456789",
      );
      expect(rn.contentData?.buyerInfo?.businessName).toBe("Buyer LLC");
    });

    it("should map all invoice states correctly", () => {
      const states: Array<[AgentInvoice["state"], string]> = [
        ["DRAFT", "created"],
        ["ISSUED", "created"],
        ["PAID", "paid"],
        ["SETTLED", "paid"],
        ["CANCELLED", "canceled"],
      ];

      for (const [flState, rnState] of states) {
        const rn = adapter.toRequestNetwork(
          makeProofLinkInvoice({ state: flState }),
        );
        expect(rn.state).toBe(rnState);
      }
    });

    it("should handle invoice without compliance stamp", () => {
      const fl = makeProofLinkInvoice({ complianceStamp: undefined });
      const rn = adapter.toRequestNetwork(fl);

      expect(rn.contentData?.prooflinkCompliance).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Request Network → ProofLink
  // -----------------------------------------------------------------------

  describe("fromRequestNetwork", () => {
    it("should convert an RN invoice to ProofLink format", () => {
      const rn = makeRNInvoice();
      const fl = adapter.fromRequestNetwork(rn);

      expect(fl.invoiceId).toBe("RF-2026-042");
      expect(fl.state).toBe("ISSUED"); // created → ISSUED
      expect(fl.seller.walletAddress).toBe(rn.payee.value);
      expect(fl.buyer.walletAddress).toBe(rn.payer.value);
      expect(fl.currency).toBe("USDC");
      expect(fl.totalAmount).toBe(150); // 150_000_000 / 10^6
      expect(fl.anchoredOnChain).toBe(true);
    });

    it("should map line items from RN invoiceItems", () => {
      const rn = makeRNInvoice();
      const fl = adapter.fromRequestNetwork(rn);

      expect(fl.lineItems).toHaveLength(1);
      expect(fl.lineItems[0].description).toBe(
        "Cloud compute (March 2026)",
      );
      expect(fl.lineItems[0].quantity).toBe(1);
      expect(fl.lineItems[0].unitPrice).toBe(150); // 15000 cents / 100
    });

    it("should extract compliance stamp from prooflinkCompliance", () => {
      const rn = makeRNInvoice();
      const fl = adapter.fromRequestNetwork(rn);

      expect(fl.complianceStamp).toBeDefined();
      expect(fl.complianceStamp?.proofLinkReceiptId).toBe(
        "receipt-xyz-456",
      );
      expect(fl.complianceStamp?.sanctionsCleared).toBe(true);
      expect(fl.complianceStamp?.travelRuleTransmitted).toBe(true);
      expect(fl.complianceStamp?.amlRiskScore).toBe(8);
    });

    it("should extract seller and buyer info", () => {
      const rn = makeRNInvoice();
      const fl = adapter.fromRequestNetwork(rn);

      expect(fl.seller.legalName).toBe("Infra Provider Inc");
      expect(fl.seller.taxId).toBe("GB-123456789");
      expect(fl.buyer.legalName).toBe("DeFi Protocol DAO");
    });

    it("should map all RN states correctly", () => {
      const states: Array<[RequestNetworkInvoice["state"], string]> = [
        ["created", "ISSUED"],
        ["accepted", "ISSUED"],
        ["canceled", "CANCELLED"],
        ["paid", "PAID"],
        ["overpaid", "PAID"],
        ["underpaid", "ISSUED"],
      ];

      for (const [rnState, flState] of states) {
        const fl = adapter.fromRequestNetwork(
          makeRNInvoice({ state: rnState }),
        );
        expect(fl.state).toBe(flState);
      }
    });

    it("should create a fallback line item when no invoiceItems exist", () => {
      const rn = makeRNInvoice({
        contentData: { reason: "Monthly retainer" },
      });
      const fl = adapter.fromRequestNetwork(rn);

      expect(fl.lineItems).toHaveLength(1);
      expect(fl.lineItems[0].description).toBe("Monthly retainer");
      expect(fl.lineItems[0].total).toBe(150);
    });

    it("should handle missing contentData gracefully", () => {
      const rn = makeRNInvoice({ contentData: undefined });
      const fl = adapter.fromRequestNetwork(rn);

      expect(fl.invoiceId).toBe(rn.requestId);
      expect(fl.lineItems).toHaveLength(1);
      expect(fl.complianceStamp).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Bidirectional Round-trip
  // -----------------------------------------------------------------------

  describe("round-trip conversion", () => {
    it("should preserve key fields through ProofLink → RN → ProofLink", () => {
      const original = makeProofLinkInvoice();
      const rn = adapter.toRequestNetwork(original);
      const roundTripped = adapter.fromRequestNetwork(rn);

      // Core fields should survive the round-trip
      expect(roundTripped.seller.walletAddress).toBe(
        original.seller.walletAddress,
      );
      expect(roundTripped.buyer.walletAddress).toBe(
        original.buyer.walletAddress,
      );
      expect(roundTripped.totalAmount).toBe(original.totalAmount);
      expect(roundTripped.currency).toBe(original.currency);
      expect(roundTripped.dueDate).toBe(original.dueDate);
      expect(roundTripped.anchoredOnChain).toBe(true);

      // Compliance stamp survives
      expect(roundTripped.complianceStamp?.proofLinkReceiptId).toBe(
        original.complianceStamp?.proofLinkReceiptId,
      );
      expect(roundTripped.complianceStamp?.sanctionsCleared).toBe(
        original.complianceStamp?.sanctionsCleared,
      );
    });

    it("should preserve key fields through RN → ProofLink → RN", () => {
      const original = makeRNInvoice();
      const fl = adapter.fromRequestNetwork(original);
      const roundTripped = adapter.toRequestNetwork(fl);

      expect(roundTripped.payee.value).toBe(original.payee.value);
      expect(roundTripped.payer.value).toBe(original.payer.value);
      expect(roundTripped.expectedAmount).toBe(original.expectedAmount);
      expect(roundTripped.paymentDueDate).toBe(original.paymentDueDate);
    });
  });

  // -----------------------------------------------------------------------
  // State Sync
  // -----------------------------------------------------------------------

  describe("syncState", () => {
    it("should detect state change from ISSUED to PAID", () => {
      const result = adapter.syncState("ISSUED", "paid");
      expect(result.newState).toBe("PAID");
      expect(result.changed).toBe(true);
    });

    it("should detect no change when states match", () => {
      const result = adapter.syncState("ISSUED", "created");
      expect(result.newState).toBe("ISSUED");
      expect(result.changed).toBe(false);
    });

    it("should map canceled to CANCELLED", () => {
      const result = adapter.syncState("ISSUED", "canceled");
      expect(result.newState).toBe("CANCELLED");
      expect(result.changed).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Compliance Stamp Mapping
  // -----------------------------------------------------------------------

  describe("complianceStampToExtension", () => {
    it("should map all ComplianceStamp fields to extension data", () => {
      const stamp = {
        proofLinkReceiptId: "receipt-001",
        sanctionsCleared: true,
        travelRuleTransmitted: true,
        amlRiskScore: 25,
        easAttestationUid: "0xeas789",
      };

      const ext = adapter.complianceStampToExtension(stamp);

      expect(ext.proofLinkReceiptId).toBe("receipt-001");
      expect(ext.complianceStatus).toBe("verified");
      expect(ext.sanctionsCleared).toBe(true);
      expect(ext.travelRuleTransmitted).toBe(true);
      expect(ext.amlRiskScore).toBe(25);
      expect(ext.easAttestationUid).toBe("0xeas789");
    });
  });

  describe("extensionToComplianceStamp", () => {
    it("should map extension data back to ComplianceStamp", () => {
      const ext = {
        proofLinkReceiptId: "receipt-002",
        complianceStatus: "verified",
        sanctionsCleared: true,
        travelRuleTransmitted: false,
        amlRiskScore: 30,
        easAttestationUid: "0xeas999",
      };

      const stamp = adapter.extensionToComplianceStamp(ext);

      expect(stamp).toBeDefined();
      expect(stamp?.proofLinkReceiptId).toBe("receipt-002");
      expect(stamp?.sanctionsCleared).toBe(true);
      expect(stamp?.travelRuleTransmitted).toBe(false);
      expect(stamp?.amlRiskScore).toBe(30);
    });

    it("should return undefined when proofLinkReceiptId is missing", () => {
      const ext = {
        complianceStatus: "verified",
        sanctionsCleared: true,
      };

      const stamp = adapter.extensionToComplianceStamp(ext);
      expect(stamp).toBeUndefined();
    });
  });
});
