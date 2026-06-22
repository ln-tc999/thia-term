'use client'

import { useState, useEffect } from "react"
import { useSession } from "next-auth/react"
import { useRouter, useSearchParams } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
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
import { DemoWalletBanner } from "@/components/demo-wallet-banner"
import { PaymentLinksModule } from "@/components/payment-links-module"
import { ComplianceVaultsModule } from "@/components/compliance-vaults-module"
import { PayrollRailsModule } from "@/components/payroll-rails-module"
import { AIInvoiceModule } from "@/components/ai-invoice-module"
import { SettingsModule } from "@/components/settings-module"
import { VendorsModule } from "@/components/vendors-module"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
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
    <TooltipProvider delayDuration={0}>
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

        {/* ─── Floating Sidebar ─── */}
        <motion.aside
          className={cn(
            "fixed left-4 top-4 bottom-4 z-50 w-20",
            "flex flex-col gap-4",
            "max-md:transition-transform max-md:duration-300",
            mobileMenuOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full max-md:left-0 max-md:top-0 max-md:bottom-0 max-md:w-64 max-md:rounded-none",
          )}
          initial={false}
        >
          {/* Logo + Primary Action */}
          <div className="backdrop-blur-xl bg-white/[0.03] border border-white/[0.08] rounded-2xl p-3 flex flex-col items-center gap-3">
            <button
              onClick={() => router.replace("/dashboard")}
              className="w-12 h-12 rounded-xl overflow-hidden shadow-lg shadow-sky-500/20 ring-1 ring-sky-500/20 hover:ring-sky-500/40 transition-all cursor-pointer"
            >
              <img src="/thia-term-logo.png" alt="Thia-Term" className="w-full h-full object-cover" />
            </button>

            <div className="w-full h-px bg-white/[0.08]" />

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => navigateTo("payment-links")}
                  className="w-12 h-12 relative overflow-hidden rounded-xl flex items-center justify-center transition-all duration-200 group bg-brand-gradient shadow-brand-glow hover:scale-105"
                >
                  <span className="absolute inset-0 bg-white/0 group-hover:bg-white/10 transition-colors rounded-xl" />
                  <Send className="w-5 h-5 text-white relative z-10" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                Send Payment
              </TooltipContent>
            </Tooltip>
          </div>

          {/* Nav items */}
          <nav className="flex-1 backdrop-blur-xl bg-white/[0.03] border border-white/[0.08] rounded-2xl p-3 flex flex-col justify-center gap-2">
            {navigation.map((item) => {
              const isActive = activeTab === item.id
              const Icon = item.icon
              return (
                <Tooltip key={item.id}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => navigateTo(item.id)}
                      className={cn(
                        "relative w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-150 group",
                        isActive
                          ? "bg-sky-500/[0.15] text-sky-400"
                          : "text-slate-500 hover:text-sky-400 hover:bg-white/[0.05]",
                      )}
                      aria-current={isActive ? "page" : undefined}
                    >
                      <Icon className={cn("w-5 h-5 transition-transform group-hover:scale-110", isActive && "scale-110")} />
                      {item.badge && (
                        <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-sky-500 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-[#0a1220]">
                          {item.badge}
                        </span>
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>
                    {item.name}
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </nav>

          {/* User section */}
          <div className="backdrop-blur-xl bg-white/[0.03] border border-white/[0.08] rounded-2xl p-3 flex flex-col items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setProfileOpen(true)}
                  className="w-12 h-12 rounded-full bg-sky-900/40 flex items-center justify-center text-sky-400 font-semibold text-sm overflow-hidden ring-2 ring-sky-500/20 hover:ring-sky-500/40 transition-all cursor-pointer hover:scale-105"
                >
                  {session?.user?.image ? (
                    <img src={session.user.image} alt="Avatar" className="w-full h-full object-cover" />
                  ) : initials}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                <div className="text-left">
                  <p className="font-semibold">{session?.user?.name ?? "User"}</p>
                  <p className="text-xs text-slate-400">{email}</p>
                </div>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleLogout}
                  className="w-10 h-10 rounded-xl text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all flex items-center justify-center"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                Logout
              </TooltipContent>
            </Tooltip>
          </div>
        </motion.aside>

      {/* ─── Main content ─── */}
      <div className="md:ml-28 flex flex-col min-h-screen">
        {/* Topbar */}
        <header className="h-20 flex items-center justify-between px-6 md:px-8 sticky top-0 z-30 backdrop-blur-xl bg-white/[0.02] border-b border-white/[0.08]">
          <div className="flex items-center gap-4">
            {/* Mobile menu toggle */}
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden p-2 rounded-xl text-slate-500 hover:text-slate-200 hover:bg-white/[0.04] transition-colors"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>

            {/* Active page label with better hierarchy */}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-xl font-bold text-white tracking-tight">
                  {navigation.find(n => n.id === activeTab)?.name ?? "Dashboard"}
                </h1>
                {navigation.find(n => n.id === activeTab)?.badge && (
                  <span className="px-2 py-0.5 text-[10px] font-bold bg-sky-500/10 text-sky-400 rounded-md border border-sky-500/20">
                    {navigation.find(n => n.id === activeTab)?.badge}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Welcome back, <span className="text-sky-400 font-medium">{session?.user?.name?.split(' ')[0] ?? 'User'}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Wallet Address Display */}
            {sessionWalletTop && (
              <div className="hidden lg:flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.08]">
                <Wallet className="w-4 h-4 text-sky-400" />
                <span className="text-xs font-mono text-slate-300">
                  {sessionWalletTop.slice(0, 6)}...{sessionWalletTop.slice(-4)}
                </span>
              </div>
            )}

            <NotificationBell onNavigate={navigateTo} />

            <button
              onClick={() => setProfileOpen(true)}
              className="flex items-center gap-2 hover:bg-white/[0.04] rounded-xl px-3 py-2 transition-colors group"
            >
              <div className="w-8 h-8 rounded-full bg-sky-900/40 flex items-center justify-center text-sky-400 font-semibold text-xs ring-2 ring-sky-500/20 group-hover:ring-sky-500/40 overflow-hidden transition-all">
                {session?.user?.image ? (
                  <img src={session.user.image} alt="Avatar" className="w-full h-full object-cover" />
                ) : initials}
              </div>
              <span className="text-sm font-medium text-slate-300 hidden md:block group-hover:text-white transition-colors">{session?.user?.name}</span>
            </button>
          </div>
        </header>

        {/* Wallet setup banner */}
        <WalletBanner onSetup={() => setWalletSetupOpen(true)} />

        {/* Demo wallet banner */}
        <DemoWalletBanner />

        {/* Page content with tab transitions */}
        <main className="flex-1 p-6 md:p-8">
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
    </TooltipProvider>
  )
}
