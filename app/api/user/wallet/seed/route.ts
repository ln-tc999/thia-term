export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth-config"
import { prisma } from "@/lib/prisma"
import { decrypt } from "@/lib/wallet-crypto"

function unauth() {
  return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
}

/**
 * GET /api/user/wallet/seed
 * Returns the decrypted mnemonic for a managed wallet.
 * Only works for walletType === "managed" and only if a mnemonic was stored
 * (not available for private-key-only imports).
 *
 * The mnemonic is NEVER cached — it is decrypted on demand and returned once.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return unauth()
  const userId = session.user.id
  if (!userId) return unauth()

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { walletType: true, encryptedMnemonic: true },
  })

  if (!user) return NextResponse.json({ success: false, error: "User not found" }, { status: 404 })
  if (user.walletType !== "managed") {
    return NextResponse.json({ success: false, error: "No managed wallet on this account" }, { status: 400 })
  }
  if (!user.encryptedMnemonic) {
    return NextResponse.json({ success: false, error: "No seed phrase stored — wallet was imported via private key" }, { status: 400 })
  }

  try {
    const mnemonic = decrypt(user.encryptedMnemonic)
    return NextResponse.json({ success: true, mnemonic })
  } catch (err) {
    console.error("[GET /api/user/wallet/seed]", err)
    return NextResponse.json({ success: false, error: "Failed to decrypt seed phrase" }, { status: 500 })
  }
}
