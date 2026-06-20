"use client"

import React, { useState, useEffect, useRef } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Shield, ShieldCheck, Users, Bell,
  LogOut, Wallet, X, Link2,
  LayoutDashboard, FileText, Send, Settings, Camera, Loader2,
  CreditCard, AlertCircle
} from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PaymentLinksModule } from "@/components/payment-links-module"
import { ComplianceVaultsModule } from "@/components/compliance-vaults-module"
import { PayrollRailsModule } from "@/components/payroll-rails-module"
import { AIInvoiceModule } from "@/components/ai-invoice-module"
import { SettingsModule } from "@/components/settings-module"
import { VendorsModule } from "@/components/vendors-module"
import { WalletSetupModal } from "@/components/wallet-setup-modal"
import { WalletOnboardingModal } from "@/components/wallet-onboarding-modal"
import { useSession, signOut } from "next-auth/react"
import { useAccount } from "wagmi"
import { ConnectButton } from "@rainbow-me/rainbowkit"
import { cn } from "@/lib/utils"

interface DashboardLayoutProps {
  children: React.ReactNode
}

interface AppNotification {
  id: string
  type: string
  title: string
  message: string
  read: boolean
  link: string | null
  createdAt: string
}

const notifTypeIcon: Record<string, React.ElementType> = {
  payment: CreditCard,
  invoice: FileText,
  payroll: Users,
  compliance: Shield,
  system: AlertCircle,
}

function NotificationBell({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<AppNotification[]>([])
  const [unread, setUnread] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  const fetchNotifs = async () => {
    try {
      const res = await fetch('/api/notifications')
      if (!res.ok) return
      const json = await res.json()
      setItems(json.data ?? [])
      setUnread(json.unreadCount ?? 0)
    } catch {}
  }

  useEffect(() => { fetchNotifs() }, [])

  // Poll every 60s
  useEffect(() => {
    const id = setInterval(fetchNotifs, 60_000)
    return () => clearInterval(id)
  }, [])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleOpen = async () => {
    setOpen(o => !o)
    if (!open && unread > 0) {
      // Mark all read optimistically
      setUnread(0)
      setItems(prev => prev.map(n => ({ ...n, read: true })))
      await fetch('/api/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    }
  }

  const handleClick = (item: AppNotification) => {
    setOpen(false)
    if (item.link) onNavigate(item.link)
  }


  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  }

  return (
    <div ref={ref} className="relative">
      <Button
        variant="ghost"
        size="sm"
        onClick={handleOpen}
        className="text-slate-600 hover:text-slate-300 hover:bg-white/[0.04] h-8 w-8 p-0 relative"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </Button>

      {open && (
        <div
          className="absolute right-0 top-10 w-80 rounded-2xl border border-white/[0.08] shadow-2xl shadow-black/60 z-50 overflow-hidden"
          style={{ background: 'rgba(10, 18, 32, 0.97)', backdropFilter: 'blur(20px)' }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
            <span className="text-sm font-semibold text-white">Notifications</span>
            <button onClick={() => setOpen(false)} className="text-slate-600 hover:text-slate-300">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="max-h-[360px] overflow-y-auto">
            {items.length === 0 ? (
              <div className="py-10 text-center text-slate-600 text-sm">No notifications yet</div>
            ) : (
              items.map(item => {
                const Icon = notifTypeIcon[item.type] ?? AlertCircle
                return (
                  <button
                    key={item.id}
                    onClick={() => handleClick(item)}
                    className="w-full flex items-start gap-3 px-4 py-3 hover:bg-white/[0.04] transition-colors text-left border-b border-white/[0.04] last:border-0"
                  >
                    <div className={`mt-0.5 p-1.5 rounded-lg shrink-0 ${item.read ? 'bg-white/[0.05]' : 'bg-emerald-500/15'}`}>
                      <Icon className={`h-3.5 w-3.5 ${item.read ? 'text-slate-500' : 'text-emerald-400'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-medium truncate ${item.read ? 'text-slate-400' : 'text-white'}`}>{item.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-2 leading-relaxed">{item.message}</p>
                      <p className="text-[10px] text-slate-700 mt-1">{timeAgo(item.createdAt)}</p>
                    </div>
                    {!item.read && (
                      <span className="mt-2 w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const navigation = [
  { id: "overview", name: "Dashboard", icon: LayoutDashboard },
  { id: "payment-links", name: "Payment Links", icon: Link2 },
  { id: "ai-invoices", name: "Invoicing", icon: FileText, badge: "AI" },
  { id: "payroll-rails", name: "Payroll", icon: Users },
  { id: "compliance-vaults", name: "Vaults", icon: Shield },
  { id: "vendor-verify", name: "VendorVerify", icon: ShieldCheck, badge: "T3" },
  { id: "settings", name: "Settings", icon: Settings },
]

function WalletBanner({ onSetup }: { onSetup: () => void }) {
  const { data: session } = useSession()
  const [dismissed, setDismissed] = useState(false)

  const sessionWallet = session?.user?.walletAddress as string | null | undefined

  if (sessionWallet || dismissed) return null

  return (
    <div className="mx-4 mt-3 flex items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.07] backdrop-blur-sm px-4 py-3">
      <Wallet className="h-4 w-4 text-amber-400 shrink-0" />
      <p className="flex-1 text-sm text-amber-300/90">
        No wallet linked. Set one up to send and receive payments.
      </p>
      <Button
        size="sm"
        onClick={onSetup}
        className="shrink-0 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-xs"
        variant="outline"
      >
        Set up
      </Button>
      <button onClick={() => setDismissed(true)} className="text-amber-500/50 hover:text-amber-400 shrink-0">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

function ProfileDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: session, update } = useSession()
  const { address, isConnected } = useAccount()
  const [saving, setSaving] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [msg, setMsg] = useState("")
  const [editName, setEditName] = useState("")
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const sessionWallet = session?.user?.walletAddress as string | null | undefined
  const currentAvatar = avatarPreview ?? session?.user?.image ?? null
  const currentName = session?.user?.name ?? ""

  useEffect(() => {
    if (open) {
      setEditName(session?.user?.name ?? "")
      setAvatarPreview(null)
      setMsg("")
    }
  }, [open, session?.user?.name])

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith("image/")) { setMsg("Please select an image file."); return }
    if (file.size > 750_000) { setMsg("Image must be under 750KB."); return }
    const reader = new FileReader()
    reader.onload = (ev) => setAvatarPreview(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  const saveProfile = async () => {
    setSaving(true)
    setMsg("")
    try {
      if (avatarPreview) {
        setUploadingAvatar(true)
        const avatarRes = await fetch('/api/user/avatar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: avatarPreview }),
        })
        const avatarData = await avatarRes.json()
        setUploadingAvatar(false)
        if (!avatarData.success) { setMsg(avatarData.error ?? "Failed to upload avatar."); return }
        await update({ picture: avatarPreview })
      }
      if (editName !== currentName) {
        const res = await fetch('/api/user', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: editName }),
        })
        const data = await res.json()
        if (!data.success) { setMsg(data.error ?? "Failed to save name."); return }
        await update({ name: editName })
      }
      setMsg("Profile updated!")
      setAvatarPreview(null)
    } catch {
      setMsg("Something went wrong.")
    } finally {
      setSaving(false)
      setUploadingAvatar(false)
    }
  }

  const linkWallet = async () => {
    if (!address) return
    setSaving(true)
    setMsg("")
    try {
      const res = await fetch('/api/user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: address }),
      })
      const data = await res.json()
      if (data.success) {
        await update({ walletAddress: data.data?.walletAddress ?? address.toLowerCase() })
        setMsg("Wallet linked successfully.")
      } else {
        setMsg(data.error ?? "Failed to link wallet.")
      }
    } catch {
      setMsg("Something went wrong.")
    } finally {
      setSaving(false)
    }
  }

  const initials = currentName
    ? currentName.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)
    : "FL"

  const isDirty = avatarPreview !== null || editName !== currentName

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm bg-[#0a1220]/95 backdrop-blur-xl border border-white/[0.08] text-white shadow-2xl shadow-black/60">
        <DialogHeader>
          <DialogTitle className="text-white font-semibold tracking-tight">Profile Settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 pt-1">
          {/* Avatar */}
          <div className="flex flex-col items-center gap-3">
            <div className="relative group">
              <div className="w-20 h-20 rounded-full overflow-hidden bg-emerald-900/40 flex items-center justify-center border border-white/[0.08] shadow-lg shadow-black/40 ring-2 ring-emerald-500/10">
                {currentAvatar ? (
                  <img src={currentAvatar} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-emerald-400 font-bold text-2xl">{initials}</span>
                )}
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="absolute inset-0 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Camera className="h-5 w-5 text-white" />
              </button>
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-xs text-emerald-400 hover:text-emerald-300 font-medium tracking-wide"
            >
              Change photo
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
            />
          </div>

          {/* Name */}
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-500 tracking-wider uppercase">Display Name</Label>
            <Input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              placeholder="Your name"
              className="bg-white/[0.04] border-white/[0.08] text-white placeholder:text-slate-600 focus:border-emerald-500/40 focus:bg-white/[0.06]"
            />
          </div>

          {/* Email (read-only) */}
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-500 tracking-wider uppercase">Email <span className="text-slate-700 normal-case">(read-only)</span></Label>
            <Input value={session?.user?.email ?? "—"} readOnly className="bg-white/[0.02] border-white/[0.06] text-slate-400 cursor-default" />
          </div>

          {/* Save button */}
          {isDirty && (
            <Button
              onClick={saveProfile}
              disabled={saving}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium shadow-lg shadow-emerald-900/40"
            >
              {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{uploadingAvatar ? "Uploading…" : "Saving…"}</> : "Save Changes"}
            </Button>
          )}

          {/* Wallet */}
          <div className="pt-2 border-t border-white/[0.06] space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500 tracking-wider uppercase">Linked Wallet</Label>
              <Input
                value={sessionWallet ?? "No wallet linked"}
                readOnly
                className="bg-white/[0.02] border-white/[0.06] font-mono text-xs text-slate-300 cursor-default"
              />
            </div>


{(session?.user as any)?.walletType !== "managed" && !isConnected && sessionWallet && (
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-500 tracking-wider uppercase">External wallet — reconnect MetaMask for on-chain actions</Label>
                <div className="flex justify-center pt-1">
                  <ConnectButton label="Reconnect Wallet" accountStatus="address" showBalance={false} />
                </div>
              </div>
            )}

            {!sessionWallet && (
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-500 tracking-wider uppercase">No wallet linked yet</Label>
                <div className="flex justify-center pt-1">
                  <ConnectButton label="Connect Wallet" accountStatus="address" showBalance={false} />
                </div>
              </div>
            )}

            {isConnected && address && address.toLowerCase() !== sessionWallet?.toLowerCase() && (session?.user as any)?.walletType !== "managed" && (
              <div className="space-y-2">
                <p className="text-xs text-slate-400">
                  Connected:{" "}
                  <span className="font-mono text-slate-300">{address.slice(0, 8)}…{address.slice(-6)}</span>
                </p>
                <Button size="sm" onClick={linkWallet} disabled={saving}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/40">
                  <Wallet className="h-3.5 w-3.5 mr-1.5" />
                  {saving ? "Linking…" : "Link this wallet"}
                </Button>
              </div>
            )}
          </div>

          {msg && (
            <p className={`text-xs ${msg.includes("!") ? "text-emerald-400" : "text-red-400"}`}>{msg}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const { data: session } = useSession()
  const { isConnected } = useAccount()
  const searchParams = useSearchParams()
  const router = useRouter()

  const [activeTab, setActiveTab] = useState(() => {
    const tab = searchParams.get("tab")
    return navigation.some(n => n.id === tab) ? tab! : "overview"
  })
  const [profileOpen, setProfileOpen] = useState(false)
  const [walletSetupOpen, setWalletSetupOpen] = useState(false)
  const [walletOnboardingOpen, setWalletOnboardingOpen] = useState(false)
  const [onboardingShown, setOnboardingShown] = useState(false)

  const sessionWalletTop = session?.user?.walletAddress as string | null | undefined

  const navigateTo = (tab: string) => {
    setActiveTab(tab)
    router.replace(`/dashboard?tab=${tab}`, { scroll: false })
  }

  useEffect(() => {
    if (
      !onboardingShown &&
      session?.user &&
      !sessionWalletTop &&
      !isConnected
    ) {
      setOnboardingShown(true)
      setWalletOnboardingOpen(true)
    }
  }, [session, sessionWalletTop, isConnected, onboardingShown])

  useEffect(() => {
    if (searchParams.get("setup") === "wallet") {
      setWalletSetupOpen(true)
      router.replace(`/dashboard?tab=${activeTab}`)
    }
  }, [searchParams, router])

  const handleLogout = () => {
    signOut({ callbackUrl: "/login" })
  }

  const renderContent = () => {
    switch (activeTab) {
      case "payment-links": return <PaymentLinksModule />
      case "compliance-vaults": return <ComplianceVaultsModule />
      case "payroll-rails": return <PayrollRailsModule />
      case "ai-invoices": return <AIInvoiceModule />
      case "vendor-verify": return <VendorsModule />
      case "settings": return <SettingsModule />
      default: return children
    }
  }

  const name = session?.user?.name ?? ""
  const email = session?.user?.email ?? ""
  const initials = name
    ? name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)
    : "FL"

  return (
    <div
      className="dark min-h-screen"
      style={{
        backgroundColor: "#080e1a",
        backgroundImage: [
          "radial-gradient(ellipse 80% 50% at 15% 40%, rgba(16,185,129,0.055) 0%, transparent 60%)",
          "radial-gradient(ellipse 60% 40% at 85% 15%, rgba(99,102,241,0.04) 0%, transparent 55%)",
          "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px)",
          "linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
        ].join(", "),
        backgroundSize: "100% 100%, 100% 100%, 28px 28px, 28px 28px",
      }}
    >
      {/* Fixed sidebar */}
      <aside
        className="w-64 flex flex-col h-screen fixed left-0 top-0 z-40 border-r border-white/[0.05]"
        style={{
          background: "rgba(6, 11, 22, 0.88)",
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
        }}
      >
        {/* Logo */}
        <div className="p-5 border-b border-white/[0.05]">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl overflow-hidden shadow-lg shadow-emerald-900/40 ring-1 ring-emerald-500/20">
              <img src="/ai-assistant-icon.png" alt="Thia-Term" className="w-full h-full object-cover" />
            </div>
            <span className="font-bold text-xl tracking-tight">
              <span className="text-white">Flow</span><span className="text-emerald-400">Link</span>
            </span>
            <div className="ml-auto flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            </div>
          </div>
        </div>

        {/* Primary action */}
        <div className="p-4">
          <button
            onClick={() => navigateTo("payment-links")}
            className="w-full relative overflow-hidden rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-200 group"
            style={{
              background: "linear-gradient(135deg, #059669 0%, #10b981 50%, #34d399 100%)",
              boxShadow: "0 0 20px rgba(16,185,129,0.25), inset 0 1px 0 rgba(255,255,255,0.15)",
            }}
          >
            <span className="absolute inset-0 bg-white/0 group-hover:bg-white/10 transition-colors rounded-xl" />
            <Send className="w-4 h-4 text-white relative z-10" />
            <span className="text-white relative z-10">Send Payment</span>
          </button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto py-2">
          {navigation.map((item) => {
            const isActive = activeTab === item.id
            return (
              <button
                key={item.id}
                onClick={() => navigateTo(item.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 relative group",
                  isActive
                    ? "text-emerald-300"
                    : "text-slate-500 hover:text-slate-200"
                )}
                style={isActive ? {
                  background: "rgba(16,185,129,0.08)",
                  boxShadow: "inset 2px 0 0 rgba(52,211,153,0.7), inset 0 0 20px rgba(16,185,129,0.04)",
                } : undefined}
              >
                {!isActive && (
                  <span className="absolute inset-0 rounded-xl bg-white/0 group-hover:bg-white/[0.03] transition-colors" />
                )}
                <item.icon
                  className={cn("w-4 h-4 shrink-0 relative z-10", isActive ? "text-emerald-400" : "text-slate-600 group-hover:text-slate-400")}
                  strokeWidth={isActive ? 2 : 1.5}
                />
                <span className="relative z-10">{item.name}</span>
                {item.badge && (
                  <span className={cn(
                    "ml-auto text-[10px] rounded-md px-1.5 py-0.5 font-semibold tracking-wider relative z-10",
                    isActive
                      ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                      : "bg-white/[0.05] text-slate-600 border border-white/[0.06]"
                  )}>
                    {item.badge}
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        {/* User section */}
        <div className="p-4 border-t border-white/[0.05]">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setProfileOpen(true)}
              className="flex-1 flex items-center gap-3 hover:bg-white/[0.04] rounded-xl p-2 transition-colors text-left cursor-pointer min-w-0 group"
              title="Edit profile"
            >
              <div className="w-9 h-9 rounded-full bg-emerald-900/40 flex items-center justify-center text-emerald-400 font-semibold text-sm shrink-0 overflow-hidden ring-1 ring-emerald-500/20">
                {session?.user?.image ? (
                  <img src={session.user.image} alt="Avatar" className="w-full h-full object-cover" />
                ) : initials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-200 truncate leading-tight group-hover:text-white transition-colors">{session?.user?.name ?? "User"}</p>
                <p className="text-xs text-slate-600 truncate leading-tight mt-0.5">{email}</p>
              </div>
            </button>
            <button
              onClick={handleLogout}
              className="p-2 rounded-xl text-slate-700 hover:text-slate-300 hover:bg-white/[0.04] transition-colors shrink-0"
              title="Log out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content — offset by sidebar width */}
      <div className="ml-64 flex flex-col min-h-screen">
        {/* Topbar */}
        <header
          className="h-14 flex items-center justify-end px-6 sticky top-0 z-30 border-b border-white/[0.04]"
          style={{
            background: "rgba(8, 14, 26, 0.80)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
          }}
        >
          <div className="flex items-center gap-3">
            {/* Active page label */}
            <span className="text-xs text-slate-600 font-mono tracking-widest uppercase mr-2 hidden md:block">
              {navigation.find(n => n.id === activeTab)?.name ?? "Dashboard"}
            </span>
            <div className="w-px h-4 bg-white/[0.06] hidden md:block" />
            <NotificationBell onNavigate={navigateTo} />
            <button
              onClick={() => setProfileOpen(true)}
              className="flex items-center gap-2 hover:bg-white/[0.04] rounded-xl px-2 py-1.5 transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-emerald-900/40 flex items-center justify-center text-emerald-400 font-semibold text-xs ring-1 ring-emerald-500/20 overflow-hidden">
                {session?.user?.image ? (
                  <img src={session.user.image} alt="Avatar" className="w-full h-full object-cover" />
                ) : initials}
              </div>
              <span className="text-sm font-medium text-slate-400 hidden md:block">{session?.user?.name}</span>
            </button>
          </div>
        </header>

        {/* Wallet setup banner */}
        <WalletBanner onSetup={() => setWalletSetupOpen(true)} />

        {/* Page content */}
        <main className="flex-1 p-6">
          {renderContent()}
        </main>
      </div>

      <ProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} />
      <WalletSetupModal open={walletSetupOpen} onClose={() => setWalletSetupOpen(false)} />
      <WalletOnboardingModal
        open={walletOnboardingOpen}
        onClose={() => setWalletOnboardingOpen(false)}
      />
    </div>
  )
}
