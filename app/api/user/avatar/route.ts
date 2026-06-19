export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth-config'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id
  if (!userId) {
    return NextResponse.json({ success: false, error: 'Session user ID missing' }, { status: 401 })
  }

  let body: { image?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const { image } = body
  if (!image || typeof image !== 'string') {
    return NextResponse.json({ success: false, error: 'image field required' }, { status: 400 })
  }

  // Only allow base64 data URLs
  if (!image.startsWith('data:image/')) {
    return NextResponse.json({ success: false, error: 'Invalid image format. Must be a base64 data URL.' }, { status: 400 })
  }

  // Limit size: base64 data URLs for ~500KB images are ~700KB strings
  if (image.length > 1_000_000) {
    return NextResponse.json({ success: false, error: 'Image too large (max ~750KB)' }, { status: 413 })
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: { image },
    select: { id: true, image: true },
  })

  return NextResponse.json({ success: true, data: { image: user.image } })
}
