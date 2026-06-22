"use client"

import { useSession } from "next-auth/react"
import { signOut } from "next-auth/react"
import { motion } from "framer-motion"
import { Sparkles, X } from "lucide-react"
import { useState } from "react"
import { Button } from "./ui/button"
import { toast } from "sonner"

/**
 * Banner shown when user is using a demo wallet
 */
export function DemoWalletBanner() {
  const { data: session, update } = useSession()
  const [dismissed, setDismissed] = useState(false)
  const [removing, setRemoving] = useState(false)

  const isDemo = session?.user?.isDemo

  if (!isDemo || dismissed) return null

  const handleRemoveDemo = async () => {
    if (!confirm("Remove demo wallet? You can create a real wallet after.")) return

    setRemoving(true)
    try {
      const res = await fetch("/api/wallet/demo", { method: "DELETE" })
      if (res.status === 401) {
        toast.error("Session expired. Please sign in again.")
        signOut({ callbackUrl: "/login" })
        return
      }
      const data = await res.json()

      if (data.success) {
        toast.success("Demo wallet removed")
        await update({ walletAddress: null, walletType: null })
        setTimeout(() => window.location.reload(), 500)
      } else {
        toast.error(data.error || "Failed to remove demo wallet")
      }
    } catch {
      toast.error("Failed to remove demo wallet")
    } finally {
      setRemoving(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-4 mt-3 flex items-center gap-3 rounded-xl border border-sky-500/30 bg-sky-500/[0.1] backdrop-blur-sm px-4 py-3"
    >
      <Sparkles className="h-4 w-4 text-sky-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-sky-300/90 font-medium">Demo Wallet Active</p>
        <p className="text-xs text-sky-400/60 mt-0.5">
          T3N DID auto-generated for testing. Do not send real funds.
        </p>
      </div>
      <Button
        size="sm"
        onClick={handleRemoveDemo}
        disabled={removing}
        className="shrink-0 bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 text-xs"
        variant="outline"
      >
        {removing ? "Removing..." : "Remove Demo"}
      </Button>
      <button
        onClick={() => setDismissed(true)}
        className="text-sky-500/50 hover:text-sky-400 shrink-0"
      >
        <X className="h-4 w-4" />
      </button>
    </motion.div>
  )
}
