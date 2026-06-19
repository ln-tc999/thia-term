export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth-config"
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { logNotification } from "@/lib/notifications"
import { sendInvoiceCreatedEmail, sendInvoicePaidEmail } from "@/lib/email"
import { hspClient } from "@/lib/hsp-client"
import { z } from "zod"

export type Invoice = {
  id: string
  userId: string
  invoiceNumber: string
  agentId: string | null
  agentName: string | null
  agentDescription?: string | null
  issuedTo: string | null
  issuedToAddress: string | null
  amount: number
  subtotal: number | null
  currency: string
  network: "hashkey" | "polygon" | "ethereum" | string
  status: "draft" | "pending" | "paid" | "overdue" | "cancelled"
  description: string | null
  notes: string | null
  lineItems: Array<{ description: string; quantity: number; unitPrice: string; total: string }>
  issueDate: string | null
  dueAt: string
  paidAt: string | null
  txHash: string | null
  complianceStatus: string
  paymentLinkCode: string | null
  createdAt: string
  updatedAt: string
  issuedAt: string // alias for createdAt, provided for compatibility
}

function unauth() {
  return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return unauth()
  const userId = session.user.id

  const { searchParams } = new URL(request.url)
  const status = searchParams.get("status")
  const agentId = searchParams.get("agentId")
  const network = searchParams.get("network")
  const creatorType = searchParams.get("creatorType") // "human" | "agent" | null

  const filterWhere = {
    userId,
    ...(status ? { status } : {}),
    ...(agentId ? { agentId } : {}),
    ...(network ? { network } : {}),
    ...(creatorType === "human" ? { agentId: null } : {}),
    ...(creatorType === "agent" ? { agentId: { not: null } } : {}),
  }

  const [invoices, allInvoices] = await Promise.all([
    prisma.invoice.findMany({ where: filterWhere, orderBy: { createdAt: "desc" } }),
    prisma.invoice.findMany({ where: { userId }, select: { status: true, amount: true } }),
  ])

  const stats = {
    total: allInvoices.length,
    pending: allInvoices.filter((i) => i.status === "pending").length,
    paid: allInvoices.filter((i) => i.status === "paid").length,
    overdue: allInvoices.filter((i) => i.status === "overdue").length,
    totalValue: allInvoices.reduce((sum, i) => sum + i.amount, 0).toFixed(2),
    paidValue: allInvoices
      .filter((i) => i.status === "paid")
      .reduce((sum, i) => sum + i.amount, 0)
      .toFixed(2),
  }

  return NextResponse.json({ success: true, data: invoices, stats })
}

const evmAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid EVM address")

const invoiceCreateSchema = z.object({
  amount: z.union([z.string(), z.number()]).transform(v => parseFloat(String(v))).refine(v => !isNaN(v) && v > 0, "amount must be a positive number").optional(),
  subtotal: z.union([z.string(), z.number()]).transform(v => parseFloat(String(v))).refine(v => !isNaN(v) && v > 0, "subtotal must be a positive number").optional(),
  recipientAddress: evmAddress.optional().nullable(),
  recipientEmail: z.string().email("Invalid email address").optional().nullable(),
  agentId: z.string().optional().nullable(),
  agentName: z.string().max(200).optional().nullable(),
  issuedTo: z.string().max(200).optional().nullable(),
  issuedToAddress: z.string().max(200).optional().nullable(),
  recipientName: z.string().max(200).optional().nullable(),
  currency: z.string().max(20).optional(),
  network: z.string().max(50).optional(),
  status: z.enum(["draft", "pending", "paid", "overdue", "cancelled"]).optional(),
  description: z.string().max(2000).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  lineItems: z.array(z.object({
    description: z.string().max(500),
    quantity: z.number(),
    unitPrice: z.string(),
    total: z.string(),
  })).optional(),
  invoiceNumber: z.string().max(50).optional(),
  issueDate: z.string().optional().nullable(),
  dueAt: z.string().optional().nullable(),
}).refine(d => d.amount !== undefined || d.subtotal !== undefined, "amount or subtotal is required")

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return unauth()
  const userId = session.user.id

  const rawBody = await request.json()
  const parsed = invoiceCreateSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.errors[0].message }, { status: 400 })
  }
  const body = parsed.data
  const amount = body.amount ?? body.subtotal ?? 0

  const count = await prisma.invoice.count({ where: { userId } })
  const year = new Date().getFullYear()
  const invoiceNumber = body.invoiceNumber || `FL-${year}-${String(count + 1).padStart(3, "0")}`

  // Resolve recipient wallet for payment link creation
  // For human invoices the recipient address is the person paying (payer), so the
  // recipientAddress on the payment link should be the SENDER (the logged-in user)
  let recipientAddress: string | null = null
  let agentName: string | null = body.agentName || null

  if (body.agentId) {
    const agent = await prisma.agent.findFirst({ where: { id: body.agentId, userId } })
    if (agent?.walletAddress) {
      recipientAddress = agent.walletAddress
      agentName = agent.name
    }
  }

  if (!recipientAddress && body.recipientAddress) {
    recipientAddress = body.recipientAddress
  }

  if (!recipientAddress) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { walletAddress: true } })
    recipientAddress = user?.walletAddress ?? null
  }

  const network = body.network || 'celo'
  const currency = body.currency || 'USDC'
  const lineItems = body.lineItems || []
  const subtotal = body.subtotal ?? body.amount ?? 0
  const status = body.status || 'pending'

  const invoice = await prisma.invoice.create({
    data: {
      userId,
      invoiceNumber,
      agentId: body.agentId || null,
      agentName,
      issuedTo: body.issuedTo || body.recipientName || null,
      issuedToAddress: body.issuedToAddress || body.recipientEmail || null,
      amount,
      subtotal,
      currency,
      network,
      status,
      description: body.description || null,
      notes: body.notes || null,
      lineItems,
      issueDate: body.issueDate ? new Date(body.issueDate) : new Date(),
      dueAt: body.dueAt ? new Date(body.dueAt) : new Date(Date.now() + 14 * 86400000),
      complianceStatus: 'pending',
    },
  })

  // Auto-create a payment link if we have a recipient address and invoice is being sent
  let paymentLinkCode: string | null = null
  if (recipientAddress && status === 'pending') {
    const linkCode = `inv-${invoice.id.slice(-8)}`
    const link = await prisma.paymentLink.create({
      data: {
        userId,
        code: linkCode,
        name: `Invoice ${invoice.invoiceNumber}${body.issuedTo || body.recipientName ? ` — ${body.issuedTo || body.recipientName}` : ''}`,
        network,
        sourceToken: currency,
        destStable: currency,
        amountMin: amount,
        amountMax: amount,
        recipientAddress,
        status: 'active',
      },
    })
    paymentLinkCode = link.code
    await prisma.invoice.update({ where: { id: invoice.id }, data: { paymentLinkCode: link.code } })
  }

  if (body.agentId) {
    await prisma.agent.update({ where: { id: body.agentId }, data: { invoiceCount: { increment: 1 } } }).catch(() => {})
  }

  // Attempt HSP Single-Pay Cart Mandate for pending invoices (graceful degradation)
  let hspCheckoutUrl: string | null = null
  let hspMandateId: string | null = null
  let hspNote: string | undefined

  if (status === 'pending') {
    try {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://flowlink.ink'
      const token = (currency as 'USDC' | 'USDT' | 'HSK') || 'USDC'
      const mandate = await hspClient.createSinglePayMandate({
        merchant_order_id: invoice.id,
        amount: String(amount),
        token: ['USDC', 'USDT', 'HSK'].includes(token) ? token : 'USDC',
        chain_id: 177, // HashKey Chain mainnet
        webhook_url: `${appUrl}/api/webhooks/hsp`,
        redirect_url: `${appUrl}/pay/invoice/${invoice.id}`,
        description: body.description || `Invoice ${invoice.invoiceNumber}`,
      })

      if (mandate?.data?.cart_mandate_id) {
        hspCheckoutUrl = mandate.data.checkout_url
        hspMandateId = mandate.data.cart_mandate_id
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { hspCheckoutUrl, hspMandateId },
        })
      }
    } catch (err) {
      console.error('[HSP] Failed to create single-pay mandate for invoice:', err)
      hspNote = 'HSP connection pending — add credentials to enable HSP checkout'
    }

    if (!hspCheckoutUrl && !hspNote) {
      hspNote = 'HSP connection pending — add credentials to enable HSP checkout'
    }
  }

  await logAudit({
    userId,
    action: 'invoice.created',
    entityId: invoice.id,
    entityType: 'Invoice',
  })
  await logNotification({
    userId,
    type: 'invoice',
    title: 'Invoice created',
    message: `Invoice ${invoiceNumber} for ${amount} ${currency}${body.issuedTo ? ` — ${body.issuedTo}` : ''} created.`,
    link: 'ai-invoices',
  })

  // Email the merchant (non-blocking)
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } })
  if (user?.email) {
    sendInvoiceCreatedEmail({
      toEmail: user.email,
      invoiceNumber,
      amount,
      currency,
      issuedTo: body.issuedTo ?? null,
      dueAt: invoice.dueAt?.toISOString() ?? null,
      paymentLink: paymentLinkCode ? `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://flowlink.ink'}/l/${paymentLinkCode}` : null,
    }).catch(e => console.error('[email] invoice created:', e))
  }

  return NextResponse.json({
    success: true,
    data: { ...invoice, paymentLinkCode, hspCheckoutUrl, hspMandateId },
    ...(hspNote ? { hspNote } : {}),
  }, { status: 201 })
}

const invoiceUpdateSchema = z.object({
  id: z.string().min(1, "id is required"),
  status: z.enum(["draft", "pending", "paid", "overdue", "cancelled"]).optional(),
  amount: z.union([z.string(), z.number()]).transform(v => parseFloat(String(v))).optional(),
  dueAt: z.string().optional(),
  description: z.string().max(2000).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  txHash: z.string().max(100).optional().nullable(),
})

export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return unauth()
  const userId = session.user.id

  const rawBody = await request.json()
  const parsed = invoiceUpdateSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.errors[0].message }, { status: 400 })
  }
  const { id, ...updates } = parsed.data

  const existing = await prisma.invoice.findFirst({ where: { id, userId } })
  if (!existing) {
    return NextResponse.json({ success: false, error: "Invoice not found" }, { status: 404 })
  }

  const data: Record<string, unknown> = { ...updates }
  if (updates.status === "paid" && !existing.paidAt) {
    data.paidAt = new Date()
  }
  if (updates.dueAt) data.dueAt = new Date(updates.dueAt)

  const invoice = await prisma.invoice.update({ where: { id, userId }, data })

  // Email merchant when manually marked as paid
  if (updates.status === "paid" && !existing.paidAt) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
    if (user?.email) {
      sendInvoicePaidEmail({
        toEmail: user.email,
        invoiceNumber: existing.invoiceNumber,
        amount: existing.amount,
        currency: existing.currency,
        issuedTo: existing.issuedTo,
        paidAt: new Date().toISOString(),
        txHash: updates.txHash ?? existing.txHash,
        network: existing.network,
      }).catch(e => console.error('[email] invoice paid:', e))
    }
  }

  return NextResponse.json({ success: true, data: invoice })
}
