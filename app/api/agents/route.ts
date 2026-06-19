export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth-config"
import { prisma } from "@/lib/prisma"
import { deriveAgentWallet } from "@/lib/agent-wallet"
import { z } from "zod"
import crypto from "crypto"

function unauth() {
  return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return unauth()
  const userId = session.user.id

  const agents = await prisma.agent.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json({ success: true, data: agents, total: agents.length })
}

const agentCreateSchema = z.object({
  name: z.string().min(1, "name is required").max(200),
  description: z.string().max(1000).optional().nullable(),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid EVM address").optional().nullable(),
  capabilities: z.array(z.string().max(100)).max(50).optional(),
})

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return unauth()
  const userId = session.user.id

  const rawBody = await request.json()
  const parsed = agentCreateSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.errors[0].message }, { status: 400 })
  }
  const body = parsed.data

  // Create agent first to get DB-generated id
  const agent = await prisma.agent.create({
    data: {
      userId,
      name: body.name,
      description: body.description || null,
      walletAddress: body.walletAddress || null,
      capabilities: body.capabilities || [],
      status: "active",
    },
  })

  // Auto-derive a deterministic wallet address from the master mnemonic
  let walletAddress = agent.walletAddress
  if (!walletAddress && process.env.DEPLOYER_MNEMONIC) {
    try {
      // Derive a stable, collision-resistant index from the full agent ID (32-bit from SHA-256)
      const idHash = crypto.createHash('sha256').update(agent.id).digest()
      const agentIndex = idHash.readUInt32BE(0) % 2_147_483_647
      const { address } = deriveAgentWallet(agentIndex)
      walletAddress = address
      await prisma.agent.update({ where: { id: agent.id }, data: { walletAddress: address } })
    } catch {
      // Non-fatal: agent still created without wallet address
    }
  }

  return NextResponse.json({ success: true, data: { ...agent, walletAddress } }, { status: 201 })
}

const agentUpdateSchema = z.object({
  id: z.string().min(1, "id is required"),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional().nullable(),
  status: z.enum(["active", "inactive", "paused"]).optional(),
  capabilities: z.array(z.string().max(100)).max(50).optional(),
})

export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return unauth()
  const userId = session.user.id

  const rawBody = await request.json()
  const parsed = agentUpdateSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.errors[0].message }, { status: 400 })
  }
  const { id, ...updates } = parsed.data

  const existing = await prisma.agent.findFirst({ where: { id, userId } })
  if (!existing) {
    return NextResponse.json({ success: false, error: "Agent not found" }, { status: 404 })
  }

  const agent = await prisma.agent.update({ where: { id, userId }, data: updates })
  return NextResponse.json({ success: true, data: agent })
}

export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return unauth()
  const userId = session.user.id

  const { searchParams } = new URL(request.url)
  const id = searchParams.get("id")

  if (!id) {
    return NextResponse.json({ success: false, error: "Missing id" }, { status: 400 })
  }

  const existing = await prisma.agent.findFirst({ where: { id, userId } })
  if (!existing) {
    return NextResponse.json({ success: false, error: "Agent not found" }, { status: 404 })
  }

  await prisma.agent.delete({ where: { id, userId } })
  return NextResponse.json({ success: true })
}
