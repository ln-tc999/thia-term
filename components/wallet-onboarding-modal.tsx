"use client"

import { useState, useCallback } from "react"
import { generateMnemonic, mnemonicToAccount, privateKeyToAccount } from "viem/accounts"
import { english } from "viem/accounts"
import { useSession } from "next-auth/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Wallet, ShieldAlert, Eye, EyeOff, Copy, Check,
  AlertTriangle, ArrowRight, ArrowLeft, Loader2, KeyRound,
  Plus, Download, Shield,
} from "lucide-react"
import { toast } from "sonner"

interface WalletOnboardingModalProps {
  open: boolean
  onClose: () => void
}

type Step = "choice" | "create" | "import"

export function WalletOnboardingModal({ open, onClose }: WalletOnboardingModalProps) {
  const { update } = useSession()
  const [step, setStep] = useState<Step>("choice")

  // Create wallet state
  const [mnemonic, setMnemonic] = useState<string | null>(null)
  const [createdAddress, setCreatedAddress] = useState<string | null>(null)
  const [seedVisible, setSeedVisible] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmedBackup, setConfirmedBackup] = useState(false)

  // Import wallet state
  const [importPhrase, setImportPhrase] = useState("")
  const [importedAddress, setImportedAddress] = useState<string | null>(null)
  const [importError, setImportError] = useState("")

  const [saving, setSaving] = useState(false)

  const resetCreate = () => {
    setMnemonic(null); setCreatedAddress(null)
    setSeedVisible(false); setCopied(false); setConfirmedBackup(false)
  }
  const resetImport = () => {
    setImportPhrase(""); setImportedAddress(null); setImportError("")
  }
  const goBack = () => { setStep("choice"); resetCreate(); resetImport() }

  // ── Generate wallet ──────────────────────────────────────────────────────
  const generateWallet = useCallback(() => {
    const phrase = generateMnemonic(english)
    const account = mnemonicToAccount(phrase)
    setMnemonic(phrase)
    setCreatedAddress(account.address)
    setSeedVisible(false); setConfirmedBackup(false); setCopied(false)
  }, [])

  const copyMnemonic = () => {
    if (!mnemonic) return
    navigator.clipboard.writeText(mnemonic)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // ── Derive imported address ──────────────────────────────────────────────
  const deriveImportedAddress = () => {
    setImportError("")
    const phrase = importPhrase.trim()
    if (!phrase) return
    const words = phrase.split(/\s+/)
    if (words.length === 12 || words.length === 24) {
      try {
        const account = mnemonicToAccount(phrase)
        setImportedAddress(account.address); return
      } catch {
        setImportError("Invalid seed phrase — check for typos.")
        setImportedAddress(null); return
      }
    }
    try {
      const pk = phrase.startsWith("0x") ? phrase : `0x${phrase}`
      const account = privateKeyToAccount(pk as `0x${string}`)
      setImportedAddress(account.address)
    } catch {
      setImportError("Not a valid seed phrase or private key.")
      setImportedAddress(null)
    }
  }

  // ── Save managed wallet to server ────────────────────────────────────────
  const saveManagedWallet = async (opts: { walletAddress: string; mnemonic?: string; privateKey?: string }) => {
    setSaving(true)
    try {
      const res = await fetch("/api/user/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts),
      })
      const data = await res.json()
      if (data.success) {
        await update({ walletAddress: data.data.walletAddress, walletType: "managed" })
        toast.success("Wallet saved — no reconnect needed!")
        onClose()
      } else {
        toast.error(data.error ?? "Failed to save wallet.")
      }
    } catch {
      toast.error("Something went wrong. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  const mnemonicWords = mnemonic ? mnemonic.split(" ") : []

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-lg bg-[#0a1f1c] border border-white/10 text-white shadow-2xl p-0 overflow-hidden">

        {/* Top accent bar */}
        <div className="h-0.5 w-full bg-gradient-to-r from-emerald-500/0 via-emerald-400 to-emerald-500/0" />

        <div className="p-6">

          {/* ── CHOICE STEP ── */}
          {step === "choice" && (
            <div className="space-y-6">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-400/10 border border-emerald-400/20 flex items-center justify-center">
                    <Wallet className="h-4 w-4 text-emerald-400" />
                  </div>
                  <h2 className="text-lg font-semibold text-white">Set up your wallet</h2>
                </div>
                <p className="text-sm text-white/50 pl-[2.6rem]">
                  To send and receive crypto payments you need a wallet linked to your FlowLink account.
                </p>
              </div>

              {/* Managed wallet notice */}
              <div className="rounded-xl bg-emerald-400/5 border border-emerald-400/15 p-3.5 flex gap-2.5">
                <Shield className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                <p className="text-xs text-white/60 leading-relaxed">
                  FlowLink encrypts your key server-side. You won't need to reconnect MetaMask for every payment — the app signs automatically.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Create */}
                <button
                  onClick={() => { setStep("create"); generateWallet() }}
                  className="flex flex-col items-start gap-3 rounded-xl border border-white/8 bg-white/[0.03] hover:bg-emerald-400/5 hover:border-emerald-400/20 p-4 text-left transition-all group"
                >
                  <div className="w-9 h-9 rounded-lg bg-emerald-400/10 border border-emerald-400/20 flex items-center justify-center group-hover:bg-emerald-400/15 transition-colors">
                    <Plus className="h-4 w-4 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Create new</p>
                    <p className="text-xs text-white/45 mt-0.5 leading-snug">Generate a fresh wallet with a 12-word phrase</p>
                  </div>
                </button>

                {/* Import */}
                <button
                  onClick={() => setStep("import")}
                  className="flex flex-col items-start gap-3 rounded-xl border border-white/8 bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/15 p-4 text-left transition-all group"
                >
                  <div className="w-9 h-9 rounded-lg bg-white/[0.06] border border-white/10 flex items-center justify-center group-hover:bg-white/10 transition-colors">
                    <Download className="h-4 w-4 text-white/60" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Import existing</p>
                    <p className="text-xs text-white/45 mt-0.5 leading-snug">Restore with a seed phrase or private key</p>
                  </div>
                </button>
              </div>

              <button
                onClick={onClose}
                className="w-full text-center text-xs text-white/30 hover:text-white/50 transition-colors py-1"
              >
                Skip for now →
              </button>
            </div>
          )}

          {/* ── CREATE STEP ── */}
          {step === "create" && (
            <div className="space-y-5">
              <div className="flex items-center gap-2.5">
                <button onClick={goBack} className="text-white/40 hover:text-white/70 transition-colors">
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald-400/10 border border-emerald-400/20 flex items-center justify-center">
                    <Plus className="h-3.5 w-3.5 text-emerald-400" />
                  </div>
                  <h2 className="text-base font-semibold text-white">Create new wallet</h2>
                </div>
              </div>

              {createdAddress && (
                <div className="rounded-xl bg-white/[0.04] border border-white/8 p-3.5">
                  <p className="text-[10px] text-white/35 uppercase tracking-wider mb-1.5">Wallet address</p>
                  <p className="font-mono text-xs text-emerald-400 break-all">{createdAddress}</p>
                </div>
              )}

              {/* Seed phrase */}
              <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.04] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                    <p className="text-xs font-semibold text-amber-400">Secret Recovery Phrase</p>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={copyMnemonic} className="p-1 rounded text-white/40 hover:text-white/70 transition-colors" title="Copy">
                      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                    <button onClick={() => setSeedVisible(!seedVisible)} className="p-1 rounded text-white/40 hover:text-white/70 transition-colors" title={seedVisible ? "Hide" : "Reveal"}>
                      {seedVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                {seedVisible ? (
                  <div className="grid grid-cols-3 gap-1.5">
                    {mnemonicWords.map((word, i) => (
                      <div key={i} className="flex items-center gap-1 bg-white/[0.06] rounded-lg px-2 py-1.5">
                        <span className="text-[10px] text-white/30 w-4 shrink-0">{i + 1}.</span>
                        <span className="text-xs text-white font-mono">{word}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <button
                    onClick={() => setSeedVisible(true)}
                    className="w-full h-[72px] rounded-lg border border-dashed border-amber-400/30 flex items-center justify-center gap-2 text-sm text-amber-400/70 hover:border-amber-400/50 hover:text-amber-400 transition-colors"
                  >
                    <Eye className="h-4 w-4" />
                    Click to reveal seed phrase
                  </button>
                )}

                <p className="text-[10px] text-white/30 leading-relaxed">
                  Write this down somewhere safe. FlowLink encrypts and stores your key so you can sign transactions without reconnecting — but this phrase is the only way to recover your wallet if you lose access.
                </p>
              </div>

              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-emerald-500 shrink-0"
                  checked={confirmedBackup}
                  onChange={(e) => setConfirmedBackup(e.target.checked)}
                />
                <span className="text-xs text-white/50">
                  I've saved my seed phrase. I understand that losing it means losing independent access to my wallet.
                </span>
              </label>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={generateWallet}
                  disabled={saving}
                  className="flex-1 bg-transparent border-white/10 text-white/60 hover:bg-white/[0.06] hover:text-white hover:border-white/20"
                >
                  Regenerate
                </Button>
                <Button
                  size="sm"
                  disabled={!confirmedBackup || saving || !createdAddress}
                  onClick={() => saveManagedWallet({ walletAddress: createdAddress!, mnemonic: mnemonic! })}
                  className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-white border-0"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <ArrowRight className="h-4 w-4 mr-1.5" />}
                  {saving ? "Saving…" : "Use this wallet"}
                </Button>
              </div>
            </div>
          )}

          {/* ── IMPORT STEP ── */}
          {step === "import" && (
            <div className="space-y-5">
              <div className="flex items-center gap-2.5">
                <button onClick={goBack} className="text-white/40 hover:text-white/70 transition-colors">
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-white/[0.06] border border-white/10 flex items-center justify-center">
                    <KeyRound className="h-3.5 w-3.5 text-white/60" />
                  </div>
                  <h2 className="text-base font-semibold text-white">Import wallet</h2>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs text-white/40">Seed phrase (12 or 24 words) or private key</p>
                <Textarea
                  placeholder="word1 word2 word3 … or 0xprivatekey"
                  className="font-mono text-xs resize-none h-24 bg-white/[0.04] border-white/10 text-white placeholder:text-white/20 focus:border-emerald-400/40 focus:ring-emerald-400/20"
                  value={importPhrase}
                  onChange={(e) => { setImportPhrase(e.target.value); setImportedAddress(null); setImportError("") }}
                />
                {importError && <p className="text-xs text-red-400">{importError}</p>}
              </div>

              {!importedAddress ? (
                <Button
                  variant="outline"
                  className="w-full bg-transparent border-white/10 text-white/70 hover:bg-white/[0.06] hover:text-white hover:border-white/20"
                  onClick={deriveImportedAddress}
                  disabled={!importPhrase.trim()}
                >
                  Derive Address
                </Button>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-xl bg-white/[0.04] border border-white/8 p-3.5">
                    <p className="text-[10px] text-white/35 uppercase tracking-wider mb-1.5">Derived address</p>
                    <p className="font-mono text-xs text-emerald-400 break-all">{importedAddress}</p>
                  </div>
                  <Button
                    className="w-full bg-emerald-500 hover:bg-emerald-400 text-white border-0"
                    onClick={() => {
                      const phrase = importPhrase.trim()
                      const words = phrase.split(/\s+/)
                      const isMnemonic = words.length === 12 || words.length === 24
                      saveManagedWallet(
                        isMnemonic
                          ? { walletAddress: importedAddress, mnemonic: phrase }
                          : { walletAddress: importedAddress, privateKey: phrase }
                      )
                    }}
                    disabled={saving}
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowRight className="h-4 w-4 mr-2" />}
                    {saving ? "Saving…" : "Save this wallet"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-white/40 hover:text-white/60 hover:bg-white/[0.04]"
                    onClick={resetImport}
                  >
                    Use a different phrase
                  </Button>
                </div>
              )}

              <div className="rounded-xl bg-white/[0.03] border border-white/8 p-3.5 flex gap-2.5">
                <ShieldAlert className="h-4 w-4 text-white/30 shrink-0 mt-0.5" />
                <p className="text-xs text-white/40 leading-relaxed">
                  Your key is sent over encrypted HTTPS and stored with AES-256-GCM encryption. Only the derived address is visible in your profile.
                </p>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
