import { prisma } from '@/lib/prisma'

export interface ComplianceResult {
  kycOk: boolean
  sanctionsOk: boolean
  complianceScore: number
  checkedAt: string
  detail?: string
}

export interface ComplianceCheckResponse {
  success: boolean
  address: string
  linkId?: string
  compliance: ComplianceResult
  error?: string
}

const cache = new Map<string, { result: ComplianceResult; expiresAt: number }>()

function getCached(address: string): ComplianceResult | null {
  const entry = cache.get(address.toLowerCase())
  if (!entry) return null
  if (Date.now() > entry.expiresAt) { cache.delete(address.toLowerCase()); return null }
  return entry.result
}

function setCached(address: string, result: ComplianceResult) {
  cache.set(address.toLowerCase(), { result, expiresAt: Date.now() + 60_000 })
}

// Known OFAC-sanctioned Ethereum addresses (Tornado Cash, Lazarus Group)
const KNOWN_SANCTIONED: Set<string> = new Set([
  '0x7f367cc41522ce07553e823bf3be79a889debe1b',
  '0xd882cfc20f52f2599d84b8e8d58c7fb62cfe344b',
  '0x901bb9583b24d97e995513c6778dc6888ab6870e',
  '0xa7e5d5a720f06526557c513402f2e6b5fa20b008',
  '0x8576acc5c05d6ce88f4e49bf65bdf0c62f91353c',
  '0x1da5821544e25c636c1417ba96ade4cf6d2f9b5a',
  '0x7db418b5d567a4e0e8c59ad71be1fce48f3e6107',
  '0x72a5843cc08275c8171e582972aa4fda8c397b2a',
  '0x098b716b8aaf21512996dc57eb0615e2383e2f96',
  '0xa0e1c89ef1a489c9c7de96311ed5ce5d32c20e4b',
  '0x3cffd56b47b7b41c56258d9c7731abadc360e073',
  '0x53b6936513e738f44fb50d2b9476730c0d3f9e9e',
  '0x797d7ae72ebddcdea2a346c1834612d57ab6e895',
  '0x38735f03b30fbc022ddd06abed01f0ca823c6a94',
])

async function checkOFAC(address: string): Promise<{ blocked: boolean; detail?: string }> {
  try {
    const res = await fetch(`https://api.ofac.dev/v1/ethereum/${address.toLowerCase()}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    })

    if (res.status === 404) return { blocked: false }
    if (!res.ok) return { blocked: false }

    const data = await res.json()
    if (data?.found === true) {
      return { blocked: true, detail: `OFAC SDN match: ${data.name ?? 'sanctioned entity'}` }
    }
    return { blocked: false }
  } catch {
    return { blocked: false }
  }
}

const VELOCITY_LIMIT_USD = 50_000
const VELOCITY_WINDOW_MS = 24 * 60 * 60 * 1000

async function checkVelocity(address: string): Promise<{ highVelocity: boolean; volume24h: number }> {
  try {
    const since = new Date(Date.now() - VELOCITY_WINDOW_MS)
    const rows = await prisma.payment.findMany({
      where: {
        payerAddress: { equals: address, mode: 'insensitive' },
        createdAt: { gte: since },
        status: { in: ['completed', 'pending'] },
      },
      select: { amount: true },
    })
    const volume24h = rows.reduce((sum, r) => sum + r.amount, 0)
    return { highVelocity: volume24h > VELOCITY_LIMIT_USD, volume24h }
  } catch {
    return { highVelocity: false, volume24h: 0 }
  }
}

function computeScore({ isOnOFAC, isKnownBad, highVelocity }: {
  isOnOFAC: boolean
  isKnownBad: boolean
  highVelocity: boolean
}): number {
  let score = 100
  if (isOnOFAC) score -= 60
  if (isKnownBad) score -= 60
  if (highVelocity) score -= 20
  return Math.max(0, score)
}

export async function runComplianceCheck(address: string): Promise<ComplianceResult> {
  const addr = address.toLowerCase()
  const cached = getCached(addr)
  if (cached) return cached

  const [ofacResult, velocityResult] = await Promise.all([
    checkOFAC(addr),
    checkVelocity(addr),
  ])

  const isKnownBad = KNOWN_SANCTIONED.has(addr)
  const score = computeScore({
    isOnOFAC: ofacResult.blocked,
    isKnownBad,
    highVelocity: velocityResult.highVelocity,
  })

  const sanctionsOk = !ofacResult.blocked && !isKnownBad

  let detail: string | undefined
  if (!sanctionsOk) {
    detail = ofacResult.detail ?? 'Address matches known OFAC sanctions list'
  } else if (velocityResult.highVelocity) {
    detail = `High transaction volume: $${velocityResult.volume24h.toLocaleString()} in last 24h`
  }

  const result: ComplianceResult = {
    kycOk: true,
    sanctionsOk,
    complianceScore: score,
    checkedAt: new Date().toISOString(),
    detail,
  }

  setCached(addr, result)
  return result
}

export async function checkCompliance(address: string, linkId?: string): Promise<ComplianceCheckResponse> {
  try {
    const params = new URLSearchParams({ addr: address })
    if (linkId) params.append('linkId', linkId)
    const response = await fetch(`/api/compliance/preflight?${params}`)
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Compliance check failed')
    return data
  } catch (error) {
    console.error('Compliance check error:', error)
    throw error
  }
}

export function getComplianceMessage(
  compliance: ComplianceResult,
  requireKYC: boolean,
  checkSanctions: boolean,
): string {
  const issues: string[] = []
  if (requireKYC && !compliance.kycOk) issues.push('KYC verification required')
  if (checkSanctions && !compliance.sanctionsOk) issues.push(compliance.detail ?? 'Address blocked by sanctions')
  return issues.length === 0 ? 'All compliance checks passed' : `Compliance issues: ${issues.join(', ')}`
}

export function canProcessPayment(
  compliance: ComplianceResult,
  requireKYC: boolean,
  checkSanctions: boolean,
): boolean {
  if (requireKYC && !compliance.kycOk) return false
  if (checkSanctions && !compliance.sanctionsOk) return false
  if (compliance.complianceScore < 60) return false
  return true
}
