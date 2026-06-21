import { HDKey } from '@scure/bip32'
import { mnemonicToSeedSync } from '@scure/bip39'
import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'

function privateKeyToAddress(privateKey: `0x${string}`): `0x${string}` {
  const pk = hexToBytes(privateKey.slice(2))
  const pubKey = secp256k1.getPublicKey(pk, false)
  const hash = keccak_256(pubKey.slice(1))
  return `0x${bytesToHex(hash.slice(-20))}` as `0x${string}`
}

export function deriveAgentWallet(agentIndex: number) {
  const mnemonic = process.env.DEPLOYER_MNEMONIC
  if (!mnemonic) throw new Error('DEPLOYER_MNEMONIC not set')
  const seed = mnemonicToSeedSync(mnemonic)
  const hdKey = HDKey.fromMasterSeed(seed)
  const child = hdKey.derive(`m/44'/60'/0'/0/${agentIndex}`)
  const privateKey = `0x${bytesToHex(child.privateKey!)}` as `0x${string}`
  const address = privateKeyToAddress(privateKey)
  return { privateKey, address }
}

/**
 * T3N-based agent payment — currently a stub.
 * Will be replaced with TenantClient.executeBusinessContract().
 */
export async function fundAgentIfNeeded(agentAddress: `0x${string}`): Promise<void> {
  if (!process.env.T3N_API_KEY) return
  // TODO: T3N gas funding via TenantClient
}

export async function agentSendERC20(
  agentIndex: number,
  tokenAddress: `0x${string}`,
  toAddress: `0x${string}`,
  amountHuman: number
): Promise<{ txHash: string; success: boolean; error?: string }> {
  // TODO: Replace with T3N TenantClient.executeBusinessContract()
  return { txHash: '', success: false, error: 'T3N payment not yet implemented' }
}

export async function agentSendNative(
  agentIndex: number,
  toAddress: `0x${string}`,
  amountHSK: number
): Promise<{ txHash: string; success: boolean; error?: string }> {
  // TODO: Replace with T3N TenantClient.executeBusinessContract()
  return { txHash: '', success: false, error: 'T3N payment not yet implemented' }
}
