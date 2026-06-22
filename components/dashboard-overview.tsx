'use client'

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Shield, Wallet, TrendingUp } from "lucide-react"
import { AgentPaymentWidget } from "@/components/agent-payment-widget"
import { VendorVerifyWidget } from "@/components/vendor-verify-widget"
import { useSession } from "next-auth/react"
import { cn } from "@/lib/utils"

interface Stats {
  totalVolume: number
  activePaymentLinks: number
  totalPayments: number
  pendingInvoices: number
}

interface RecentPayment {
  id: string
  payer: string | null
  amount: number
  currency: string
  status: string
  kycPassed: boolean
  sanctionsChecked: boolean
  createdAt: string
}

interface ComplianceMetrics {
  kycRate: number
  amlRate: number
  monitoringRate: number
  score: number
}

function SkeletonRow() {
  return (
    <div className="flex items-center justify-between p-3 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-white/10" />
        <div className="space-y-1.5">
          <div className="h-3 w-28 bg-white/10 rounded" />
          <div className="h-2.5 w-20 bg-white/[0.06] rounded" />
        </div>
      </div>
      <div className="h-3 w-16 bg-white/10 rounded" />
    </div>
  )
}

const statusStyles: Record<string, string> = {
  completed: "badge-sky",
  pending: "badge-amber",
  failed: "badge-red",
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium capitalize", statusStyles[status] ?? "bg-white/10 text-slate-400 border border-white/10")}>
      {status}
    </span>
  )
}

export function DashboardOverview() {
  const { data: session } = useSession()
  const [stats, setStats] = useState<Stats | null>(null)
  const [recent, setRecent] = useState<RecentPayment[]>([])
  const [compliance, setCompliance] = useState<ComplianceMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [agents, setAgents] = useState<{ id: string; name: string; walletAddress?: string | null }[]>([])
  const [hasPaymentLink, setHasPaymentLink] = useState(false)
  const [hasInvoice, setHasInvoice] = useState(false)
  const [dismissedOnboarding, setDismissedOnboarding] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const walletAddress = session?.user?.walletAddress as string | null | undefined
  const firstName = session?.user?.name?.split(' ')[0] ?? 'there'

  const timeOfDay = (() => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 18) return 'Good afternoon'
    return 'Good evening'
  })()

  const loadAll = async (signal?: AbortSignal) => {
    try {
      setError(null)
      const [statsRes, paymentsRes, linksRes] = await Promise.allSettled([
        fetch('/api/dashboard/stats', { signal }),
        fetch('/api/payments?limit=5', { signal }),
        fetch('/api/payment-links', { signal }),
      ])

      let recentPayments: RecentPayment[] = []
      let totalPayments = 0
      if (paymentsRes.status === 'fulfilled' && paymentsRes.value.ok) {
        const json = await paymentsRes.value.json()
        recentPayments = Array.isArray(json) ? json : (json.data ?? json.payments ?? [])
        totalPayments = json.total ?? recentPayments.length
      }
      setRecent(recentPayments)

      if (statsRes.status === 'fulfilled' && statsRes.value.ok) {
        const data = await statsRes.value.json()
        setStats({
          totalVolume: data.totalVolume ?? 0,
          activePaymentLinks: data.activePaymentLinks ?? 0,
          totalPayments: data.totalPayments ?? totalPayments,
          pendingInvoices: data.pendingInvoices ?? 0,
        })
      } else {
        let activePaymentLinks = 0
        let totalVolume = 0
        if (linksRes.status === 'fulfilled' && linksRes.value.ok) {
          const json = await linksRes.value.json()
          const links: any[] = Array.isArray(json) ? json : (json.data ?? [])
          activePaymentLinks = links.filter((l: any) => l.status === 'active').length
          totalVolume = links.reduce((s: number, l: any) => s + (Number(l.totalVolume) || 0), 0)
          setHasPaymentLink(links.length > 0)
        }
        setStats({ totalVolume, activePaymentLinks, totalPayments, pendingInvoices: 0 })
      }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return
      setError('Could not load dashboard data')
      console.error('Dashboard load error:', e)
      setStats({ totalVolume: 0, activePaymentLinks: 0, totalPayments: 0, pendingInvoices: 0 })
      setRecent([])
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    const controller = new AbortController()
    loadAll(controller.signal)
    return () => controller.abort()
  }, [])

  const handleRefresh = () => {
    setRefreshing(true)
    const controller = new AbortController()
    loadAll(controller.signal)
  }

  const s = stats ?? { totalVolume: 0, activePaymentLinks: 0, totalPayments: 0, pendingInvoices: 0 }

  const hasCompletedSetup = hasPaymentLink && hasInvoice && !!walletAddress
  const onboardingSteps = [
    { step: 1, title: "Create a payment link", desc: "Share it to receive crypto payments instantly.", done: hasPaymentLink },
    { step: 2, title: "Link your wallet", desc: "Connect your T3N wallet to receive payments.", done: !!walletAddress },
    { step: 3, title: "Send an invoice", desc: "Professional invoices with built-in KYC/AML.", done: hasInvoice },
  ]
  const completedSteps = onboardingSteps.filter(s => s.done).length

  return (
    <div className="space-y-8">
      {/* ── Greeting ── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="flex items-start justify-between"
      >
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            {timeOfDay}, {firstName}
          </h1>
          <p className="text-slate-500 mt-1 text-sm">Here&apos;s your payment overview for today.</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing || loading}
          className="text-xs text-slate-600 hover:text-slate-400 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          aria-label="Refresh dashboard data"
        >
          <svg className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </motion.div>

      {/* ── Error state ── */}
      {error && !loading && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-red-500/20 bg-red-500/[0.06] p-4 flex items-center gap-3"
        >
          <span className="text-red-400 text-sm flex-1">{error}</span>
          <button
            onClick={handleRefresh}
            className="text-xs text-red-400 hover:text-red-300 border border-red-500/30 rounded-lg px-3 py-1.5"
          >
            Retry
          </button>
        </motion.div>
      )}

      {/* ── Onboarding ── */}
      {!hasCompletedSetup && !dismissedOnboarding && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="rounded-2xl border border-sky-500/20 bg-sky-500/[0.04] p-6"
        >
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base font-semibold text-white">Get started with Thia-Term</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                <span className="text-sky-400 font-medium">{completedSteps}</span> of 3 steps complete
              </p>
            </div>
            <button
              onClick={() => setDismissedOnboarding(true)}
              className="text-sm text-slate-600 hover:text-slate-400 transition-colors"
            >
              Skip for now
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {onboardingSteps.map(({ step, title, desc, done }) => (
              <div
                key={step}
                className={cn(
                  "rounded-xl border p-4 transition-all",
                  done
                    ? "border-sky-500/20 bg-sky-500/[0.06]"
                    : "border-white/[0.06] bg-white/[0.02]"
                )}
              >
                <h3 className={cn("font-semibold text-sm mb-1", done ? "text-sky-300" : "text-slate-300")}>{title}</h3>
                <p className="text-xs text-slate-600">{desc}</p>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* ── Stats area ── */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        {/* Hero — Total Volume */}
        {loading ? (
          <div className="lg:col-span-2 rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-xl p-7 animate-pulse">
            <div className="h-3 w-24 bg-white/10 rounded mb-4" />
            <div className="h-10 w-40 bg-white/10 rounded" />
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="lg:col-span-2 relative overflow-hidden rounded-2xl border border-sky-500/20 bg-gradient-to-br from-sky-500/[0.12] via-sky-500/[0.06] to-transparent backdrop-blur-xl p-7"
          >
            <div className="absolute top-0 right-0 w-48 h-48 bg-sky-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" aria-hidden="true" />
            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-sky-500/10 flex items-center justify-center">
                  <Wallet className="w-4 h-4 text-sky-400" />
                </div>
                <p className="text-xs text-sky-400/80 font-semibold uppercase tracking-wider">Total Volume</p>
              </div>
              <p className="text-5xl font-black text-white mt-2 tracking-tight">
                ${s.totalVolume.toLocaleString()}
              </p>
              <div className="flex items-center gap-2 mt-4">
                <span className="inline-flex items-center gap-1.5 text-xs text-sky-400/70 font-medium">
                  <TrendingUp className="w-3.5 h-3.5" />
                  {s.totalPayments} transactions
                </span>
                <span className="w-1 h-1 rounded-full bg-sky-500/30" />
                <span className="text-xs text-sky-400/50">via T3N TEE</span>
              </div>
            </div>
          </motion.div>
        )}

        {/* Active Links */}
        {loading ? (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-xl p-6 animate-pulse">
            <div className="h-3 w-16 bg-white/10 rounded mb-4" />
            <div className="h-8 w-12 bg-white/10 rounded" />
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-xl p-6 hover:border-sky-500/20 hover:bg-white/[0.06] transition-all duration-300"
          >
            <div className="flex items-center gap-2 mb-4">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Active Links</p>
            </div>
            <p className="text-3xl font-black text-white tracking-tight">{s.activePaymentLinks}</p>
            <p className="text-xs text-slate-600 mt-2">Ready to receive</p>
          </motion.div>
        )}

        {/* Pending */}
        {loading ? (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-xl p-6 animate-pulse">
            <div className="h-3 w-20 bg-white/10 rounded mb-4" />
            <div className="h-8 w-12 bg-white/10 rounded" />
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-xl p-6 hover:border-amber-500/20 hover:bg-white/[0.06] transition-all duration-300"
          >
            <div className="flex items-center gap-2 mb-4">
              <div className="w-2 h-2 rounded-full bg-amber-400" />
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Pending</p>
            </div>
            <p className="text-3xl font-black text-white tracking-tight">{s.pendingInvoices}</p>
            <p className="text-xs text-slate-600 mt-2">Awaiting payment</p>
          </motion.div>
        )}
      </div>

      {/* ── Lower section ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Payments — takes 2/3 */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="lg:col-span-2 rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-xl p-6"
        >
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-bold text-white">Recent Payments</h2>
              <p className="text-xs text-slate-500 mt-0.5">Last 5 transactions</p>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-3 py-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live
            </div>
          </div>

          <div className="space-y-2">
            {loading ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : recent.length === 0 ? (
              <div className="text-center py-12 rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02]">
                <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-white/[0.04] flex items-center justify-center">
                  <Wallet className="w-6 h-6 text-slate-600" />
                </div>
                <p className="text-sm font-medium text-slate-400">No payments yet</p>
                <p className="text-xs text-slate-600 mt-1">Share a payment link to get started</p>
              </div>
            ) : (
              recent.map((p, idx) => (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className="flex items-center justify-between p-4 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04] transition-all duration-200"
                >
                  <div className="flex items-center gap-3.5">
                    <div className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 backdrop-blur-xl",
                      p.status === 'completed' ? "bg-sky-500/15 border border-sky-500/20 text-sky-400" :
                      p.status === 'pending' ? "bg-amber-500/15 border border-amber-500/20 text-amber-400" :
                      "bg-white/[0.08] border border-white/[0.08] text-slate-500"
                    )}>
                      {p.payer ? p.payer.slice(2, 4).toUpperCase() : "??"}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-200">
                        {p.payer ? `${p.payer.slice(0, 6)}…${p.payer.slice(-4)}` : 'Unknown'}
                      </p>
                      <p className="text-xs text-slate-600 flex items-center gap-1.5 mt-0.5">
                        {new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        {(p.kycPassed || p.sanctionsChecked) && (
                          <>
                            <span className="w-1 h-1 rounded-full bg-slate-700" />
                            <Shield className="w-3 h-3 text-emerald-500" />
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="text-right flex items-center gap-3">
                    <div>
                      <p className="text-sm font-bold text-white">{p.amount} {p.currency}</p>
                      <StatusBadge status={p.status} />
                    </div>
                  </div>
                </motion.div>
              ))
            )}
          </div>
        </motion.div>

        {/* Compliance — takes 1/3 */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-xl p-6"
        >
          <div className="flex items-center gap-2 mb-6">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <Shield className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Compliance</h2>
              <p className="text-xs text-slate-500">T3N Testnet</p>
            </div>
          </div>

          {loading ? (
            <div className="space-y-4">
              <div className="h-20 rounded-xl bg-white/[0.03] animate-pulse" />
              <div className="h-3 bg-white/[0.03] rounded animate-pulse" />
              <div className="h-3 bg-white/[0.03] rounded animate-pulse w-4/5" />
            </div>
          ) : compliance ? (
            <div className="space-y-5">
              <div className="relative overflow-hidden rounded-xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.12] to-emerald-500/[0.04] p-5">
                <div className="absolute -top-4 -right-4 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl" />
                <div className="relative z-10">
                  <p className="text-xs text-emerald-400/70 font-semibold uppercase tracking-wider mb-2">Score</p>
                  <p className="text-5xl font-black text-emerald-400">{compliance.score}</p>
                  <p className="text-xs text-emerald-400/60 mt-2">{s.totalPayments} payments analyzed</p>
                </div>
              </div>

              {[
                { label: 'KYC', value: compliance.kycRate, icon: Shield },
                { label: 'AML', value: compliance.amlRate, icon: Shield },
                { label: 'Monitoring', value: compliance.monitoringRate, icon: Shield },
              ].map((item) => (
                <div key={item.label} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
                      <item.icon className="w-3 h-3" />
                      {item.label}
                    </span>
                    <span className="text-xs font-bold text-white">{item.value}%</span>
                  </div>
                  <Progress value={item.value} className="h-2 bg-white/[0.08]" />
                </div>
              ))}

              <div className="pt-4 border-t border-white/[0.06]">
                <p className="text-xs text-emerald-400 flex items-center gap-2 font-medium">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  All systems operational
                </p>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02]">
              <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-white/[0.04] flex items-center justify-center">
                <Shield className="w-6 h-6 text-slate-600" />
              </div>
              <p className="text-sm font-medium text-slate-400">No data yet</p>
              <p className="text-xs text-slate-600 mt-1">Metrics appear after payments</p>
            </div>
          )}
        </motion.div>
      </div>

      {/* ── Widgets Grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Agent Payments */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.55, ease: [0.22, 1, 0.36, 1] }}
        >
          <AgentPaymentWidget agents={agents} />
        </motion.div>

        {/* Vendor Verification */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.65, ease: [0.22, 1, 0.36, 1] }}
        >
          <VendorVerifyWidget
            onViewDetails={() => {
              if (typeof window !== 'undefined') {
                window.location.href = '/dashboard?tab=vendor-verify'
              }
            }}
          />
        </motion.div>
      </div>
    </div>
  )
}
