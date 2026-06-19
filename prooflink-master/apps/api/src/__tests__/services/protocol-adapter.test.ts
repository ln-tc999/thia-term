import { describe, expect, it } from "vitest";

import {
  getProtocolCompliance,
  isSupportedProtocol,
  _resolvers,
} from "../../services/protocol-adapter.js";
import type { ProtocolComplianceContext } from "../../services/protocol-adapter.js";

// ---------------------------------------------------------------------------
// Fixture factory — sensible defaults, override per test
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<ProtocolComplianceContext> = {}): ProtocolComplianceContext {
  return {
    protocol: "direct",
    senderAddress: "0xSENDER",
    receiverAddress: "0xRECEIVER",
    amount: "100",
    asset: "USDC",
    chain: "eip155:8453",
    amountUsd: 100,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// x402
// ---------------------------------------------------------------------------

describe("getProtocolCompliance — x402", () => {
  it("returns protocol x402", () => {
    const result = getProtocolCompliance(makeCtx({ protocol: "x402", amountUsd: 100 }));
    expect(result.protocol).toBe("x402");
  });

  it("does not add FACILITATOR_SANCTIONS_SCREENING when no facilitator address", () => {
    const result = getProtocolCompliance(makeCtx({ protocol: "x402", amountUsd: 500 }));
    expect(result.additionalChecks).not.toContain("FACILITATOR_SANCTIONS_SCREENING");
  });

  it("adds FACILITATOR_SANCTIONS_SCREENING when facilitator address is present", () => {
    const result = getProtocolCompliance(
      makeCtx({ protocol: "x402", amountUsd: 500, x402FacilitatorAddress: "0xFACILITATOR" }),
    );
    expect(result.additionalChecks).toContain("FACILITATOR_SANCTIONS_SCREENING");
  });

  it("includes facilitator address in protocolSpecificNotes", () => {
    const result = getProtocolCompliance(
      makeCtx({ protocol: "x402", amountUsd: 500, x402FacilitatorAddress: "0xFACILITATOR" }),
    );
    expect(result.protocolSpecificNotes.some((n) => n.includes("0xFACILITATOR"))).toBe(true);
  });

  it("requiresKYA is false when amountUsd <= 1000", () => {
    const result = getProtocolCompliance(makeCtx({ protocol: "x402", amountUsd: 1000 }));
    expect(result.requiresKYA).toBe(false);
  });

  it("requiresKYA is true when amountUsd > 1000", () => {
    const result = getProtocolCompliance(makeCtx({ protocol: "x402", amountUsd: 1001 }));
    expect(result.requiresKYA).toBe(true);
  });

  it("requiresTravelRule is false below $3000", () => {
    const result = getProtocolCompliance(makeCtx({ protocol: "x402", amountUsd: 2999 }));
    expect(result.requiresTravelRule).toBe(false);
  });

  it("requiresTravelRule is true at $3000", () => {
    const result = getProtocolCompliance(makeCtx({ protocol: "x402", amountUsd: 3000 }));
    expect(result.requiresTravelRule).toBe(true);
  });

  it("requiresEnhancedDueDiligence is true at $10,000", () => {
    const result = getProtocolCompliance(makeCtx({ protocol: "x402", amountUsd: 10_000 }));
    expect(result.requiresEnhancedDueDiligence).toBe(true);
  });

  it("requiresEnhancedDueDiligence is false below $10,000", () => {
    const result = getProtocolCompliance(makeCtx({ protocol: "x402", amountUsd: 9_999 }));
    expect(result.requiresEnhancedDueDiligence).toBe(false);
  });

  it("travelRuleThresholdUsd is 3000", () => {
    const result = getProtocolCompliance(makeCtx({ protocol: "x402", amountUsd: 100 }));
    expect(result.travelRuleThresholdUsd).toBe(3000);
  });
});

// ---------------------------------------------------------------------------
// ap2
// ---------------------------------------------------------------------------

describe("getProtocolCompliance — ap2", () => {
  it("returns protocol ap2", () => {
    const result = getProtocolCompliance(makeCtx({ protocol: "ap2", amountUsd: 100 }));
    expect(result.protocol).toBe("ap2");
  });

  it("with mandate: travelRuleThresholdUsd is 5000 (higher threshold)", () => {
    const result = getProtocolCompliance(
      makeCtx({ protocol: "ap2", amountUsd: 4000, ap2MandateId: "mandate-abc" }),
    );
    expect(result.travelRuleThresholdUsd).toBe(5000);
  });

  it("without mandate: travelRuleThresholdUsd is 3000 (standard threshold)", () => {
    const result = getProtocolCompliance(makeCtx({ protocol: "ap2", amountUsd: 4000 }));
    expect(result.travelRuleThresholdUsd).toBe(3000);
  });

  it("with mandate: requiresKYA is false", () => {
    const result = getProtocolCompliance(
      makeCtx({ protocol: "ap2", amountUsd: 2000, ap2MandateId: "mandate-xyz" }),
    );
    expect(result.requiresKYA).toBe(false);
  });

  it("without mandate: requiresKYA is true when amountUsd > 1000", () => {
    const result = getProtocolCompliance(makeCtx({ protocol: "ap2", amountUsd: 1500 }));
    expect(result.requiresKYA).toBe(true);
  });

  it("without mandate: requiresKYA is false when amountUsd <= 1000", () => {
    const result = getProtocolCompliance(makeCtx({ protocol: "ap2", amountUsd: 1000 }));
    expect(result.requiresKYA).toBe(false);
  });

  it("with mandate: adds MANDATE_VALIDATION check", () => {
    const result = getProtocolCompliance(
      makeCtx({ protocol: "ap2", amountUsd: 100, ap2MandateId: "mandate-001" }),
    );
    expect(result.additionalChecks).toContain("MANDATE_VALIDATION");
  });

  it("without mandate: does not add MANDATE_VALIDATION check", () => {
    const result = getProtocolCompliance(makeCtx({ protocol: "ap2", amountUsd: 100 }));
    expect(result.additionalChecks).not.toContain("MANDATE_VALIDATION");
  });

  it("requiresEnhancedDueDiligence at $15,000", () => {
    const result = getProtocolCompliance(
      makeCtx({ protocol: "ap2", amountUsd: 15_000, ap2MandateId: "m1" }),
    );
    expect(result.requiresEnhancedDueDiligence).toBe(true);
  });

  it("requiresEnhancedDueDiligence is false below $15,000", () => {
    const result = getProtocolCompliance(makeCtx({ protocol: "ap2", amountUsd: 14_999 }));
    expect(result.requiresEnhancedDueDiligence).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// mpp
// ---------------------------------------------------------------------------

describe("getProtocolCompliance — mpp", () => {
  it("returns protocol mpp", () => {
    const result = getProtocolCompliance(makeCtx({ protocol: "mpp", amountUsd: 100 }));
    expect(result.protocol).toBe("mpp");
  });

  it("with session: adds SESSION_AUTHENTICATION_CHECK", () => {
    const result = getProtocolCompliance(
      makeCtx({ protocol: "mpp", amountUsd: 500, mppSessionId: "sess-abc" }),
    );
    expect(result.additionalChecks).toContain("SESSION_AUTHENTICATION_CHECK");
  });

  it("without session: does not add SESSION_AUTHENTICATION_CHECK", () => {
    const result = getProtocolCompliance(makeCtx({ protocol: "mpp", amountUsd: 500 }));
    expect(result.additionalChecks).not.toContain("SESSION_AUTHENTICATION_CHECK");
  });

  it("with session: requiresKYA is false below $3000", () => {
    const result = getProtocolCompliance(
      makeCtx({ protocol: "mpp", amountUsd: 2999, mppSessionId: "sess-1" }),
    );
    expect(result.requiresKYA).toBe(false);
  });

  it("with session: requiresKYA is true at $3000", () => {
    const result = getProtocolCompliance(
      makeCtx({ protocol: "mpp", amountUsd: 3000, mppSessionId: "sess-1" }),
    );
    expect(result.requiresKYA).toBe(true);
  });

  it("without session: requiresKYA is true when amountUsd > 1000", () => {
    const result = getProtocolCompliance(makeCtx({ protocol: "mpp", amountUsd: 1001 }));
    expect(result.requiresKYA).toBe(true);
  });

  it("without session: requiresKYA is false when amountUsd <= 1000", () => {
    const result = getProtocolCompliance(makeCtx({ protocol: "mpp", amountUsd: 1000 }));
    expect(result.requiresKYA).toBe(false);
  });

  it("travelRuleThresholdUsd is 3000", () => {
    const result = getProtocolCompliance(makeCtx({ protocol: "mpp", amountUsd: 100 }));
    expect(result.travelRuleThresholdUsd).toBe(3000);
  });

  it("requiresEnhancedDueDiligence at $10,000", () => {
    const result = getProtocolCompliance(makeCtx({ protocol: "mpp", amountUsd: 10_000 }));
    expect(result.requiresEnhancedDueDiligence).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// acp
// ---------------------------------------------------------------------------

describe("getProtocolCompliance — acp", () => {
  it("returns protocol acp", () => {
    const result = getProtocolCompliance(makeCtx({ protocol: "acp", amountUsd: 100 }));
    expect(result.protocol).toBe("acp");
  });

  it("with checkoutId: adds MERCHANT_VERIFICATION_CHECK", () => {
    const result = getProtocolCompliance(
      makeCtx({ protocol: "acp", amountUsd: 100, acpCheckoutId: "co-001" }),
    );
    expect(result.additionalChecks).toContain("MERCHANT_VERIFICATION_CHECK");
  });

  it("without checkoutId: does not add MERCHANT_VERIFICATION_CHECK", () => {
    const result = getProtocolCompliance(makeCtx({ protocol: "acp", amountUsd: 100 }));
    expect(result.additionalChecks).not.toContain("MERCHANT_VERIFICATION_CHECK");
  });

  it("with checkoutId: requiresKYA is false below $5000", () => {
    const result = getProtocolCompliance(
      makeCtx({ protocol: "acp", amountUsd: 4999, acpCheckoutId: "co-1" }),
    );
    expect(result.requiresKYA).toBe(false);
  });

  it("with checkoutId: requiresKYA is true at $5000", () => {
    const result = getProtocolCompliance(
      makeCtx({ protocol: "acp", amountUsd: 5000, acpCheckoutId: "co-1" }),
    );
    expect(result.requiresKYA).toBe(true);
  });

  it("without checkoutId: requiresKYA is true when amountUsd > 1000", () => {
    const result = getProtocolCompliance(makeCtx({ protocol: "acp", amountUsd: 1500 }));
    expect(result.requiresKYA).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// direct
// ---------------------------------------------------------------------------

describe("getProtocolCompliance — direct", () => {
  it("returns protocol direct", () => {
    const result = getProtocolCompliance(makeCtx({ protocol: "direct", amountUsd: 100 }));
    expect(result.protocol).toBe("direct");
  });

  it("always requiresKYA regardless of amount", () => {
    expect(getProtocolCompliance(makeCtx({ protocol: "direct", amountUsd: 1 })).requiresKYA).toBe(true);
    expect(getProtocolCompliance(makeCtx({ protocol: "direct", amountUsd: 50_000 })).requiresKYA).toBe(true);
  });

  it("requiresEnhancedDueDiligence at $5000 (lower EDD threshold than other protocols)", () => {
    const result = getProtocolCompliance(makeCtx({ protocol: "direct", amountUsd: 5000 }));
    expect(result.requiresEnhancedDueDiligence).toBe(true);
  });

  it("requiresEnhancedDueDiligence is false below $5000", () => {
    const result = getProtocolCompliance(makeCtx({ protocol: "direct", amountUsd: 4999 }));
    expect(result.requiresEnhancedDueDiligence).toBe(false);
  });

  it("always includes FULL_COUNTERPARTY_SCREENING in additionalChecks", () => {
    const result = getProtocolCompliance(makeCtx({ protocol: "direct", amountUsd: 100 }));
    expect(result.additionalChecks).toContain("FULL_COUNTERPARTY_SCREENING");
  });

  it("includes no-trust-layer note in protocolSpecificNotes", () => {
    const result = getProtocolCompliance(makeCtx({ protocol: "direct", amountUsd: 100 }));
    expect(result.protocolSpecificNotes.some((n) => n.includes("no trust layer"))).toBe(true);
  });

  it("travelRuleThresholdUsd is 3000", () => {
    const result = getProtocolCompliance(makeCtx({ protocol: "direct", amountUsd: 100 }));
    expect(result.travelRuleThresholdUsd).toBe(3000);
  });
});

// ---------------------------------------------------------------------------
// Unknown protocol falls back to direct (most restrictive)
// ---------------------------------------------------------------------------

describe("getProtocolCompliance — unknown protocol falls back to direct", () => {
  it("applies direct rules for an unrecognized protocol string", () => {
    // Cast to bypass TS type checking — simulates runtime input
    const ctx = makeCtx({ protocol: "unknown_proto" as "direct", amountUsd: 100 });
    const result = getProtocolCompliance(ctx);

    expect(result.protocol).toBe("direct");
    expect(result.requiresKYA).toBe(true);
    expect(result.additionalChecks).toContain("FULL_COUNTERPARTY_SCREENING");
  });

  it("applies EDD at $5000 for unknown protocol (inherits direct threshold)", () => {
    const ctx = makeCtx({ protocol: "foobar" as "direct", amountUsd: 5000 });
    const result = getProtocolCompliance(ctx);
    expect(result.requiresEnhancedDueDiligence).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isSupportedProtocol
// ---------------------------------------------------------------------------

describe("isSupportedProtocol", () => {
  it("returns true for x402", () => {
    expect(isSupportedProtocol("x402")).toBe(true);
  });

  it("returns true for ap2", () => {
    expect(isSupportedProtocol("ap2")).toBe(true);
  });

  it("returns true for mpp", () => {
    expect(isSupportedProtocol("mpp")).toBe(true);
  });

  it("returns true for acp", () => {
    expect(isSupportedProtocol("acp")).toBe(true);
  });

  it("returns true for direct", () => {
    expect(isSupportedProtocol("direct")).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(isSupportedProtocol("")).toBe(false);
  });

  it("returns false for unknown protocol string", () => {
    expect(isSupportedProtocol("graphql")).toBe(false);
    expect(isSupportedProtocol("lightning")).toBe(false);
  });

  it("is a type predicate — narrows to SupportedProtocol", () => {
    const proto: string = "x402";
    if (isSupportedProtocol(proto)) {
      // TypeScript should narrow `proto` to SupportedProtocol here
      expect(proto).toBe("x402");
    }
  });
});

// ---------------------------------------------------------------------------
// _resolvers (exported for testing — individual resolver smoke tests)
// ---------------------------------------------------------------------------

describe("_resolvers — exported resolver references", () => {
  it("_resolvers.resolveX402 is callable and returns x402 protocol", () => {
    const result = _resolvers.resolveX402(makeCtx({ protocol: "x402", amountUsd: 50 }));
    expect(result.protocol).toBe("x402");
  });

  it("_resolvers.resolveAp2 is callable and returns ap2 protocol", () => {
    const result = _resolvers.resolveAp2(makeCtx({ protocol: "ap2", amountUsd: 50 }));
    expect(result.protocol).toBe("ap2");
  });

  it("_resolvers.resolveMpp is callable and returns mpp protocol", () => {
    const result = _resolvers.resolveMpp(makeCtx({ protocol: "mpp", amountUsd: 50 }));
    expect(result.protocol).toBe("mpp");
  });

  it("_resolvers.resolveAcp is callable and returns acp protocol", () => {
    const result = _resolvers.resolveAcp(makeCtx({ protocol: "acp", amountUsd: 50 }));
    expect(result.protocol).toBe("acp");
  });

  it("_resolvers.resolveDirect is callable and returns direct protocol", () => {
    const result = _resolvers.resolveDirect(makeCtx({ protocol: "direct", amountUsd: 50 }));
    expect(result.protocol).toBe("direct");
  });
});
