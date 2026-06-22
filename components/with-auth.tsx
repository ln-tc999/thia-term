'use client'

import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

function LoadingSpinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#080e1a' }}>
      <div className="text-center">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-sky-500 border-t-transparent mx-auto mb-4" />
        <p className="text-sm text-slate-500">{label}</p>
      </div>
    </div>
  )
}

/** Higher-order component that guards a page behind authentication.
 *  Shows a spinner while session loads, redirects to /login if unauthenticated,
 *  and renders `Component` only when authenticated. */
export function withAuth<P extends object>(
  Component: React.ComponentType<P>,
  loadingLabel?: string,
) {
  return function AuthenticatedPage(props: P) {
    const { data: session, status } = useSession()
    const router = useRouter()

    useEffect(() => {
      if (status === 'unauthenticated') {
        router.replace('/login')
      }
    }, [status, router])

    if (status === 'loading') return <LoadingSpinner label={loadingLabel} />
    if (!session) return null

    return <Component {...props} />
  }
}
