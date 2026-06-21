export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth-config"
import { prisma } from "@/lib/prisma"

function unauth() {
  return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
}

/**
 * POST /api/user/wallet
 * Store a managed wallet address linked to the user.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return unauth()
  const userId = session.user.id
  if (!userId) return unauth()

  let body: { walletAddress?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 })
  }

  const { walletAddress } = body

  if (!walletAddress) {
    return NextResponse.json({ success: false, error: "walletAddress is required" }, { status: 400 })
  }

  const addr = walletAddress.trim().toLowerCase()
  if (!/^0x[0-9a-f]{40}$/.test(addr)) {
    return NextResponse.json({ success: false, error: "Invalid EVM address" }, { status: 400 })
  }

  // Check for conflicts with other users
  const conflict = await prisma.user.findFirst({ where: { walletAddress: addr } })
  if (conflict && conflict.id !== userId) {
    return NextResponse.json({ success: false, error: "Wallet already linked to another account" }, { status: 409 })
  }

  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        walletAddress: addr,
        walletType: "managed",
      },
      select: { id: true, walletAddress: true, walletType: true },
    })
    return NextResponse.json({ success: true, data: user })
  } catch (err) {
    console.error("[POST /api/user/wallet]", err)
    return NextResponse.json({ success: false, error: "Database error" }, { status: 500 })
  }
}

/**
 * DELETE /api/user/wallet
 * Unlink the managed wallet entirely (clears all wallet fields).
 */
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return unauth()
  const userId = session.user.id
  if (!userId) return unauth()

  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        walletAddress: null,
        walletType: null,
        encryptedPrivateKey: null,
        encryptedMnemonic: null,
      },
    })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("[DELETE /api/user/wallet]", err)
    return NextResponse.json({ success: false, error: "Database error" }, { status: 500 })
  }
}
