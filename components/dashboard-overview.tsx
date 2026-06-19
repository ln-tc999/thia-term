"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Shield, CheckCircle, Link2, FileText, Wallet, TrendingUp, ArrowUpRight, ArrowRight, Plus } from "lucide-react"
import { AgentPaymentWidget } from "@/components/agent-payment-widget"
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


function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-6 animate-pulse">
      <div className="flex items-start justify-between mb-4">
        <div className="space-y-2">
          <div className="h-3 w-24 bg-white/10 rounded" />
          <div className="h-8 w-20 bg-white/10 rounded" />
        </div>
        <div className="w-12 h-12 rounded-xl bg-white/10" />
      </div>
      <div className="h-3 w-32 bg-white/[0.06] rounded" />
    </div>
  )
}

function SkeletonRow() {
  return (
    <div className="flex items-center justify-between p-4 rounded-xl bg-white/[0.02] animate-pulse">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-white/10" />
        <div className="space-y-1.5">
          <div className="h-3 w-28 bg-white/10 rounded" />
          <div className="h-2.5 w-20 bg-white/[0.06] rounded" />
        </div>
      </div>
      <div className="space-y-1.5 text-right">
        <div className="h-3 w-16 bg-white/10 rounded" />
        <div className="h-2.5 w-12 bg-white/[0.06] rounded ml-auto" />
      </div>
    </div>
  )
}

const statusStyles: Record<string, string> = {
  completed: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
  pending: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
  failed: "bg-red-500/10 text-red-400 border border-red-500/20",
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium capitalize", statusStyles[status] ?? "bg-white/10 text-slate-400 border border-white/10")}>
      {status}
    </span>
  )
}

function StatCard({ title, value, icon, trend, sub }: { title: string; value: string; icon: React.ReactNode; trend?: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.05] transition-all p-6 group">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-sm text-slate-500 font-medium">{title}</p>
          <p className="text-3xl font-bold text-white mt-1 tracking-tight">{value}</p>
        </div>
        <div className="w-12 h-12 rounded-xl flex items-center justify-center shadow-lg flex-shrink-0 group-hover:scale-105 transition-transform"
          style={{ background: 'linear-gradient(135deg, #0a2e2e 0%, #0f3d3d 100%)' }}>
          {icon}
        </div>
      </div>
      {trend && (
        <div className="flex items-center gap-1">
          <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-xs text-emerald-400 font-medium">{trend}</span>
          {sub && <span className="text-xs text-slate-600 ml-1">{sub}</span>}
        </div>
      )}
    </div>
  )
}

export function DashboardOverview() {
  const { data: session } = useSession()
  const [stats, setStats] = useState<Stats | null>(null)
  const [recent, setRecent] = useState<RecentPayment[]>([])
  const [compliance, setCompliance] = useState<ComplianceMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [agents, setAgents] = useState<{ id: string; name: string; walletAddress?: string | null }[]>([])
  const [hasPaymentLink, setHasPaymentLink] = useState(false)
  const [hasInvoice, setHasInvoice] = useState(false)
  const [dismissedOnboarding, setDismissedOnboarding] = useState(false)

  const walletAddress = session?.user?.walletAddress as string | null | undefined
  const firstName = session?.user?.name?.split(' ')[0] ?? 'there'

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    async function loadAll() {
      try {
        const [statsRes, paymentsRes, linksRes] = await Promise.allSettled([
          fetch('/api/dashboard/stats', { signal: controller.signal }),
          fetch('/api/payments?limit=5', { signal: controller.signal }),
          fetch('/api/payment-links', { signal: controller.signal }),
        ])

        if (cancelled) return

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
        if (cancelled) return
        console.error('Dashboard load error:', e)
        setStats({ totalVolume: 0, activePaymentLinks: 0, totalPayments: 0, pendingInvoices: 0 })
        setRecent([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadAll()
    return () => { cancelled = true; controller.abort() }
  }, [])

  const s = stats ?? { totalVolume: 0, activePaymentLinks: 0, totalPayments: 0, pendingInvoices: 0 }

  const statCards = [
    {
      title: 'Total Volume',
      value: `$${s.totalVolume.toLocaleString()}`,
      trend: 'This month',
      icon: (
        <svg width="22" height="22" viewBox="0 0 28 28" fill="none" stroke="#34d399" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3,20 8,14 12,17 17,9 22,12 25,7" />
          <polyline points="21,7 25,7 25,11" />
        </svg>
      ),
    },
    {
      title: 'Active Links',
      value: s.activePaymentLinks.toString(),
      trend: 'Payment links',
      icon: (
        <svg width="22" height="22" viewBox="0 0 28 28" fill="none" stroke="#34d399" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
        </svg>
      ),
    },
    {
      title: 'Total Payments',
      value: s.totalPayments.toString(),
      trend: 'All time',
      icon: (
        <svg width="22" height="22" viewBox="0 0 28 28" fill="none" stroke="#34d399" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <line x1="5" y1="11" x2="23" y2="11"/>
          <polyline points="17,6 23,11 17,16"/>
          <line x1="23" y1="17" x2="5" y2="17"/>
          <polyline points="11,22 5,17 11,12"/>
        </svg>
      ),
    },
    {
      title: 'Pending Invoices',
      value: s.pendingInvoices.toString(),
      trend: 'Awaiting payment',
      icon: (
        <svg width="22" height="22" viewBox="0 0 28 28" fill="none" stroke="#34d399" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 4 L18 4 L22 8 L22 15 M6 4 L6 24 L15 24"/>
          <polyline points="18,4 18,8 22,8"/>
          <line x1="10" y1="11" x2="18" y2="11"/>
          <line x1="10" y1="14" x2="15" y2="14"/>
          <circle cx="20" cy="21" r="5"/>
          <polyline points="20,18.5 20,21 22,22.5"/>
        </svg>
      ),
    },
  ]

  const hasCompletedSetup = hasPaymentLink && hasInvoice && !!walletAddress
  const onboardingSteps = [
    { step: 1, title: "Create a payment link", desc: "Share it to receive crypto payments instantly.", icon: Link2, done: hasPaymentLink },
    { step: 2, title: "Link your wallet", desc: "Connect to receive funds on HashKey Chain.", icon: Wallet, done: !!walletAddress },
    { step: 3, title: "Send an invoice", desc: "Professional invoices with built-in KYC/AML.", icon: FileText, done: hasInvoice },
  ]
  const completedSteps = onboardingSteps.filter(s => s.done).length

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Good morning, {firstName}
        </h1>
        <p className="text-slate-500 mt-1 text-sm">Here&apos;s your payment overview for today.</p>
      </div>

      {/* Onboarding steps */}
      {!hasCompletedSetup && !dismissedOnboarding && (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base font-semibold text-white">Get started with FlowLink</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                <span className="text-emerald-400 font-medium">{completedSteps}</span> of 3 steps complete
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
            {onboardingSteps.map(({ step, title, desc, icon: Icon, done }) => (
              <div
                key={step}
                className={cn(
                  "rounded-xl border p-4 transition-all",
                  done
                    ? "border-emerald-500/20 bg-emerald-500/[0.06]"
                    : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]"
                )}
              >
                <div className={cn(
                  "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold mb-3",
                  done ? "bg-emerald-500/20 text-emerald-400" : "bg-white/10 text-slate-500"
                )}>
                  {done ? <CheckCircle className="h-4 w-4" /> : step}
                </div>
                <h3 className={cn("font-semibold text-sm mb-1", done ? "text-emerald-300" : "text-slate-300")}>{title}</h3>
                <p className="text-xs text-slate-600">{desc}</p>
                {!done && (
                  <span className="text-xs text-emerald-500 font-medium mt-3 flex items-center gap-1">
                    Do it now <ArrowRight className="h-3 w-3" />
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
          : statCards.map((card) => (
              <StatCard
                key={card.title}
                title={card.title}
                value={card.value}
                icon={card.icon}
                trend={card.trend}
              />
            ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent payments */}
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base font-semibold text-white">Recent Payments</h2>
              <p className="text-xs text-slate-500 mt-0.5">Last 5 transactions</p>
            </div>
            <TrendingUp className="h-4 w-4 text-slate-600" />
          </div>
          <div className="space-y-2">
            {loading ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : recent.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg"
                  style={{ background: "linear-gradient(135deg, #0a2e2e, #0f3d3d)" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                  </svg>
                </div>
                <p className="text-sm font-medium text-slate-400">No payments yet</p>
                <p className="text-xs text-slate-600 mt-1">Share a payment link to get started</p>
              </div>
            ) : (
              recent.map((p) => (
                <div key={p.id} className="flex items-center justify-between p-3.5 rounded-xl hover:bg-white/[0.03] transition-colors group">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                      p.status === 'completed' ? "bg-emerald-500/10 text-emerald-400" :
                      p.status === 'pending' ? "bg-amber-500/10 text-amber-400" :
                      "bg-white/[0.06] text-slate-500"
                    )}>
                      {p.payer ? p.payer.slice(2, 4).toUpperCase() : "??"}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-300">
                        {p.payer ? `${p.payer.slice(0, 6)}…${p.payer.slice(-4)}` : 'Unknown'}
                      </p>
                      <p className="text-xs text-slate-600">
                        {new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                  <div className="text-right flex flex-col items-end gap-1">
                    <p className="text-sm font-semibold text-white">{p.amount} {p.currency}</p>
                    <StatusBadge status={p.status} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Compliance score */}
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base font-semibold text-white">Compliance Status</h2>
              <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
                HashKey Testnet · Live
              </p>
            </div>
            <Shield className="h-4 w-4 text-slate-600" />
          </div>
          <div className="space-y-5">
            {loading ? (
              <div className="space-y-3">
                <div className="h-20 rounded-xl bg-white/[0.03] animate-pulse" />
                <div className="h-3 bg-white/[0.03] rounded animate-pulse" />
                <div className="h-3 bg-white/[0.03] rounded animate-pulse w-4/5" />
                <div className="h-3 bg-white/[0.03] rounded animate-pulse w-3/5" />
              </div>
            ) : compliance ? (
              <>
                <div className="flex items-center gap-4 p-4 bg-emerald-500/[0.06] rounded-xl border border-emerald-500/20">
                  <div className="text-4xl font-black text-emerald-400">{compliance.score}</div>
                  <div>
                    <p className="font-semibold text-white">Compliance Score</p>
                    <p className="text-sm text-slate-500">Based on {stats?.totalPayments ?? 0} payments</p>
                  </div>
                </div>
                {[
                  { label: 'KYC Verification', value: compliance.kycRate },
                  { label: 'AML Screening', value: compliance.amlRate },
                  { label: 'Transaction Monitoring', value: compliance.monitoringRate },
                ].map((item) => (
                  <div key={item.label} className="space-y-1.5">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">{item.label}</span>
                      <span className="font-semibold text-white">{item.value}%</span>
                    </div>
                    <Progress value={item.value} className="h-1.5 bg-white/10" />
                  </div>
                ))}
                <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/[0.06] border border-emerald-500/20 text-sm text-emerald-400">
                  <CheckCircle className="h-4 w-4 shrink-0" />
                  No alerts · All systems normal
                </div>
              </>
            ) : (
              <div className="text-center py-12">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg"
                  style={{ background: "linear-gradient(135deg, #0a2e2e, #0f3d3d)" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                    <polyline points="9 12 11 14 15 10"/>
                  </svg>
                </div>
                <p className="text-sm font-medium text-slate-400">No compliance data yet</p>
                <p className="text-xs text-slate-600 mt-1">Metrics appear once you receive payments.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Agent Payments */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AgentPaymentWidget agents={agents} />
      </div>
    </div>
  )
}
