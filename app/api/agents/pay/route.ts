export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth-config'
import { prisma } from '@/lib/prisma'
import { agentSendERC20, agentSendNative, deriveAgentWallet, fundAgentIfNeeded } from '@/lib/agent-wallet'
import { logAudit } from '@/lib/audit'
import { hspClient } from '@/lib/hsp-client'
import { runComplianceCheck } from '@/lib/compliance'
import { z } from 'zod'
import crypto from 'crypto'

// Token addresses on HashKey Chain mainnet
const HASHKEY_TOKENS: Record<string, `0x${string}`> = {
  USDC: '0x8845E8C74cE5dF8E0d37bf0fe57dc5E0ddD8021b' as `0x${string}`,
  USDT: '0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029' as `0x${string}`,
}

const agentPaySchema = z.object({
  agentId: z.string().min(1, "agentId is required"),
  toAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "toAddress must be a valid EVM address").optional(),
  toAgentId: z.string().optional(),
  amount: z.number().positive("amount must be positive"),
  token: z.enum(["HSK", "USDC", "USDT"]).default("HSK"),
  memo: z.string().max(500).optional().default(""),
  paymentType: z.enum(["agent-to-human", "agent-to-agent"]).default("agent-to-human"),
}).refine(d => d.toAddress || d.toAgentId, "toAddress or toAgentId is required")

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id

  const rawBody = await req.json()
  const parsed = agentPaySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 })
  }
  const {
    agentId,
    toAddress,
    toAgentId,
    amount,
    token,
    memo,
    paymentType,
  } = parsed.data

  // Get agent and verify ownership
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, userId },
  })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  // Ensure agent has an HSP Multi-Pay mandate (create once, reuse for all payments)
  let hspMultipayMandateId = agent.hspMultipayMandateId ?? null
  if (!hspMultipayMandateId && hspClient.isConfigured) {
    try {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      const mandate = await hspClient.createMultiPayMandate({
        merchant_order_id: `agent-${agent.id}`,
        description: `Thia-Term Agent: ${agent.name}`,
        webhook_url: `${appUrl}/api/webhooks/hsp`,
        redirect_url: `${appUrl}/dashboard`,
      })
      if (mandate?.data?.cart_mandate_id) {
        hspMultipayMandateId = mandate.data.cart_mandate_id
        await prisma.agent.update({
          where: { id: agentId },
          data: { hspMultipayMandateId },
        })
        console.log(`[HSP] Created multi-pay mandate ${hspMultipayMandateId} for agent ${agentId}`)
      }
    } catch (err) {
      console.error('[HSP] Failed to create multi-pay mandate for agent:', err)
      // Non-fatal — continue with on-chain payment
    }
  }

  // Resolve destination
  let destAddress: `0x${string}`
  let destAgentName: string | null = null

  if (paymentType === 'agent-to-agent' && toAgentId) {
    const destAgent = await prisma.agent.findUnique({ where: { id: toAgentId } })
    if (!destAgent?.walletAddress)
      return NextResponse.json({ error: 'Destination agent has no wallet' }, { status: 400 })
    destAddress = destAgent.walletAddress as `0x${string}`
    destAgentName = destAgent.name
  } else if (toAddress) {
    destAddress = toAddress as `0x${string}`
  } else {
    return NextResponse.json({ error: 'toAddress or toAgentId required' }, { status: 400 })
  }

  // Run compliance check on destination address before touching the chain
  const compliance = await runComplianceCheck(destAddress)
  if (!compliance.sanctionsOk || compliance.complianceScore < 60) {
    await logAudit({
      userId,
      action: 'agent.payment.blocked',
      entityId: agentId,
      entityType: 'Agent',
      metadata: {
        destAddress,
        reason: compliance.detail ?? 'Failed compliance screening',
        complianceScore: compliance.complianceScore,
      },
    })
    return NextResponse.json(
      {
        error: 'Payment blocked by compliance screening',
        detail: compliance.detail ?? 'Address failed sanctions or risk check',
        complianceScore: compliance.complianceScore,
      },
      { status: 403 },
    )
  }

  // Collision-resistant deterministic wallet index from agent ID
  const idHash = crypto.createHash('sha256').update(agent.id).digest()
  const agentIndex = idHash.readUInt32BE(0) % 2_147_483_647

  // Auto-fund agent wallet with gas if balance is too low
  const agentAddress = deriveAgentWallet(agentIndex).address
  await fundAgentIfNeeded(agentAddress)

  // Execute on-chain payment
  let txResult
  if (token === 'HSK') {
    txResult = await agentSendNative(agentIndex, destAddress, amount)
  } else {
    const tokenAddress = HASHKEY_TOKENS[token]
    if (!tokenAddress)
      return NextResponse.json({ error: `Unknown token: ${token}` }, { status: 400 })
    txResult = await agentSendERC20(agentIndex, tokenAddress, destAddress, amount)
  }

  if (!txResult.success) {
    console.error('[agents/pay] Transaction failed:', txResult.error)
    const isInsufficientFunds = txResult.error?.toLowerCase().includes('insufficient')
    return NextResponse.json(
      {
        error: isInsufficientFunds
          ? 'Agent wallet has insufficient HSK for gas. Top up the agent wallet and retry.'
          : 'Transaction failed',
        detail: txResult.error,
        code: isInsufficientFunds ? 'INSUFFICIENT_GAS' : 'TX_FAILED',
      },
      { status: 500 },
    )
  }

  const payerAddress = agentAddress

  // Record payment in DB
  const payment = await prisma.payment.create({
    data: {
      userId,
      agentId,
      amount,
      token,
      network: 'hashkey',
      txHash: txResult.txHash,
      status: 'completed',
      payerAddress,
      recipientAddress: destAddress,
      memo: hspMultipayMandateId
        ? `${memo || ''}${memo ? ' | ' : ''}hsp_mandate:${hspMultipayMandateId}`.trim()
        : memo,
      paymentType,
      kycPassed: compliance.kycOk,
      sanctionsChecked: compliance.sanctionsOk,
      complianceScore: compliance.complianceScore,
    },
  })

  await logAudit({
    userId,
    action: 'agent.payment.executed',
    entityId: payment.id,
    entityType: 'Payment',
    metadata: {
      agentId,
      paymentType,
      amount,
      token,
      txHash: txResult.txHash,
      hspMultipayMandateId: hspMultipayMandateId ?? undefined,
    },
  })

  return NextResponse.json({
    success: true,
    txHash: txResult.txHash,
    txUrl: `https://hashkey.blockscout.com/tx/${txResult.txHash}`,
    payment,
    hspMultipayMandateId: hspMultipayMandateId ?? null,
    message:
      paymentType === 'agent-to-agent'
        ? `Agent paid ${destAgentName} ${amount} ${token} on HashKey Chain`
        : `Agent paid ${destAddress.slice(0, 8)}... ${amount} ${token} on HashKey Chain`,
  })
}
