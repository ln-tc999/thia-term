"use client"

import { useState } from "react"
import { signOut, useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  Wallet, ShieldAlert, Eye, EyeOff, Copy, Check,
  ArrowRight, Loader2, Download,
} from "lucide-react"
import { toast } from "sonner"

interface WalletOnboardingModalProps {
  open: boolean
  onClose: () => void
}

type Step = "choice" | "create" | "done"

export function WalletOnboardingModal({ open, onClose }: WalletOnboardingModalProps) {
  const { update } = useSession()
  const [step, setStep] = useState<Step>("choice")
  const [creating, setCreating] = useState(false)
  const [mnemonicRevealed, setMnemonicRevealed] = useState(false)
  const [mnemonic, setMnemonic] = useState<string | null>(null)
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const handleCreate = async () => {
    setCreating(true)
    try {
      const res = await fetch("/api/user/wallet/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
      if (res.status === 401) {
        toast.error("Session expired. Please sign in again.")
        signOut({ callbackUrl: "/login" })
        return
      }
      const data = await res.json()
      if (data.success) {
        setMnemonic(data.mnemonic)
        setWalletAddress(data.address)
        await update({ walletAddress: data.address, walletType: "managed" })
        setStep("done")
      } else {
        toast.error(data.error || "Failed to create wallet")
      }
    } catch {
      toast.error("Failed to create wallet. Please try again.")
    } finally {
      setCreating(false)
    }
  }

  const handleCreateDemo = async () => {
    setCreating(true)
    try {
      const res = await fetch("/api/wallet/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
      if (res.status === 401) {
        toast.error("Session expired. Please sign in again.")
        signOut({ callbackUrl: "/login" })
        return
      }
      const data = await res.json()
      if (data.success) {
        await update({
          walletAddress: data.wallet.address,
          walletType: data.wallet.type,
        })
        toast.success(data.message)
        onClose()
        setTimeout(() => window.location.reload(), 500)
      } else {
        toast.error(data.error || "Failed to create demo wallet")
      }
    } catch {
      toast.error("Failed to create demo wallet. Please try again.")
    } finally {
      setCreating(false)
    }
  }

  const handleCopy = () => {
    if (!mnemonic) return
    navigator.clipboard.writeText(mnemonic)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDownload = () => {
    if (!mnemonic) return
    const blob = new Blob([`Thia-Term Wallet Recovery Phrase\n\n${mnemonic}\n\nAddress: ${walletAddress}\nCreated: ${new Date().toISOString()}`], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `thia-term-wallet-${walletAddress?.slice(0, 8)}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!creating && step !== "done") onClose() }}>
      <DialogContent className="max-w-md bg-[#0a1220]/95 backdrop-blur-xl border border-white/[0.08] text-white shadow-2xl shadow-black/60">
        <DialogHeader>
          <DialogTitle className="text-white font-semibold tracking-tight flex items-center gap-2">
            <Wallet className="h-4 w-4 text-sky-400" />
            Set Up Your Wallet
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Create a managed wallet for use with Thia-Term and T3N.
          </DialogDescription>
        </DialogHeader>

        {step === "choice" && (
          <div className="space-y-3">
            <button
              onClick={handleCreateDemo}
              disabled={creating}
              className="w-full text-left p-4 rounded-xl bg-sky-500/10 border border-sky-500/20 hover:bg-sky-500/15 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-sky-500/20">
                  <Wallet className="h-5 w-5 text-sky-400" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white">Try Demo Wallet</p>
                    <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-sky-500/20 text-sky-400 rounded">DEMO</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">Auto-generate T3N DID for testing</p>
                </div>
                {creating ? (
                  <Loader2 className="h-5 w-5 text-sky-400 animate-spin" />
                ) : (
                  <ArrowRight className="h-5 w-5 text-sky-500" />
                )}
              </div>
            </button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/[0.08]"></div>
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-[#0a1220] px-2 text-slate-600">or</span>
              </div>
            </div>

            <button
              onClick={handleCreate}
              disabled={creating}
              className="w-full text-left p-4 rounded-xl bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-white/[0.06]">
                  <Wallet className="h-5 w-5 text-slate-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-white">Create Production Wallet</p>
                  <p className="text-xs text-slate-500 mt-0.5">Generate wallet with recovery phrase</p>
                </div>
                {creating ? (
                  <Loader2 className="h-5 w-5 text-sky-400 animate-spin" />
                ) : (
                  <ArrowRight className="h-5 w-5 text-slate-500" />
                )}
              </div>
            </button>
          </div>
        )}

        {step === "done" && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-3">
              <ShieldAlert className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-300 space-y-1">
                <p className="font-medium">Write this down. Keep it safe.</p>
                <p>Never share your recovery phrase. Anyone with it can access your wallet.</p>
              </div>
            </div>

            <div className="relative">
              <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-4 font-mono text-sm text-slate-300 leading-relaxed">
                {mnemonicRevealed ? mnemonic : mnemonic?.split(" ").map(() => "••••••").join(" ")}
              </div>
              <button
                onClick={() => setMnemonicRevealed(!mnemonicRevealed)}
                className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-white/[0.08] text-slate-500 hover:text-slate-300"
              >
                {mnemonicRevealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            {mnemonicRevealed && (
              <div className="flex gap-2">
                <Button onClick={handleCopy} variant="outline" className="flex-1 border-white/[0.08] text-slate-300 hover:text-white">
                  {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
                <Button onClick={handleDownload} variant="outline" className="flex-1 border-white/[0.08] text-slate-300 hover:text-white">
                  <Download className="h-4 w-4 mr-1" /> Download
                </Button>
              </div>
            )}

            <Button onClick={() => { onClose(); window.location.reload() }} className="w-full bg-sky-600 hover:bg-sky-500 text-white">
              Done — Open Dashboard
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
