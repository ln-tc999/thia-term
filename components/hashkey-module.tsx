"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Layers,
  ArrowUpRight,
  ArrowDownLeft,
  Shield,
  ExternalLink,
  Copy,
  CheckCircle,
  Clock,
  Zap,
  Globe,
  DollarSign,
  Activity,
} from "lucide-react"
import { hashkeyMainnet, hashkeyTokens, hashkeyCompliance } from "@/lib/hashkey"
import { useAccount } from "wagmi"

interface TxRow {
  hash: string
  type: string
  amount: string
  token: string
  from: string
  to: string
  status: string
  time: string
  direction: "in" | "out"
}

export function HashKeyModule() {
  const [copied, setCopied] = useState("")
  const [transactions, setTransactions] = useState<TxRow[]>([])
  const [loadingTx, setLoadingTx] = useState(true)
  const { isConnected, chain } = useAccount()

  useEffect(() => {
    fetch("/api/payments?limit=10&network=hashkey")
      .then((r) => r.json())
      .then((json) => {
        if (json.success) {
          setTransactions(
            json.data.map((p: any) => ({
              hash: p.txHash || p.id,
              type: p.payer ? "Received" : "Payment",
              amount: Number(p.amount).toFixed(2),
              token: p.currency,
              from: p.payer || "—",
              to: "—",
              status: p.status === "completed" ? "confirmed" : p.status,
              time: new Date(p.createdAt).toLocaleDateString(),
              direction: "in" as const,
            }))
          )
        }
      })
      .catch(() => {})
      .finally(() => setLoadingTx(false))
  }, [])

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(""), 2000)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-500/10 to-indigo-500/10 border border-emerald-500/20 rounded-xl p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-emerald-500/20 rounded-xl">
              <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
                <circle cx="16" cy="16" r="16" fill="#059669" fillOpacity="0.2"/>
                <path d="M16 4L25.526 9.5V20.5L16 26L6.474 20.5V9.5L16 4Z" fill="none" stroke="#059669" strokeWidth="1.5"/>
                <path d="M11 16L16 12L21 16L16 20L11 16Z" fill="#059669"/>
              </svg>
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                HashKey Chain
                <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-xs">Mainnet</Badge>
              </h2>
              <p className="text-slate-400 text-sm">Compliance-ready blockchain for regulated finance</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
            <span className={`text-sm font-medium ${isConnected ? 'text-emerald-600' : 'text-slate-500'}`}>
              {isConnected ? (chain?.id === 177 ? 'HashKey Chain' : `Wrong network`) : 'Not connected'}
            </span>
          </div>
        </div>

        {/* Chain stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5">
          {[
            { label: "Chain ID", value: `${hashkeyMainnet.id}`, icon: Layers },
            { label: "Native Token", value: hashkeyMainnet.nativeCurrency.symbol, icon: DollarSign },
            { label: "Block Explorer", value: "Blockscout", icon: ExternalLink },
            { label: "KYC Required", value: hashkeyCompliance.kycRequired ? "Yes" : "No", icon: Shield },
          ].map(stat => (
            <div key={stat.label} className="bg-white/[0.06] rounded-xl p-3 border border-white/[0.08]">
              <div className="flex items-center gap-2 mb-1">
                <stat.icon className="h-3.5 w-3.5 text-slate-500" />
                <p className="text-slate-500 text-xs">{stat.label}</p>
              </div>
              <p className="text-white font-semibold text-sm">{stat.value}</p>
            </div>
          ))}
        </div>

        {/* RPC + Explorer links */}
        <div className="flex flex-wrap gap-2 mt-4">
          <div className="flex items-center gap-2 bg-white/[0.06] border border-white/[0.08] rounded-xl px-3 py-1.5">
            <Globe className="h-3.5 w-3.5 text-slate-500" />
            <span className="text-slate-300 text-xs font-mono">{hashkeyMainnet.rpcUrls.default.http[0]}</span>
            <button onClick={() => copy(hashkeyMainnet.rpcUrls.default.http[0], "rpc")} className="text-slate-500 hover:text-slate-300">
              {copied === "rpc" ? <CheckCircle className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
            </button>
          </div>
          <a
            href={hashkeyMainnet.blockExplorers.default.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-1.5 hover:bg-emerald-500/20 transition-all"
          >
            <ExternalLink className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-emerald-400 text-xs">Open Explorer</span>
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Supported Tokens */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-emerald-400" />
              Supported Tokens
            </CardTitle>
            <CardDescription>Stablecoins and assets on HashKey Chain</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {hashkeyTokens.stablecoins.map(token => (
              <div key={token.symbol} className="flex items-center justify-between p-3 bg-white/[0.04] border border-white/[0.06] rounded-xl">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full overflow-hidden flex items-center justify-center shrink-0">
                    {token.symbol === "USDC" ? (
                      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                        <circle cx="16" cy="16" r="16" fill="#2775CA"/>
                        <path d="M17.333 22.6V24H14.667V22.6C12.8 22.2 11.333 20.933 11.333 19.2H13.333C13.333 20 14.533 20.667 16 20.667C17.467 20.667 18.667 20 18.667 19.2C18.667 18.4 17.867 18 16 17.6C13.6 17.067 11.333 16.267 11.333 14C11.333 12.267 12.8 11 14.667 10.6V9.333H17.333V10.6C19.2 11 20.667 12.267 20.667 14H18.667C18.667 13.2 17.467 12.533 16 12.533C14.533 12.533 13.333 13.2 13.333 14C13.333 14.8 14.133 15.2 16 15.6C18.4 16.133 20.667 16.933 20.667 19.2C20.667 20.933 19.2 22.2 17.333 22.6Z" fill="white"/>
                      </svg>
                    ) : token.symbol === "USDT" ? (
                      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                        <circle cx="16" cy="16" r="16" fill="#26A17B"/>
                        <path d="M17.25 17.312v-.002c-.082.006-.504.031-1.244.031-.647 0-1.103-.022-1.265-.031v.003C11.323 17.175 9 16.619 9 15.947c0-.671 2.323-1.228 5.741-1.367v2.178c.165.012.629.039 1.275.039.775 0 1.165-.031 1.234-.039v-2.177c3.41.138 5.727.696 5.727 1.366 0 .671-2.317 1.228-5.727 1.365zM17.25 13.376v-1.94H21V9H11v2.436h3.741v1.938C10.88 13.553 8 14.282 8 15.947c0 1.665 2.88 2.394 6.741 2.571V23h2.509v-4.484c3.853-.175 6.727-.904 6.727-2.569 0-1.665-2.874-2.394-6.727-2.571z" fill="white"/>
                      </svg>
                    ) : (
                      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                        <circle cx="16" cy="16" r="16" fill="#059669"/>
                        <path d="M16 5L25.526 10.5V21.5L16 27L6.474 21.5V10.5L16 5Z" fill="#059669" stroke="white" strokeWidth="1.5"/>
                        <path d="M11 16L16 12.5L21 16L16 19.5L11 16Z" fill="white"/>
                      </svg>
                    )}
                  </div>
                  <div>
                    <p className="text-white text-sm font-medium">{token.name}</p>
                    <p className="text-slate-500 text-xs font-mono">
                      {token.address
                        ? `${token.address.slice(0, 10)}...${token.address.slice(-6)}`
                        : 'Address TBD — check HashKey explorer'}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-xs">{token.symbol}</Badge>
                  <p className="text-slate-500 text-xs mt-1">{token.decimals} decimals</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Compliance Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4 text-emerald-400" />
              Compliance Framework
            </CardTitle>
            <CardDescription>HashKey Chain regulatory standards</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              {[
                { label: "KYC Verification", status: true, detail: hashkeyCompliance.kycProviders.join(", ") },
                { label: "Sanctions Screening", status: true, detail: "Real-time OFAC & global screening" },
                { label: "Programmable Vault Policies", status: true, detail: "Geofencing, limits, and time windows per vault" },
                { label: "AML Monitoring", status: true, detail: "Automated transaction monitoring" },
              ].map(item => (
                <div key={item.label} className="flex items-start gap-3 p-3 bg-white/[0.04] border border-white/[0.06] rounded-xl">
                  <CheckCircle className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-white text-sm font-medium">{item.label}</p>
                    <p className="text-slate-500 text-xs">{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>
            <div>
              <p className="text-slate-500 text-xs mb-2">Supported Jurisdictions</p>
              <div className="flex flex-wrap gap-2">
                {hashkeyCompliance.supportedJurisdictions.map(j => (
                  <Badge key={j} className="bg-white/[0.06] text-slate-300 border-white/[0.08] text-xs">{j}</Badge>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-2 bg-white/[0.04] border border-white/[0.06] rounded-lg">
                <p className="text-slate-500">Daily Limit</p>
                <p className="text-white font-medium">$1,000,000</p>
              </div>
              <div className="p-2 bg-white/[0.04] border border-white/[0.06] rounded-lg">
                <p className="text-slate-500">Monthly Limit</p>
                <p className="text-white font-medium">$10,000,000</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Transactions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-emerald-400" />
            Recent Transactions on HashKey Chain
          </CardTitle>
          <CardDescription>Your latest on-chain activity</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {loadingTx ? (
            <div className="text-center py-8 text-slate-500">Loading transactions…</div>
          ) : transactions.length === 0 ? (
            <div className="text-center py-8 text-slate-500">No transactions yet</div>
          ) : null}
          {transactions.map((tx, idx) => (
            <div key={idx} className="flex items-center gap-3 p-3 bg-white/[0.04] border border-white/[0.06] rounded-xl hover:bg-white/[0.06] transition-all">
              <div className={`p-2 rounded-full ${tx.direction === "in" ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
                {tx.direction === "in"
                  ? <ArrowDownLeft className="h-4 w-4 text-emerald-400" />
                  : <ArrowUpRight className="h-4 w-4 text-red-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-white text-sm font-medium">{tx.type}</p>
                  <Badge className={`text-xs border ${tx.status === "confirmed" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-amber-500/10 text-amber-400 border-amber-500/20"}`}>
                    {tx.status === "confirmed" ? <CheckCircle className="h-2.5 w-2.5 mr-1" /> : <Clock className="h-2.5 w-2.5 mr-1" />}
                    {tx.status}
                  </Badge>
                </div>
                <p className="text-slate-500 text-xs font-mono truncate">{tx.hash.slice(0, 20)}...{tx.hash.slice(-8)}</p>
              </div>
              <div className="text-right shrink-0">
                <p className={`font-bold text-sm font-mono ${tx.direction === "in" ? "text-emerald-400" : "text-red-400"}`}>
                  {tx.direction === "in" ? "+" : "-"}{tx.amount} {tx.token}
                </p>
                <p className="text-slate-500 text-xs">{tx.time}</p>
              </div>
              <a
                href={`${hashkeyMainnet.blockExplorers.default.url}/tx/${tx.hash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-500 hover:text-emerald-400 shrink-0"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
