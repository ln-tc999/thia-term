export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth-config"
import { prisma } from "@/lib/prisma"
import { decrypt, encrypt } from "@/lib/wallet-crypto"
import { generateMnemonic, mnemonicToSeedSync } from "@scure/bip39"
import { wordlist } from "@scure/bip39/wordlists/english"
import { HDKey } from "@scure/bip32"
import { secp256k1 } from "@noble/curves/secp256k1"
import { keccak_256 } from "@noble/hashes/sha3"
import { bytesToHex } from "@noble/hashes/utils"
import crypto from "node:crypto"

function unauth() {
  return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
}

function privateKeyToAddress(privateKey: `0x${string}`): `0x${string}` {
  const pk = Buffer.from(privateKey.slice(2), "hex")
  const pubKey = secp256k1.getPublicKey(pk, false)
  const hash = keccak_256(pubKey.slice(1))
  return `0x${bytesToHex(hash.slice(-20))}` as `0x${string}`
}

/**
 * POST /api/user/wallet/seed
 * Generate a new managed wallet with a random seed phrase.
 * Returns mnemonic + address. The mnemonic is encrypted and stored.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return unauth()
  const userId = session.user.id
  if (!userId) return unauth()

  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { walletAddress: true },
  })
  if (existing?.walletAddress) {
    return NextResponse.json({ success: false, error: "User already has a wallet" }, { status: 409 })
  }

  try {
    const mnemonic = generateMnemonic(wordlist, 128)
    const seed = mnemonicToSeedSync(mnemonic)
    const hdKey = HDKey.fromMasterSeed(seed)
    const child = hdKey.derive("m/44'/60'/0'/0/0")
    if (!child.privateKey) throw new Error("Key derivation failed")
    const privateKey = `0x${bytesToHex(child.privateKey)}` as `0x${string}`
    const address = privateKeyToAddress(privateKey)

    const encryptedMnemonic = encrypt(mnemonic)

    await prisma.user.update({
      where: { id: userId },
      data: {
        walletAddress: address,
        walletType: "managed",
        encryptedMnemonic,
      },
    })

    return NextResponse.json({ success: true, mnemonic, address })
  } catch (err) {
    console.error("[POST /api/user/wallet/seed]", err)
    return NextResponse.json({ success: false, error: "Failed to create wallet" }, { status: 500 })
  }
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
