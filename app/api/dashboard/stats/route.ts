import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth-config'
import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = session.user.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Single round-trip: aggregate + two counts in parallel
    const [volumeAgg, activeLinks, totalPayments, pendingInvoices] = await Promise.all([
      prisma.payment.aggregate({ where: { userId }, _sum: { amount: true }, _count: true }),
      prisma.paymentLink.count({ where: { userId, status: 'active' } }),
      prisma.payment.count({ where: { userId } }),
      prisma.invoice.count({ where: { userId, status: 'pending' } }),
    ])

    const totalVolume = Number(volumeAgg._sum.amount ?? 0)

    return NextResponse.json({ totalVolume, activePaymentLinks: activeLinks, totalPayments, pendingInvoices })
  } catch (e) {
    console.error('Dashboard stats error:', e)
    return NextResponse.json({ totalVolume: 0, activePaymentLinks: 0, totalPayments: 0, pendingInvoices: 0 })
  }
}
