"use client"

import { useSession } from "next-auth/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Wallet, CheckCircle, ExternalLink } from "lucide-react"

interface WalletSetupModalProps {
  open: boolean
  onClose: () => void
}

export function WalletSetupModal({ open, onClose }: WalletSetupModalProps) {
  const { data: session } = useSession()
  const walletAddress = session?.user?.walletAddress as string | null | undefined

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm bg-[#0a1220]/95 backdrop-blur-xl border border-white/[0.08] text-white shadow-2xl shadow-black/60">
        <DialogHeader>
          <DialogTitle className="text-white font-semibold tracking-tight flex items-center gap-2">
            <Wallet className="h-4 w-4 text-emerald-400" />
            T3N Wallet
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {walletAddress ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-emerald-400">
                <CheckCircle className="h-4 w-4" />
                <span className="text-sm font-medium">Wallet active</span>
              </div>
              <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-3">
                <p className="text-xs text-slate-500 mb-1">Address</p>
                <p className="font-mono text-sm text-slate-200 break-all">{walletAddress}</p>
              </div>
            </div>
          ) : (
            <div className="text-center py-6 space-y-3">
              <Wallet className="h-10 w-10 text-slate-600 mx-auto" />
              <p className="text-sm text-slate-400">No wallet linked yet.</p>
              <p className="text-xs text-slate-500">Create a wallet from the onboarding prompt.</p>
            </div>
          )}
          <Button onClick={onClose} className="w-full bg-white/[0.06] hover:bg-white/[0.1] text-white border border-white/[0.08]">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
