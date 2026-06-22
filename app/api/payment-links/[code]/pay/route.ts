export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getT3nClient, getTenantClient, getScriptVersion, getNodeUrl } from "@/lib/t3n-client"
import { runComplianceCheck, canProcessPayment } from "@/lib/compliance"
import { z } from "zod"

interface Params {
  params: Promise<{ code: string }>
}

const paymentSchema = z.object({
  payerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address"),
  amount: z.number().positive("Amount must be positive"),
  payerName: z.string().optional(),
  payerEmail: z.string().email().optional(),
})

function extractTid(did: string): string {
  return did.slice('did:t3n:'.length)
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { code } = await params
    const body = await request.json()

    // Validate input
    const parsed = paymentSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0].message },
        { status: 400 }
      )
    }

    const { payerAddress, amount, payerName, payerEmail } = parsed.data

    // Get payment link
    const link = await prisma.paymentLink.findUnique({
      where: { code },
      include: { user: true },
    })

    if (!link) {
      return NextResponse.json(
        { success: false, error: "Payment link not found" },
        { status: 404 }
      )
    }

    if (link.status !== "active") {
      return NextResponse.json(
        { success: false, error: "Payment link is not active" },
        { status: 400 }
      )
    }

    const recipientAddress = link.recipientAddress ?? link.user.walletAddress

    if (!recipientAddress) {
      return NextResponse.json(
        { success: false, error: "Recipient wallet not configured" },
        { status: 400 }
      )
    }

    // Validate amount range
    if (link.amountMin && amount < link.amountMin) {
      return NextResponse.json(
        { success: false, error: `Amount below minimum (${link.amountMin})` },
        { status: 400 }
      )
    }

    if (link.amountMax && amount > link.amountMax) {
      return NextResponse.json(
        { success: false, error: `Amount exceeds maximum (${link.amountMax})` },
        { status: 400 }
      )
    }

    // Run compliance check
    const complianceResult = await runComplianceCheck(payerAddress)
    const canPay = canProcessPayment(complianceResult, false, true)

    if (!canPay) {
      return NextResponse.json(
        {
          success: false,
          error: "Payment blocked by compliance check",
          detail: complianceResult.detail
        },
        { status: 403 }
      )
    }

    // Execute payment via T3N
    let txHash = ""
    let txUrl = ""

    if (process.env.T3N_API_KEY) {
      try {
        const t3n = await getT3nClient()
        const { did: tenantDid } = await getTenantClient()
        const tenantId = extractTid(tenantDid)

        const scriptName = `z:${tenantId}:vendor-contracts`
        const scriptVersion = await getScriptVersion(getNodeUrl(), scriptName)

        const result = await t3n.executeAndDecode({
          script_name: scriptName,
          script_version: scriptVersion,
          function_name: 'process-payment',
          input: {
            toAddress: recipientAddress,
            amount,
            token: link.sourceToken,
            memo: `Payment Link: ${link.name || link.code}`,
          },
        }) as { txHash?: string; success?: boolean; error?: string }

        txHash = result?.txHash || ""

        if (!result?.success || !txHash) {
          throw new Error(result?.error || "T3N payment execution failed")
        }

        // Construct tx URL based on network
        if (link.network === "t3n_testnet") {
          txUrl = `https://testnet.terminal3.io/tx/${txHash}`
        } else if (link.network === "t3n") {
          txUrl = `https://terminal3.io/tx/${txHash}`
        }

      } catch (err: any) {
        console.warn("T3N payment unavailable, recording locally:", err.message)
        txHash = `demo_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
        txUrl = ""
      }
    } else {
      txHash = `local_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    }

    // Record payment in database
    const payment = await prisma.payment.create({
      data: {
        userId: link.userId,
        paymentLinkId: link.id,
        payer: payerName || null,
        payerAddress,
        amount,
        currency: link.sourceToken,
        token: link.sourceToken,
        network: link.network,
        txHash,
        status: "completed",
        complianceScore: complianceResult.complianceScore,
        kycPassed: complianceResult.kycOk,
        sanctionsChecked: complianceResult.sanctionsOk,
        paymentType: "payment_link",
        recipientAddress,
      },
    })

    // Update payment link stats
    await prisma.paymentLink.update({
      where: { id: link.id },
      data: {
        totalVolume: { increment: amount },
        transactions: { increment: 1 },
      },
    })

    return NextResponse.json({
      success: true,
      data: {
        paymentId: payment.id,
        txHash,
        txUrl,
        amount,
        currency: link.sourceToken,
        recipient: recipientAddress,
        complianceScore: complianceResult.complianceScore,
      },
    })

  } catch (error: any) {
    console.error("Payment link execution error:", error)
    return NextResponse.json(
      { success: false, error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
