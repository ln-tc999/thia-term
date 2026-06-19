import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, ProofLinkConfigSchema } from "../config.js";

// ---------------------------------------------------------------------------
// Save / restore process.env
// ---------------------------------------------------------------------------

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  // Clear any ProofLink-specific env vars before each test
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("PROOFLINK_")) {
      delete process.env[key];
    }
  }
});

afterEach(() => {
  // Restore original env
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("PROOFLINK_")) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, ORIGINAL_ENV);
});

// ---------------------------------------------------------------------------
// ProofLinkConfigSchema (direct Zod validation)
// ---------------------------------------------------------------------------

describe("ProofLinkConfigSchema", () => {
  it("parses a minimal config with all defaults", () => {
    const config = ProofLinkConfigSchema.parse({});
    expect(config.chainalysisBaseUrl).toBe(
      "https://public.chainalysis.com/api/v1",
    );
    expect(config.maxRiskScore).toBe(85);
    expect(config.escalationThreshold).toBe(60);
    expect(config.failOpen).toBe(false);
    expect(config.sanctionsLists).toEqual(["OFAC_SDN"]);
    expect(config.cacheMaxEntries).toBe(10_000);
    expect(config.sanctionsCacheTtlMs).toBe(300_000);
    expect(config.kyaCacheTtlMs).toBe(900_000);
    expect(config.allowlist).toEqual([]);
    expect(config.blocklist).toEqual([]);
  });

  it("rejects maxRiskScore > 100", () => {
    expect(() => ProofLinkConfigSchema.parse({ maxRiskScore: 101 })).toThrow();
  });

  it("rejects maxRiskScore < 0", () => {
    expect(() => ProofLinkConfigSchema.parse({ maxRiskScore: -1 })).toThrow();
  });

  it("rejects escalationThreshold > 100", () => {
    expect(() =>
      ProofLinkConfigSchema.parse({ escalationThreshold: 101 }),
    ).toThrow();
  });

  it("rejects invalid chainalysisBaseUrl", () => {
    expect(() =>
      ProofLinkConfigSchema.parse({ chainalysisBaseUrl: "not-a-url" }),
    ).toThrow();
  });

  it("rejects invalid sanctionsList values", () => {
    expect(() =>
      ProofLinkConfigSchema.parse({
        sanctionsLists: ["OFAC_SDN", "UNKNOWN_LIST"],
      }),
    ).toThrow();
  });

  it("rejects zero or negative cacheMaxEntries", () => {
    expect(() =>
      ProofLinkConfigSchema.parse({ cacheMaxEntries: 0 }),
    ).toThrow();
    expect(() =>
      ProofLinkConfigSchema.parse({ cacheMaxEntries: -1 }),
    ).toThrow();
  });

  it("rejects negative sanctionsCacheTtlMs", () => {
    expect(() =>
      ProofLinkConfigSchema.parse({ sanctionsCacheTtlMs: 0 }),
    ).toThrow();
  });

  it("accepts valid notabene config", () => {
    const config = ProofLinkConfigSchema.parse({
      notabene: {
        apiKey: "nb_key",
        vaspDID: "did:ethr:0xVASP",
      },
    });
    expect(config.notabene?.apiKey).toBe("nb_key");
    expect(config.notabene?.testnet).toBe(false);
    expect(config.notabene?.baseUrl).toBe("https://api.notabene.id/v1");
  });

  it("rejects notabene with invalid baseUrl", () => {
    expect(() =>
      ProofLinkConfigSchema.parse({
        notabene: {
          apiKey: "nb_key",
          vaspDID: "did:ethr:0xVASP",
          baseUrl: "not-a-url",
        },
      }),
    ).toThrow();
  });

  it("accepts all valid sanctionsLists values", () => {
    const config = ProofLinkConfigSchema.parse({
      sanctionsLists: ["OFAC_SDN", "EU_CONSOLIDATED", "UN_CONSOLIDATED", "HMT"],
    });
    expect(config.sanctionsLists).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// loadConfig — default values (no env, no overrides)
// ---------------------------------------------------------------------------

describe("loadConfig — defaults", () => {
  it("returns defaults when no env vars or overrides", () => {
    const config = loadConfig();
    expect(config.failOpen).toBe(false);
    expect(config.maxRiskScore).toBe(85);
    expect(config.chainalysisBaseUrl).toBe(
      "https://public.chainalysis.com/api/v1",
    );
  });
});

// ---------------------------------------------------------------------------
// loadConfig — env var mappings
// ---------------------------------------------------------------------------

describe("loadConfig — environment variables", () => {
  it("reads PROOFLINK_CHAINALYSIS_API_KEY", () => {
    process.env.PROOFLINK_CHAINALYSIS_API_KEY = "test-key-abc";
    const config = loadConfig();
    expect(config.chainalysisApiKey).toBe("test-key-abc");
  });

  it("reads PROOFLINK_CHAINALYSIS_BASE_URL", () => {
    process.env.PROOFLINK_CHAINALYSIS_BASE_URL =
      "https://custom.chainalysis.example.com";
    const config = loadConfig();
    expect(config.chainalysisBaseUrl).toBe(
      "https://custom.chainalysis.example.com",
    );
  });

  it("reads PROOFLINK_MAX_RISK_SCORE as number", () => {
    process.env.PROOFLINK_MAX_RISK_SCORE = "70";
    const config = loadConfig();
    expect(config.maxRiskScore).toBe(70);
  });

  it("reads PROOFLINK_ESCALATION_THRESHOLD as number", () => {
    process.env.PROOFLINK_ESCALATION_THRESHOLD = "50";
    const config = loadConfig();
    expect(config.escalationThreshold).toBe(50);
  });

  it("reads PROOFLINK_FAIL_OPEN=true as boolean true", () => {
    process.env.PROOFLINK_FAIL_OPEN = "true";
    const config = loadConfig();
    expect(config.failOpen).toBe(true);
  });

  it("reads PROOFLINK_FAIL_OPEN=false as boolean false", () => {
    process.env.PROOFLINK_FAIL_OPEN = "false";
    const config = loadConfig();
    expect(config.failOpen).toBe(false);
  });

  it("reads PROOFLINK_RPC_URL", () => {
    process.env.PROOFLINK_RPC_URL = "https://mainnet.infura.io/v3/key";
    const config = loadConfig();
    expect(config.rpcUrl).toBe("https://mainnet.infura.io/v3/key");
  });

  it("reads PROOFLINK_CHAIN_ID as number", () => {
    process.env.PROOFLINK_CHAIN_ID = "8453";
    const config = loadConfig();
    expect(config.chainId).toBe(8453);
  });

  it("reads PROOFLINK_SIGNER_PRIVATE_KEY", () => {
    process.env.PROOFLINK_SIGNER_PRIVATE_KEY = "0xdeadbeef";
    const config = loadConfig();
    expect(config.signerPrivateKey).toBe("0xdeadbeef");
  });

  it("reads PROOFLINK_ERC8004_REGISTRY", () => {
    process.env.PROOFLINK_ERC8004_REGISTRY =
      "0x1234567890abcdef1234567890abcdef12345678";
    const config = loadConfig();
    expect(config.erc8004RegistryAddress).toBe(
      "0x1234567890abcdef1234567890abcdef12345678",
    );
  });

  it("reads PROOFLINK_IPFS_GATEWAY_URL", () => {
    process.env.PROOFLINK_IPFS_GATEWAY_URL = "https://ipfs.infura.io";
    const config = loadConfig();
    expect(config.ipfsGatewayUrl).toBe("https://ipfs.infura.io");
  });

  it("reads Notabene config from env when both API_KEY and VASP_DID are present", () => {
    process.env.PROOFLINK_NOTABENE_API_KEY = "nb_test_key";
    process.env.PROOFLINK_NOTABENE_VASP_DID = "did:ethr:0xVASP123";
    const config = loadConfig();
    expect(config.notabene?.apiKey).toBe("nb_test_key");
    expect(config.notabene?.vaspDID).toBe("did:ethr:0xVASP123");
    expect(config.notabene?.testnet).toBe(false);
  });

  it("does not set notabene when only VASP_DID is present", () => {
    process.env.PROOFLINK_NOTABENE_VASP_DID = "did:ethr:0xVASP123";
    const config = loadConfig();
    expect(config.notabene).toBeUndefined();
  });

  it("reads PROOFLINK_NOTABENE_TESTNET=true", () => {
    process.env.PROOFLINK_NOTABENE_API_KEY = "nb_key";
    process.env.PROOFLINK_NOTABENE_VASP_DID = "did:ethr:0xVASP";
    process.env.PROOFLINK_NOTABENE_TESTNET = "true";
    const config = loadConfig();
    expect(config.notabene?.testnet).toBe(true);
  });

  it("reads PROOFLINK_NOTABENE_BASE_URL override", () => {
    process.env.PROOFLINK_NOTABENE_API_KEY = "nb_key";
    process.env.PROOFLINK_NOTABENE_VASP_DID = "did:ethr:0xVASP";
    process.env.PROOFLINK_NOTABENE_BASE_URL = "https://sandbox.notabene.id/v1";
    const config = loadConfig();
    expect(config.notabene?.baseUrl).toBe("https://sandbox.notabene.id/v1");
  });
});

// ---------------------------------------------------------------------------
// loadConfig — overrides take precedence over env vars
// ---------------------------------------------------------------------------

describe("loadConfig — overrides take precedence", () => {
  it("override value wins over env var", () => {
    process.env.PROOFLINK_MAX_RISK_SCORE = "70";
    const config = loadConfig({ maxRiskScore: 50 });
    expect(config.maxRiskScore).toBe(50);
  });

  it("override failOpen=true wins over no env var", () => {
    const config = loadConfig({ failOpen: true });
    expect(config.failOpen).toBe(true);
  });

  it("override chainalysisApiKey is set", () => {
    const config = loadConfig({ chainalysisApiKey: "override-key" });
    expect(config.chainalysisApiKey).toBe("override-key");
  });
});

// ---------------------------------------------------------------------------
// loadConfig — boundary values
// ---------------------------------------------------------------------------

describe("loadConfig — boundary values", () => {
  it("accepts maxRiskScore exactly at 0", () => {
    const config = loadConfig({ maxRiskScore: 0 });
    expect(config.maxRiskScore).toBe(0);
  });

  it("accepts maxRiskScore exactly at 100", () => {
    const config = loadConfig({ maxRiskScore: 100 });
    expect(config.maxRiskScore).toBe(100);
  });

  it("throws on maxRiskScore=101", () => {
    expect(() => loadConfig({ maxRiskScore: 101 })).toThrow();
  });
});
