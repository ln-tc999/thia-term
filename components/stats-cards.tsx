"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TrendingUp, Link2, DollarSign, Shield, Loader2 } from "lucide-react"

export function StatsCards() {
  const [data, setData] = useState<{ links: number; volume: number; payments: number; compliance: number } | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const [linksRes, paymentsRes] = await Promise.all([
          fetch('/api/payment-links'),
          fetch('/api/payments?limit=100'),
        ])
        const [links, payments] = await Promise.all([linksRes.json(), paymentsRes.json()])

        const totalVolume = links.data?.reduce((s: number, l: any) => s + (l.totalVolume ?? 0), 0) ?? 0
        const completedPayments = payments.data?.filter((p: any) => p.status === 'completed') ?? []
        const compliance = completedPayments.length > 0
          ? Math.round(completedPayments.reduce((s: number, p: any) => s + (p.complianceScore ?? 0), 0) / completedPayments.length)
          : 100

        setData({
          links: links.data?.length ?? 0,
          volume: totalVolume,
          payments: payments.total ?? 0,
          compliance,
        })
      } catch (e) {
        console.error(e)
      }
    }
    load()
  }, [])

  const stats = data
    ? [
        { title: 'Payment Links', value: data.links.toString(), icon: Link2, color: 'text-emerald-600', bg: 'bg-emerald-50' },
        { title: 'Total Volume', value: `$${data.volume.toLocaleString()}`, icon: DollarSign, color: 'text-teal-600', bg: 'bg-teal-50' },
        { title: 'Payments Processed', value: data.payments.toString(), icon: TrendingUp, color: 'text-violet-600', bg: 'bg-violet-50' },
        { title: 'Avg Compliance Score', value: `${data.compliance}%`, icon: Shield, color: 'text-emerald-600', bg: 'bg-emerald-50' },
      ]
    : []

  if (!data) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-6 flex items-center gap-2 text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading…</span>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {stats.map((s) => (
        <Card key={s.title}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">{s.title}</CardTitle>
            <div className={`p-2 rounded-lg ${s.bg}`}>
              <s.icon className={`h-4 w-4 ${s.color}`} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">{s.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
