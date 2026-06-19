import { HDKey } from '@scure/bip32'
import { mnemonicToSeedSync } from '@scure/bip39'
import { privateKeyToAccount } from 'viem/accounts'
import { createWalletClient, createPublicClient, http, parseUnits, parseAbi, parseEther, formatEther } from 'viem'
import { hashkey } from 'viem/chains'

const RPC = process.env.NEXT_PUBLIC_HASHKEY_MAINNET_RPC || 'https://mainnet.hsk.xyz'

// Minimum HSK balance an agent wallet must hold to cover gas
const GAS_THRESHOLD = parseEther('0.005')
// Amount sent from deployer when agent balance is below threshold
const GAS_TOP_UP = parseEther('0.01')

export function deriveAgentWallet(agentIndex: number) {
  const mnemonic = process.env.DEPLOYER_MNEMONIC
  if (!mnemonic) throw new Error('DEPLOYER_MNEMONIC not set')
  const seed = mnemonicToSeedSync(mnemonic)
  const hdKey = HDKey.fromMasterSeed(seed)
  const child = hdKey.derive(`m/44'/60'/0'/0/${agentIndex}`)
  const privateKey = `0x${Buffer.from(child.privateKey!).toString('hex')}` as `0x${string}`
  const account = privateKeyToAccount(privateKey)
  return { account, privateKey, address: account.address }
}

export function getAgentWalletClient(agentIndex: number) {
  const { account } = deriveAgentWallet(agentIndex)
  return createWalletClient({
    account,
    chain: hashkey,
    transport: http(RPC),
  })
}

export function getPublicClient() {
  return createPublicClient({
    chain: hashkey,
    transport: http(RPC),
  })
}

// Funds the agent wallet from the deployer if balance is below GAS_THRESHOLD.
// Silent no-op if DEPLOYER_PRIVATE_KEY is not set.
export async function fundAgentIfNeeded(agentAddress: `0x${string}`): Promise<void> {
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}` | undefined
  if (!deployerKey) return

  const publicClient = getPublicClient()
  const balance = await publicClient.getBalance({ address: agentAddress })
  if (balance >= GAS_THRESHOLD) return

  const deployer = privateKeyToAccount(deployerKey)
  const deployerClient = createWalletClient({ account: deployer, chain: hashkey, transport: http(RPC) })

  console.log(`[agent-wallet] Funding ${agentAddress} with ${formatEther(GAS_TOP_UP)} HSK for gas`)
  await deployerClient.sendTransaction({ to: agentAddress, value: GAS_TOP_UP })
}

export const ERC20_ABI = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
])

export async function agentSendERC20(
  agentIndex: number,
  tokenAddress: `0x${string}`,
  toAddress: `0x${string}`,
  amountHuman: number
): Promise<{ txHash: string; success: boolean; error?: string }> {
  try {
    const client = getAgentWalletClient(agentIndex)
    const publicClient = getPublicClient()
    const decimals = await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'decimals',
    })
    const amount = parseUnits(amountHuman.toString(), decimals)
    const hash = await client.writeContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [toAddress, amount],
    })
    return { txHash: hash, success: true }
  } catch (e: any) {
    return { txHash: '', success: false, error: e.message }
  }
}

export async function agentSendNative(
  agentIndex: number,
  toAddress: `0x${string}`,
  amountHSK: number
): Promise<{ txHash: string; success: boolean; error?: string }> {
  try {
    const client = getAgentWalletClient(agentIndex)
    const hash = await client.sendTransaction({
      to: toAddress,
      value: parseEther(amountHSK.toString()),
    })
    return { txHash: hash, success: true }
  } catch (e: any) {
    return { txHash: '', success: false, error: e.message }
  }
}
