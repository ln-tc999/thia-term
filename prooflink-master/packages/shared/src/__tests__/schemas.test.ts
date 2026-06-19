import { describe, it, expect } from "vitest";
import {
  SanctionsList,
  SanctionsMatchDetail,
  SanctionsCheckResult,
  AMLRiskFactor,
  AMLRiskScore,
  IVMS101Person,
  TravelRuleData,
  TravelRuleStatus,
  ComplianceCheckType,
  ComplianceCheckResult,
  CheckPerformed,
  ComplianceReceipt,
  ComplianceDecision,
  ComplianceDecisionStatus,
  ProofLinkReceipt,
  CompliancePolicy,
} from "../types/compliance.js";
import {
  InvoiceState,
  ServiceCategory,
  InvoiceLineItem,
  InvoiceParty,
  AgentInvoice,
  InvoiceCurrency,
  ComplianceStamp,
  PaymentProof,
} from "../types/invoice.js";
import { AgentType, DelegationScope, AgentIdentity, KYACredential, KYAVerificationResult } from "../types/identity.js";
import {
  PaymentProtocol,
  SupportedChain,
  SupportedToken,
  PaymentIntent,
  SettlementResult,
  ComplianceRequest as ComplianceRequestSchema,
} from "../types/protocol.js";
import {
  WebhookEventType,
  WebhookConfig,
  WebhookEvent,
  WebhookDelivery,
  WebhookSubscription,
  WebhookDeliveryStatus,
} from "../types/webhook.js";
import {
  PaginationParams,
  PaginatedMeta,
  APIErrorDetail,
  APIErrorResponse,
  APIKeyScope,
  APIKey,
  RateLimitInfo,
} from "../types/api.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function futureIso(daysAhead = 365): string {
  return new Date(Date.now() + daysAhead * 86_400_000).toISOString();
}

// ---------------------------------------------------------------------------
// SanctionsList enum
// ---------------------------------------------------------------------------

describe("SanctionsList", () => {
  it("parses all valid list names", () => {
    for (const name of ["OFAC_SDN", "OFAC_CONS", "EU_CONSOLIDATED", "UN_CONSOLIDATED", "HMT"]) {
      expect(SanctionsList.parse(name)).toBe(name);
    }
  });

  it("throws on unknown list name", () => {
    expect(() => SanctionsList.parse("UNKNOWN_LIST")).toThrow();
  });

  it("throws on empty string", () => {
    expect(() => SanctionsList.parse("")).toThrow();
  });

  it("throws on null", () => {
    expect(() => SanctionsList.parse(null)).toThrow();
  });

  it("throws on lowercase variant", () => {
    expect(() => SanctionsList.parse("ofac_sdn")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SanctionsMatchDetail
// ---------------------------------------------------------------------------

describe("SanctionsMatchDetail", () => {
  it("parses a valid match detail", () => {
    const result = SanctionsMatchDetail.parse({
      list: "OFAC_SDN",
      entryId: "e-001",
      name: "Tornado Cash",
      matchConfidence: 1.0,
    });
    expect(result.name).toBe("Tornado Cash");
  });

  it("accepts matchConfidence at exact boundary values (0 and 1)", () => {
    for (const confidence of [0, 0.5, 1]) {
      const result = SanctionsMatchDetail.parse({
        list: "OFAC_SDN",
        entryId: "e-001",
        name: "X",
        matchConfidence: confidence,
      });
      expect(result.matchConfidence).toBe(confidence);
    }
  });

  it("rejects matchConfidence > 1", () => {
    expect(() =>
      SanctionsMatchDetail.parse({
        list: "OFAC_SDN",
        entryId: "e-001",
        name: "X",
        matchConfidence: 1.1,
      }),
    ).toThrow();
  });

  it("rejects matchConfidence < 0", () => {
    expect(() =>
      SanctionsMatchDetail.parse({
        list: "OFAC_SDN",
        entryId: "e-001",
        name: "X",
        matchConfidence: -0.1,
      }),
    ).toThrow();
  });

  it("rejects missing required fields", () => {
    expect(() => SanctionsMatchDetail.parse({ list: "OFAC_SDN" })).toThrow();
  });

  it("rejects invalid list value", () => {
    expect(() =>
      SanctionsMatchDetail.parse({
        list: "FAKE_LIST",
        entryId: "e-001",
        name: "X",
        matchConfidence: 0.5,
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SanctionsCheckResult
// ---------------------------------------------------------------------------

describe("SanctionsCheckResult", () => {
  it("parses a clean result", () => {
    const result = SanctionsCheckResult.parse({
      matched: false,
      listsChecked: ["OFAC_SDN"],
      matchDetails: [],
      riskScore: 0,
      screenedAt: nowIso(),
      provider: "chainalysis_free",
    });
    expect(result.matched).toBe(false);
  });

  it("parses a hit result with match details", () => {
    const result = SanctionsCheckResult.parse({
      matched: true,
      listsChecked: ["OFAC_SDN", "EU_CONSOLIDATED"],
      matchDetails: [
        { list: "OFAC_SDN", entryId: "tc-001", name: "Tornado Cash", matchConfidence: 1.0 },
      ],
      riskScore: 100,
      screenedAt: nowIso(),
      provider: "chainalysis_kyt",
    });
    expect(result.matched).toBe(true);
    expect(result.matchDetails).toHaveLength(1);
  });

  it("accepts all valid providers", () => {
    const providers = [
      "chainalysis_free",
      "chainalysis_kyt",
      "trm",
      "chainaware",
      "ofac_sdn_offline",
      "multi_provider",
      "custom",
    ];
    for (const provider of providers) {
      const result = SanctionsCheckResult.parse({
        matched: false,
        listsChecked: ["OFAC_SDN"],
        matchDetails: [],
        riskScore: 0,
        screenedAt: nowIso(),
        provider,
      });
      expect(result.provider).toBe(provider);
    }
  });

  it("rejects riskScore > 100", () => {
    expect(() =>
      SanctionsCheckResult.parse({
        matched: false,
        listsChecked: ["OFAC_SDN"],
        matchDetails: [],
        riskScore: 101,
        screenedAt: nowIso(),
        provider: "chainalysis_free",
      }),
    ).toThrow();
  });

  it("rejects riskScore < 0", () => {
    expect(() =>
      SanctionsCheckResult.parse({
        matched: false,
        listsChecked: ["OFAC_SDN"],
        matchDetails: [],
        riskScore: -1,
        screenedAt: nowIso(),
        provider: "chainalysis_free",
      }),
    ).toThrow();
  });

  it("rejects non-integer riskScore", () => {
    expect(() =>
      SanctionsCheckResult.parse({
        matched: false,
        listsChecked: ["OFAC_SDN"],
        matchDetails: [],
        riskScore: 50.5,
        screenedAt: nowIso(),
        provider: "chainalysis_free",
      }),
    ).toThrow();
  });

  it("rejects unknown provider", () => {
    expect(() =>
      SanctionsCheckResult.parse({
        matched: false,
        listsChecked: ["OFAC_SDN"],
        matchDetails: [],
        riskScore: 0,
        screenedAt: nowIso(),
        provider: "unknown_provider",
      }),
    ).toThrow();
  });

  it("rejects non-ISO screenedAt", () => {
    expect(() =>
      SanctionsCheckResult.parse({
        matched: false,
        listsChecked: ["OFAC_SDN"],
        matchDetails: [],
        riskScore: 0,
        screenedAt: "2026-03-21",
        provider: "chainalysis_free",
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// AMLRiskFactor enum
// ---------------------------------------------------------------------------

describe("AMLRiskFactor", () => {
  const validFactors = [
    "velocity_anomaly",
    "destination_risk",
    "amount_anomaly",
    "indirect_exposure",
    "new_wallet",
    "mixer_interaction",
    "darknet_exposure",
    "structuring",
    "time_of_day_anomaly",
    "cross_chain_correlation",
  ];

  it("accepts all valid factors", () => {
    for (const f of validFactors) {
      expect(AMLRiskFactor.parse(f)).toBe(f);
    }
  });

  it("rejects unknown factor", () => {
    expect(() => AMLRiskFactor.parse("rug_pull")).toThrow();
  });

  it("rejects empty string", () => {
    expect(() => AMLRiskFactor.parse("")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// AMLRiskScore
// ---------------------------------------------------------------------------

describe("AMLRiskScore", () => {
  it("parses a valid score object", () => {
    const obj = AMLRiskScore.parse({
      score: 45,
      factors: [
        {
          factor: "velocity_anomaly",
          weight: 0.5,
          detail: "25 tx/hour",
        },
      ],
      threshold: 85,
      exceeds: false,
      evaluatedAt: nowIso(),
    });
    expect(obj.score).toBe(45);
  });

  it("parses with empty factors array", () => {
    const obj = AMLRiskScore.parse({
      score: 0,
      factors: [],
      threshold: 85,
      exceeds: false,
      evaluatedAt: nowIso(),
    });
    expect(obj.factors).toHaveLength(0);
  });

  it("rejects score > 100", () => {
    expect(() =>
      AMLRiskScore.parse({
        score: 101,
        factors: [],
        threshold: 85,
        exceeds: false,
        evaluatedAt: nowIso(),
      }),
    ).toThrow();
  });

  it("rejects non-integer score", () => {
    expect(() =>
      AMLRiskScore.parse({
        score: 50.5,
        factors: [],
        threshold: 85,
        exceeds: false,
        evaluatedAt: nowIso(),
      }),
    ).toThrow();
  });

  it("accepts score boundary values 0 and 100", () => {
    for (const score of [0, 100]) {
      const obj = AMLRiskScore.parse({
        score,
        factors: [],
        threshold: 85,
        exceeds: score > 85,
        evaluatedAt: nowIso(),
      });
      expect(obj.score).toBe(score);
    }
  });

  it("rejects factor with weight > 1", () => {
    expect(() =>
      AMLRiskScore.parse({
        score: 50,
        factors: [{ factor: "velocity_anomaly", weight: 1.5, detail: "too fast" }],
        threshold: 85,
        exceeds: false,
        evaluatedAt: nowIso(),
      }),
    ).toThrow();
  });

  it("rejects factor with weight < 0", () => {
    expect(() =>
      AMLRiskScore.parse({
        score: 50,
        factors: [{ factor: "velocity_anomaly", weight: -0.1, detail: "ok" }],
        threshold: 85,
        exceeds: false,
        evaluatedAt: nowIso(),
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// IVMS101Person
// ---------------------------------------------------------------------------

describe("IVMS101Person", () => {
  it("parses with only required walletAddress", () => {
    const person = IVMS101Person.parse({ walletAddress: "0xABC" });
    expect(person.walletAddress).toBe("0xABC");
  });

  it("parses with all optional fields", () => {
    const person = IVMS101Person.parse({
      walletAddress: "0xABC",
      name: "Alice",
      physicalAddress: "1 Main St",
      nationalId: "ID-001",
      accountNumber: "ACC-123",
      agentId: "agent-001",
      vaspDid: "did:web:vasp.example.com",
    });
    expect(person.name).toBe("Alice");
    expect(person.vaspDid).toBe("did:web:vasp.example.com");
  });

  it("rejects missing walletAddress", () => {
    expect(() => IVMS101Person.parse({ name: "Alice" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// TravelRuleData
// ---------------------------------------------------------------------------

describe("TravelRuleData", () => {
  it("parses a valid travel rule record", () => {
    const data = TravelRuleData.parse({
      originator: { walletAddress: "0xABCDEF" },
      beneficiary: { walletAddress: "0x123456" },
      amountUsd: 5000,
      asset: "USDC",
      chain: "base",
      direction: "outgoing",
    });
    expect(data.amountUsd).toBe(5000);
  });

  it("parses with optional txHash", () => {
    const data = TravelRuleData.parse({
      originator: { walletAddress: "0xABC" },
      beneficiary: { walletAddress: "0xDEF" },
      amountUsd: 100,
      asset: "USDC",
      chain: "base",
      direction: "outgoing",
      txHash: "0xtxhash123",
    });
    expect(data.txHash).toBe("0xtxhash123");
  });

  it("rejects zero or negative amountUsd", () => {
    for (const amountUsd of [0, -1, -0.001]) {
      expect(() =>
        TravelRuleData.parse({
          originator: { walletAddress: "0xABC" },
          beneficiary: { walletAddress: "0xDEF" },
          amountUsd,
          asset: "USDC",
          chain: "base",
          direction: "outgoing",
        }),
      ).toThrow();
    }
  });

  it("rejects invalid direction", () => {
    expect(() =>
      TravelRuleData.parse({
        originator: { walletAddress: "0xABC" },
        beneficiary: { walletAddress: "0xDEF" },
        amountUsd: 100,
        asset: "USDC",
        chain: "base",
        direction: "sideways",
      }),
    ).toThrow();
  });

  it("defaults preTransaction to false", () => {
    const data = TravelRuleData.parse({
      originator: { walletAddress: "0xABC" },
      beneficiary: { walletAddress: "0xDEF" },
      amountUsd: 100,
      asset: "USDC",
      chain: "base",
      direction: "outgoing",
    });
    expect(data.preTransaction).toBe(false);
  });

  it("accepts both valid directions", () => {
    for (const direction of ["outgoing", "incoming"]) {
      const data = TravelRuleData.parse({
        originator: { walletAddress: "0xABC" },
        beneficiary: { walletAddress: "0xDEF" },
        amountUsd: 100,
        asset: "USDC",
        chain: "base",
        direction,
      });
      expect(data.direction).toBe(direction);
    }
  });
});

// ---------------------------------------------------------------------------
// TravelRuleStatus
// ---------------------------------------------------------------------------

describe("TravelRuleStatus", () => {
  it("accepts all valid statuses", () => {
    const statuses = ["NOT_REQUIRED", "TRANSMITTED", "PENDING", "FAILED", "ACK_RECEIVED"];
    for (const status of statuses) {
      expect(TravelRuleStatus.parse(status)).toBe(status);
    }
  });

  it("rejects unknown status", () => {
    expect(() => TravelRuleStatus.parse("COMPLETED")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ComplianceCheckType
// ---------------------------------------------------------------------------

describe("ComplianceCheckType", () => {
  it("accepts all valid check types", () => {
    const types = [
      "SANCTIONS_SCREENING",
      "KYA_VERIFICATION",
      "TRAVEL_RULE",
      "AML_MONITORING",
      "INVOICE_VALIDATION",
      "JURISDICTIONAL_RULES",
    ];
    for (const t of types) {
      expect(ComplianceCheckType.parse(t)).toBe(t);
    }
  });

  it("rejects unknown check type", () => {
    expect(() => ComplianceCheckType.parse("CREDIT_CHECK")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ComplianceCheckResult
// ---------------------------------------------------------------------------

describe("ComplianceCheckResult", () => {
  it("accepts PASSED, FAILED, SKIPPED", () => {
    for (const result of ["PASSED", "FAILED", "SKIPPED"]) {
      expect(ComplianceCheckResult.parse(result)).toBe(result);
    }
  });

  it("rejects unknown result", () => {
    expect(() => ComplianceCheckResult.parse("PENDING")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// CheckPerformed
// ---------------------------------------------------------------------------

describe("CheckPerformed", () => {
  it("parses a valid check with optional detail", () => {
    const check = CheckPerformed.parse({
      checkType: "SANCTIONS_SCREENING",
      result: "PASSED",
      performedAt: nowIso(),
      provider: "chainalysis_free",
      detail: "No hits on OFAC_SDN",
    });
    expect(check.checkType).toBe("SANCTIONS_SCREENING");
    expect(check.detail).toBe("No hits on OFAC_SDN");
  });

  it("parses without optional detail", () => {
    const check = CheckPerformed.parse({
      checkType: "AML_MONITORING",
      result: "PASSED",
      performedAt: nowIso(),
      provider: "internal",
    });
    expect(check.detail).toBeUndefined();
  });

  it("rejects invalid checkType", () => {
    expect(() =>
      CheckPerformed.parse({
        checkType: "CUSTOM_CHECK",
        result: "PASSED",
        performedAt: nowIso(),
        provider: "internal",
      }),
    ).toThrow();
  });

  it("rejects invalid result", () => {
    expect(() =>
      CheckPerformed.parse({
        checkType: "SANCTIONS_SCREENING",
        result: "UNKNOWN",
        performedAt: nowIso(),
        provider: "internal",
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ComplianceReceipt
// ---------------------------------------------------------------------------

describe("ComplianceReceipt", () => {
  function makeReceipt(overrides = {}) {
    return {
      receiptId: "cmp_abc123",
      checksPerformed: [],
      overallStatus: "APPROVED",
      riskScore: 12,
      travelRuleStatus: "NOT_REQUIRED",
      signature: "0x" + "a".repeat(128),
      timestamp: nowIso(),
      ...overrides,
    };
  }

  it("parses a minimal valid receipt", () => {
    const receipt = ComplianceReceipt.parse(makeReceipt());
    expect(receipt.receiptId).toBe("cmp_abc123");
    expect(receipt.ttl).toBe(300); // default
    expect(receipt.proofLinkVersion).toBe("1.0.0"); // default
  });

  it("accepts all valid overallStatus values", () => {
    for (const status of ["APPROVED", "REJECTED", "ESCALATED"]) {
      const receipt = ComplianceReceipt.parse(makeReceipt({ overallStatus: status }));
      expect(receipt.overallStatus).toBe(status);
    }
  });

  it("rejects riskScore > 100", () => {
    expect(() => ComplianceReceipt.parse(makeReceipt({ riskScore: 101 }))).toThrow();
  });

  it("rejects riskScore < 0", () => {
    expect(() => ComplianceReceipt.parse(makeReceipt({ riskScore: -1 }))).toThrow();
  });

  it("rejects invalid overallStatus", () => {
    expect(() => ComplianceReceipt.parse(makeReceipt({ overallStatus: "INVALID_STATUS" }))).toThrow();
  });

  it("rejects non-positive ttl", () => {
    expect(() => ComplianceReceipt.parse(makeReceipt({ ttl: 0 }))).toThrow();
  });

  it("accepts optional fields: txHash, easAttestationUid, ipfsCid", () => {
    const receipt = ComplianceReceipt.parse(makeReceipt({
      txHash: "0xtx123",
      easAttestationUid: "0xeas456",
      ipfsCid: "QmXXXXXXXXXXXX",
    }));
    expect(receipt.txHash).toBe("0xtx123");
    expect(receipt.easAttestationUid).toBe("0xeas456");
    expect(receipt.ipfsCid).toBe("QmXXXXXXXXXXXX");
  });
});

// ---------------------------------------------------------------------------
// ComplianceDecision
// ---------------------------------------------------------------------------

describe("ComplianceDecision", () => {
  function makeDecision(overrides = {}) {
    return {
      status: "APPROVED",
      riskScore: 12,
      receiptId: "cmp_dec001",
      receiptHash: "0x" + "b".repeat(64),
      checks: [],
      travelRuleStatus: "NOT_REQUIRED",
      timestamp: nowIso(),
      ...overrides,
    };
  }

  it("parses a valid approved decision", () => {
    const decision = ComplianceDecision.parse(makeDecision());
    expect(decision.status).toBe("APPROVED");
    expect(decision.ttl).toBe(300); // default
  });

  it("accepts all valid status values", () => {
    for (const status of ["APPROVED", "REJECTED", "ESCALATED"]) {
      const decision = ComplianceDecision.parse(makeDecision({ status }));
      expect(decision.status).toBe(status);
    }
  });

  it("accepts optional blockReason for REJECTED status", () => {
    const decision = ComplianceDecision.parse(makeDecision({
      status: "REJECTED",
      blockReason: "Sanctions match on OFAC_SDN",
    }));
    expect(decision.blockReason).toBe("Sanctions match on OFAC_SDN");
  });

  it("rejects invalid status", () => {
    expect(() => ComplianceDecision.parse(makeDecision({ status: "PENDING" }))).toThrow();
  });

  it("rejects riskScore > 100", () => {
    expect(() => ComplianceDecision.parse(makeDecision({ riskScore: 101 }))).toThrow();
  });

  it("rejects non-positive ttl", () => {
    expect(() => ComplianceDecision.parse(makeDecision({ ttl: 0 }))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ComplianceDecisionStatus
// ---------------------------------------------------------------------------

describe("ComplianceDecisionStatus", () => {
  it("accepts APPROVED, REJECTED, ESCALATED", () => {
    for (const s of ["APPROVED", "REJECTED", "ESCALATED"]) {
      expect(ComplianceDecisionStatus.parse(s)).toBe(s);
    }
  });

  it("rejects unknown status", () => {
    expect(() => ComplianceDecisionStatus.parse("BLOCKED")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ProofLinkReceipt
// ---------------------------------------------------------------------------

describe("ProofLinkReceipt", () => {
  function makeProofLinkReceipt(overrides = {}) {
    return {
      version: 1 as const,
      network: "eip155:8453",
      sender: "0x1111111111111111111111111111111111111111",
      receiver: "0x2222222222222222222222222222222222222222",
      amount: "100.00",
      asset: "USDC",
      complianceDecision: {
        status: "APPROVED",
        riskScore: 5,
        receiptId: "cmp_001",
        receiptHash: "0x" + "a".repeat(64),
        checks: [],
        travelRuleStatus: "NOT_REQUIRED",
        timestamp: nowIso(),
      },
      createdAt: nowIso(),
      ...overrides,
    };
  }

  it("parses a minimal valid ProofLink receipt", () => {
    const receipt = ProofLinkReceipt.parse(makeProofLinkReceipt());
    expect(receipt.version).toBe(1);
    expect(receipt.sender).toBe("0x1111111111111111111111111111111111111111");
  });

  it("rejects version !== 1", () => {
    expect(() => ProofLinkReceipt.parse(makeProofLinkReceipt({ version: 2 }))).toThrow();
    expect(() => ProofLinkReceipt.parse(makeProofLinkReceipt({ version: 0 }))).toThrow();
  });

  it("accepts optional transactionHash, invoiceId, attestationUid, ipfsCid", () => {
    const receipt = ProofLinkReceipt.parse(makeProofLinkReceipt({
      transactionHash: "0xtxhash",
      invoiceId: "inv_001",
      attestationUid: "0xeas001",
      ipfsCid: "QmReceipt",
    }));
    expect(receipt.transactionHash).toBe("0xtxhash");
    expect(receipt.invoiceId).toBe("inv_001");
    expect(receipt.attestationUid).toBe("0xeas001");
    expect(receipt.ipfsCid).toBe("QmReceipt");
  });

  it("rejects non-ISO createdAt", () => {
    expect(() => ProofLinkReceipt.parse(makeProofLinkReceipt({ createdAt: "2026-03-21" }))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// CompliancePolicy
// ---------------------------------------------------------------------------

describe("CompliancePolicy", () => {
  it("parses a minimal valid policy", () => {
    const policy = CompliancePolicy.parse({
      sanctionsLists: ["OFAC_SDN"],
      maxRiskScore: 85,
      travelRuleThresholdUsd: 3000,
    });
    expect(policy.maxRiskScore).toBe(85);
    expect(policy.failOpen).toBe(false);
  });

  it("rejects maxRiskScore > 100", () => {
    expect(() =>
      CompliancePolicy.parse({
        sanctionsLists: ["OFAC_SDN"],
        maxRiskScore: 101,
        travelRuleThresholdUsd: 3000,
      }),
    ).toThrow();
  });

  it("rejects maxRiskScore < 0", () => {
    expect(() =>
      CompliancePolicy.parse({
        sanctionsLists: ["OFAC_SDN"],
        maxRiskScore: -1,
        travelRuleThresholdUsd: 3000,
      }),
    ).toThrow();
  });

  it("rejects negative travelRuleThresholdUsd", () => {
    expect(() =>
      CompliancePolicy.parse({
        sanctionsLists: ["OFAC_SDN"],
        maxRiskScore: 85,
        travelRuleThresholdUsd: -1,
      }),
    ).toThrow();
  });

  it("accepts threshold of 0 (always required)", () => {
    const policy = CompliancePolicy.parse({
      sanctionsLists: ["OFAC_SDN"],
      maxRiskScore: 85,
      travelRuleThresholdUsd: 0,
    });
    expect(policy.travelRuleThresholdUsd).toBe(0);
  });

  it("accepts maxRiskScore boundary values 0 and 100", () => {
    for (const maxRiskScore of [0, 100]) {
      const policy = CompliancePolicy.parse({
        sanctionsLists: ["OFAC_SDN"],
        maxRiskScore,
        travelRuleThresholdUsd: 3000,
      });
      expect(policy.maxRiskScore).toBe(maxRiskScore);
    }
  });

  it("accepts optional allowlist, blocklist, eddJurisdictions", () => {
    const policy = CompliancePolicy.parse({
      sanctionsLists: ["OFAC_SDN"],
      maxRiskScore: 85,
      travelRuleThresholdUsd: 3000,
      allowlist: ["0xtreasury"],
      blocklist: ["0xbad"],
      eddJurisdictions: ["IR", "KP"],
    });
    expect(policy.allowlist).toEqual(["0xtreasury"]);
    expect(policy.blocklist).toEqual(["0xbad"]);
    expect(policy.eddJurisdictions).toEqual(["IR", "KP"]);
  });

  it("accepts failOpen = true", () => {
    const policy = CompliancePolicy.parse({
      sanctionsLists: ["OFAC_SDN"],
      maxRiskScore: 85,
      travelRuleThresholdUsd: 3000,
      failOpen: true,
    });
    expect(policy.failOpen).toBe(true);
  });

  it("accepts multiple sanctions lists", () => {
    const policy = CompliancePolicy.parse({
      sanctionsLists: ["OFAC_SDN", "OFAC_CONS", "EU_CONSOLIDATED", "UN_CONSOLIDATED", "HMT"],
      maxRiskScore: 85,
      travelRuleThresholdUsd: 3000,
    });
    expect(policy.sanctionsLists).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// InvoiceState
// ---------------------------------------------------------------------------

describe("InvoiceState", () => {
  it("accepts all valid states", () => {
    const states = ["DRAFT", "ISSUED", "PAID", "SETTLED", "DISPUTED", "CANCELLED"];
    for (const state of states) {
      expect(InvoiceState.parse(state)).toBe(state);
    }
  });

  it("rejects unknown state", () => {
    expect(() => InvoiceState.parse("ARCHIVED")).toThrow();
    expect(() => InvoiceState.parse("")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ServiceCategory
// ---------------------------------------------------------------------------

describe("ServiceCategory", () => {
  it("accepts all valid categories", () => {
    const categories = [
      "compute",
      "data",
      "api_call",
      "content_generation",
      "analysis",
      "transaction_fee",
      "other",
    ];
    for (const cat of categories) {
      expect(ServiceCategory.parse(cat)).toBe(cat);
    }
  });

  it("rejects unknown category", () => {
    expect(() => ServiceCategory.parse("mining")).toThrow();
    expect(() => ServiceCategory.parse("COMPUTE")).toThrow(); // case-sensitive
  });
});

// ---------------------------------------------------------------------------
// InvoiceLineItem
// ---------------------------------------------------------------------------

describe("InvoiceLineItem", () => {
  it("parses a valid line item with service category", () => {
    const item = InvoiceLineItem.parse({
      description: "API calls",
      quantity: 100,
      unitPrice: 0.01,
      total: 1.0,
      serviceCategory: "api_call",
    });
    expect(item.serviceCategory).toBe("api_call");
    expect(item.unit).toBe("unit");
  });

  it("accepts custom unit", () => {
    const item = InvoiceLineItem.parse({
      description: "GPU hours",
      quantity: 10,
      unit: "hour",
      unitPrice: 5.0,
      total: 50.0,
      serviceCategory: "compute",
    });
    expect(item.unit).toBe("hour");
  });

  it("rejects zero quantity (not positive)", () => {
    expect(() =>
      InvoiceLineItem.parse({
        description: "API calls",
        quantity: 0,
        unitPrice: 0.01,
        total: 0,
      }),
    ).toThrow();
  });

  it("rejects negative quantity", () => {
    expect(() =>
      InvoiceLineItem.parse({
        description: "API calls",
        quantity: -1,
        unitPrice: 0.01,
        total: -0.01,
      }),
    ).toThrow();
  });

  it("accepts unitPrice of 0 (free tier)", () => {
    const item = InvoiceLineItem.parse({
      description: "Free tier",
      quantity: 1000,
      unitPrice: 0,
      total: 0,
    });
    expect(item.unitPrice).toBe(0);
  });

  it("rejects negative unitPrice", () => {
    expect(() =>
      InvoiceLineItem.parse({
        description: "API calls",
        quantity: 1,
        unitPrice: -1,
        total: -1,
      }),
    ).toThrow();
  });

  it("rejects invalid service category", () => {
    expect(() =>
      InvoiceLineItem.parse({
        description: "foo",
        quantity: 1,
        unitPrice: 1,
        total: 1,
        serviceCategory: "mining",
      }),
    ).toThrow();
  });

  it("accepts optional serviceCategory (absent)", () => {
    const item = InvoiceLineItem.parse({
      description: "miscellaneous",
      quantity: 1,
      unitPrice: 100,
      total: 100,
    });
    expect(item.serviceCategory).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// InvoiceParty
// ---------------------------------------------------------------------------

describe("InvoiceParty", () => {
  it("parses with only required walletAddress", () => {
    const party = InvoiceParty.parse({ walletAddress: "0xSeller" });
    expect(party.walletAddress).toBe("0xSeller");
  });

  it("parses with all optional fields", () => {
    const party = InvoiceParty.parse({
      walletAddress: "0xSeller",
      agentId: "did:prooflink:agent:seller",
      legalName: "Acme Corp",
      taxId: "US-123456789",
    });
    expect(party.legalName).toBe("Acme Corp");
    expect(party.taxId).toBe("US-123456789");
  });

  it("rejects missing walletAddress", () => {
    expect(() => InvoiceParty.parse({ agentId: "agent-001" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// InvoiceCurrency
// ---------------------------------------------------------------------------

describe("InvoiceCurrency", () => {
  it("accepts all valid currencies", () => {
    for (const currency of ["USDC", "USDT", "USD", "EUR", "GBP", "EURC"]) {
      expect(InvoiceCurrency.parse(currency)).toBe(currency);
    }
  });

  it("rejects BTC, ETH, XRP", () => {
    for (const currency of ["BTC", "ETH", "XRP"]) {
      expect(() => InvoiceCurrency.parse(currency)).toThrow();
    }
  });

  it("rejects empty string", () => {
    expect(() => InvoiceCurrency.parse("")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ComplianceStamp
// ---------------------------------------------------------------------------

describe("ComplianceStamp", () => {
  it("parses a minimal valid stamp", () => {
    const stamp = ComplianceStamp.parse({
      proofLinkReceiptId: "cmp_abc",
      sanctionsCleared: true,
      travelRuleTransmitted: false,
    });
    expect(stamp.proofLinkReceiptId).toBe("cmp_abc");
    expect(stamp.sanctionsCleared).toBe(true);
  });

  it("accepts optional amlRiskScore and easAttestationUid", () => {
    const stamp = ComplianceStamp.parse({
      proofLinkReceiptId: "cmp_xyz",
      sanctionsCleared: true,
      travelRuleTransmitted: true,
      amlRiskScore: 12,
      easAttestationUid: "0xeas001",
    });
    expect(stamp.amlRiskScore).toBe(12);
    expect(stamp.easAttestationUid).toBe("0xeas001");
  });

  it("rejects amlRiskScore > 100", () => {
    expect(() =>
      ComplianceStamp.parse({
        proofLinkReceiptId: "cmp_xyz",
        sanctionsCleared: true,
        travelRuleTransmitted: false,
        amlRiskScore: 101,
      }),
    ).toThrow();
  });

  it("rejects amlRiskScore < 0", () => {
    expect(() =>
      ComplianceStamp.parse({
        proofLinkReceiptId: "cmp_xyz",
        sanctionsCleared: true,
        travelRuleTransmitted: false,
        amlRiskScore: -1,
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// AgentInvoice
// ---------------------------------------------------------------------------

describe("AgentInvoice", () => {
  function makeInvoice(overrides = {}) {
    return {
      invoiceId: "inv_001",
      state: "DRAFT",
      seller: { walletAddress: "0xSeller" },
      buyer: { walletAddress: "0xBuyer" },
      lineItems: [
        {
          description: "Compute",
          quantity: 1,
          unitPrice: 10,
          total: 10,
        },
      ],
      currency: "USDC",
      totalAmount: 10,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...overrides,
    };
  }

  it("parses a minimal valid invoice", () => {
    const invoice = AgentInvoice.parse(makeInvoice());
    expect(invoice.invoiceId).toBe("inv_001");
    expect(invoice.anchoredOnChain).toBe(false);
  });

  it("applies JSON-LD defaults for @context and @type", () => {
    const invoice = AgentInvoice.parse(makeInvoice());
    expect(invoice["@type"]).toBe("Invoice");
    expect(invoice["@context"]).toContain("https://schema.org");
  });

  it("requires at least one line item", () => {
    expect(() => AgentInvoice.parse(makeInvoice({ lineItems: [] }))).toThrow();
  });

  it("rejects negative totalAmount", () => {
    expect(() =>
      AgentInvoice.parse(makeInvoice({ totalAmount: -1 })),
    ).toThrow();
  });

  it("accepts totalAmount of 0 (complimentary invoice)", () => {
    const invoice = AgentInvoice.parse(makeInvoice({ totalAmount: 0 }));
    expect(invoice.totalAmount).toBe(0);
  });

  it("rejects invalid currency", () => {
    expect(() =>
      AgentInvoice.parse(makeInvoice({ currency: "BTC" })),
    ).toThrow();
  });

  it("rejects invalid state", () => {
    expect(() =>
      AgentInvoice.parse(makeInvoice({ state: "INVALID" })),
    ).toThrow();
  });

  it("rejects invalid dueDate (non-ISO)", () => {
    expect(() =>
      AgentInvoice.parse(makeInvoice({ dueDate: "not-a-date" })),
    ).toThrow();
  });

  it("accepts all valid InvoiceState values", () => {
    const states = ["DRAFT", "ISSUED", "PAID", "SETTLED", "DISPUTED", "CANCELLED"];
    for (const state of states) {
      const invoice = AgentInvoice.parse(makeInvoice({ state }));
      expect(invoice.state).toBe(state);
    }
  });

  it("accepts optional paymentProtocol", () => {
    const invoice = AgentInvoice.parse(makeInvoice({ paymentProtocol: "X402" }));
    expect(invoice.paymentProtocol).toBe("X402");
  });

  it("accepts optional invoiceUrl (valid URL)", () => {
    const invoice = AgentInvoice.parse(makeInvoice({ invoiceUrl: "https://ipfs.io/ipfs/QmTest" }));
    expect(invoice.invoiceUrl).toBe("https://ipfs.io/ipfs/QmTest");
  });

  it("rejects invalid invoiceUrl", () => {
    expect(() => AgentInvoice.parse(makeInvoice({ invoiceUrl: "not-a-url" }))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// PaymentProof
// ---------------------------------------------------------------------------

describe("PaymentProof", () => {
  it("parses a valid payment proof", () => {
    const proof = PaymentProof.parse({
      protocol: "X402",
      txHash: "0xtx001",
      chain: "eip155:8453",
      settledAt: nowIso(),
    });
    expect(proof.protocol).toBe("X402");
  });

  it("accepts optional facilitator", () => {
    const proof = PaymentProof.parse({
      protocol: "X402",
      txHash: "0xtx002",
      chain: "eip155:8453",
      settledAt: nowIso(),
      facilitator: "0xFacilitator",
    });
    expect(proof.facilitator).toBe("0xFacilitator");
  });

  it("rejects invalid protocol", () => {
    expect(() =>
      PaymentProof.parse({
        protocol: "BITCOIN",
        txHash: "0xtx001",
        chain: "eip155:8453",
        settledAt: nowIso(),
      }),
    ).toThrow();
  });

  it("rejects non-ISO settledAt", () => {
    expect(() =>
      PaymentProof.parse({
        protocol: "X402",
        txHash: "0xtx001",
        chain: "eip155:8453",
        settledAt: "March 21 2026",
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// DelegationScope
// ---------------------------------------------------------------------------

describe("DelegationScope", () => {
  it("parses a valid delegation scope", () => {
    const scope = DelegationScope.parse({
      maxTransactionValue: 10_000,
      expiresAt: futureIso(),
    });
    expect(scope.maxTransactionValue).toBe(10_000);
  });

  it("rejects negative maxTransactionValue", () => {
    expect(() =>
      DelegationScope.parse({
        maxTransactionValue: -1,
        expiresAt: futureIso(),
      }),
    ).toThrow();
  });

  it("accepts maxTransactionValue of 0", () => {
    const scope = DelegationScope.parse({
      maxTransactionValue: 0,
      expiresAt: futureIso(),
    });
    expect(scope.maxTransactionValue).toBe(0);
  });

  it("rejects invalid expiresAt (non-ISO)", () => {
    expect(() =>
      DelegationScope.parse({
        maxTransactionValue: 1000,
        expiresAt: "2030-01-01",
      }),
    ).toThrow();
  });

  it("accepts optional allowedChains and allowedCurrencies", () => {
    const scope = DelegationScope.parse({
      maxTransactionValue: 5000,
      expiresAt: futureIso(),
      allowedChains: ["ethereum", "base"],
      allowedCurrencies: ["USDC", "USDT"],
    });
    expect(scope.allowedChains).toEqual(["ethereum", "base"]);
    expect(scope.allowedCurrencies).toEqual(["USDC", "USDT"]);
  });

  it("accepts optional dailyLimit and blockedJurisdictions", () => {
    const scope = DelegationScope.parse({
      maxTransactionValue: 5000,
      expiresAt: futureIso(),
      dailyLimit: 50000,
      blockedJurisdictions: ["IR", "KP"],
    });
    expect(scope.dailyLimit).toBe(50000);
    expect(scope.blockedJurisdictions).toEqual(["IR", "KP"]);
  });

  it("rejects invalid chain in allowedChains", () => {
    expect(() =>
      DelegationScope.parse({
        maxTransactionValue: 5000,
        expiresAt: futureIso(),
        allowedChains: ["avalanche"],
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// AgentType
// ---------------------------------------------------------------------------

describe("AgentType", () => {
  it("accepts all valid agent types", () => {
    for (const type of ["autonomous", "semi-autonomous", "human-supervised"]) {
      expect(AgentType.parse(type)).toBe(type);
    }
  });

  it("rejects unknown type", () => {
    expect(() => AgentType.parse("fully-autonomous")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// PaymentProtocol
// ---------------------------------------------------------------------------

describe("PaymentProtocol", () => {
  it("accepts all valid protocols", () => {
    for (const p of ["X402", "MPP", "AP2", "ACP", "DIRECT"]) {
      expect(PaymentProtocol.parse(p)).toBe(p);
    }
  });

  it("rejects unknown protocol", () => {
    expect(() => PaymentProtocol.parse("x402")).toThrow(); // case-sensitive
    expect(() => PaymentProtocol.parse("BITCOIN")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SupportedChain
// ---------------------------------------------------------------------------

describe("SupportedChain", () => {
  it("accepts all valid chains", () => {
    for (const chain of ["ethereum", "base", "solana", "polygon", "arbitrum"]) {
      expect(SupportedChain.parse(chain)).toBe(chain);
    }
  });

  it("rejects avalanche, bsc", () => {
    expect(() => SupportedChain.parse("avalanche")).toThrow();
    expect(() => SupportedChain.parse("bsc")).toThrow();
  });

  it("is case-sensitive", () => {
    expect(() => SupportedChain.parse("Ethereum")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SupportedToken
// ---------------------------------------------------------------------------

describe("SupportedToken", () => {
  it("accepts all valid tokens", () => {
    for (const token of ["USDC", "USDT", "EURC", "ETH", "SOL"]) {
      expect(SupportedToken.parse(token)).toBe(token);
    }
  });

  it("rejects BTC, MATIC, BNB", () => {
    for (const token of ["BTC", "MATIC", "BNB"]) {
      expect(() => SupportedToken.parse(token)).toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// WebhookEventType
// ---------------------------------------------------------------------------

describe("WebhookEventType", () => {
  it("accepts all defined event types", () => {
    const types = [
      "compliance.check.completed",
      "compliance.check.failed",
      "compliance.sanctions.match",
      "payment.completed",
      "payment.blocked",
      "payment.failed",
      "travel_rule.transmitted",
      "travel_rule.acknowledged",
      "travel_rule.failed",
      "invoice.created",
      "invoice.paid",
      "invoice.disputed",
      "kya.verified",
      "kya.failed",
      "attestation.created",
    ];
    for (const t of types) {
      expect(WebhookEventType.parse(t)).toBe(t);
    }
  });

  it("rejects unknown event type", () => {
    expect(() => WebhookEventType.parse("invoice.deleted")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// WebhookConfig
// ---------------------------------------------------------------------------

describe("WebhookConfig", () => {
  function makeWebhookConfig(overrides = {}) {
    return {
      id: "wh_001",
      url: "https://example.com/webhooks/prooflink",
      secret: "supersecret1234567890",
      events: ["compliance.check.completed"],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...overrides,
    };
  }

  it("parses a minimal valid config", () => {
    const config = WebhookConfig.parse(makeWebhookConfig());
    expect(config.id).toBe("wh_001");
    expect(config.enabled).toBe(true); // default
    expect(config.maxRetries).toBe(3); // default
    expect(config.timeoutMs).toBe(10_000); // default
  });

  it("rejects invalid URL", () => {
    expect(() => WebhookConfig.parse(makeWebhookConfig({ url: "not-a-url" }))).toThrow();
  });

  it("rejects secret shorter than 16 chars", () => {
    expect(() => WebhookConfig.parse(makeWebhookConfig({ secret: "short" }))).toThrow();
  });

  it("rejects empty events array", () => {
    expect(() => WebhookConfig.parse(makeWebhookConfig({ events: [] }))).toThrow();
  });

  it("rejects maxRetries > 10", () => {
    expect(() => WebhookConfig.parse(makeWebhookConfig({ maxRetries: 11 }))).toThrow();
  });

  it("rejects maxRetries < 0", () => {
    expect(() => WebhookConfig.parse(makeWebhookConfig({ maxRetries: -1 }))).toThrow();
  });

  it("accepts enabled = false", () => {
    const config = WebhookConfig.parse(makeWebhookConfig({ enabled: false }));
    expect(config.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// WebhookEvent
// ---------------------------------------------------------------------------

describe("WebhookEvent", () => {
  it("parses a valid webhook event", () => {
    const event = WebhookEvent.parse({
      id: "evt_001",
      type: "compliance.check.completed",
      timestamp: nowIso(),
      payload: { receiptId: "cmp_001", status: "APPROVED" },
      idempotencyKey: "idem_key_001",
    });
    expect(event.type).toBe("compliance.check.completed");
    expect(event.idempotencyKey).toBe("idem_key_001");
  });

  it("rejects invalid event type", () => {
    expect(() =>
      WebhookEvent.parse({
        id: "evt_002",
        type: "unknown.event",
        timestamp: nowIso(),
        payload: {},
        idempotencyKey: "key",
      }),
    ).toThrow();
  });

  it("rejects non-ISO timestamp", () => {
    expect(() =>
      WebhookEvent.parse({
        id: "evt_003",
        type: "invoice.created",
        timestamp: "2026-03-21",
        payload: {},
        idempotencyKey: "key",
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// WebhookDelivery
// ---------------------------------------------------------------------------

describe("WebhookDelivery", () => {
  function makeDelivery(overrides = {}) {
    return {
      id: "del_001",
      webhookId: "wh_001",
      eventId: "evt_001",
      status: "pending",
      attempt: 1,
      maxAttempts: 3,
      createdAt: nowIso(),
      ...overrides,
    };
  }

  it("parses a minimal delivery", () => {
    const delivery = WebhookDelivery.parse(makeDelivery());
    expect(delivery.status).toBe("pending");
    expect(delivery.attempt).toBe(1);
  });

  it("accepts all valid statuses", () => {
    for (const status of ["pending", "delivered", "failed", "retrying"]) {
      const d = WebhookDelivery.parse(makeDelivery({ status }));
      expect(d.status).toBe(status);
    }
  });

  it("rejects attempt < 1", () => {
    expect(() => WebhookDelivery.parse(makeDelivery({ attempt: 0 }))).toThrow();
  });

  it("rejects maxAttempts < 1", () => {
    expect(() => WebhookDelivery.parse(makeDelivery({ maxAttempts: 0 }))).toThrow();
  });

  it("accepts optional httpStatusCode and responseBody", () => {
    const d = WebhookDelivery.parse(makeDelivery({
      httpStatusCode: 200,
      responseBody: "OK",
      deliveredAt: nowIso(),
    }));
    expect(d.httpStatusCode).toBe(200);
    expect(d.responseBody).toBe("OK");
  });
});

// ---------------------------------------------------------------------------
// PaginationParams
// ---------------------------------------------------------------------------

describe("PaginationParams", () => {
  it("applies defaults when no values provided", () => {
    const params = PaginationParams.parse({});
    expect(params.page).toBe(1);
    expect(params.limit).toBe(20);
    expect(params.sortOrder).toBe("desc");
  });

  it("accepts valid page and limit", () => {
    const params = PaginationParams.parse({ page: 3, limit: 50 });
    expect(params.page).toBe(3);
    expect(params.limit).toBe(50);
  });

  it("rejects page < 1", () => {
    expect(() => PaginationParams.parse({ page: 0 })).toThrow();
  });

  it("rejects limit > 100", () => {
    expect(() => PaginationParams.parse({ limit: 101 })).toThrow();
  });

  it("rejects limit < 1", () => {
    expect(() => PaginationParams.parse({ limit: 0 })).toThrow();
  });

  it("accepts sortOrder asc and desc", () => {
    for (const sortOrder of ["asc", "desc"]) {
      const params = PaginationParams.parse({ sortOrder });
      expect(params.sortOrder).toBe(sortOrder);
    }
  });

  it("rejects invalid sortOrder", () => {
    expect(() => PaginationParams.parse({ sortOrder: "random" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// APIErrorDetail
// ---------------------------------------------------------------------------

describe("APIErrorDetail", () => {
  it("parses with only required message", () => {
    const detail = APIErrorDetail.parse({ message: "bad request" });
    expect(detail.message).toBe("bad request");
  });

  it("accepts optional field and code", () => {
    const detail = APIErrorDetail.parse({
      field: "amount",
      message: "must be positive",
      code: "INVALID_AMOUNT",
    });
    expect(detail.field).toBe("amount");
    expect(detail.code).toBe("INVALID_AMOUNT");
  });

  it("rejects missing message", () => {
    expect(() => APIErrorDetail.parse({ field: "amount" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// APIKeyScope
// ---------------------------------------------------------------------------

describe("APIKeyScope", () => {
  it("accepts all valid scopes", () => {
    const scopes = [
      "compliance:read",
      "compliance:write",
      "payments:read",
      "payments:write",
      "invoices:read",
      "invoices:write",
      "analytics:read",
      "webhooks:manage",
      "admin",
    ];
    for (const scope of scopes) {
      expect(APIKeyScope.parse(scope)).toBe(scope);
    }
  });

  it("rejects unknown scope", () => {
    expect(() => APIKeyScope.parse("superuser")).toThrow();
  });
});
