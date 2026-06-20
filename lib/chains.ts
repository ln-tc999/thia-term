// Multi-chain registry for Thia-Term
// Add new chains here and they propagate everywhere automatically

export interface ChainToken {
  symbol: string
  name: string
  address: string  // empty string = native token
  decimals: number
}

export interface SupportedChain {
  id: number
  key: string          // used in DB (PaymentLink.network)
  name: string
  testnet: boolean
  explorerUrl: string
  nativeSymbol: string
  tokens: ChainToken[]
}

export const SUPPORTED_CHAINS: SupportedChain[] = [
  {
    id: 44787,
    key: 'celo-alfajores',
    name: 'Celo Alfajores',
    testnet: true,
    explorerUrl: 'https://alfajores.celoscan.io',
    nativeSymbol: 'CELO',
    tokens: [
      {
        symbol: 'cUSD',
        name: 'Celo Dollar',
        address: '0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1',
        decimals: 18,
      },
      {
        symbol: 'USDC',
        name: 'USD Coin',
        address: '0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B',
        decimals: 6,
      },
      {
        symbol: 'CELO',
        name: 'Celo (native)',
        address: '',  // native — use sendTransaction
        decimals: 18,
      },
    ],
  },
  {
    id: 42220,
    key: 'celo',
    name: 'Celo',
    testnet: false,
    explorerUrl: 'https://celoscan.io',
    nativeSymbol: 'CELO',
    tokens: [
      {
        symbol: 'cUSD',
        name: 'Celo Dollar',
        address: '0x765DE816845861e75A25fCA122bb6898B8B1282a',
        decimals: 18,
      },
      {
        symbol: 'USDC',
        name: 'USD Coin',
        address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
        decimals: 6,
      },
      {
        symbol: 'USDT',
        name: 'Tether USD',
        address: '0x617f3112bf5397D0467D315cC709EF968D9ba546',
        decimals: 6,
      },
      {
        symbol: 'CELO',
        name: 'Celo (native)',
        address: '',
        decimals: 18,
      },
    ],
  },
  {
    id: 133,
    key: 'hashkey-testnet',
    name: 'HashKey Testnet',
    testnet: true,
    explorerUrl: 'https://testnet.explorer.hsk.xyz',
    nativeSymbol: 'HSK',
    tokens: [
      {
        symbol: 'HSK',
        name: 'HashKey Token (native)',
        address: '',
        decimals: 18,
      },
      {
        symbol: 'USDC',
        name: 'USD Coin',
        address: '0x47725537961326e4b906558BD208012c6C11aCa2',
        decimals: 6,
      },
      {
        symbol: 'USDT',
        name: 'Tether USD',
        address: '0x60EFCa24B785391C6063ba37fF917Ff0edEb9f4a',
        decimals: 6,
      },
    ],
  },
  {
    id: 177,
    key: 'hashkey',
    name: 'HashKey Chain',
    testnet: false,
    explorerUrl: 'https://hashkey.blockscout.com',
    nativeSymbol: 'HSK',
    tokens: [
      {
        symbol: 'HSK',
        name: 'HashKey Token (native)',
        address: '',
        decimals: 18,
      },
      {
        symbol: 'USDC',
        name: 'USD Coin',
        address: '0x8845E8C74cE5dF8E0d37bf0fe57dc5E0ddD8021b',
        decimals: 6,
      },
      {
        symbol: 'USDT',
        name: 'Tether USD',
        address: '0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029',
        decimals: 6,
      },
    ],
  },
]

export function getChain(key: string): SupportedChain | undefined {
  return SUPPORTED_CHAINS.find(c => c.key === key)
}

export function getChainById(id: number): SupportedChain | undefined {
  return SUPPORTED_CHAINS.find(c => c.id === id)
}

export function getToken(chainKey: string, symbol: string): ChainToken | undefined {
  return getChain(chainKey)?.tokens.find(t => t.symbol === symbol)
}

export function isNativeToken(token: ChainToken): boolean {
  return token.address === ''
}

// Default chain for new payment links
export const DEFAULT_CHAIN_KEY = 'hashkey'
