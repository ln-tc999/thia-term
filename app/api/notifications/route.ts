export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth-config'
import { prisma } from '@/lib/prisma'

function unauth() {
  return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
}

// GET /api/notifications — last 10 notifications + unread count
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return unauth()
  const userId = session.user.id

  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        type: true,
        title: true,
        message: true,
        read: true,
        link: true,
        createdAt: true,
      },
    }),
    prisma.notification.count({
      where: { userId, read: false },
    }),
  ])

  return NextResponse.json({ success: true, data: notifications, unreadCount })
}

// PATCH /api/notifications — mark all (or specific IDs) as read
export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return unauth()
  const userId = session.user.id

  const body = await request.json().catch(() => ({}))
  const ids: string[] | undefined = body.ids

  if (ids && ids.length > 0) {
    await prisma.notification.updateMany({
      where: { userId, id: { in: ids } },
      data: { read: true },
    })
  } else {
    // Mark all as read
    await prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    })
  }

  return NextResponse.json({ success: true })
}
