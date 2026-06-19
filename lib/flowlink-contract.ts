export const FLOWLINK_PAYMENTS_ADDRESS: Record<string, `0x${string}`> = {
  'hashkey-testnet': (process.env.NEXT_PUBLIC_FLOWLINK_CONTRACT_HASHKEY_TESTNET as `0x${string}`) || '0x0000000000000000000000000000000000000000',
  'hashkey': (process.env.NEXT_PUBLIC_FLOWLINK_CONTRACT_HASHKEY_MAINNET as `0x${string}`) || '0x0000000000000000000000000000000000000000',
}

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

export const FLOWLINK_PAYMENTS_ABI = [
  {
    name: 'pay',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'paymentLinkId', type: 'bytes32' },
      { name: 'recipient', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'payNative',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'paymentLinkId', type: 'bytes32' },
      { name: 'recipient', type: 'address' },
    ],
    outputs: [],
  },
  {
    name: 'PaymentProcessed',
    type: 'event',
    inputs: [
      { name: 'paymentLinkId', type: 'bytes32', indexed: true },
      { name: 'payer', type: 'address', indexed: true },
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'timestamp', type: 'uint256', indexed: false },
    ],
  },
] as const
