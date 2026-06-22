"use client"

import { useState, useEffect, useRef } from "react"
import {
  Search, User, Lock, Bell, Building2, Users, Shield,
  CreditCard, Plug, Coins, Hash, Store, Wallet, Globe, FileText,
  ChevronRight, ArrowLeft, Loader2, Check, Eye, EyeOff,
  Camera, Copy, Unlink, Plus, Calendar, Mail, KeyRound, AlertTriangle, Download,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { useSession, signOut } from "next-auth/react"
import { toast } from "sonner"
import { WalletSetupModal } from "@/components/wallet-setup-modal"

// ─── Panel definitions ─────────────────────────────────────────────────────

type PanelId =
  | "personal" | "auth" | "notifications"
  | "company" | "team" | "security" | "subscription" | "integrations"
  | "stablecoins" | "wallet-chain" | "payment-links-cfg" | "compliance" | "invoices-cfg" | "vendors"
  | "exports"

const settingsSections = [
  {
    title: "Personal",
    items: [
      { id: "personal" as PanelId, icon: User, title: "Personal Details", desc: "Edit your name and email address to keep your profile up to date." },
      { id: "auth" as PanelId, icon: Lock, title: "Authentication", desc: "Re-authenticate to change your password or two-factor settings." },
      { id: "notifications" as PanelId, icon: Bell, title: "Notifications", desc: "Manage which email alerts and updates you'd like to receive." },
    ],
  },
  {
    title: "Company",
    items: [
      { id: "company" as PanelId, icon: Building2, title: "Company Details", desc: "Update your company information used on all future payables & receivables." },
      { id: "team" as PanelId, icon: Users, title: "Team", desc: "Manage team roles and permissions." },
      { id: "security" as PanelId, icon: Shield, title: "Team Security", desc: "Manage mandatory team authentication." },
      { id: "subscription" as PanelId, icon: CreditCard, title: "Subscription", desc: "View your current plan, billing history, and available upgrades." },
      { id: "integrations" as PanelId, icon: Plug, title: "Integrations", desc: "Connect Thia-Term to accounting software and other tools." },
    ],
  },
  {
    title: "Product",
    items: [
      { id: "stablecoins" as PanelId, icon: Coins, title: "Stablecoin Settings", desc: "Configure accepted stablecoins and token preferences for payments." },
      { id: "wallet-chain" as PanelId, icon: Wallet, title: "Wallet & Chain", desc: "Manage your connected wallet and T3N settings." },
      { id: "payment-links-cfg" as PanelId, icon: Globe, title: "Payment Links", desc: "Configure default settings for your payment links." },
      { id: "compliance" as PanelId, icon: Shield, title: "Compliance", desc: "Manage KYC/AML rules and compliance thresholds." },
      { id: "invoices-cfg" as PanelId, icon: FileText, title: "Invoice Settings", desc: "Set invoice numbering, templates, and due date defaults." },
      { id: "vendors" as PanelId, icon: Store, title: "Vendor Policy", desc: "Choose who can send bills and block unauthorized vendors." },
    ],
  },
  {
    title: "Data",
    items: [
      { id: "exports" as PanelId, icon: FileText, title: "Export & Reports", desc: "Download your account statement, payments, invoices, and payroll as CSV or PDF." },
    ],
  },
]

// ─── Shared panel header ───────────────────────────────────────────────────

function PanelHeader({ title, icon: Icon, onBack }: { title: string; icon: React.ComponentType<{ className?: string }>; onBack: () => void }) {
  return (
    <div className="flex items-center gap-3 pb-5 border-b border-white/[0.06]">
      <button
        onClick={onBack}
        className="p-1.5 rounded-lg bg-white/[0.04] border border-white/10 text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
      </button>
      <div className="w-9 h-9 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center">
        <Icon className="w-5 h-5 text-sky-400" />
      </div>
      <h2 className="text-lg font-bold text-white">{title}</h2>
    </div>
  )
}

// ─── Personal Details Panel ────────────────────────────────────────────────

function PersonalDetailsPanel({ onBack }: { onBack: () => void }) {
  const { data: session, update } = useSession()
  const [name, setName] = useState(session?.user?.name ?? "")
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null)

  // Avatar
  const fileRef = useRef<HTMLInputElement>(null)
  const [avatarSaving, setAvatarSaving] = useState(false)
  const [avatarMsg, setAvatarMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null)

  // Wallet
  const [walletAddress, setWalletAddress] = useState<string | null>((session?.user as any)?.walletAddress ?? null)
  const [walletType, setWalletType] = useState<string | null>((session?.user as any)?.walletType ?? null)
  const [walletModalOpen, setWalletModalOpen] = useState(false)
  const [walletUnlinking, setWalletUnlinking] = useState(false)
  const [walletCopied, setWalletCopied] = useState(false)
  const [walletMsg, setWalletMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null)

  // Seed phrase reveal
  const [seedLoading, setSeedLoading] = useState(false)
  const [seedPhrase, setSeedPhrase] = useState<string | null>(null)
  const [seedVisible, setSeedVisible] = useState(false)
  const [seedCopied, setSeedCopied] = useState(false)

  useEffect(() => { setName(session?.user?.name ?? "") }, [session?.user?.name])
  useEffect(() => {
    setWalletAddress((session?.user as any)?.walletAddress ?? null)
    setWalletType((session?.user as any)?.walletType ?? null)
  }, [(session?.user as any)?.walletAddress, (session?.user as any)?.walletType])

  // ── Profile info save ──────────────────────────────────────────────────────
  const save = async () => {
    setSaving(true); setMsg(null)
    try {
      const res = await fetch("/api/user", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      if (data.success) {
        await update({ name })
        setMsg({ type: "ok", text: "Changes saved." })
      } else {
        setMsg({ type: "err", text: data.error ?? "Failed to save." })
      }
    } catch {
      setMsg({ type: "err", text: "Something went wrong." })
    } finally {
      setSaving(false)
    }
  }

  // ── Avatar upload ──────────────────────────────────────────────────────────
  const handleAvatarFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setAvatarMsg({ type: "err", text: "Please select an image file." }); return
    }
    setAvatarSaving(true); setAvatarMsg(null)
    const reader = new FileReader()
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string
      try {
        const res = await fetch("/api/user/avatar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: dataUrl }),
        })
        const data = await res.json()
        if (data.success) {
          await update({ image: data.data.image })
          setAvatarMsg({ type: "ok", text: "Avatar updated." })
        } else {
          setAvatarMsg({ type: "err", text: data.error ?? "Failed to upload." })
        }
      } catch {
        setAvatarMsg({ type: "err", text: "Upload failed." })
      } finally {
        setAvatarSaving(false)
      }
    }
    reader.readAsDataURL(file)
  }

  // ── Wallet actions ─────────────────────────────────────────────────────────
  const unlinkWallet = async () => {
    setWalletUnlinking(true); setWalletMsg(null)
    try {
      const res = await fetch("/api/user/wallet", { method: "DELETE" })
      const data = await res.json()
      if (data.success) {
        await update({ walletAddress: null, walletType: null })
        setWalletAddress(null); setWalletType(null); setSeedPhrase(null)
        setWalletMsg({ type: "ok", text: "Wallet unlinked." })
      } else {
        setWalletMsg({ type: "err", text: data.error ?? "Failed to unlink." })
      }
    } catch {
      setWalletMsg({ type: "err", text: "Something went wrong." })
    } finally {
      setWalletUnlinking(false)
    }
  }

  const loadSeedPhrase = async () => {
    setSeedLoading(true)
    try {
      const res = await fetch("/api/user/wallet/seed")
      if (res.status === 401) {
        toast.error("Session expired. Please sign in again.")
        signOut({ callbackUrl: "/login" })
        return
      }
      const data = await res.json()
      if (data.success) {
        setSeedPhrase(data.mnemonic)
      } else {
        setWalletMsg({ type: "err", text: data.error ?? "Could not retrieve seed phrase." })
      }
    } catch {
      setWalletMsg({ type: "err", text: "Something went wrong." })
    } finally {
      setSeedLoading(false)
    }
  }

  const copySeed = () => {
    if (!seedPhrase) return
    navigator.clipboard.writeText(seedPhrase)
    setSeedCopied(true)
    setTimeout(() => setSeedCopied(false), 2000)
  }

  const copyWallet = () => {
    if (!walletAddress) return
    navigator.clipboard.writeText(walletAddress)
    setWalletCopied(true)
    setTimeout(() => setWalletCopied(false), 2000)
  }

  const isDirty = name !== (session?.user?.name ?? "")
  const avatarUrl = (session?.user as any)?.image ?? session?.user?.image
  const initials = (session?.user?.name ?? session?.user?.email ?? "?")
    .split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase()
  const memberSince = (session?.user as any)?.createdAt
    ? new Date((session?.user as any).createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : null

  return (
    <div className="space-y-8">
      <PanelHeader title="Personal Details" icon={User} onBack={onBack} />

      {/* ── Avatar ── */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Profile Picture</h3>
        <div className="flex items-center gap-4">
          <div className="relative group">
            <div className="w-16 h-16 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center overflow-hidden">
              {avatarUrl ? (
                <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
              ) : (
                <span className="text-sky-400 font-bold text-xl">{initials}</span>
              )}
            </div>
            <button
              onClick={() => fileRef.current?.click()}
              className="absolute inset-0 rounded-2xl bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
              disabled={avatarSaving}
            >
              {avatarSaving ? <Loader2 className="h-4 w-4 text-white animate-spin" /> : <Camera className="h-4 w-4 text-white" />}
            </button>
          </div>
          <div>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={avatarSaving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white/[0.04] border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white rounded-xl transition-colors disabled:opacity-50"
            >
              {avatarSaving ? <><Loader2 className="h-3 w-3 animate-spin" />Uploading…</> : <><Camera className="h-3 w-3" />Change photo</>}
            </button>
            <p className="text-xs text-slate-500 mt-1">JPG, PNG, or WebP · max 750 KB</p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleAvatarFile(f) }}
          />
        </div>
        {avatarMsg && (
          <p className={`text-xs flex items-center gap-1 ${avatarMsg.type === "ok" ? "text-sky-400" : "text-red-400"}`}>
            {avatarMsg.type === "ok" && <Check className="h-3 w-3" />}
            {avatarMsg.text}
          </p>
        )}
      </section>

      <div className="border-t border-white/[0.06]" />

      {/* ── Profile info ── */}
      <section className="space-y-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Profile Info</h3>
        <div>
          <Label className="text-xs text-slate-400">Display Name</Label>
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Your name"
            className="mt-1.5 bg-white/[0.04] border-white/10 text-white placeholder:text-slate-600 focus:border-sky-500/50 rounded-xl"
          />
        </div>

        <div>
          <Label className="text-xs text-slate-400 flex items-center gap-1.5">
            <Mail className="h-3.5 w-3.5 text-slate-500" />
            Email <span className="text-slate-500 font-normal">(read-only)</span>
          </Label>
          <Input
            value={session?.user?.email ?? "—"}
            readOnly
            className="mt-1.5 bg-white/[0.02] border-white/[0.06] text-slate-500 rounded-xl cursor-default"
          />
          <p className="text-xs text-slate-500 mt-1">Email cannot be changed here. Contact support if needed.</p>
        </div>

        {memberSince && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Calendar className="h-3.5 w-3.5" />
            Member since {memberSince}
          </div>
        )}

        {msg && (
          <p className={`text-sm flex items-center gap-1.5 ${msg.type === "ok" ? "text-sky-400" : "text-red-400"}`}>
            {msg.type === "ok" && <Check className="h-4 w-4" />}
            {msg.text}
          </p>
        )}

        <button
          onClick={save}
          disabled={!isDirty || saving}
          className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-sky-600 to-sky-500 hover:from-sky-500 hover:to-sky-400 text-white rounded-xl text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving…</> : "Save Changes"}
        </button>
      </section>

      <div className="border-t border-white/[0.06]" />

      {/* ── Linked Wallet ── */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Linked Wallet</h3>
        {walletAddress ? (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center shrink-0">
                <Wallet className="h-4 w-4 text-sky-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-xs text-slate-400 font-medium">Connected wallet</p>
                  {walletType === "managed" ? (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20">Thia-Term managed</span>
                  ) : walletType === "external" ? (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-white/[0.04] text-slate-400 border border-white/10">External</span>
                  ) : null}
                </div>
                <p className="font-mono text-xs text-slate-300 truncate">{walletAddress}</p>
              </div>
            </div>

            {/* Wallet address copy display */}
            <div className="font-mono text-xs bg-white/[0.04] border border-white/10 text-slate-300 rounded-xl p-3 break-all">
              {walletAddress}
            </div>

            <div className="flex gap-2">
              <button
                onClick={copyWallet}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs bg-sky-500/10 border border-sky-500/20 text-sky-400 hover:bg-sky-500/20 rounded-xl transition-colors"
              >
                {walletCopied ? <><Check className="h-3 w-3" />Copied</> : <><Copy className="h-3 w-3" />Copy</>}
              </button>
              <button
                onClick={() => setWalletModalOpen(true)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs bg-white/[0.04] border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white rounded-xl transition-colors"
              >
                <Wallet className="h-3 w-3" />Change
              </button>
              <button
                onClick={unlinkWallet}
                disabled={walletUnlinking}
                className="inline-flex items-center justify-center px-3 py-1.5 text-xs bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 rounded-xl transition-colors disabled:opacity-50"
              >
                {walletUnlinking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unlink className="h-3 w-3" />}
              </button>
            </div>

            {/* Seed phrase section — managed wallets only */}
            {walletType === "managed" && (
              <div className="pt-3 border-t border-white/[0.06] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <KeyRound className="h-3.5 w-3.5 text-slate-500" />
                    <p className="text-xs font-medium text-slate-400">Secret Recovery Phrase</p>
                  </div>
                  {!seedPhrase ? (
                    <button
                      onClick={loadSeedPhrase}
                      disabled={seedLoading}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-white/[0.04] border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white rounded-xl transition-colors disabled:opacity-50"
                    >
                      {seedLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
                      {seedLoading ? "Loading…" : "Reveal"}
                    </button>
                  ) : (
                    <div className="flex gap-1">
                      <button
                        onClick={copySeed}
                        className="p-1 rounded-lg text-slate-500 hover:text-sky-400 transition-colors"
                      >
                        {seedCopied ? <Check className="h-3.5 w-3.5 text-sky-400" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        onClick={() => setSeedVisible(!seedVisible)}
                        className="p-1 rounded-lg text-slate-500 hover:text-slate-300 transition-colors"
                      >
                        {seedVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        onClick={() => { setSeedPhrase(null); setSeedVisible(false) }}
                        className="p-1 rounded-lg text-slate-500 hover:text-slate-300 transition-colors text-xs"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>

                {seedPhrase && (
                  <div className="space-y-2">
                    <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-2.5 flex gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                      <p className="text-[10px] text-amber-400/80">Never share this phrase. Anyone with it controls your wallet.</p>
                    </div>
                    {seedVisible ? (
                      <div className="grid grid-cols-3 gap-1.5">
                        {seedPhrase.split(" ").map((word, i) => (
                          <div key={i} className="flex items-center gap-1 bg-white/[0.04] border border-white/[0.06] rounded-lg px-2 py-1.5">
                            <span className="text-[10px] text-slate-600 w-4 shrink-0">{i + 1}.</span>
                            <span className="text-xs font-mono text-slate-300">{word}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <button
                        onClick={() => setSeedVisible(true)}
                        className="w-full h-14 rounded-xl border border-dashed border-amber-500/30 flex items-center justify-center gap-2 text-xs text-amber-400/70 hover:bg-amber-500/5 hover:text-amber-400 transition-colors"
                      >
                        <Eye className="h-3.5 w-3.5" />Click to show phrase
                      </button>
                    )}
                  </div>
                )}

                {!seedPhrase && (
                  <p className="text-[10px] text-slate-500">View your 12-word seed phrase. Keep it safe — it gives full access to your wallet.</p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] p-6 flex flex-col items-center gap-3 text-center">
            <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center">
              <Wallet className="h-5 w-5 text-sky-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">No wallet linked</p>
              <p className="text-xs text-slate-500 mt-0.5">Connect a wallet to send and receive crypto payments.</p>
            </div>
            <button
              onClick={() => setWalletModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-sky-600 to-sky-500 hover:from-sky-500 hover:to-sky-400 text-white rounded-xl text-sm font-medium transition-all"
            >
              <Plus className="h-3.5 w-3.5" />Link wallet
            </button>
          </div>
        )}
        {walletMsg && (
          <p className={`text-xs flex items-center gap-1 ${walletMsg.type === "ok" ? "text-sky-400" : "text-red-400"}`}>
            {walletMsg.type === "ok" && <Check className="h-3 w-3" />}
            {walletMsg.text}
          </p>
        )}
      </section>

      <WalletSetupModal
        open={walletModalOpen}
        onClose={async () => {
          setWalletModalOpen(false)
          // Fetch the freshest wallet address from the server
          try {
            const res = await fetch("/api/user")
            const data = await res.json()
            if (data.success) setWalletAddress(data.data?.walletAddress ?? null)
          } catch { /* ignore */ }
        }}
      />
    </div>
  )
}

// ─── Authentication Panel ──────────────────────────────────────────────────

function AuthenticationPanel({ onBack }: { onBack: () => void }) {
  const { data: session } = useSession()
  const [form, setForm] = useState({ current: "", newPw: "", confirm: "" })
  const [show, setShow] = useState({ current: false, newPw: false, confirm: false })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null)

  const isGoogleOnly = !!(session?.user?.email) // heuristic: all users might not have password

  const save = async () => {
    if (form.newPw !== form.confirm) {
      setMsg({ type: "err", text: "Passwords do not match." }); return
    }
    if (form.newPw.length < 8) {
      setMsg({ type: "err", text: "Password must be at least 8 characters." }); return
    }
    setSaving(true); setMsg(null)
    try {
      const res = await fetch("/api/user/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: form.current || undefined, newPassword: form.newPw }),
      })
      const data = await res.json()
      if (data.success) {
        setMsg({ type: "ok", text: "Password updated successfully." })
        setForm({ current: "", newPw: "", confirm: "" })
      } else {
        setMsg({ type: "err", text: data.error ?? "Failed to update password." })
      }
    } catch {
      setMsg({ type: "err", text: "Something went wrong." })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <PanelHeader title="Authentication" icon={Lock} onBack={onBack} />

      <div className="space-y-5">
        <div className="p-4 bg-white/[0.03] border border-white/[0.06] rounded-2xl text-sm text-slate-400">
          Set or change your password. If you signed up via Google, you can add a password to enable email login as well.
        </div>

        <div>
          <Label className="text-xs text-slate-400">Current Password</Label>
          <div className="relative mt-1.5">
            <Input
              type={show.current ? "text" : "password"}
              value={form.current}
              onChange={e => setForm({ ...form, current: e.target.value })}
              placeholder="Enter current password (if set)"
              className="pr-10 bg-white/[0.04] border-white/10 text-white placeholder:text-slate-600 focus:border-sky-500/50 rounded-xl"
            />
            <button
              type="button"
              onClick={() => setShow(s => ({ ...s, current: !s.current }))}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
            >
              {show.current ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-1">Leave blank if you don't have a password yet.</p>
        </div>

        <div>
          <Label className="text-xs text-slate-400">New Password</Label>
          <div className="relative mt-1.5">
            <Input
              type={show.newPw ? "text" : "password"}
              value={form.newPw}
              onChange={e => setForm({ ...form, newPw: e.target.value })}
              placeholder="At least 8 characters"
              className="pr-10 bg-white/[0.04] border-white/10 text-white placeholder:text-slate-600 focus:border-sky-500/50 rounded-xl"
            />
            <button
              type="button"
              onClick={() => setShow(s => ({ ...s, newPw: !s.newPw }))}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
            >
              {show.newPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {form.newPw.length > 0 && (
            <div className="mt-1.5 h-1 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  form.newPw.length < 8 ? "w-1/4 bg-red-500" :
                  form.newPw.length < 12 ? "w-1/2 bg-amber-500" :
                  "w-full bg-sky-500"
                }`}
              />
            </div>
          )}
        </div>

        <div>
          <Label className="text-xs text-slate-400">Confirm New Password</Label>
          <div className="relative mt-1.5">
            <Input
              type={show.confirm ? "text" : "password"}
              value={form.confirm}
              onChange={e => setForm({ ...form, confirm: e.target.value })}
              placeholder="Repeat new password"
              className={`pr-10 bg-white/[0.04] border-white/10 text-white placeholder:text-slate-600 focus:border-sky-500/50 rounded-xl ${form.confirm && form.confirm !== form.newPw ? "border-red-500/50" : ""}`}
            />
            <button
              type="button"
              onClick={() => setShow(s => ({ ...s, confirm: !s.confirm }))}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
            >
              {show.confirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {form.confirm && form.confirm !== form.newPw && (
            <p className="text-xs text-red-400 mt-1">Passwords do not match.</p>
          )}
        </div>

        {msg && (
          <p className={`text-sm flex items-center gap-1.5 ${msg.type === "ok" ? "text-sky-400" : "text-red-400"}`}>
            {msg.type === "ok" && <Check className="h-4 w-4" />}
            {msg.text}
          </p>
        )}

        <button
          onClick={save}
          disabled={!form.newPw || !form.confirm || saving}
          className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-sky-600 to-sky-500 hover:from-sky-500 hover:to-sky-400 text-white rounded-xl text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving…</> : "Update Password"}
        </button>
      </div>
    </div>
  )
}

// ─── Notifications Panel ───────────────────────────────────────────────────

function NotificationsPanel({ onBack }: { onBack: () => void }) {
  const [prefs, setPrefs] = useState({
    paymentReceived: true,
    invoicePaid: true,
    payrollCompleted: true,
    complianceAlert: true,
    productUpdates: false,
    marketing: false,
  })
  const [saved, setSaved] = useState(false)

  const toggle = (key: keyof typeof prefs) => setPrefs(p => ({ ...p, [key]: !p[key] }))
  const save = () => { setSaved(true); setTimeout(() => setSaved(false), 2000) }

  const rows = [
    { key: "paymentReceived" as const, label: "Payment received", desc: "When someone pays via your payment link" },
    { key: "invoicePaid" as const, label: "Invoice paid", desc: "When a client pays an invoice" },
    { key: "payrollCompleted" as const, label: "Payroll completed", desc: "When a payroll batch finishes" },
    { key: "complianceAlert" as const, label: "Compliance alerts", desc: "KYC failures, sanctions matches" },
    { key: "productUpdates" as const, label: "Product updates", desc: "New features and improvements" },
    { key: "marketing" as const, label: "Marketing emails", desc: "Tips, guides, and promotions" },
  ]

  return (
    <div className="space-y-6">
      <PanelHeader title="Notifications" icon={Bell} onBack={onBack} />
      <div className="divide-y divide-white/[0.06]">
        {rows.map(r => (
          <div key={r.key} className="flex items-center justify-between py-4">
            <div>
              <p className="text-sm font-medium text-slate-200">{r.label}</p>
              <p className="text-xs text-slate-500 mt-0.5">{r.desc}</p>
            </div>
            <Switch checked={prefs[r.key]} onCheckedChange={() => toggle(r.key)} />
          </div>
        ))}
      </div>
      <button
        onClick={save}
        className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-sky-600 to-sky-500 hover:from-sky-500 hover:to-sky-400 text-white rounded-xl text-sm font-medium transition-all"
      >
        {saved ? <><Check className="h-4 w-4" />Saved</> : "Save Preferences"}
      </button>
    </div>
  )
}

// ─── Coming Soon Panel ─────────────────────────────────────────────────────

function ComingSoonPanel({ title, icon: Icon, onBack }: { title: string; icon: React.ComponentType<{ className?: string }>; onBack: () => void }) {
  return (
    <div className="space-y-6">
      <PanelHeader title={title} icon={Icon} onBack={onBack} />
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-14 h-14 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center mb-4">
          <Icon className="w-7 h-7 text-sky-400" />
        </div>
        <p className="text-white font-semibold">Coming soon</p>
        <p className="text-sm text-slate-500 mt-1 max-w-xs">This section is under development. Check back in a future update.</p>
      </div>
    </div>
  )
}

// ─── Exports Panel ────────────────────────────────────────────────────────

function ExportsPanel({ onBack }: { onBack: () => void }) {
  const [loading, setLoading] = useState<string | null>(null)
  const download = async (type: string, filename: string, isHtml = false) => {
    setLoading(type)
    try {
      const res = await fetch(`/api/reports?type=${type}`, { credentials: 'include' })
      if (!res.ok) { alert('Export failed — please try again.'); return }
      const text = await res.text()
      const blob = new Blob([text], { type: isHtml ? 'text/html;charset=utf-8' : '﻿text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      if (isHtml) {
        const tab = window.open(url, '_blank')
        if (!tab) { const a = document.createElement('a'); a.href = url; a.download = filename; a.click() }
      } else {
        const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a)
      }
      setTimeout(() => URL.revokeObjectURL(url), 30000)
    } catch { alert('Export failed.') } finally { setLoading(null) }
  }

  const reports = [
    {
      type: 'statement',
      label: 'Account Statement',
      desc: 'Full summary — payments, invoices, links, wallet. Opens as a printable page (save as PDF).',
      isHtml: true,
      filename: `thia-term-statement-${new Date().toISOString().split('T')[0]}.html`,
    },
    {
      type: 'payments',
      label: 'Payments Export',
      desc: 'Export all payment transactions as CSV.',
      isHtml: false,
      filename: `thia-term-payments-${new Date().toISOString().split('T')[0]}.csv`,
    },
    {
      type: 'invoices',
      label: 'Invoices Export',
      desc: 'Export all invoices as CSV.',
      isHtml: false,
      filename: `thia-term-invoices-${new Date().toISOString().split('T')[0]}.csv`,
    },
    {
      type: 'payroll',
      label: 'Payroll Export',
      desc: 'Export all payroll records as CSV.',
      isHtml: false,
      filename: `thia-term-payroll-${new Date().toISOString().split('T')[0]}.csv`,
    },
  ]

  return (
    <div className="space-y-5">
      <PanelHeader title="Export & Reports" icon={Download} onBack={onBack} />
      <div className="space-y-3">
        {reports.map(r => (
          <div key={r.type} className="flex items-center justify-between gap-4 p-4 bg-white/[0.03] border border-white/[0.06] rounded-xl hover:bg-white/[0.05] transition-colors">
            <div className="min-w-0">
              <p className="text-white font-medium text-sm">{r.label}</p>
              <p className="text-slate-500 text-xs mt-0.5">{r.desc}</p>
            </div>
            <Button
              size="sm"
              disabled={loading === r.type}
              onClick={() => download(r.type, r.filename, r.isHtml)}
              className="shrink-0 bg-white/[0.06] border border-white/10 text-slate-300 hover:bg-sky-500/10 hover:border-sky-500/30 hover:text-sky-400 rounded-xl gap-2 transition-colors"
            >
              {loading === r.type
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Download className="h-3.5 w-3.5" />}
              {r.isHtml ? 'Open' : 'Download'}
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────

export function SettingsModule() {
  const [search, setSearch] = useState("")
  const [activePanel, setActivePanel] = useState<PanelId | null>(null)

  const filtered = settingsSections
    .map(section => ({
      ...section,
      items: section.items.filter(item =>
        item.title.toLowerCase().includes(search.toLowerCase()) ||
        item.desc.toLowerCase().includes(search.toLowerCase())
      ),
    }))
    .filter(section => section.items.length > 0)

  const renderPanel = () => {
    switch (activePanel) {
      case "personal":       return <PersonalDetailsPanel onBack={() => setActivePanel(null)} />
      case "auth":           return <AuthenticationPanel onBack={() => setActivePanel(null)} />
      case "notifications":  return <NotificationsPanel onBack={() => setActivePanel(null)} />
      case "exports":        return <ExportsPanel onBack={() => setActivePanel(null)} />
      default: {
        const all = settingsSections.flatMap(s => s.items)
        const item = all.find(i => i.id === activePanel)
        if (!item) return null
        return <ComingSoonPanel title={item.title} icon={item.icon} onBack={() => setActivePanel(null)} />
      }
    }
  }

  if (activePanel) {
    return (
      <div className="max-w-xl mx-auto py-8 px-6">
        {renderPanel()}
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto py-8 px-6">
      {/* Search */}
      <div className="relative mb-8">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search settings…"
          className="w-full pl-11 pr-4 py-3 bg-white/[0.04] border border-white/10 rounded-xl text-white placeholder:text-slate-600 text-sm focus:outline-none focus:border-sky-500/50 transition-colors"
        />
      </div>

      {/* Sections */}
      <div className="space-y-10">
        {filtered.map(section => (
          <div key={section.title}>
            <h2 className="text-xl font-bold text-white mb-5">{section.title}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {section.items.map(item => (
                <button
                  key={item.id}
                  onClick={() => setActivePanel(item.id)}
                  className="flex items-start gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.05] p-5 cursor-pointer transition-all text-left group"
                >
                  <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center shrink-0 group-hover:bg-sky-500/15 transition-colors">
                    <item.icon className="w-5 h-5 text-sky-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-slate-200">{item.title}</h3>
                      <ChevronRight className="w-4 h-4 text-slate-600 shrink-0 group-hover:text-slate-400 transition-colors" />
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed mt-0.5">{item.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <p className="text-slate-500 text-sm text-center py-12">No settings found for "{search}"</p>
        )}
      </div>
    </div>
  )
}
