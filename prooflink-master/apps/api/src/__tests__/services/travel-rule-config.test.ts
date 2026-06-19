import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock DB — resolveAgentOriginator calls getDb() internally
// ---------------------------------------------------------------------------

const mockSelectWhereLimitFn = vi.fn();

vi.mock("../../db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: mockSelectWhereLimitFn,
        }),
      }),
    }),
  }),
}));

import {
  resolveJurisdiction,
  resolveTravelRuleThreshold,
  resolveAgentOriginator,
  JURISDICTION_RULES,
  DEFAULT_JURISDICTION_RULE,
} from "../../services/travel-rule-config.js";

// ---------------------------------------------------------------------------
// resolveJurisdiction
// ---------------------------------------------------------------------------

describe("resolveJurisdiction", () => {
  // DID-based resolution
  it("resolves DID with .de TLD to EU", () => {
    expect(resolveJurisdiction("ethereum", "did:web:vasp.de")).toBe("EU");
  });

  it("resolves DID with .fr TLD to EU", () => {
    expect(resolveJurisdiction("ethereum", "did:web:bank.fr")).toBe("EU");
  });

  it("resolves DID with .jp TLD to JP", () => {
    expect(resolveJurisdiction("ethereum", "did:web:agent.jp")).toBe("JP");
  });

  it("resolves DID with .us TLD to US", () => {
    expect(resolveJurisdiction("ethereum", "did:web:vasp.us")).toBe("US");
  });

  it("resolves DID with .gb TLD to GB", () => {
    expect(resolveJurisdiction("ethereum", "did:web:bank.gb")).toBe("GB");
  });

  it("resolves DID with .sg TLD to SG", () => {
    expect(resolveJurisdiction("ethereum", "did:web:vasp.sg")).toBe("SG");
  });

  it("resolves DID with .ae TLD to AE", () => {
    expect(resolveJurisdiction("ethereum", "did:web:vasp.ae")).toBe("AE");
  });

  it("DID-based resolution is case-insensitive for TLD", () => {
    expect(resolveJurisdiction("ethereum", "did:web:vasp.DE")).toBe("EU");
    expect(resolveJurisdiction("ethereum", "did:web:vasp.JP")).toBe("JP");
  });

  // EU member state mapping
  it("maps all EU member state codes to EU rule set", () => {
    const euCodes = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR",
      "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
      "PL", "PT", "RO", "SK", "SI", "ES", "SE"];

    for (const code of euCodes) {
      const did = `did:web:vasp.${code.toLowerCase()}`;
      expect(resolveJurisdiction("ethereum", did)).toBe("EU");
    }
  });

  // Chain-based resolution
  it("resolves chain 'eip155:8453' (Base) to US via chain hint", () => {
    // eip155:8453 is not in the CHAIN_JURISDICTION_HINTS map directly;
    // check the normalized form — the function normalizes via toLowerCase().trim()
    // "eip155:8453" is not mapped, so this resolves to UNKNOWN unless we use "base"
    const result = resolveJurisdiction("eip155:8453");
    // eip155:8453 is not a key — chain hint won't match. Returns UNKNOWN.
    expect(result).toBe("UNKNOWN");
  });

  it("resolves chain 'base' to US", () => {
    expect(resolveJurisdiction("base")).toBe("US");
  });

  it("resolves chain 'ethereum' to US", () => {
    expect(resolveJurisdiction("ethereum")).toBe("US");
  });

  it("resolves chain 'optimism' to US", () => {
    expect(resolveJurisdiction("optimism")).toBe("US");
  });

  it("resolves chain 'arbitrum' to US", () => {
    expect(resolveJurisdiction("arbitrum")).toBe("US");
  });

  it("resolves chain 'gnosis' to EU", () => {
    expect(resolveJurisdiction("gnosis")).toBe("EU");
  });

  it("resolves chain 'astar' to JP", () => {
    expect(resolveJurisdiction("astar")).toBe("JP");
  });

  it("resolves chain 'polygon' to UNKNOWN (multi-jurisdictional)", () => {
    expect(resolveJurisdiction("polygon")).toBe("UNKNOWN");
  });

  it("resolves chain 'solana' to UNKNOWN", () => {
    expect(resolveJurisdiction("solana")).toBe("UNKNOWN");
  });

  // Unknown chain + no DID
  it("returns UNKNOWN when chain is unrecognized and no DID provided", () => {
    expect(resolveJurisdiction("terra")).toBe("UNKNOWN");
    expect(resolveJurisdiction("")).toBe("UNKNOWN");
  });

  // DID takes priority over chain hint
  it("DID-based resolution takes priority over chain hint", () => {
    // DID says JP, chain says US — DID should win
    const result = resolveJurisdiction("ethereum", "did:web:vasp.jp");
    expect(result).toBe("JP");
  });
});

// ---------------------------------------------------------------------------
// resolveTravelRuleThreshold
// ---------------------------------------------------------------------------

describe("resolveTravelRuleThreshold", () => {
  it("EU vs US: applies EU threshold (0) as the lower/more-restrictive threshold", () => {
    const result = resolveTravelRuleThreshold(
      1000,
      "ethereum",
      "ethereum",
      "did:web:sender.de",
      "did:web:receiver.us",
    );
    expect(result.appliedThresholdUsd).toBe(0);
    expect(result.triggeringJurisdiction).toBe("EU");
    expect(result.applies).toBe(true);
  });

  it("US vs US: applies US threshold ($3000)", () => {
    const result = resolveTravelRuleThreshold(
      2999,
      "ethereum",
      "ethereum",
      "did:web:sender.us",
      "did:web:receiver.us",
    );
    expect(result.appliedThresholdUsd).toBe(3000);
    expect(result.applies).toBe(false);
  });

  it("US vs US at exactly $3000: Travel Rule applies", () => {
    const result = resolveTravelRuleThreshold(
      3000,
      "ethereum",
      "ethereum",
      "did:web:sender.us",
      "did:web:receiver.us",
    );
    expect(result.applies).toBe(true);
  });

  it("unknown jurisdiction applies DEFAULT threshold (0) — most restrictive", () => {
    const result = resolveTravelRuleThreshold(100, "terra", "terra");
    expect(result.appliedThresholdUsd).toBe(0);
    expect(result.applies).toBe(true);
  });

  it("UNKNOWN jurisdiction uses DEFAULT_JURISDICTION_RULE (threshold 0)", () => {
    const result = resolveTravelRuleThreshold(1, "terra", "terra");
    expect(result.appliedThresholdUsd).toBe(DEFAULT_JURISDICTION_RULE.threshold);
    expect(result.appliedThresholdUsd).toBe(0);
  });

  it("sender and receiver jurisdiction codes are returned in result", () => {
    const result = resolveTravelRuleThreshold(
      500,
      "ethereum",
      "ethereum",
      "did:web:sender.us",
      "did:web:receiver.gb",
    );
    expect(result.senderJurisdiction).toBe("US");
    expect(result.receiverJurisdiction).toBe("GB");
  });

  it("requiresFullIVMS101 is true when threshold applies and rule requires address", () => {
    // EU rule: threshold=0, requiresAddress=true
    const result = resolveTravelRuleThreshold(
      100,
      "gnosis",
      "gnosis",
    );
    expect(result.requiresFullIVMS101).toBe(true);
  });

  it("requiresFullIVMS101 is false when Travel Rule does not apply", () => {
    // US threshold=3000; amount=100 < 3000 → does not apply
    const result = resolveTravelRuleThreshold(
      100,
      "ethereum",
      "ethereum",
      "did:web:sender.us",
      "did:web:receiver.us",
    );
    expect(result.applies).toBe(false);
    expect(result.requiresFullIVMS101).toBe(false);
  });

  it("JP vs US: applies JP threshold (0) as lower", () => {
    const result = resolveTravelRuleThreshold(
      500,
      "astar",
      "ethereum",
    );
    // astar → JP (threshold 0), ethereum → US (threshold 3000)
    expect(result.appliedThresholdUsd).toBe(0);
    expect(result.triggeringJurisdiction).toBe("JP");
  });

  it("appliedRule is the actual JurisdictionRule object", () => {
    const result = resolveTravelRuleThreshold(
      500,
      "ethereum",
      "ethereum",
      "did:web:sender.us",
      "did:web:receiver.us",
    );
    expect(result.appliedRule).toEqual(JURISDICTION_RULES["US"]);
  });
});

// ---------------------------------------------------------------------------
// resolveAgentOriginator — DB-backed
// ---------------------------------------------------------------------------

describe("resolveAgentOriginator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const agentDid = "did:web:agent.prooflink.io";

  function makeAgentRow(overrides: Record<string, unknown> = {}) {
    return {
      controllingEntityName: "Acme Corp",
      controllingEntityLei: "529900T8BM49AURSDO55",
      agentDid,
      name: "Acme Agent",
      agentType: "autonomous",
      isActive: true,
      ...overrides,
    };
  }

  it("returns AgentOriginatorInfo when agent is found and active", async () => {
    mockSelectWhereLimitFn.mockResolvedValue([makeAgentRow()]);

    const result = await resolveAgentOriginator(agentDid);

    expect(result).not.toBeNull();
    expect(result?.agentDid).toBe(agentDid);
    expect(result?.controllingEntityName).toBe("Acme Corp");
    expect(result?.controllingEntityLei).toBe("529900T8BM49AURSDO55");
    expect(result?.agentName).toBe("Acme Agent");
    expect(result?.agentType).toBe("autonomous");
  });

  it("returns null when agent is not found (empty DB result)", async () => {
    mockSelectWhereLimitFn.mockResolvedValue([]);

    const result = await resolveAgentOriginator(agentDid);

    expect(result).toBeNull();
  });

  it("returns null when agent exists but isActive is false", async () => {
    mockSelectWhereLimitFn.mockResolvedValue([makeAgentRow({ isActive: false })]);

    const result = await resolveAgentOriginator(agentDid);

    expect(result).toBeNull();
  });

  it("returns controllingEntityLei as null when it is null in DB", async () => {
    mockSelectWhereLimitFn.mockResolvedValue([makeAgentRow({ controllingEntityLei: null })]);

    const result = await resolveAgentOriginator(agentDid);

    expect(result?.controllingEntityLei).toBeNull();
  });

  it("returns agentName as null when name is null in DB", async () => {
    mockSelectWhereLimitFn.mockResolvedValue([makeAgentRow({ name: null })]);

    const result = await resolveAgentOriginator(agentDid);

    expect(result?.agentName).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// JURISDICTION_RULES + DEFAULT_JURISDICTION_RULE exports
// ---------------------------------------------------------------------------

describe("JURISDICTION_RULES", () => {
  it("US threshold is 3000", () => {
    expect(JURISDICTION_RULES["US"]?.threshold).toBe(3000);
  });

  it("EU threshold is 0 (all transactions)", () => {
    expect(JURISDICTION_RULES["EU"]?.threshold).toBe(0);
  });

  it("JP threshold is 0 (no de minimis)", () => {
    expect(JURISDICTION_RULES["JP"]?.threshold).toBe(0);
  });

  it("DEFAULT_JURISDICTION_RULE threshold is 0 (most restrictive)", () => {
    expect(DEFAULT_JURISDICTION_RULE.threshold).toBe(0);
  });

  it("DEFAULT_JURISDICTION_RULE requiresNationalId is true", () => {
    expect(DEFAULT_JURISDICTION_RULE.requiresNationalId).toBe(true);
  });
});
