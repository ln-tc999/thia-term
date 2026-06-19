export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth-config'
import { prisma } from '@/lib/prisma'

function unauth() {
  return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return unauth()
  const userId = session.user.id

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, walletAddress: true, createdAt: true },
  })

  if (!user) return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 })
  return NextResponse.json({ success: true, data: user })
}

export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return unauth()
  const userId = session.user.id

  // Guard: session user id must be present (can be absent when JWT is misconfigured)
  if (!userId) {
    return NextResponse.json({ success: false, error: 'Session user ID missing' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const data: Record<string, unknown> = {}

  if (body.walletAddress !== undefined) {
    // Normalise to lowercase; null means "unlink"
    const addr = body.walletAddress
      ? (body.walletAddress as string).trim().toLowerCase()
      : null

    if (addr && !/^0x[0-9a-f]{40}$/.test(addr)) {
      return NextResponse.json(
        { success: false, error: 'Invalid EVM wallet address' },
        { status: 400 }
      )
    }
    if (addr) {
      const conflict = await prisma.user.findFirst({ where: { walletAddress: addr } })
      if (conflict && conflict.id !== userId) {
        return NextResponse.json(
          { success: false, error: 'Wallet address is already linked to another account' },
          { status: 409 }
        )
      }
    }
    data.walletAddress = addr
  }

  if (body.name !== undefined) data.name = body.name

  // Nothing to update — return the current user without touching the DB
  if (Object.keys(data).length === 0) {
    const current = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, walletAddress: true },
    })
    return NextResponse.json({ success: true, data: current })
  }

  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data,
      select: { id: true, name: true, email: true, walletAddress: true },
    })
    return NextResponse.json({ success: true, data: user })
  } catch (err: unknown) {
    console.error('[PATCH /api/user]', err)
    return NextResponse.json(
      { success: false, error: 'Database error while updating user' },
      { status: 500 }
    )
  }
}
