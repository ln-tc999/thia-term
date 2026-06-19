import { prisma } from './prisma'

export async function logAudit(params: {
  userId: string
  action: string
  entityId?: string
  entityType?: string
  metadata?: Record<string, any>
  ipAddress?: string
  userAgent?: string
}) {
  try {
    await prisma.auditLog.create({ data: params })
  } catch (e) {
    console.error('Audit log failed:', e)
  }
}
