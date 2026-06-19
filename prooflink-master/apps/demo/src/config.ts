// ---------------------------------------------------------------------------
// Demo configuration — test addresses, chains, API settings
// ---------------------------------------------------------------------------

export interface TestWallet {
  readonly address: string;
  readonly label: string;
  readonly status: "clean" | "sanctioned" | "new";
  readonly description: string;
}

export interface ChainConfig {
  readonly name: string;
  readonly chainId: number;
  readonly currency: string;
  readonly explorerUrl: string;
  readonly travelRuleThreshold: number;
}

export interface DemoConfig {
  readonly apiUrl: string;
  readonly wallets: Record<string, TestWallet>;
  readonly chains: Record<string, ChainConfig>;
  readonly defaults: {
    readonly amount: number;
    readonly currency: string;
    readonly chain: string;
    readonly travelRuleThreshold: number;
  };
  readonly webhookPort: number;
}

// ---------------------------------------------------------------------------
// Pre-configured test wallets
// ---------------------------------------------------------------------------

const WALLETS: Record<string, TestWallet> = {
  sanctionedTornado: {
    address: "0x905b63Fff465B9fFBF41DeA908CEb12df9d1c960",
    label: "Tornado Cash Deployer",
    status: "sanctioned",
    description: "OFAC SDN listed — Tornado Cash deployer address",
  },
  sanctionedLazarus: {
    address: "0x098B716B8Aaf21512996dC57EB0615e2383E2f96",
    label: "Lazarus Group",
    status: "sanctioned",
    description: "OFAC SDN listed — DPRK Lazarus Group",
  },
  sanctionedBlender: {
    address: "0x0836222F2B2B24A3F36f98668Ed8F0B38D1a872f",
    label: "Blender.io",
    status: "sanctioned",
    description: "OFAC SDN listed — Blender.io mixer",
  },
  cleanVitalik: {
    address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    label: "vitalik.eth",
    status: "clean",
    description: "Ethereum co-founder — well-known clean address",
  },
  cleanCoinbase: {
    address: "0x71660c4005BA85c37ccec55d0C4493E66Fe775d3",
    label: "Coinbase Wallet",
    status: "clean",
    description: "Coinbase institutional wallet — regulated entity",
  },
  cleanUniswap: {
    address: "0x1a9C8182C09F50C8318d769245beA52c32BE35BC",
    label: "Uniswap Treasury",
    status: "clean",
    description: "Uniswap protocol treasury — well-known DeFi",
  },
  newAgent: {
    address: "0xA1b2C3d4E5f6A7B8C9D0E1F2a3B4c5D6e7F8a9B0",
    label: "Agent Wallet (New)",
    status: "new",
    description: "Newly created agent wallet — no history",
  },
  newAgent2: {
    address: "0xB2c3D4e5F6a7B8c9D0e1F2a3B4C5d6E7f8A9b0C1",
    label: "Agent Wallet #2",
    status: "new",
    description: "Second agent wallet for multi-chain demos",
  },
} as const;

// ---------------------------------------------------------------------------
// Chain configurations
// ---------------------------------------------------------------------------

const CHAINS: Record<string, ChainConfig> = {
  ethereum: {
    name: "Ethereum",
    chainId: 1,
    currency: "ETH",
    explorerUrl: "https://etherscan.io",
    travelRuleThreshold: 3000,
  },
  base: {
    name: "Base",
    chainId: 8453,
    currency: "ETH",
    explorerUrl: "https://basescan.org",
    travelRuleThreshold: 3000,
  },
  polygon: {
    name: "Polygon",
    chainId: 137,
    currency: "MATIC",
    explorerUrl: "https://polygonscan.com",
    travelRuleThreshold: 1000,
  },
  arbitrum: {
    name: "Arbitrum",
    chainId: 42161,
    currency: "ETH",
    explorerUrl: "https://arbiscan.io",
    travelRuleThreshold: 3000,
  },
} as const;

// ---------------------------------------------------------------------------
// Full config
// ---------------------------------------------------------------------------

export const demoConfig: DemoConfig = {
  apiUrl: process.env["PROOFLINK_API_URL"] ?? "https://api.prooflink.finance",
  wallets: WALLETS,
  chains: CHAINS,
  defaults: {
    amount: 50,
    currency: "USDC",
    chain: "base",
    travelRuleThreshold: 3000,
  },
  webhookPort: parseInt(process.env["WEBHOOK_PORT"] ?? "9876", 10),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getWallet(key: string): TestWallet {
  const wallet = demoConfig.wallets[key];
  if (!wallet) {
    throw new Error(`Unknown wallet key: ${key}`);
  }
  return wallet;
}

export function getChain(key: string): ChainConfig {
  const chain = demoConfig.chains[key];
  if (!chain) {
    throw new Error(`Unknown chain key: ${key}`);
  }
  return chain;
}

export function getAllSanctionedAddresses(): string[] {
  return Object.values(demoConfig.wallets)
    .filter((w) => w.status === "sanctioned")
    .map((w) => w.address);
}

export function getAllCleanAddresses(): string[] {
  return Object.values(demoConfig.wallets)
    .filter((w) => w.status === "clean")
    .map((w) => w.address);
}

export function getRandomCleanAddress(): string {
  const clean = getAllCleanAddresses();
  return clean[Math.floor(Math.random() * clean.length)] ?? clean[0]!;
}
