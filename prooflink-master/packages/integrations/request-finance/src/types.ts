import { z } from "zod";

// ---------------------------------------------------------------------------
// Request Network Chain Identifiers
// ---------------------------------------------------------------------------

export const RequestNetworkChain = z.enum([
  "mainnet",
  "gnosis",
  "polygon",
  "arbitrum",
  "optimism",
  "base",
  "bsc",
  "celo",
  "fantom",
  "zksync",
  "sepolia",
  "sonic",
  "tron",
]);
export type RequestNetworkChain = z.infer<typeof RequestNetworkChain>;

// ---------------------------------------------------------------------------
// Request Network Currency
// ---------------------------------------------------------------------------

export const RequestNetworkCurrency = z.object({
  type: z.enum(["ERC20", "ETH", "ISO4217"]),
  value: z.string(), // contract address for ERC20, "ETH" for native, ISO code for fiat
  network: RequestNetworkChain,
  decimals: z.number().int().nonnegative().optional(),
});
export type RequestNetworkCurrency = z.infer<typeof RequestNetworkCurrency>;

// ---------------------------------------------------------------------------
// Request Network Invoice State
// ---------------------------------------------------------------------------

export const RequestNetworkState = z.enum([
  "created",
  "accepted",
  "canceled",
  "paid",
  "overpaid",
  "underpaid",
]);
export type RequestNetworkState = z.infer<typeof RequestNetworkState>;

// ---------------------------------------------------------------------------
// Request Network Identity
// ---------------------------------------------------------------------------

export const RequestNetworkIdentity = z.object({
  type: z.enum(["ethereumAddress", "tronAddress"]),
  value: z.string(),
});
export type RequestNetworkIdentity = z.infer<typeof RequestNetworkIdentity>;

// ---------------------------------------------------------------------------
// Request Network Extension Data (arbitrary key-value on invoice)
// ---------------------------------------------------------------------------

export const RequestNetworkExtensionData = z.record(
  z.string(),
  z.unknown(),
);
export type RequestNetworkExtensionData = z.infer<typeof RequestNetworkExtensionData>;

// ---------------------------------------------------------------------------
// Request Network Invoice (data-format compatible)
// ---------------------------------------------------------------------------

export const RequestNetworkInvoice = z.object({
  requestId: z.string(),
  version: z.string().default("0.62.0"),
  state: RequestNetworkState,

  // Parties
  payee: RequestNetworkIdentity,
  payer: RequestNetworkIdentity,

  // Amounts
  currency: RequestNetworkCurrency,
  expectedAmount: z.string(), // decimal string in smallest unit
  balance: z.string().optional(), // amount paid so far

  // Timestamps
  timestamp: z.number(), // unix epoch seconds
  creationDate: z.string().optional(), // ISO 8601
  paymentDueDate: z.string().optional(), // ISO 8601

  // Content data (stored on IPFS)
  contentData: z
    .object({
      reason: z.string().optional(),
      dueDate: z.string().optional(),
      builderId: z.string().optional(),
      createdWith: z.string().optional(),
      invoiceNumber: z.string().optional(),
      invoiceItems: z
        .array(
          z.object({
            name: z.string(),
            quantity: z.number(),
            unitPrice: z.string(), // decimal string
            currency: z.string(),
            taxPercent: z.number().optional(),
          }),
        )
        .optional(),
      sellerInfo: z
        .object({
          businessName: z.string().optional(),
          taxRegistration: z.string().optional(),
          address: z.record(z.string(), z.string()).optional(),
        })
        .optional(),
      buyerInfo: z
        .object({
          businessName: z.string().optional(),
          taxRegistration: z.string().optional(),
          address: z.record(z.string(), z.string()).optional(),
        })
        .optional(),
      // ProofLink compliance extension data
      prooflinkCompliance: z
        .object({
          proofLinkReceiptId: z.string().optional(),
          complianceStatus: z.string().optional(),
          sanctionsCleared: z.boolean().optional(),
          travelRuleTransmitted: z.boolean().optional(),
          amlRiskScore: z.number().optional(),
          easAttestationUid: z.string().optional(),
        })
        .optional(),
    })
    .passthrough()
    .optional(),

  // Extension data (protocol-level extensions)
  extensions: z.record(z.string(), RequestNetworkExtensionData).optional(),

  // IPFS CID for the full invoice data
  ipfsCid: z.string().optional(),
});
export type RequestNetworkInvoice = z.infer<typeof RequestNetworkInvoice>;

// ---------------------------------------------------------------------------
// Payment Detection Event
// ---------------------------------------------------------------------------

export const PaymentDetectionEvent = z.object({
  amount: z.string(),
  name: z.enum(["payment", "refund"]),
  parameters: z.object({
    txHash: z.string(),
    block: z.number(),
    from: z.string(),
    to: z.string().optional(),
    feeAmount: z.string().optional(),
    feeAddress: z.string().optional(),
  }),
  timestamp: z.number(),
});
export type PaymentDetectionEvent = z.infer<typeof PaymentDetectionEvent>;

// ---------------------------------------------------------------------------
// Request Network Client Config
// ---------------------------------------------------------------------------

export const RequestNetworkClientConfig = z.object({
  /** Request Network node URL (e.g. https://gnosis.gateway.request.network) */
  nodeUrl: z.string().url(),
  /** IPFS gateway URL for fetching invoice content */
  ipfsGatewayUrl: z.string().url().default("https://gateway.ipfs.io"),
  /** The Graph API URL for payment detection indexer */
  theGraphUrl: z.string().url().optional(),
  /** Signer private key for creating requests (hex, no 0x prefix) */
  signerPrivateKey: z.string().optional(),
  /** Payment network chain */
  paymentChain: RequestNetworkChain.default("mainnet"),
  /** Request timeout in ms */
  timeoutMs: z.number().int().positive().default(30_000),
});
export type RequestNetworkClientConfig = z.infer<typeof RequestNetworkClientConfig>;

// ---------------------------------------------------------------------------
// Chain Mapping: ProofLink SupportedChain <-> RequestNetworkChain
// ---------------------------------------------------------------------------

export const PROOFLINK_TO_RN_CHAIN: Record<string, RequestNetworkChain> = {
  ethereum: "mainnet",
  base: "base",
  polygon: "polygon",
  arbitrum: "arbitrum",
};

export const RN_TO_PROOFLINK_CHAIN: Record<string, string> = {
  mainnet: "ethereum",
  base: "base",
  polygon: "polygon",
  arbitrum: "arbitrum",
  gnosis: "ethereum", // fallback — Gnosis storage chain maps loosely
};

// ---------------------------------------------------------------------------
// Currency Mapping
// ---------------------------------------------------------------------------

/** Well-known ERC20 contract addresses per chain for stablecoins */
export const STABLECOIN_ADDRESSES: Record<string, Record<string, string>> = {
  mainnet: {
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    EURC: "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c",
  },
  base: {
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  polygon: {
    USDC: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    USDT: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
  },
  arbitrum: {
    USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
  },
};
