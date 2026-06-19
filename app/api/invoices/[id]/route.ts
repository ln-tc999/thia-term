export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth-config"
import { prisma } from "@/lib/prisma"

interface Params {
  params: { id: string }
}

// Public GET — no auth required, used by the payment page
export async function GET(_req: NextRequest, { params }: Params) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: params.id },
    include: {
      user: { select: { name: true, email: true, walletAddress: true } },
    },
  })

  if (!invoice) {
    return NextResponse.json({ success: false, error: "Invoice not found" }, { status: 404 })
  }

  return NextResponse.json({ success: true, data: invoice })
}

// Authed PATCH — update status, txHash, etc.
export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  const userId = session?.user?.id

  const body = await request.json()

  // Allow unauthenticated PATCH only for marking paid (payer submitting txHash)
  const allowedUnauthFields = ["status", "txHash", "paidAt"]
  const isPayerUpdate =
    !userId &&
    body.status === "paid" &&
    body.txHash &&
    Object.keys(body).every((k) => allowedUnauthFields.includes(k))

  const invoice = await prisma.invoice.findUnique({ where: { id: params.id } })
  if (!invoice) {
    return NextResponse.json({ success: false, error: "Invoice not found" }, { status: 404 })
  }

  // Authed users must own the invoice
  if (userId && invoice.userId !== userId) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 })
  }

  if (!userId && !isPayerUpdate) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  const data: Record<string, unknown> = {}
  if (body.status) data.status = body.status
  if (body.txHash) data.txHash = body.txHash
  if (body.status === "paid" && !invoice.paidAt) data.paidAt = new Date()
  if (body.dueAt) data.dueAt = new Date(body.dueAt)
  if (body.notes !== undefined) data.notes = body.notes

  const updated = await prisma.invoice.update({ where: { id: params.id }, data })
  return NextResponse.json({ success: true, data: updated })
}
