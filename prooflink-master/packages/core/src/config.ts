import { z } from "zod";

// ---------------------------------------------------------------------------
// ProofLink Engine Configuration
// ---------------------------------------------------------------------------

export const ProofLinkConfigSchema = z.object({
  /** Chainalysis free sanctions API key (optional — free API works without key) */
  chainalysisApiKey: z.string().optional(),

  /** Base URL for Chainalysis free sanctions API */
  chainalysisBaseUrl: z
    .string()
    .url()
    .default("https://public.chainalysis.com/api/v1"),

  /** Sanctions lists to screen against */
  sanctionsLists: z
    .array(z.enum(["OFAC_SDN", "EU_CONSOLIDATED", "UN_CONSOLIDATED", "HMT"]))
    .default(["OFAC_SDN"]),

  /** Maximum AML risk score before rejection (0-100) */
  maxRiskScore: z.number().int().min(0).max(100).default(85),

  /** AML risk score threshold for escalation */
  escalationThreshold: z.number().int().min(0).max(100).default(60),

  /** Whether to fail-open when external APIs are unreachable */
  failOpen: z.boolean().default(false),

  /** Wallet addresses that bypass compliance checks */
  allowlist: z.array(z.string()).default([]),

  /** Wallet addresses that are always blocked */
  blocklist: z.array(z.string()).default([]),

  /** Travel Rule thresholds by jurisdiction (ISO 3166-1 alpha-2 -> USD equivalent) */
  travelRuleThresholds: z
    .record(z.string(), z.number().nonnegative())
    .default({
      US: 3000,
      EU: 0,
      // EU member states mapped to EU zero-threshold (MiCA TFR Article 14)
      DE: 0, FR: 0, IT: 0, ES: 0, NL: 0, BE: 0, AT: 0, IE: 0, PT: 0,
      FI: 0, GR: 0, LU: 0, SK: 0, SI: 0, EE: 0, LV: 0, LT: 0, CY: 0,
      MT: 0, HR: 0, BG: 0, RO: 0, CZ: 0, DK: 0, HU: 0, PL: 0, SE: 0,
      SG: 1100,
      JP: 0,
      KR: 850,
      AE: 950,
    }),

  /** Default Travel Rule threshold in USD (for jurisdictions not explicitly listed) */
  defaultTravelRuleThresholdUsd: z.number().nonnegative().default(3000),

  /** Notabene API config for Travel Rule transmission */
  notabene: z
    .object({
      apiKey: z.string(),
      vaspDID: z.string(),
      baseUrl: z.string().url().default("https://api.notabene.id/v1"),
      testnet: z.boolean().default(false),
    })
    .optional(),

  /** ERC-8004 registry contract address */
  erc8004RegistryAddress: z.string().optional(),

  /** RPC URL for on-chain lookups (ERC-8004, EIP-712 signing) */
  rpcUrl: z.string().url().optional(),

  /** Chain ID for on-chain operations */
  chainId: z.number().int().positive().optional(),

  /** Private key for signing compliance receipts (EIP-712) */
  signerPrivateKey: z.string().optional(),

  /** LRU cache max entries */
  cacheMaxEntries: z.number().int().positive().default(10_000),

  /** Sanctions cache TTL in milliseconds */
  sanctionsCacheTtlMs: z.number().int().positive().default(5 * 60 * 1000),

  /** KYA credential cache TTL in milliseconds */
  kyaCacheTtlMs: z.number().int().positive().default(15 * 60 * 1000),

  /** Restricted jurisdictions (ISO 3166-1 alpha-2 codes) */
  restrictedJurisdictions: z
    .array(z.string())
    .default(["IR", "KP", "SY", "CU", "RU"]),

  /** IPFS gateway URL for receipt anchoring */
  ipfsGatewayUrl: z.string().url().optional(),
});

export type ProofLinkConfig = z.infer<typeof ProofLinkConfigSchema>;

/**
 * Load ProofLink configuration from environment variables, with optional overrides.
 * Environment variables are prefixed with `PROOFLINK_`.
 */
export function loadConfig(
  overrides?: Partial<ProofLinkConfig>,
): ProofLinkConfig {
  const env = typeof process !== "undefined" ? process.env : {};

  const fromEnv: Record<string, unknown> = {};

  if (env.PROOFLINK_CHAINALYSIS_API_KEY) {
    fromEnv.chainalysisApiKey = env.PROOFLINK_CHAINALYSIS_API_KEY;
  }
  if (env.PROOFLINK_CHAINALYSIS_BASE_URL) {
    fromEnv.chainalysisBaseUrl = env.PROOFLINK_CHAINALYSIS_BASE_URL;
  }
  if (env.PROOFLINK_MAX_RISK_SCORE) {
    fromEnv.maxRiskScore = Number(env.PROOFLINK_MAX_RISK_SCORE);
  }
  if (env.PROOFLINK_ESCALATION_THRESHOLD) {
    fromEnv.escalationThreshold = Number(env.PROOFLINK_ESCALATION_THRESHOLD);
  }
  if (env.PROOFLINK_FAIL_OPEN) {
    fromEnv.failOpen = env.PROOFLINK_FAIL_OPEN === "true";
  }
  if (env.PROOFLINK_RPC_URL) {
    fromEnv.rpcUrl = env.PROOFLINK_RPC_URL;
  }
  if (env.PROOFLINK_CHAIN_ID) {
    fromEnv.chainId = Number(env.PROOFLINK_CHAIN_ID);
  }
  if (env.PROOFLINK_SIGNER_PRIVATE_KEY) {
    fromEnv.signerPrivateKey = env.PROOFLINK_SIGNER_PRIVATE_KEY;
  }
  if (env.PROOFLINK_ERC8004_REGISTRY) {
    fromEnv.erc8004RegistryAddress = env.PROOFLINK_ERC8004_REGISTRY;
  }
  if (env.PROOFLINK_IPFS_GATEWAY_URL) {
    fromEnv.ipfsGatewayUrl = env.PROOFLINK_IPFS_GATEWAY_URL;
  }

  // Notabene from env
  if (env.PROOFLINK_NOTABENE_API_KEY && env.PROOFLINK_NOTABENE_VASP_DID) {
    fromEnv.notabene = {
      apiKey: env.PROOFLINK_NOTABENE_API_KEY,
      vaspDID: env.PROOFLINK_NOTABENE_VASP_DID,
      baseUrl:
        env.PROOFLINK_NOTABENE_BASE_URL ?? "https://api.notabene.id/v1",
      testnet: env.PROOFLINK_NOTABENE_TESTNET === "true",
    };
  }

  const merged = { ...fromEnv, ...overrides };
  return ProofLinkConfigSchema.parse(merged);
}
