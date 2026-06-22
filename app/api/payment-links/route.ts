export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth-config"
import { prisma } from "@/lib/prisma"
import { z } from "zod"

function unauth() {
  return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return unauth()
  const userId = session.user.id

  const { searchParams } = new URL(request.url)
  const status = searchParams.get("status")

  const links = await prisma.paymentLink.findMany({
    where: {
      userId,
      ...(status ? { status } : {}),
    },
    select: {
      id: true,
      code: true,
      name: true,
      network: true,
      sourceToken: true,
      destStable: true,
      amountMin: true,
      amountMax: true,
      recipientAddress: true,
      status: true,
      totalVolume: true,
      transactions: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  })

  return NextResponse.json({ success: true, data: links, total: links.length })
}

const paymentLinkCreateSchema = z.object({
  code: z.string().max(100).optional(),
  name: z.string().max(200).optional().nullable(),
  network: z.string().max(50).optional(),
  sourceToken: z.string().max(20).optional(),
  destStable: z.string().max(20).optional(),
  amountMin: z.union([z.string(), z.number()]).transform(v => parseFloat(String(v))).refine(v => !isNaN(v) && v >= 0, "amountMin must be a non-negative number").optional().nullable(),
  amountMax: z.union([z.string(), z.number()]).transform(v => parseFloat(String(v))).refine(v => !isNaN(v) && v > 0, "amountMax must be a positive number").optional().nullable(),
})

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return unauth()
  const userId = session.user.id

  const rawBody = await request.json()
  const parsed = paymentLinkCreateSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.errors[0].message }, { status: 400 })
  }
  const body = parsed.data

  // Look up the authenticated user's wallet address to use as recipient
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { walletAddress: true },
  })

  const link = await prisma.paymentLink.create({
    data: {
      userId,
      code: body.code || `pay-${Date.now()}`,
      name: body.name || null,
      network: body.network || "t3n_testnet",
      sourceToken: body.sourceToken || "USDC",
      destStable: body.destStable || "USDC",
      amountMin: body.amountMin ?? null,
      amountMax: body.amountMax ?? null,
      recipientAddress: user?.walletAddress ?? null,
      status: "active",
    },
  })

  return NextResponse.json(
    {
      success: true,
      data: link,
    },
    { status: 201 },
  )
}

const paymentLinkUpdateSchema = z.object({
  id: z.string().min(1, "id is required"),
  name: z.string().max(200).optional().nullable(),
  status: z.enum(["active", "inactive", "archived"]).optional(),
  amountMin: z.union([z.string(), z.number()]).transform(v => parseFloat(String(v))).optional().nullable(),
  amountMax: z.union([z.string(), z.number()]).transform(v => parseFloat(String(v))).optional().nullable(),
})

export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return unauth()
  const userId = session.user.id

  const rawBody = await request.json()
  const parsed = paymentLinkUpdateSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.errors[0].message }, { status: 400 })
  }
  const { id, ...updates } = parsed.data

  const existing = await prisma.paymentLink.findFirst({ where: { id, userId } })
  if (!existing) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 })
  }

  const link = await prisma.paymentLink.update({ where: { id }, data: updates })
  return NextResponse.json({ success: true, data: link })
}

export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return unauth()
  const userId = session.user.id

  const { searchParams } = new URL(request.url)
  const id = searchParams.get("id")
  if (!id) return NextResponse.json({ success: false, error: "ID required" }, { status: 400 })

  const existing = await prisma.paymentLink.findFirst({ where: { id, userId } })
  if (!existing) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 })
  }

  await prisma.paymentLink.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
