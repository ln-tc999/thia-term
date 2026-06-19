export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth-config'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { runComplianceCheck } from '@/lib/compliance'
import { logNotification } from '@/lib/notifications'

function unauth() {
  return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
}

// GET — list payments for the logged-in user
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return unauth()
  const userId = session.user.id

  const { searchParams } = new URL(request.url)
  const paymentLinkId = searchParams.get('paymentLinkId')
  const status = searchParams.get('status')
  const network = searchParams.get('network')
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100)
  const offset = parseInt(searchParams.get('offset') || '0')

  const where = {
    userId,
    ...(paymentLinkId ? { paymentLinkId } : {}),
    ...(status ? { status } : {}),
    ...(network ? { network } : {}),
  }

  const [payments, total] = await Promise.all([
    prisma.payment.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
    prisma.payment.count({ where }),
  ])

  return NextResponse.json({ success: true, data: payments, total, limit, offset })
}

// POST — record a new payment (called from public pay page — no auth required)
export async function POST(request: NextRequest) {
  const body = await request.json()

  if (!body.payer || !body.amount) {
    return NextResponse.json({ success: false, error: 'payer and amount are required' }, { status: 400 })
  }

  const parsedAmount = parseFloat(body.amount)
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    return NextResponse.json({ success: false, error: 'amount must be a positive number' }, { status: 400 })
  }

  const walletRegex = /^0x[a-fA-F0-9]{40}$/
  if (!walletRegex.test(body.payer)) {
    return NextResponse.json({ success: false, error: 'payer must be a valid wallet address' }, { status: 400 })
  }

  // Resolve userId from the payment link owner
  let userId: string | undefined
  if (body.paymentLinkId) {
    const link = await prisma.paymentLink.findUnique({
      where: { id: body.paymentLinkId },
      select: { userId: true },
    })
    userId = link?.userId
  }

  const compliance = await runComplianceCheck(body.payer)
  if (!compliance.sanctionsOk || compliance.complianceScore < 60) {
    return NextResponse.json(
      { success: false, error: compliance.detail ?? 'Payment blocked by compliance screening' },
      { status: 403 },
    )
  }

  const payment = await prisma.payment.create({
    data: {
      userId: userId ?? null,
      paymentLinkId: body.paymentLinkId ?? null,
      payer: body.payer,
      amount: parseFloat(body.amount),
      currency: body.currency || 'USDC',
      txHash: body.txHash ?? null,
      status: body.status || 'pending',
      network: body.network || 'celo',
      kycPassed: compliance.kycOk,
      sanctionsChecked: compliance.sanctionsOk,
      complianceScore: compliance.complianceScore,
      gasUsed: body.gasUsed ?? null,
    },
  })

  // Update payment link totals + downstream records on completion
  if (body.paymentLinkId && body.status === 'completed') {
    const link = await prisma.paymentLink.update({
      where: { id: body.paymentLinkId },
      data: {
        totalVolume: { increment: parseFloat(body.amount) },
        transactions: { increment: 1 },
      },
    })

    // Auto-mark the related invoice as paid
    const invoice = await prisma.invoice.findFirst({
      where: { paymentLinkCode: link.code, status: { not: 'paid' } },
    })
    if (invoice) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: 'paid',
          paidAt: new Date(),
          txHash: body.txHash ?? null,
          complianceStatus: 'approved',
        },
      })

      // Increment agent totalEarned if the invoice was issued by an agent
      if (invoice.agentId) {
        await prisma.agent.update({
          where: { id: invoice.agentId },
          data: { totalEarned: { increment: parseFloat(body.amount) } },
        })
      }
    }

    // Auto-create an invoice as on-chain proof if requested
    if (body.createInvoice && userId) {
      const invoiceNumber = `INV-${Date.now()}`
      await prisma.invoice.create({
        data: {
          userId,
          invoiceNumber,
          issuedTo: body.payer ?? null,
          issuedToAddress: body.payer ?? null,
          amount: parseFloat(body.amount),
          currency: body.currency || 'USDC',
          network: body.network || 'celo',
          status: 'paid',
          description: `Payment via link ${link.code}`,
          paymentLinkCode: link.code,
          txHash: body.txHash ?? null,
          paidAt: new Date(),
          complianceStatus: 'approved',
        },
      })
    }
  }

  if (userId) {
    await logAudit({
      userId,
      action: 'payment.created',
      entityId: payment.id,
      entityType: 'Payment',
      metadata: { amount: payment.amount, network: payment.network, token: payment.currency },
    })
    await logNotification({
      userId,
      type: 'payment',
      title: 'Payment received',
      message: `${payment.amount} ${payment.currency} received${payment.payer ? ` from ${payment.payer.slice(0, 8)}…` : ''}.`,
      link: 'payment-links',
    })
  }

  return NextResponse.json({ success: true, data: payment }, { status: 201 })
}

// PUT — update a payment (requires auth, user must own the payment)
export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return unauth()
  const userId = session.user.id

  const body = await request.json()
  const { id, ...updates } = body

  if (!id) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 })

  const existing = await prisma.payment.findFirst({ where: { id, userId } })
  if (!existing) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })

  const payment = await prisma.payment.update({
    where: { id },
    data: {
      ...(updates.status && { status: updates.status }),
      ...(updates.txHash && { txHash: updates.txHash }),
      ...(updates.gasUsed && { gasUsed: updates.gasUsed }),
      ...(updates.complianceScore !== undefined && { complianceScore: updates.complianceScore }),
      ...(updates.kycPassed !== undefined && { kycPassed: updates.kycPassed }),
      ...(updates.sanctionsChecked !== undefined && { sanctionsChecked: updates.sanctionsChecked }),
    },
  })

  return NextResponse.json({ success: true, data: payment })
}
