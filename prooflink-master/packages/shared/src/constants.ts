// ---------------------------------------------------------------------------
// Chain IDs (CAIP-2 format)
// ---------------------------------------------------------------------------

export const CHAIN_IDS = {
  ETHEREUM_MAINNET: "eip155:1",
  BASE_MAINNET: "eip155:8453",
  POLYGON_MAINNET: "eip155:137",
  ARBITRUM_MAINNET: "eip155:42161",
  SOLANA_MAINNET: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",

  // Testnets
  ETHEREUM_SEPOLIA: "eip155:11155111",
  BASE_SEPOLIA: "eip155:84532",
  POLYGON_AMOY: "eip155:80002",
  ARBITRUM_SEPOLIA: "eip155:421614",
  SOLANA_DEVNET: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
} as const;

export type ChainId = (typeof CHAIN_IDS)[keyof typeof CHAIN_IDS];

// ---------------------------------------------------------------------------
// Numeric Chain IDs (for EVM)
// ---------------------------------------------------------------------------

export const EVM_CHAIN_IDS = {
  ETHEREUM_MAINNET: 1,
  BASE_MAINNET: 8453,
  POLYGON_MAINNET: 137,
  ARBITRUM_MAINNET: 42161,
  ETHEREUM_SEPOLIA: 11155111,
  BASE_SEPOLIA: 84532,
  POLYGON_AMOY: 80002,
  ARBITRUM_SEPOLIA: 421614,
} as const;

// ---------------------------------------------------------------------------
// Sanctions & Compliance API URLs
// ---------------------------------------------------------------------------

export const COMPLIANCE_API_URLS = {
  /** Chainalysis Free Sanctions API (OFAC SDN only) */
  CHAINALYSIS_FREE: "https://public.chainalysis.com/api/v1/address",

  /** Chainalysis KYT (full screening — requires enterprise key) */
  CHAINALYSIS_KYT: "https://api.chainalysis.com/api/kyt/v2",

  /** OFAC SDN list (CSV download) */
  OFAC_SDN_LIST: "https://www.treasury.gov/ofac/downloads/sdn.csv",

  /** OFAC SDN API (advanced search) */
  OFAC_SDN_API:
    "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML",

  /** EU Consolidated Sanctions */
  EU_SANCTIONS_API:
    "https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content",

  /** UN Security Council Consolidated List */
  UN_SANCTIONS_API:
    "https://scsanctions.un.org/resources/xml/en/consolidated.xml",

  /** HM Treasury Sanctions (UK) */
  HMT_SANCTIONS_API:
    "https://ofsistorage.blob.core.windows.net/publishlive/2022format/ConList.xml",

  /** Notabene Travel Rule Gateway */
  NOTABENE_API: "https://api.notabene.id/v1",

  /** EAS (Ethereum Attestation Service) on Base */
  EAS_BASE_MAINNET: "https://base.easscan.org/graphql",
  EAS_BASE_SEPOLIA: "https://base-sepolia.easscan.org/graphql",
} as const;

// ---------------------------------------------------------------------------
// EAS Schema UIDs
// ---------------------------------------------------------------------------

export const EAS_SCHEMA_UIDS = {
  /** ProofLink compliance receipt schema on Base */
  PROOFLINK_RECEIPT:
    "0x0000000000000000000000000000000000000000000000000000000000000000", // placeholder — set after deployment

  /** KYA credential attestation schema */
  KYA_CREDENTIAL:
    "0x0000000000000000000000000000000000000000000000000000000000000000",

  /** Invoice anchor schema */
  INVOICE_ANCHOR:
    "0x0000000000000000000000000000000000000000000000000000000000000000",
} as const;

// ---------------------------------------------------------------------------
// Supported Tokens — contract addresses per chain
// ---------------------------------------------------------------------------

export const TOKEN_ADDRESSES = {
  USDC: {
    ethereum: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    polygon: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    solana: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  },
  USDT: {
    ethereum: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    base: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
    polygon: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    arbitrum: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    solana: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  },
  EURC: {
    ethereum: "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c",
    base: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42",
  },
} as const;

// ---------------------------------------------------------------------------
// Travel Rule Thresholds (USD equivalent)
// ---------------------------------------------------------------------------

export const TRAVEL_RULE_THRESHOLDS = {
  /** US (GENIUS Act / FinCEN) */
  US: 3000,
  /** EU TFR 2023/1113: €0 for CASP-to-CASP (all transfers require IVMS101); €1,000 only for self-hosted wallets */
  EU: 0,
  /** Singapore MAS PS-N02: SGD 1,500 ≈ USD 1,100 */
  SG: 1100,
  /** Japan (JFSA — no threshold, always required) */
  JP: 0,
  /** Default for unlisted jurisdictions */
  DEFAULT: 1000,
} as const;

// ---------------------------------------------------------------------------
// Risk Score Thresholds
// ---------------------------------------------------------------------------

export const RISK_THRESHOLDS = {
  /** Transactions above this score are auto-rejected */
  REJECT: 85,
  /** Transactions above this score require manual review */
  ESCALATE: 60,
  /** On-chain risk threshold for ProofLinkRegistry */
  ON_CHAIN_DEFAULT: 50,
} as const;

// ---------------------------------------------------------------------------
// ProofLink Contract Addresses (Base Mainnet — placeholders pre-deployment)
// ---------------------------------------------------------------------------

export const CONTRACT_ADDRESSES = {
  BASE_MAINNET: {
    PROOFLINK_REGISTRY: "0x0000000000000000000000000000000000000000",
    PROOFLINK_KYA: "0x0000000000000000000000000000000000000000",
    AGENT_INVOICE: "0x0000000000000000000000000000000000000000",
    PROOFLINK_FACILITATOR: "0x0000000000000000000000000000000000000000",
    DISPUTE_ORACLE: "0x0000000000000000000000000000000000000000",
  },
  BASE_SEPOLIA: {
    PROOFLINK_REGISTRY: "0x0000000000000000000000000000000000000000",
    PROOFLINK_KYA: "0x0000000000000000000000000000000000000000",
    AGENT_INVOICE: "0x0000000000000000000000000000000000000000",
    PROOFLINK_FACILITATOR: "0x0000000000000000000000000000000000000000",
    DISPUTE_ORACLE: "0x0000000000000000000000000000000000000000",
  },
} as const;

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

export const MCP_SERVER = {
  NAME: "prooflink-compliance",
  VERSION: "1.0.0",
  VENDOR: "ProofLink",
  BASE_URL: "https://mcp.prooflink.io/v1",
} as const;

// ---------------------------------------------------------------------------
// Sanctions Bitmask Flags (matches ProofLinkRegistry.sanctionsFlags)
// ---------------------------------------------------------------------------

export const SANCTIONS_FLAGS = {
  OFAC: 1 << 0,
  EU: 1 << 1,
  UN: 1 << 2,
  HMT: 1 << 3,
} as const;

// ---------------------------------------------------------------------------
// Default Compliance Policy
// ---------------------------------------------------------------------------

export const DEFAULT_COMPLIANCE_POLICY = {
  sanctionsLists: [
    "OFAC_SDN",
    "EU_CONSOLIDATED",
    "UN_CONSOLIDATED",
    "HMT",
  ] as const,
  maxRiskScore: 85,
  travelRuleThresholdUsd: 1000,
  eddJurisdictions: ["IR", "KP", "SY", "CU", "MM", "RU", "BY"],
  allowlist: [] as string[],
  blocklist: [] as string[],
  failOpen: false,
} as const;

// ---------------------------------------------------------------------------
// Supported Jurisdictions
// ---------------------------------------------------------------------------

export const SUPPORTED_JURISDICTIONS = {
  /** Full compliance support with local regulatory mapping. */
  FULL: [
    "US", "GB", "DE", "FR", "NL", "CH", "SG", "JP", "AU", "CA",
    "IE", "LU", "AT", "BE", "ES", "IT", "PT", "FI", "SE", "DK",
    "NO", "KR", "HK", "AE", "BH",
  ],
  /** EU/EEA member states (MiCA applies). */
  EU_EEA: [
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR",
    "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
    "PL", "PT", "RO", "SK", "SI", "ES", "SE",
    // EEA (non-EU)
    "IS", "LI", "NO",
  ],
  /** FATF-identified high-risk or restricted jurisdictions. */
  RESTRICTED: [
    "IR", "KP", "SY", "MM", "AF",
  ],
  /** Jurisdictions under enhanced monitoring. */
  ENHANCED_MONITORING: [
    "CU", "RU", "BY", "VE", "NI", "YE", "SO", "LY", "IQ", "LB",
  ],
} as const;

// ---------------------------------------------------------------------------
// Error Codes (constant mirror for runtime lookups)
// ---------------------------------------------------------------------------

export { ErrorCode } from "./errors.js";

// ---------------------------------------------------------------------------
// API Versions
// ---------------------------------------------------------------------------

export const API_VERSIONS = {
  CURRENT: "v1",
  SUPPORTED: ["v1"] as const,
  DEPRECATED: [] as string[],
} as const;

// ---------------------------------------------------------------------------
// Rate Limits (requests per window)
// ---------------------------------------------------------------------------

export const RATE_LIMITS = {
  /** Free tier — 100 req / 60s window. */
  FREE: { requests: 100, windowSeconds: 60 },
  /** Standard tier — 1 000 req / 60s window. */
  STANDARD: { requests: 1_000, windowSeconds: 60 },
  /** Pro tier — 10 000 req / 60s window. */
  PRO: { requests: 10_000, windowSeconds: 60 },
  /** Enterprise — 100 000 req / 60s window. */
  ENTERPRISE: { requests: 100_000, windowSeconds: 60 },
} as const;
