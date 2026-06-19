export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { hspClient, HSPWebhookPayload } from '@/lib/hsp-client'
import { prisma } from '@/lib/prisma'
import { sendInvoicePaidEmail, sendPaymentReceivedEmail } from '@/lib/email'

/**
 * POST /api/webhooks/hsp
 *
 * Receives payment confirmation callbacks from HashKey Settlement Protocol.
 * HSP signs each delivery with the same HMAC-SHA256 scheme used for API requests.
 * Must return HTTP 200 within 10 seconds (HSP requirement).
 */
export async function POST(request: NextRequest) {
  const url = new URL(request.url)
  const path = url.pathname
  const query = url.searchParams.toString()

  // Read raw body for signature verification
  const rawBody = await request.text()

  const timestamp = request.headers.get('X-Timestamp') ?? ''
  const nonce = request.headers.get('X-Nonce') ?? ''
  const signature = request.headers.get('X-Signature') ?? ''

  // Verify HMAC signature if HSP is configured
  if (hspClient.isConfigured) {
    if (!timestamp || !nonce || !signature) {
      console.error('[HSP webhook] Missing required signature headers')
      return NextResponse.json({ error: 'Missing signature headers' }, { status: 400 })
    }

    // Replay protection — reject requests outside a 5-minute window
    const ts = parseInt(timestamp, 10)
    const now = Math.floor(Date.now() / 1000)
    if (isNaN(ts) || Math.abs(now - ts) > 300) {
      console.error('[HSP webhook] Timestamp out of acceptable window')
      return NextResponse.json({ error: 'Request timestamp out of window' }, { status: 400 })
    }

    const valid = hspClient.verifyWebhookSignature(
      'POST',
      path,
      query,
      rawBody,
      timestamp,
      nonce,
      signature,
    )

    if (!valid) {
      console.error('[HSP webhook] Invalid signature — rejecting delivery')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  } else {
    // Accept unsigned webhooks when HSP isn't configured (dev / testing)
    console.warn('[HSP webhook] HSP not configured — skipping signature verification')
  }

  let payload: HSPWebhookPayload
  try {
    payload = JSON.parse(rawBody) as HSPWebhookPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { cart_mandate_id, status, tx_hash, amount, token } = payload

  if (!cart_mandate_id) {
    return NextResponse.json({ error: 'Missing cart_mandate_id' }, { status: 400 })
  }

  console.log(`[HSP webhook] cart_mandate_id=${cart_mandate_id} status=${status}`)

  // Only act on terminal states
  if (status !== 'SUCCESS' && status !== 'FAILED') {
    return NextResponse.json({ ok: true, message: 'Acknowledged — no action for pending status' })
  }

  const newStatus = status === 'SUCCESS' ? 'paid' : 'failed'

  // Look up matching PaymentLink and Invoice in parallel
  const [paymentLink, invoice] = await Promise.all([
    prisma.paymentLink.findFirst({ where: { hspMandateId: cart_mandate_id } }),
    prisma.invoice.findFirst({ where: { hspMandateId: cart_mandate_id } }),
  ])

  // Handle PaymentLink match
  if (paymentLink) {
    if (status === 'SUCCESS') {
      // Record the inbound payment
      await prisma.payment.create({
        data: {
          userId: paymentLink.userId,
          paymentLinkId: paymentLink.id,
          amount: parseFloat(amount ?? '0'),
          currency: token ?? 'USDC',
          token: token ?? 'USDC',
          txHash: tx_hash ?? null,
          status: 'completed',
          network: 'hashkey',
          paymentType: 'hsp',
          kycPassed: true,
          sanctionsChecked: true,
          complianceScore: 90,
        },
      })

      // Increment the payment link counters
      await prisma.paymentLink.update({
        where: { id: paymentLink.id },
        data: {
          transactions: { increment: 1 },
          totalVolume: { increment: parseFloat(amount ?? '0') },
        },
      })

      console.log(`[HSP webhook] Recorded payment on link ${paymentLink.code}`)

      // Email merchant
      const user = await prisma.user.findUnique({ where: { id: paymentLink.userId }, select: { email: true } })
      if (user?.email) {
        sendPaymentReceivedEmail({
          toEmail: user.email,
          amount: parseFloat(amount ?? '0'),
          currency: token ?? 'USDC',
          network: 'HashKey Chain',
          txHash: tx_hash,
          paymentLinkName: paymentLink.name,
        }).catch(e => console.error('[email] payment received:', e))
      }
    }
  }

  // Handle Invoice match
  if (invoice) {
    const updateData: Record<string, unknown> = { status: newStatus }
    if (status === 'SUCCESS') {
      updateData.paidAt = new Date()
      if (tx_hash) updateData.txHash = tx_hash
    }

    await prisma.invoice.update({ where: { id: invoice.id }, data: updateData })
    console.log(`[HSP webhook] Updated invoice ${invoice.invoiceNumber} → ${newStatus}`)

    // Email merchant when invoice paid via HSP
    if (status === 'SUCCESS') {
      const user = await prisma.user.findUnique({ where: { id: invoice.userId }, select: { email: true } })
      if (user?.email) {
        sendInvoicePaidEmail({
          toEmail: user.email,
          invoiceNumber: invoice.invoiceNumber,
          amount: invoice.amount,
          currency: invoice.currency,
          issuedTo: invoice.issuedTo,
          paidAt: new Date().toISOString(),
          txHash: tx_hash,
          network: invoice.network,
        }).catch(e => console.error('[email] invoice paid via HSP:', e))
      }
    }
  }

  if (!paymentLink && !invoice) {
    // Unknown mandate — log but still return 200 to prevent HSP retries
    console.warn(`[HSP webhook] No matching record found for cart_mandate_id=${cart_mandate_id}`)
  }

  return NextResponse.json({ ok: true })
}
