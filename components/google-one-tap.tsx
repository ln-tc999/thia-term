"use client"

import { useEffect } from "react"
import { useSession, signIn } from "next-auth/react"

export function GoogleOneTap() {
  const { data: session, status } = useSession()

  useEffect(() => {
    if (status === "loading" || session) return

    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
    if (!clientId || typeof window === "undefined" || !(window as any).google) return

    ;(window as any).google.accounts.id.initialize({
      client_id: clientId,
      callback: async (response: { credential: string }) => {
        await signIn("google-one-tap", {
          credential: response.credential,
          redirect: true,
          callbackUrl: "/dashboard",
        })
      },
      auto_select: true,
      cancel_on_tap_outside: false,
    })

    ;(window as any).google.accounts.id.prompt()
  }, [session, status])

  return null
}
