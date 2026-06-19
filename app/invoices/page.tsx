'use client'

import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { DashboardLayout } from '@/components/dashboard-layout'
import { InvoiceModule } from '@/components/invoice-module'
import { ThemeProvider } from '@/components/theme-provider'

export default function InvoicesPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login')
    }
  }, [status, router])

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <div className="text-center text-white">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto mb-4" />
          <p className="text-lg">Loading invoices...</p>
        </div>
      </div>
    )
  }

  if (!session) return null

  return (
    <ThemeProvider>
      <DashboardLayout>
        <InvoiceModule />
      </DashboardLayout>
    </ThemeProvider>
  )
}
