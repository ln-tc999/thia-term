import { HDKey } from '@scure/bip32'
import { mnemonicToSeedSync } from '@scure/bip39'
import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import { getT3nClient, getTenantClient, getScriptVersion, getNodeUrl } from './t3n-client'

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

function extractTid(did: string): string {
  return did.slice('did:t3n:'.length)
}

/**
 * T3N handles gas internally — no manual funding needed.
 */
export async function fundAgentIfNeeded(_agentAddress: `0x${string}`): Promise<void> {
}

/**
 * Execute an agent payment through T3N.
 * Uses the tenant's agent-contracts WASM on T3N.
 * Falls back to vendor-contracts if agent-contracts is not deployed.
 */
async function t3nPay(
  token: string,
  toAddress: `0x${string}`,
  amount: number,
): Promise<{ txHash: string; success: boolean; error?: string }> {
  if (!process.env.T3N_API_KEY) {
    return { txHash: '', success: false, error: 'T3N_API_KEY not set' }
  }

  try {
    const t3n = await getT3nClient()
    const { did: tenantDid } = await getTenantClient()
    const tenantId = extractTid(tenantDid)

    const agentScript = `z:${tenantId}:agent-contracts`
    const vendorScript = `z:${tenantId}:vendor-contracts`

    let scriptName: string
    let scriptVersion: string | null = null

    try {
      scriptVersion = await getScriptVersion(getNodeUrl(), agentScript)
      scriptName = agentScript
    } catch {
      try {
        scriptVersion = await getScriptVersion(getNodeUrl(), vendorScript)
        scriptName = vendorScript
      } catch {
        return { txHash: '', success: false, error: 'No payment contract deployed on T3N' }
      }
    }

    const result = await t3n.executeAndDecode({
      script_name: scriptName,
      script_version: scriptVersion,
      function_name: 'process-payment',
      input: { toAddress, amount, token },
    }) as { txHash?: string; success?: boolean; error?: string }

    const txHash = result?.txHash ?? ''
    if (!txHash) {
      return { txHash: '', success: false, error: result?.error || 'Payment failed — no txHash returned' }
    }

    return { txHash, success: true }
  } catch (err: any) {
    return { txHash: '', success: false, error: err?.message || 'T3N payment failed' }
  }
}

export async function agentSendERC20(
  _agentIndex: number,
  _tokenAddress: `0x${string}`,
  toAddress: `0x${string}`,
  amountHuman: number
): Promise<{ txHash: string; success: boolean; error?: string }> {
  return t3nPay('USDC', toAddress, amountHuman)
}

export async function agentSendNative(
  _agentIndex: number,
  toAddress: `0x${string}`,
  amountHSK: number
): Promise<{ txHash: string; success: boolean; error?: string }> {
  return t3nPay('HSK', toAddress, amountHSK)
}
