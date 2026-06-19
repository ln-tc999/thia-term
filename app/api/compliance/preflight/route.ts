export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { runComplianceCheck } from '@/lib/compliance'

/**
 * GET /api/compliance/preflight?addr=0x...&linkId=...
 *
 * Runs a real compliance check on the given wallet address:
 *  1. OFAC SDN screening via ofac.dev free community API
 *  2. Velocity check against our own payment DB (24 h window)
 *  3. Risk scoring (0–100), score < 60 = blocked
 *
 * Returns 200 with { kycOk, sanctionsOk, complianceScore, ... } on pass
 * Returns 403 with detail message when the address is blocked
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const addr = searchParams.get('addr')
  const linkId = searchParams.get('linkId') ?? undefined

  if (!addr || !/^0x[a-fA-F0-9]{40}$/.test(addr)) {
    return NextResponse.json(
      { success: false, error: 'addr must be a valid EVM address (0x + 40 hex chars)' },
      { status: 400 },
    )
  }

  const compliance = await runComplianceCheck(addr)

  const blocked = !compliance.sanctionsOk || compliance.complianceScore < 60

  if (blocked) {
    return NextResponse.json(
      {
        success: false,
        address: addr,
        linkId,
        compliance,
        error: compliance.detail ?? 'Address failed compliance screening',
      },
      { status: 403 },
    )
  }

  return NextResponse.json({
    success: true,
    address: addr,
    linkId,
    compliance,
  })
}
