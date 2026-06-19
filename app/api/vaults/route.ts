export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth-config"
import { prisma } from "@/lib/prisma"

function unauth() {
  return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return unauth()
  const userId = session.user.id

  const { searchParams } = new URL(request.url)
  const status = searchParams.get("status")

  const vaults = await prisma.complianceVault.findMany({
    where: {
      userId,
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json({ success: true, data: vaults, total: vaults.length })
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return unauth()
  const userId = session.user.id

  const body = await request.json()

  const vault = await prisma.complianceVault.create({
    data: {
      userId,
      name: body.name,
      status: "active",
      riskScore: 0,
      totalVolume: 0,
      monthlyTransactions: 0,
      policies: body.policies || [],
    },
  })

  return NextResponse.json({ success: true, data: vault }, { status: 201 })
}

export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return unauth()
  const userId = session.user.id

  const body = await request.json()
  const { id, ...updates } = body

  const existing = await prisma.complianceVault.findFirst({ where: { id, userId } })
  if (!existing) {
    return NextResponse.json({ success: false, error: "Vault not found" }, { status: 404 })
  }

  const vault = await prisma.complianceVault.update({ where: { id }, data: updates })
  return NextResponse.json({ success: true, data: vault })
}
