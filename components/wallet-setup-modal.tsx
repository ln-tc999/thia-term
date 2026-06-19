"use client"

import { useState, useCallback } from "react"
import { generateMnemonic, mnemonicToAccount, privateKeyToAccount } from "viem/accounts"
import { english } from "viem/accounts"
import { useSession } from "next-auth/react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { ConnectButton } from "@rainbow-me/rainbowkit"
import { useAccount } from "wagmi"
import {
  Wallet, ShieldAlert, Eye, EyeOff, Copy, Check,
  AlertTriangle, ArrowRight, Loader2, KeyRound, Shield, Plus,
} from "lucide-react"
import { toast } from "sonner"

interface WalletSetupModalProps {
  open: boolean
  onClose: () => void
}

export function WalletSetupModal({ open, onClose }: WalletSetupModalProps) {
  const { update } = useSession()
  const { address: connectedAddress, isConnected } = useAccount()

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

  // ── Generate new wallet ──────────────────────────────────────────────────
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

  // ── Derive address from import phrase ────────────────────────────────────
  const deriveImportedAddress = () => {
    setImportError("")
    const phrase = importPhrase.trim()
    if (!phrase) return
    const words = phrase.split(/\s+/)
    if (words.length === 12 || words.length === 24) {
      try {
        setImportedAddress(mnemonicToAccount(phrase).address); return
      } catch {
        setImportError("Invalid seed phrase — check for typos.")
        setImportedAddress(null); return
      }
    }
    try {
      const pk = phrase.startsWith("0x") ? phrase : `0x${phrase}`
      setImportedAddress(privateKeyToAccount(pk as `0x${string}`).address)
    } catch {
      setImportError("Not a valid seed phrase or private key.")
      setImportedAddress(null)
    }
  }

  // ── Save managed wallet ──────────────────────────────────────────────────
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
      toast.error("Something went wrong.")
    } finally {
      setSaving(false)
    }
  }

  // ── Link external wallet (MetaMask) ─────────────────────────────────────
  const linkExternalWallet = async (addr: string) => {
    setSaving(true)
    try {
      const res = await fetch("/api/user", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: addr, walletType: "external" }),
      })
      const data = await res.json()
      if (data.success) {
        await update({ walletAddress: data.data?.walletAddress ?? addr.toLowerCase(), walletType: "external" })
        toast.success("External wallet linked.")
        onClose()
      } else {
        toast.error(data.error ?? "Failed to link wallet.")
      }
    } catch {
      toast.error("Something went wrong.")
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

        <div className="p-6 space-y-5">
          {/* Header */}
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-400/10 border border-emerald-400/20 flex items-center justify-center">
                <Wallet className="h-4 w-4 text-emerald-400" />
              </div>
              <h2 className="text-base font-semibold text-white">Change wallet</h2>
            </div>
            <p className="text-xs text-white/40 pl-[2.6rem]">Link a new wallet to your FlowLink account.</p>
          </div>

          <Tabs defaultValue="managed" className="space-y-4">
            <TabsList className="grid w-full grid-cols-2 bg-white/[0.04] border border-white/8 rounded-xl p-1 h-auto">
              <TabsTrigger
                value="managed"
                className="rounded-lg text-xs text-white/50 data-[state=active]:bg-emerald-500 data-[state=active]:text-white data-[state=active]:shadow-none py-2"
              >
                FlowLink Wallet
              </TabsTrigger>
              <TabsTrigger
                value="external"
                className="rounded-lg text-xs text-white/50 data-[state=active]:bg-white/[0.08] data-[state=active]:text-white data-[state=active]:shadow-none py-2"
              >
                External (MetaMask)
              </TabsTrigger>
            </TabsList>

            {/* ── Managed: Create tab ── */}
            <TabsContent value="managed" className="space-y-4">
              <div className="rounded-xl bg-emerald-400/5 border border-emerald-400/15 p-3 flex gap-2.5">
                <Shield className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                <p className="text-xs text-white/55 leading-relaxed">
                  Your key is encrypted with AES-256-GCM and stored securely. No MetaMask or reconnect needed.
                </p>
              </div>

              <Tabs defaultValue="create">
                <TabsList className="w-full bg-white/[0.03] border border-white/8 rounded-xl p-1 h-auto grid grid-cols-2">
                  <TabsTrigger value="create" className="rounded-lg text-xs text-white/50 data-[state=active]:bg-white/[0.08] data-[state=active]:text-white py-1.5">
                    Create new
                  </TabsTrigger>
                  <TabsTrigger value="import" className="rounded-lg text-xs text-white/50 data-[state=active]:bg-white/[0.08] data-[state=active]:text-white py-1.5">
                    Import
                  </TabsTrigger>
                </TabsList>

                {/* Create new */}
                <TabsContent value="create" className="space-y-4 pt-3">
                  {!mnemonic ? (
                    <div className="space-y-3">
                      <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.04] p-3 flex gap-2">
                        <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                        <p className="text-xs text-white/55">
                          You must save your seed phrase — it's the only way to recover your wallet independently.
                        </p>
                      </div>
                      <Button
                        className="w-full bg-emerald-500 hover:bg-emerald-400 text-white border-0"
                        onClick={generateWallet}
                      >
                        <Plus className="h-4 w-4 mr-2" />Generate wallet
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="rounded-xl bg-white/[0.04] border border-white/8 p-3">
                        <p className="text-[10px] text-white/35 uppercase tracking-wider mb-1.5">Wallet address</p>
                        <p className="font-mono text-xs text-emerald-400 break-all">{createdAddress}</p>
                      </div>

                      <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.04] p-3.5 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                            <p className="text-xs font-semibold text-amber-400">Secret Recovery Phrase</p>
                          </div>
                          <div className="flex gap-1">
                            <button onClick={copyMnemonic} className="p-1 rounded text-white/40 hover:text-white/70 transition-colors">
                              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                            </button>
                            <button onClick={() => setSeedVisible(!seedVisible)} className="p-1 rounded text-white/40 hover:text-white/70 transition-colors">
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
                            className="w-full h-16 rounded-lg border border-dashed border-amber-400/30 flex items-center justify-center gap-2 text-sm text-amber-400/70 hover:border-amber-400/50 transition-colors"
                          >
                            <Eye className="h-4 w-4" />Click to reveal
                          </button>
                        )}
                      </div>

                      <label className="flex items-start gap-2 cursor-pointer select-none">
                        <input type="checkbox" className="mt-0.5 accent-emerald-500 shrink-0" checked={confirmedBackup} onChange={(e) => setConfirmedBackup(e.target.checked)} />
                        <span className="text-xs text-white/45">I've saved my seed phrase somewhere safe.</span>
                      </label>

                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={generateWallet} className="flex-1 bg-transparent border-white/10 text-white/60 hover:bg-white/[0.06] hover:text-white hover:border-white/20">
                          Regenerate
                        </Button>
                        <Button
                          size="sm"
                          className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-white border-0"
                          disabled={!confirmedBackup || saving}
                          onClick={() => saveManagedWallet({ walletAddress: createdAddress!, mnemonic: mnemonic! })}
                        >
                          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <ArrowRight className="h-4 w-4 mr-1.5" />}
                          {saving ? "Saving…" : "Use this wallet"}
                        </Button>
                      </div>
                    </div>
                  )}
                </TabsContent>

                {/* Import */}
                <TabsContent value="import" className="space-y-4 pt-3">
                  <div className="space-y-1.5">
                    <p className="text-xs text-white/40 flex items-center gap-1">
                      <KeyRound className="h-3 w-3" />Seed phrase (12 or 24 words) or private key
                    </p>
                    <Textarea
                      placeholder="word1 word2 word3 … or 0xprivatekey"
                      className="font-mono text-xs resize-none h-20 bg-white/[0.04] border-white/10 text-white placeholder:text-white/20 focus:border-emerald-400/40"
                      value={importPhrase}
                      onChange={(e) => { setImportPhrase(e.target.value); setImportedAddress(null); setImportError("") }}
                    />
                    {importError && <p className="text-xs text-red-400">{importError}</p>}
                  </div>

                  {!importedAddress ? (
                    <Button
                      variant="outline"
                      className="w-full bg-transparent border-white/10 text-white/60 hover:bg-white/[0.06] hover:text-white hover:border-white/20"
                      onClick={deriveImportedAddress}
                      disabled={!importPhrase.trim()}
                    >
                      Derive Address
                    </Button>
                  ) : (
                    <div className="space-y-3">
                      <div className="rounded-xl bg-white/[0.04] border border-white/8 p-3">
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
                      <Button variant="ghost" size="sm" className="w-full text-white/40 hover:text-white/60 hover:bg-white/[0.04]" onClick={() => { setImportedAddress(null); setImportPhrase("") }}>
                        Use a different phrase
                      </Button>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </TabsContent>

            {/* ── External wallet tab ── */}
            <TabsContent value="external" className="space-y-4">
              <div className="rounded-xl bg-white/[0.03] border border-white/8 p-3 flex gap-2.5">
                <ShieldAlert className="h-4 w-4 text-white/30 shrink-0 mt-0.5" />
                <p className="text-xs text-white/45 leading-relaxed">
                  External wallets require MetaMask to be connected for every on-chain action. FlowLink cannot sign transactions automatically on your behalf.
                </p>
              </div>

              <div className="flex justify-center py-1">
                <ConnectButton label="Connect MetaMask" accountStatus="address" showBalance={false} />
              </div>

              {isConnected && connectedAddress && (
                <div className="space-y-3">
                  <div className="rounded-xl bg-white/[0.04] border border-white/8 p-3">
                    <p className="text-[10px] text-white/35 uppercase tracking-wider mb-1.5">Connected wallet</p>
                    <p className="font-mono text-xs text-white/80 break-all">{connectedAddress}</p>
                  </div>
                  <Button
                    className="w-full bg-white/[0.08] hover:bg-white/[0.12] text-white border border-white/10"
                    onClick={() => linkExternalWallet(connectedAddress)}
                    disabled={saving}
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowRight className="h-4 w-4 mr-2" />}
                    {saving ? "Linking…" : "Link this wallet"}
                  </Button>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  )
}
