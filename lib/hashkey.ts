// HashKey Chain Configuration

// Testnet (Chain ID 133) — what we use in the app today
export const hashkeyChain = {
  id: 133,
  name: 'HashKey Testnet',
  network: 'hashkey-testnet',
  nativeCurrency: {
    decimals: 18,
    name: 'HashKey Token',
    symbol: 'HSK',
  },
  rpcUrls: {
    default: {
      http: ['https://testnet.hsk.xyz'],
    },
    public: {
      http: ['https://testnet.hsk.xyz'],
    },
  },
  blockExplorers: {
    default: {
      name: 'HashKey Testnet Explorer',
      url: 'https://testnet.explorer.hsk.xyz',
    },
  },
  testnet: true,
}

// Mainnet (Chain ID 177)
export const hashkeyMainnet = {
  id: 177,
  name: 'HashKey Chain',
  network: 'hashkey',
  nativeCurrency: {
    decimals: 18,
    name: 'HashKey Token',
    symbol: 'HSK',
  },
  rpcUrls: {
    default: { http: ['https://mainnet.hsk.xyz'] },
    public:  { http: ['https://mainnet.hsk.xyz'] },
  },
  blockExplorers: {
    default: { name: 'HashKey Explorer', url: 'https://explorer.hsk.xyz' },
  },
  testnet: false,
}

// Alias for backwards compat
export const hashkeyTestnet = hashkeyChain

// HashKey-specific token configurations
export const hashkeyTokens = {
  stablecoins: [
    {
      symbol: 'USDC',
      name: 'USD Coin',
      address: '0x8845E8C74cE5dF8E0d37bf0fe57dc5E0ddD8021b' as string,
      decimals: 6,
    },
    {
      symbol: 'USDT',
      name: 'Tether USD',
      address: '0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029' as string,
      decimals: 6,
    },
  ],

  // Kept for utils compatibility
  RWATokens: [] as Array<{ symbol: string; name: string; address: string; decimals: number; apy?: string }>,
  MMFTokens: [] as Array<{ symbol: string; name: string; address: string; decimals: number }>,
  BondTokens: [] as Array<{ symbol: string; name: string; address: string; decimals: number }>,
}

// HashKey compliance features
export const hashkeyCompliance = {
  // KYC requirements
  kycRequired: true,
  kycProviders: ['HashKey KYC', 'Third-party KYC'],

  // Sanctions screening
  sanctionsScreening: true,

  // Transaction limits
  dailyLimit: '1000000', // 1M USD equivalent
  monthlyLimit: '10000000', // 10M USD equivalent

  // Supported jurisdictions
  supportedJurisdictions: ['Hong Kong', 'Singapore', 'Japan', 'US'],
}

// HashKey API endpoints (to be verified with official docs)
export const hashkeyApi = {
  baseUrl: 'https://api.hashkey-chain.io',
  endpoints: {
    balance: '/v1/balance',
    transactions: '/v1/transactions',
    compliance: '/v1/compliance',
    rwa: '/v1/rwa',
    quotes: '/v1/quotes',
  },
}

// HashKey integration utilities
export const hashkeyUtils = {
  // Format addresses for HashKey
  formatAddress: (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  },

  // Calculate transaction fees
  calculateFee: (gasLimit: bigint, gasPrice: bigint) => {
    return gasLimit * gasPrice;
  },

  // Check if token is supported
  isTokenSupported: (tokenAddress: string) => {
    const allTokens = [
      ...hashkeyTokens.RWATokens,
      ...hashkeyTokens.MMFTokens,
      ...hashkeyTokens.BondTokens,
    ];
    return allTokens.some(token => token.address.toLowerCase() === tokenAddress.toLowerCase());
  },

  // Get token info
  getTokenInfo: (tokenAddress: string) => {
    const allTokens = [
      ...hashkeyTokens.RWATokens,
      ...hashkeyTokens.MMFTokens,
      ...hashkeyTokens.BondTokens,
    ];
    return allTokens.find(token => token.address.toLowerCase() === tokenAddress.toLowerCase());
  },
}
