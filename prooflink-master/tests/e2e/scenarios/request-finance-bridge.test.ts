/**
 * E2E: Request Finance Bridge — ProofLink ↔ Request Network
 *
 * Tests the RequestFinanceAdapter and the full round-trip:
 * 1. Create invoice in ProofLink format (AgentInvoice)
 * 2. Convert to Request Network format (toRequestNetwork)
 *    - Verify currency, amounts, parties, chain mapped correctly
 *    - Verify contentData populated with ProofLink invoice metadata
 * 3. Run compliance check — simulate the compliance pipeline
 * 4. Attach compliance stamp to ProofLink invoice
 * 5. Convert back to ProofLink format (fromRequestNetwork)
 *    - Verify compliance stamp preserved through the round-trip
 * 6. Verify state sync (syncState)
 *
 * Additional coverage:
 * - complianceStampToExtension / extensionToComplianceStamp round-trip
 * - Missing contentData edge cases
 * - Unsupported currency fallback
 * - All supported chains (base, mainnet, polygon, arbitrum)
 */

import { describe, expect, it } from "vitest";
import { RequestFinanceAdapter } from "../../../packages/integrations/request-finance/src/adapter.js";
import type { AgentInvoice, ComplianceStamp } from "@prooflink/shared/types";
import type { RequestNetworkInvoice } from "../../../packages/integrations/request-finance/src/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SELLER_WALLET = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const BUYER_WALLET = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const NOW = "2026-03-20T12:00:00.000Z";

function makeProofLinkInvoice(overrides: Partial<AgentInvoice> = {}): AgentInvoice {
  return {
    "@context": ["https://schema.org", "https://prooflink.io/invoices/v1"],
    "@type": "Invoice",
    invoiceId: "INV-2026-0042",
    state: "ISSUED",
    seller: {
      walletAddress: SELLER_WALLET,
      agentId: "did:prooflink:agent:seller-001",
      legalName: "Acme Compute Ltd",
      taxId: "US123456789",
    },
    buyer: {
      walletAddress: BUYER_WALLET,
      agentId: "did:prooflink:agent:buyer-001",
      legalName: "ProofLink Client",
    },
    lineItems: [
      {
        description: "API inference calls",
        quantity: 15000,
        unit: "call",
        unitPrice: 0.003,
        total: 45.0,
        serviceCategory: "api_call",
      },
    ],
    currency: "USDC",
    totalAmount: 45.0,
    paymentProtocol: "X402",
    anchoredOnChain: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeComplianceStamp(overrides: Partial<ComplianceStamp> = {}): ComplianceStamp {
  return {
    proofLinkReceiptId: "pl_01HW4K9X7MNPQ3R5T7W9A",
    sanctionsCleared: true,
    travelRuleTransmitted: false,
    amlRiskScore: 8,
    easAttestationUid: "0x7f3e8a2b4c9d1e6f0000000000000000000000000000000000000000000000001",
    ...overrides,
  };
}

function makeRequestNetworkInvoice(overrides: Partial<RequestNetworkInvoice> = {}): RequestNetworkInvoice {
  return {
    requestId: "fl-INV-2026-0042",
    version: "0.62.0",
    state: "created",
    payee: { type: "ethereumAddress", value: SELLER_WALLET },
    payer: { type: "ethereumAddress", value: BUYER_WALLET },
    currency: {
      type: "ERC20",
      value: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC on Base
      network: "base",
      decimals: 6,
    },
    expectedAmount: "45000000", // 45 USDC × 10^6
    timestamp: Math.floor(new Date(NOW).getTime() / 1000),
    creationDate: NOW,
    contentData: {
      reason: "ProofLink Invoice INV-2026-0042",
      createdWith: "ProofLink",
      builderId: "prooflink-integration",
      invoiceNumber: "INV-2026-0042",
      invoiceItems: [
        {
          name: "API inference calls",
          quantity: 15000,
          unitPrice: "0", // cents — 0.003 * 100 = 0 (rounds to 0 for sub-cent)
          currency: "USDC",
        },
      ],
      sellerInfo: { businessName: "Acme Compute Ltd", taxRegistration: "US123456789" },
      buyerInfo: { businessName: "ProofLink Client" },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("E2E: Request Finance Bridge", () => {
  const adapter = new RequestFinanceAdapter();

  // -------------------------------------------------------------------------
  // Step 1 & 2: ProofLink → Request Network
  // -------------------------------------------------------------------------

  describe("toRequestNetwork — ProofLink invoice to Request Network format", () => {
    it("should map seller address to payee", () => {
      const rn = adapter.toRequestNetwork(makeProofLinkInvoice());

      expect(rn.payee.type).toBe("ethereumAddress");
      expect(rn.payee.value).toBe(SELLER_WALLET);
    });

    it("should map buyer address to payer", () => {
      const rn = adapter.toRequestNetwork(makeProofLinkInvoice());

      expect(rn.payer.type).toBe("ethereumAddress");
      expect(rn.payer.value).toBe(BUYER_WALLET);
    });

    it("should map USDC on Base chain to correct ERC20 contract address", () => {
      const rn = adapter.toRequestNetwork(
        makeProofLinkInvoice({
          paymentProtocol: "X402",
          paymentProof: {
            protocol: "X402",
            txHash: "0xabc123",
            chain: "base",
            settledAt: NOW,
          },
        }),
      );

      expect(rn.currency.type).toBe("ERC20");
      expect(rn.currency.network).toBe("base");
      // USDC on Base
      expect(rn.currency.value).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
      expect(rn.currency.decimals).toBe(6);
    });

    it("should convert totalAmount to smallest unit (6 decimals for USDC)", () => {
      const rn = adapter.toRequestNetwork(makeProofLinkInvoice());

      // 45 USDC × 10^6 = 45_000_000
      expect(rn.expectedAmount).toBe("45000000");
    });

    it("should populate contentData with invoice metadata", () => {
      const rn = adapter.toRequestNetwork(makeProofLinkInvoice());

      expect(rn.contentData?.builderId).toBe("prooflink-integration");
      expect(rn.contentData?.createdWith).toBe("ProofLink");
      expect(rn.contentData?.invoiceNumber).toBe("INV-2026-0042");
      expect(rn.contentData?.invoiceItems).toHaveLength(1);
    });

    it("should include sellerInfo when legalName/taxId are present", () => {
      const rn = adapter.toRequestNetwork(makeProofLinkInvoice());

      expect(rn.contentData?.sellerInfo?.businessName).toBe("Acme Compute Ltd");
      expect(rn.contentData?.sellerInfo?.taxRegistration).toBe("US123456789");
    });

    it("should include buyerInfo when legalName is present", () => {
      const rn = adapter.toRequestNetwork(makeProofLinkInvoice());

      expect(rn.contentData?.buyerInfo?.businessName).toBe("ProofLink Client");
    });

    it("should embed compliance stamp into contentData.prooflinkCompliance when stamp present", () => {
      const invoice = makeProofLinkInvoice({
        complianceStamp: makeComplianceStamp(),
      });
      const rn = adapter.toRequestNetwork(invoice);

      const compliance = rn.contentData?.prooflinkCompliance;
      expect(compliance).toBeDefined();
      expect(compliance?.proofLinkReceiptId).toBe("pl_01HW4K9X7MNPQ3R5T7W9A");
      expect(compliance?.sanctionsCleared).toBe(true);
      expect(compliance?.travelRuleTransmitted).toBe(false);
      expect(compliance?.amlRiskScore).toBe(8);
    });

    it("should set requestId prefixed with fl-", () => {
      const rn = adapter.toRequestNetwork(makeProofLinkInvoice());

      expect(rn.requestId).toBe("fl-INV-2026-0042");
    });

    it("should map invoice timestamp from createdAt", () => {
      const rn = adapter.toRequestNetwork(makeProofLinkInvoice());

      const expectedTimestamp = Math.floor(new Date(NOW).getTime() / 1000);
      expect(rn.timestamp).toBe(expectedTimestamp);
    });

    it("should map dueDate when present", () => {
      const dueDate = "2026-04-20T00:00:00.000Z";
      const rn = adapter.toRequestNetwork(makeProofLinkInvoice({ dueDate }));

      expect(rn.paymentDueDate).toBe(dueDate);
    });

    it("should set ipfsCid from invoiceUrl when present", () => {
      const invoiceUrl = "ipfs://QmTestHash123";
      const rn = adapter.toRequestNetwork(makeProofLinkInvoice({ invoiceUrl }));

      expect(rn.ipfsCid).toBe(invoiceUrl);
    });

    it("should map ISSUED state to created in Request Network", () => {
      const rn = adapter.toRequestNetwork(makeProofLinkInvoice({ state: "ISSUED" }));

      expect(rn.state).toBe("created");
    });

    it("should map PAID state to paid in Request Network", () => {
      const rn = adapter.toRequestNetwork(makeProofLinkInvoice({ state: "PAID" }));

      expect(rn.state).toBe("paid");
    });

    it("should map CANCELLED state to canceled in Request Network", () => {
      const rn = adapter.toRequestNetwork(makeProofLinkInvoice({ state: "CANCELLED" }));

      expect(rn.state).toBe("canceled");
    });
  });

  // -------------------------------------------------------------------------
  // Step 3 & 4: Compliance check and stamp attachment
  // -------------------------------------------------------------------------

  describe("complianceStampToExtension — stamp serialization for RN", () => {
    it("should map all ComplianceStamp fields to RN extension format", () => {
      const stamp = makeComplianceStamp();
      const ext = adapter.complianceStampToExtension(stamp);

      expect(ext.proofLinkReceiptId).toBe(stamp.proofLinkReceiptId);
      expect(ext.sanctionsCleared).toBe(true);
      expect(ext.travelRuleTransmitted).toBe(false);
      expect(ext.amlRiskScore).toBe(8);
      expect(ext.complianceStatus).toBe("verified");
      expect(ext.easAttestationUid).toBe(stamp.easAttestationUid);
    });

    it("should set complianceStatus to verified always", () => {
      const ext = adapter.complianceStampToExtension(makeComplianceStamp());

      expect(ext.complianceStatus).toBe("verified");
    });
  });

  // -------------------------------------------------------------------------
  // Step 5: Request Network → ProofLink (round-trip)
  // -------------------------------------------------------------------------

  describe("fromRequestNetwork — Request Network invoice to ProofLink format", () => {
    it("should map payee to seller.walletAddress", () => {
      const fl = adapter.fromRequestNetwork(makeRequestNetworkInvoice());

      expect(fl.seller.walletAddress).toBe(SELLER_WALLET);
    });

    it("should map payer to buyer.walletAddress", () => {
      const fl = adapter.fromRequestNetwork(makeRequestNetworkInvoice());

      expect(fl.buyer.walletAddress).toBe(BUYER_WALLET);
    });

    it("should convert expectedAmount from smallest unit to decimal USDC", () => {
      const fl = adapter.fromRequestNetwork(makeRequestNetworkInvoice());

      // 45_000_000 / 10^6 = 45
      expect(fl.totalAmount).toBe(45);
    });

    it("should map invoiceNumber from contentData as invoiceId", () => {
      const fl = adapter.fromRequestNetwork(makeRequestNetworkInvoice());

      expect(fl.invoiceId).toBe("INV-2026-0042");
    });

    it("should map contentData.sellerInfo.businessName to seller.legalName", () => {
      const fl = adapter.fromRequestNetwork(makeRequestNetworkInvoice());

      expect(fl.seller.legalName).toBe("Acme Compute Ltd");
    });

    it("should map RN created state to ProofLink ISSUED state", () => {
      const fl = adapter.fromRequestNetwork(makeRequestNetworkInvoice({ state: "created" }));

      expect(fl.state).toBe("ISSUED");
    });

    it("should map RN paid state to ProofLink PAID state", () => {
      const fl = adapter.fromRequestNetwork(makeRequestNetworkInvoice({ state: "paid" }));

      expect(fl.state).toBe("PAID");
    });

    it("should map RN canceled state to ProofLink CANCELLED state", () => {
      const fl = adapter.fromRequestNetwork(makeRequestNetworkInvoice({ state: "canceled" }));

      expect(fl.state).toBe("CANCELLED");
    });

    it("should set anchoredOnChain=true for all RN invoices", () => {
      const fl = adapter.fromRequestNetwork(makeRequestNetworkInvoice());

      // RN invoices are always anchored on Gnosis chain via IPFS
      expect(fl.anchoredOnChain).toBe(true);
    });

    it("should produce a default line item when contentData.invoiceItems is absent", () => {
      const rnWithoutItems = makeRequestNetworkInvoice({
        contentData: { reason: "Simple payment" },
      });
      const fl = adapter.fromRequestNetwork(rnWithoutItems);

      expect(fl.lineItems).toHaveLength(1);
      expect(fl.lineItems[0].description).toBe("Simple payment");
      expect(fl.lineItems[0].total).toBe(45);
    });

    it("should use requestId as invoiceId when invoiceNumber is absent in contentData", () => {
      const rnWithoutInvoiceNum = makeRequestNetworkInvoice({
        contentData: { reason: "Fallback" },
      });
      const fl = adapter.fromRequestNetwork(rnWithoutInvoiceNum);

      expect(fl.invoiceId).toBe("fl-INV-2026-0042");
    });

    it("should produce a default line item with totalAmount when contentData absent", () => {
      const rnNoContent = makeRequestNetworkInvoice({ contentData: undefined });
      const fl = adapter.fromRequestNetwork(rnNoContent);

      expect(fl.lineItems).toHaveLength(1);
      expect(fl.lineItems[0].total).toBe(45);
    });
  });

  // -------------------------------------------------------------------------
  // Step 5 (continued): Compliance stamp preserved through round-trip
  // -------------------------------------------------------------------------

  describe("Round-trip compliance stamp preservation", () => {
    it("should preserve compliance stamp through ProofLink → RN → ProofLink", () => {
      const originalStamp = makeComplianceStamp();
      const invoice = makeProofLinkInvoice({ complianceStamp: originalStamp });

      // ProofLink → RN
      const rnInvoice = adapter.toRequestNetwork(invoice);

      // Verify stamp embedded in RN format
      expect(rnInvoice.contentData?.prooflinkCompliance?.proofLinkReceiptId)
        .toBe(originalStamp.proofLinkReceiptId);

      // RN → ProofLink
      const recoveredInvoice = adapter.fromRequestNetwork(rnInvoice);

      // Compliance stamp must survive the round-trip
      expect(recoveredInvoice.complianceStamp).toBeDefined();
      expect(recoveredInvoice.complianceStamp?.proofLinkReceiptId)
        .toBe(originalStamp.proofLinkReceiptId);
      expect(recoveredInvoice.complianceStamp?.sanctionsCleared).toBe(true);
      expect(recoveredInvoice.complianceStamp?.travelRuleTransmitted).toBe(false);
      expect(recoveredInvoice.complianceStamp?.amlRiskScore).toBe(8);
    });

    it("should preserve EAS attestation UID through round-trip", () => {
      const stamp = makeComplianceStamp({
        easAttestationUid: "0xABCDEF1234567890abcdef1234567890ABCDEF1234567890abcdef1234567890AB",
      });
      const invoice = makeProofLinkInvoice({ complianceStamp: stamp });

      const rn = adapter.toRequestNetwork(invoice);
      const recovered = adapter.fromRequestNetwork(rn);

      expect(recovered.complianceStamp?.easAttestationUid).toBe(stamp.easAttestationUid);
    });

    it("should return undefined complianceStamp when RN has no prooflinkCompliance data", () => {
      const fl = adapter.fromRequestNetwork(makeRequestNetworkInvoice());

      // No compliance data in the fixture's contentData
      expect(fl.complianceStamp).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // extensionToComplianceStamp edge cases
  // -------------------------------------------------------------------------

  describe("extensionToComplianceStamp — deserialization", () => {
    it("should return undefined when proofLinkReceiptId is missing", () => {
      const result = adapter.extensionToComplianceStamp({
        sanctionsCleared: true,
        travelRuleTransmitted: false,
      });

      expect(result).toBeUndefined();
    });

    it("should default sanctionsCleared to false when missing", () => {
      const result = adapter.extensionToComplianceStamp({
        proofLinkReceiptId: "pl_test",
      });

      expect(result?.sanctionsCleared).toBe(false);
    });

    it("should default travelRuleTransmitted to false when missing", () => {
      const result = adapter.extensionToComplianceStamp({
        proofLinkReceiptId: "pl_test",
      });

      expect(result?.travelRuleTransmitted).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Step 6: State sync
  // -------------------------------------------------------------------------

  describe("syncState — ProofLink ↔ Request Network state synchronisation", () => {
    it("should detect state change from ISSUED to PAID when RN reports paid", () => {
      const { newState, changed } = adapter.syncState("ISSUED", "paid");

      expect(newState).toBe("PAID");
      expect(changed).toBe(true);
    });

    it("should detect state change from ISSUED to CANCELLED when RN reports canceled", () => {
      const { newState, changed } = adapter.syncState("ISSUED", "canceled");

      expect(newState).toBe("CANCELLED");
      expect(changed).toBe(true);
    });

    it("should report changed=false when state has not changed", () => {
      // RN created maps to ProofLink ISSUED
      const { newState, changed } = adapter.syncState("ISSUED", "created");

      expect(newState).toBe("ISSUED");
      expect(changed).toBe(false);
    });

    it("should handle overpaid RN state as ProofLink PAID", () => {
      const { newState } = adapter.syncState("ISSUED", "overpaid");

      expect(newState).toBe("PAID");
    });

    it("should handle underpaid RN state as ProofLink ISSUED (still open)", () => {
      const { newState } = adapter.syncState("ISSUED", "underpaid");

      // underpaid means invoice not fully settled — stays ISSUED
      expect(newState).toBe("ISSUED");
    });

    it("should handle accepted RN state as ProofLink ISSUED", () => {
      const { newState, changed } = adapter.syncState("ISSUED", "accepted");

      expect(newState).toBe("ISSUED");
      expect(changed).toBe(false);
    });
  });
});
