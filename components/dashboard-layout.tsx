'use client'

import { useState, useEffect } from "react"
import { useSession } from "next-auth/react"
import { useRouter, useSearchParams } from "next/navigation"
import { motion, AnimatePresence } from "motion/react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Shield, ShieldCheck, Users, LogOut, Wallet, X, Link2,
  LayoutDashboard, FileText, Send, Settings, Menu,
} from "lucide-react"
import { NotificationBell } from "@/components/notification-bell"
import { ProfileDialog } from "@/components/profile-dialog"
import { WalletSetupModal } from "@/components/wallet-setup-modal"
import { WalletOnboardingModal } from "@/components/wallet-onboarding-modal"
import { PaymentLinksModule } from "@/components/payment-links-module"
import { ComplianceVaultsModule } from "@/components/compliance-vaults-module"
import { PayrollRailsModule } from "@/components/payroll-rails-module"
import { AIInvoiceModule } from "@/components/ai-invoice-module"
import { SettingsModule } from "@/components/settings-module"
import { VendorsModule } from "@/components/vendors-module"
import { signOut } from "next-auth/react"

interface DashboardLayoutProps {
  children: React.ReactNode
}

const navigation: { id: string; name: string; icon: React.ElementType; badge?: string }[] = [
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
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-4 mt-3 flex items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.07] backdrop-blur-sm px-4 py-3"
    >
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
    </motion.div>
  )
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const { data: session } = useSession()
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const sessionWalletTop = session?.user?.walletAddress as string | null | undefined

  const navigateTo = (tab: string) => {
    setActiveTab(tab)
    setMobileMenuOpen(false)
    router.replace(`/dashboard?tab=${tab}`, { scroll: false })
  }

  useEffect(() => {
    if (!onboardingShown && session?.user && !sessionWalletTop) {
      setOnboardingShown(true)
      setWalletOnboardingOpen(true)
    }
  }, [session, sessionWalletTop, onboardingShown])

  useEffect(() => {
    if (searchParams.get("setup") === "wallet") {
      setWalletSetupOpen(true)
      router.replace(`/dashboard?tab=${activeTab}`)
    }
  }, [searchParams, router, activeTab])

  const handleLogout = () => signOut({ callbackUrl: "/login" })

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
    <div className="dark min-h-screen bg-dashboard">
      {/* ─── Mobile menu overlay ─── */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm md:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* ─── Sidebar ─── */}
      <motion.aside
        className={cn(
          "w-64 flex flex-col h-screen fixed left-0 top-0 z-50 border-r border-glass-border bg-sidebar",
          "md:z-40",
          "max-md:transition-transform max-md:duration-300",
          mobileMenuOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full",
        )}
        initial={false}
      >
        {/* Logo */}
        <div className="p-5 border-b border-glass-border">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl overflow-hidden shadow-lg shadow-emerald-900/40 ring-1 ring-emerald-500/20">
              <img src="/ai-assistant-icon.png" alt="Thia-Term" className="w-full h-full object-cover" />
            </div>
            <span className="font-bold text-xl tracking-tight">
              <span className="text-white">Flow</span><span className="text-emerald-400">Link</span>
            </span>
          </div>
        </div>

        {/* Primary action */}
        <div className="p-4">
          <button
            onClick={() => navigateTo("payment-links")}
            className="w-full relative overflow-hidden rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-200 group bg-brand-gradient shadow-brand-glow"
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
            const Icon = item.icon
            return (
              <button
                key={item.id}
                onClick={() => navigateTo(item.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150",
                  isActive
                    ? "text-emerald-300 bg-emerald-500/[0.08]"
                    : "text-slate-500 hover:text-slate-200 hover:bg-white/[0.03]",
                )}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon className={cn("w-4 h-4 shrink-0", isActive ? "text-emerald-400" : "text-slate-600")} />
                <span>{item.name}</span>
                {item.badge && (
                  <span className={cn(
                    "ml-auto text-[10px] rounded-md px-1.5 py-0.5 font-semibold",
                    isActive
                      ? "bg-emerald-500/15 text-emerald-400"
                      : "bg-white/[0.05] text-slate-600",
                  )}>
                    {item.badge}
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        {/* User section */}
        <div className="p-4 border-t border-glass-border">
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
              aria-label="Log out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </motion.aside>

      {/* ─── Main content ─── */}
      <div className="md:ml-64 flex flex-col min-h-screen">
        {/* Topbar */}
        <header className="h-14 flex items-center justify-between px-4 md:px-6 sticky top-0 z-30 border-b border-glass-border bg-topbar">
          <div className="flex items-center gap-3">
            {/* Mobile menu toggle */}
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden p-2 rounded-xl text-slate-500 hover:text-slate-200 hover:bg-white/[0.04] transition-colors"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>

            {/* Active page label */}
            <span className="text-xs text-slate-600 font-mono tracking-widest uppercase">
              {navigation.find(n => n.id === activeTab)?.name ?? "Dashboard"}
            </span>
          </div>

          <div className="flex items-center gap-3">
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

        {/* Page content with tab transitions */}
        <main className="flex-1 p-4 md:p-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
            >
              {renderContent()}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <ProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} />
      <WalletSetupModal open={walletSetupOpen} onClose={() => setWalletSetupOpen(false)} />
      <WalletOnboardingModal open={walletOnboardingOpen} onClose={() => setWalletOnboardingOpen(false)} />
    </div>
  )
}
