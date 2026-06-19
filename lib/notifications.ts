import { prisma } from '@/lib/prisma'

export type NotificationType = 'payment' | 'invoice' | 'payroll' | 'compliance' | 'system'

export async function logNotification({
  userId,
  type,
  title,
  message,
  link,
}: {
  userId: string
  type: NotificationType
  title: string
  message: string
  link?: string
}) {
  try {
    await prisma.notification.create({
      data: { userId, type, title, message, link: link ?? null },
    })
  } catch (e) {
    // Non-critical — never break the main operation
    console.error('[notifications] Failed to create notification:', e)
  }
}
