/**
 * Demo Wallet Generator
 * Creates temporary T3N DID and wallet credentials for demo purposes
 */

import { randomBytes } from 'crypto'
import { generateMnemonic, mnemonicToSeedSync } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import { HDKey } from '@scure/bip32'
import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'
import { bytesToHex } from '@noble/hashes/utils'
import { encrypt } from './wallet-crypto'

function privateKeyToAddress(privateKey: `0x${string}`): `0x${string}` {
  const pk = Buffer.from(privateKey.slice(2), 'hex')
  const pubKey = secp256k1.getPublicKey(pk, false)
  const hash = keccak_256(pubKey.slice(1))
  return `0x${bytesToHex(hash.slice(-20))}` as `0x${string}`
}

/**
 * Generate a new Ethereum private key for T3N API
 * This will automatically get a DID when used with T3N SDK
 */
export function generateDemoT3nKey(): string {
  // Generate 32 random bytes for private key
  const privateKeyBytes = randomBytes(32)
  // Format as 0x-prefixed hex string
  return '0x' + privateKeyBytes.toString('hex')
}

/**
 * Generate complete demo wallet with mnemonic
 */
export function generateDemoWallet() {
  // Generate BIP-39 mnemonic (12 words, 128 bits entropy)
  const mnemonic = generateMnemonic(wordlist, 128)
  const seed = mnemonicToSeedSync(mnemonic)
  const hdKey = HDKey.fromMasterSeed(seed)
  const child = hdKey.derive("m/44'/60'/0'/0/0")

  if (!child.privateKey) throw new Error('Key derivation failed')

  const privateKey = `0x${bytesToHex(child.privateKey)}` as `0x${string}`
  const walletAddress = privateKeyToAddress(privateKey)

  // Encrypt credentials
  const encryptedMnemonic = encrypt(mnemonic)
  const encryptedPrivateKey = encrypt(privateKey)

  return {
    mnemonic,
    privateKey,
    walletAddress,
    encryptedMnemonic,
    encryptedPrivateKey,
  }
}

/**
 * Generate T3N DID from wallet address (for demo)
 * Format: did:t3n:<address_without_0x>
 */
export function generateDemoT3nDid(walletAddress: string): string {
  // T3N DID is derived from Ethereum address
  const address = walletAddress.toLowerCase().replace('0x', '')
  return `did:t3n:${address}`
}

/**
 * Check if a user is using demo credentials
 */
export function isDemoUser(email: string | null | undefined): boolean {
  return email?.startsWith('demo-') || false
}

/**
 * Generate unique demo email
 */
export function generateDemoEmail(): string {
  const timestamp = Date.now()
  const random = randomBytes(4).toString('hex')
  return `demo-${timestamp}-${random}@thia-term.local`
}
