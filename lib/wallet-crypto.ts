import { createCipheriv, createDecipheriv, randomBytes } from "crypto"

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 12  // 96-bit IV for GCM
const TAG_LENGTH = 16 // 128-bit auth tag

function getKey(): Buffer {
  const hex = process.env.WALLET_ENCRYPTION_KEY
  if (!hex || hex.length !== 64) {
    throw new Error("WALLET_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)")
  }
  return Buffer.from(hex, "hex")
}

/**
 * Encrypt plaintext string with AES-256-GCM.
 * Returns "iv:authTag:ciphertext" — all hex-encoded.
 */
export function encrypt(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`
}

/**
 * Decrypt an "iv:authTag:ciphertext" string produced by encrypt().
 */
export function decrypt(stored: string): string {
  const parts = stored.split(":")
  if (parts.length !== 3) throw new Error("Invalid encrypted format")
  const [ivHex, tagHex, ctHex] = parts
  const key = getKey()
  const iv = Buffer.from(ivHex, "hex")
  const tag = Buffer.from(tagHex, "hex")
  const ct = Buffer.from(ctHex, "hex")
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8")
}
