import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const record = rateLimitMap.get(key)

  if (!record || now > record.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }

  if (record.count >= limit) return false
  record.count++
  return true
}

export function middleware(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown'
  const path = req.nextUrl.pathname

  // Rate limit payment endpoints: 20 requests per minute
  if (path.startsWith('/api/payments') || path.startsWith('/api/agents/pay')) {
    const allowed = rateLimit(`${ip}:payments`, 20, 60_000)
    if (!allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded. Try again in a minute.' }, { status: 429 })
    }
  }

  // Rate limit auth endpoints: 10 per minute
  if (path.startsWith('/api/auth')) {
    const allowed = rateLimit(`${ip}:auth`, 10, 60_000)
    if (!allowed) {
      return NextResponse.json({ error: 'Too many auth attempts.' }, { status: 429 })
    }
  }

  // Rate limit invoices, payment-links, avatar: 30 per minute
  if (
    path.startsWith('/api/invoices') ||
    path.startsWith('/api/payment-links') ||
    path.startsWith('/api/user/avatar')
  ) {
    const allowed = rateLimit(`${ip}:general-api`, 30, 60_000)
    if (!allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded. Try again in a minute.' }, { status: 429 })
    }
  }

  // Rate limit wallet seed retrieval: 5 per minute (sensitive mnemonic endpoint)
  if (path.startsWith('/api/user/wallet/seed')) {
    const allowed = rateLimit(`${ip}:wallet-seed`, 5, 60_000)
    if (!allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded. Try again in a minute.' }, { status: 429 })
    }
  }

  // Rate limit AI chat: 20 per minute
  if (path.startsWith('/api/ai/chat')) {
    const allowed = rateLimit(`${ip}:ai-chat`, 20, 60_000)
    if (!allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded. Try again in a minute.' }, { status: 429 })
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/api/payments/:path*',
    '/api/agents/pay/:path*',
    '/api/auth/:path*',
    '/api/invoices/:path*',
    '/api/payment-links/:path*',
    '/api/user/avatar/:path*',
    '/api/user/wallet/seed/:path*',
    '/api/user/wallet/seed',
    '/api/ai/chat',
  ],
}
