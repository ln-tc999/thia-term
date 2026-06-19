export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth-config"
import { prisma } from "@/lib/prisma"
import { encrypt } from "@/lib/wallet-crypto"
import { HDKey } from "@scure/bip32"
import { mnemonicToSeedSync } from "@scure/bip39"
import { privateKeyToAccount } from "viem/accounts"

function unauth() {
  return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
}

/**
 * POST /api/user/wallet
 * Save a managed wallet. Accepts one of:
 *   { walletAddress, mnemonic }          — from "create" or "import seed phrase" flows
 *   { walletAddress, privateKey }        — from "import private key" flow
 *
 * The server derives the private key from the mnemonic (if provided), encrypts
 * everything with AES-256-GCM, and stores it. The plaintext never touches the DB.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return unauth()
  const userId = session.user.id
  if (!userId) return unauth()

  let body: { walletAddress?: string; mnemonic?: string; privateKey?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 })
  }

  const { walletAddress, mnemonic, privateKey: rawPrivateKey } = body

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

  // Derive / validate the private key
  let derivedPrivateKey: string | null = null
  let encryptedMnemonic: string | null = null

  if (mnemonic) {
    try {
      const seed = mnemonicToSeedSync(mnemonic.trim())
      const hd = HDKey.fromMasterSeed(seed)
      const child = hd.derive("m/44'/60'/0'/0/0")
      if (!child.privateKey) throw new Error("Key derivation failed")
      derivedPrivateKey = `0x${Buffer.from(child.privateKey).toString("hex")}`
      encryptedMnemonic = encrypt(mnemonic.trim())
    } catch {
      return NextResponse.json({ success: false, error: "Invalid mnemonic phrase" }, { status: 400 })
    }
  } else if (rawPrivateKey) {
    const pk = rawPrivateKey.startsWith("0x") ? rawPrivateKey : `0x${rawPrivateKey}`
    try {
      privateKeyToAccount(pk as `0x${string}`) // validates format
      derivedPrivateKey = pk
    } catch {
      return NextResponse.json({ success: false, error: "Invalid private key" }, { status: 400 })
    }
  } else {
    return NextResponse.json({ success: false, error: "mnemonic or privateKey required" }, { status: 400 })
  }

  const encryptedPrivateKey = encrypt(derivedPrivateKey!)

  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        walletAddress: addr,
        walletType: "managed",
        encryptedPrivateKey,
        encryptedMnemonic,
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
