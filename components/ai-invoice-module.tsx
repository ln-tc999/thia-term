"use client"

import { useState, useEffect, useRef } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Bot, Plus, FileText, CheckCircle, Clock, AlertTriangle, DollarSign,
  Send, Copy, ExternalLink, Zap, Shield, X, Wallet, Sparkles,
  ChevronRight, MessageSquare, User, Ban,
} from "lucide-react"
import type { Invoice } from "@/app/api/invoices/route"
import { SUPPORTED_CHAINS, DEFAULT_CHAIN_KEY } from "@/lib/chains"

const CHAINS = SUPPORTED_CHAINS

interface Agent {
  id: string
  name: string
  description: string | null
  walletAddress: string | null
  capabilities: string[]
  status: string
  totalEarned: number
  invoiceCount: number
  createdAt: string
}

const statusConfig = {
  draft:     { label: "Draft",     color: "bg-white/[0.06] text-slate-400 border-white/[0.08]",       icon: FileText },
  pending:   { label: "Pending",   color: "bg-amber-500/10 text-amber-400 border-amber-500/20",        icon: Clock },
  paid:      { label: "Paid",      color: "bg-sky-500/10 text-sky-400 border-sky-500/20",  icon: CheckCircle },
  overdue:   { label: "Overdue",   color: "bg-red-500/10 text-red-400 border-red-500/20",              icon: AlertTriangle },
  cancelled: { label: "Cancelled", color: "bg-white/[0.06] text-slate-500 border-white/[0.08]",        icon: X },
}

const networkLabel: Record<string, string> = {
  "t3n_testnet":     "T3N Testnet",
  "t3n":             "T3N Production",
  polygon:           "Polygon",
  ethereum:          "Ethereum",
  celo:              "Celo",
}

interface LineItem {
  description: string
  quantity: number
  unitPrice: string
  total: string
}

const emptyLineItem = (): LineItem => ({ description: "", quantity: 1, unitPrice: "", total: "0.00" })

const defaultForm = () => ({
  issuedTo: "",
  issuedToAddress: "",
  description: "",
  currency: "HSK",
  network: DEFAULT_CHAIN_KEY,
  dueAt: "",
  kycRequired: true,
  selectedAgentId: "",
  agentName: "",
  agentDescription: "",
})

// ─── Create Invoice Dialog ─────────────────────────────────────────────────

function CreateInvoiceDialog({
  open, onOpenChange, agents, onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  agents: Agent[]
  onCreated: (link: string | null) => void
}) {
  const [form, setForm] = useState(defaultForm())
  const [lineItems, setLineItems] = useState<LineItem[]>([emptyLineItem()])
  const [loading, setLoading] = useState(false)

  const updateLineItem = (idx: number, field: keyof LineItem, value: string | number) => {
    const updated = [...lineItems]
    updated[idx] = { ...updated[idx], [field]: value }
    if (field === "quantity" || field === "unitPrice") {
      const qty = field === "quantity" ? Number(value) : Number(updated[idx].quantity)
      const price = field === "unitPrice" ? parseFloat(value as string) || 0 : parseFloat(updated[idx].unitPrice) || 0
      updated[idx].total = (qty * price).toFixed(2)
    }
    setLineItems(updated)
  }

  const totalAmount = lineItems.reduce((sum, item) => sum + parseFloat(item.total || "0"), 0).toFixed(2)

  const handleAgentSelect = (agentId: string) => {
    const agent = agents.find(a => a.id === agentId)
    if (agent) {
      setForm(f => ({ ...f, selectedAgentId: agentId, agentName: agent.name, agentDescription: agent.description ?? "" }))
    } else {
      setForm(f => ({ ...f, selectedAgentId: "", agentName: "", agentDescription: "" }))
    }
  }

  const create = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: form.selectedAgentId || null,
          agentName: form.agentName || null,
          issuedTo: form.issuedTo,
          issuedToAddress: form.issuedToAddress,
          description: form.description,
          currency: form.currency,
          network: form.network,
          dueAt: form.dueAt,
          kycRequired: form.kycRequired,
          lineItems,
          amount: totalAmount,
        }),
      })
      const data = await res.json()
      if (data.success) {
        const linkCode = data.data?.paymentLinkCode
        onCreated(linkCode ? `${window.location.origin}/l/${linkCode}` : null)
        setForm(defaultForm())
        setLineItems([emptyLineItem()])
        onOpenChange(false)
      } else {
        alert(data.error || "Failed to create invoice")
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-[#0f172a] border border-white/10">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <FileText className="h-5 w-5 text-sky-400" />
            New Invoice
          </DialogTitle>
          <DialogDescription className="text-slate-500">Create an invoice and share the payment link with your client.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {/* Client */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-slate-400">Invoice To (Name) *</Label>
              <Input value={form.issuedTo} onChange={e => setForm(f => ({ ...f, issuedTo: e.target.value }))} placeholder="Client name or company"
                className="mt-1 bg-white/[0.04] border-white/10 text-white placeholder:text-slate-600 focus:border-sky-500/50 rounded-xl" />
            </div>
            <div>
              <Label className="text-xs text-slate-400">Client Wallet Address</Label>
              <Input value={form.issuedToAddress} onChange={e => setForm(f => ({ ...f, issuedToAddress: e.target.value }))} placeholder="0x… (optional)"
                className="mt-1 bg-white/[0.04] border-white/10 text-white placeholder:text-slate-600 focus:border-sky-500/50 rounded-xl" />
            </div>
          </div>

          <div>
            <Label className="text-xs text-slate-400">Description</Label>
            <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Services rendered, project details…"
              className="mt-1 bg-white/[0.04] border-white/10 text-white placeholder:text-slate-600 focus:border-sky-500/50 rounded-xl resize-none" rows={2} />
          </div>

          {/* Payment settings */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs text-slate-400">Network</Label>
              <Select value={form.network} onValueChange={v => {
                const chain = CHAINS.find(c => c.key === v)
                setForm(f => ({ ...f, network: v, currency: chain?.tokens[0]?.symbol ?? "HSK" }))
              }}>
                <SelectTrigger className="mt-1 bg-white/[0.04] border-white/10 text-slate-300 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-[#1e293b] border-white/10 text-slate-300">
                  {CHAINS.map(c => <SelectItem key={c.key} value={c.key}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-slate-400">Token</Label>
              <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                <SelectTrigger className="mt-1 bg-white/[0.04] border-white/10 text-slate-300 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-[#1e293b] border-white/10 text-slate-300">
                  {(CHAINS.find(c => c.key === form.network)?.tokens ?? []).map(t => <SelectItem key={t.symbol} value={t.symbol}>{t.symbol}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-slate-400">Due Date</Label>
              <Input type="date" value={form.dueAt} onChange={e => setForm(f => ({ ...f, dueAt: e.target.value }))}
                className="mt-1 bg-white/[0.04] border-white/10 text-white focus:border-sky-500/50 rounded-xl" />
            </div>
          </div>

          {/* KYC */}
          <div className="flex items-center gap-3 p-3 bg-white/[0.04] border border-white/[0.06] rounded-xl">
            <Shield className="h-4 w-4 text-sky-400 shrink-0" />
            <div className="flex-1">
              <p className="text-white text-sm font-medium">Require KYC</p>
              <p className="text-slate-500 text-xs">Payer must complete KYC before payment</p>
            </div>
            <Switch checked={form.kycRequired} onCheckedChange={v => setForm(f => ({ ...f, kycRequired: v }))} />
          </div>

          {/* Optional agent */}
          {agents.length > 0 && (
            <details className="group">
              <summary className="flex items-center gap-2 cursor-pointer text-xs text-slate-500 hover:text-slate-300 select-none list-none">
                <Bot className="h-3.5 w-3.5" />
                Assign to AI Agent <span className="text-slate-600">(optional)</span>
                <ChevronRight className="h-3 w-3 group-open:rotate-90 transition-transform ml-auto" />
              </summary>
              <div className="mt-2">
                <Select value={form.selectedAgentId} onValueChange={handleAgentSelect}>
                  <SelectTrigger className="bg-white/[0.04] border-white/10 text-slate-300 rounded-xl"><SelectValue placeholder="Choose an agent…" /></SelectTrigger>
                  <SelectContent className="bg-[#1e293b] border-white/10 text-slate-300">
                    <SelectItem value="">None</SelectItem>
                    {agents.map(a => (
                      <SelectItem key={a.id} value={a.id}>{a.name}{a.walletAddress ? ` (${a.walletAddress.slice(0, 6)}…)` : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </details>
          )}

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs text-slate-400">Line Items</Label>
              <Button variant="ghost" size="sm" className="text-sky-400 hover:text-sky-300 h-6 text-xs"
                onClick={() => setLineItems([...lineItems, emptyLineItem()])}>
                <Plus className="h-3 w-3 mr-1" /> Add Item
              </Button>
            </div>
            <div className="space-y-2">
              {lineItems.map((item, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <Input className="col-span-5 text-xs h-8 bg-white/[0.04] border-white/10 text-white placeholder:text-slate-600" placeholder="Description" value={item.description}
                    onChange={e => updateLineItem(idx, "description", e.target.value)} />
                  <Input className="col-span-2 text-xs h-8 bg-white/[0.04] border-white/10 text-white" placeholder="Qty" type="number" value={item.quantity}
                    onChange={e => updateLineItem(idx, "quantity", parseInt(e.target.value) || 1)} />
                  <Input className="col-span-2 text-xs h-8 bg-white/[0.04] border-white/10 text-white placeholder:text-slate-600" placeholder="Price" value={item.unitPrice}
                    onChange={e => updateLineItem(idx, "unitPrice", e.target.value)} />
                  <div className="col-span-2 text-right">
                    <span className="text-sky-400 text-xs font-mono">${item.total}</span>
                  </div>
                  <Button variant="ghost" size="sm" className="col-span-1 h-8 w-8 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    onClick={() => setLineItems(lineItems.filter((_, i) => i !== idx))} disabled={lineItems.length === 1}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-3 pt-3 border-t border-white/[0.06]">
              <div className="text-right">
                <p className="text-slate-500 text-xs">Total</p>
                <p className="text-sky-400 font-bold text-xl font-mono">${totalAmount} <span className="text-sm font-normal">{form.currency}</span></p>
              </div>
            </div>
          </div>

          <Button className="w-full bg-gradient-to-r from-sky-600 to-sky-500 hover:from-sky-500 hover:to-sky-400 text-white rounded-xl shadow-lg shadow-sky-900/30" onClick={create}
            disabled={loading || !form.issuedTo || !lineItems[0].description || parseFloat(totalAmount) <= 0}>
            {loading ? "Creating…" : "Create Invoice & Get Payment Link"}
            <Zap className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── AI Chat assistant ─────────────────────────────────────────────────────

function AIAssistantPanel({ onCreateFromAI }: { onCreateFromAI?: (draft: Partial<ReturnType<typeof defaultForm>>) => void }) {
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([
    { role: "assistant", content: "Hi! I can help you draft and send invoices to your clients. Tell me who you want to invoice, for what services, and how much — I'll help you set it all up." },
  ])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }) }, [messages])

  const send = async () => {
    if (!input.trim() || loading) return
    const userMsg = input.trim()
    setInput("")
    setMessages(m => [...m, { role: "user", content: userMsg }])
    setLoading(true)
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg, history: messages }),
      })
      const data = await res.json()
      setMessages(m => [...m, { role: "assistant", content: data.message ?? data.error ?? "Something went wrong." }])
    } catch {
      setMessages(m => [...m, { role: "assistant", content: "Could not reach AI. Check your connection." }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-[520px]">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1 pb-2">
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
            <div className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-white text-xs font-bold ${m.role === "assistant" ? "bg-indigo-500" : "bg-sky-500"}`}>
              {m.role === "assistant" ? <Sparkles className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
            </div>
            <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
              m.role === "assistant" ? "bg-white/[0.06] text-slate-200" : "bg-sky-600 text-white"
            }`}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-indigo-500 shrink-0 flex items-center justify-center">
              <Sparkles className="h-3.5 w-3.5 text-white" />
            </div>
            <div className="bg-white/[0.06] rounded-2xl px-4 py-3 flex gap-1">
              {[0, 1, 2].map(i => (
                <span key={i} className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2 pt-3 border-t border-white/[0.06]">
        <Input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
          placeholder="Ask me to draft an invoice…"
          className="flex-1 bg-white/[0.04] border-white/10 text-white placeholder:text-slate-600 focus:border-sky-500/50 rounded-xl"
          disabled={loading}
        />
        <Button onClick={send} disabled={!input.trim() || loading}
          className="bg-gradient-to-r from-sky-600 to-sky-500 hover:from-sky-500 hover:to-sky-400 text-white rounded-xl shrink-0">
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

// ─── Invoice row ───────────────────────────────────────────────────────────

function InvoiceRow({ invoice, onClick }: { invoice: Invoice; onClick: () => void }) {
  const status = statusConfig[invoice.status] ?? statusConfig.draft
  const StatusIcon = status.icon
  const netLabel = networkLabel[invoice.network] ?? invoice.network

  return (
    <div
      onClick={onClick}
      className="p-4 bg-white/[0.03] border border-white/[0.06] rounded-xl hover:bg-white/[0.05] hover:border-white/[0.10] transition-all cursor-pointer"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-sky-500/10 rounded-lg shrink-0">
            <FileText className="h-4 w-4 text-sky-400" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-white text-sm">{invoice.invoiceNumber}</span>
              <span className="text-xs text-slate-400 bg-white/[0.06] rounded px-1.5 py-0.5">{netLabel}</span>
              {invoice.agentName && (
                <span className="text-xs text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 rounded px-1.5 py-0.5 flex items-center gap-1">
                  <Bot className="h-3 w-3" />{invoice.agentName}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5 truncate">{invoice.issuedTo}{invoice.description ? ` · ${invoice.description}` : ""}</p>
          </div>
        </div>
        <div className="text-right shrink-0 space-y-1">
          <Badge className={`text-xs border ${status.color} flex items-center gap-1`}>
            <StatusIcon className="h-3 w-3" />{status.label}
          </Badge>
          <p className="text-sky-400 font-bold font-mono text-sm">${parseFloat(String(invoice.amount)).toLocaleString()} {invoice.currency}</p>
          {invoice.dueAt ? <p className="text-slate-500 text-xs">Due {new Date(invoice.dueAt).toLocaleDateString()}</p> : null}
        </div>
      </div>
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────

export function AIInvoiceModule() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [stats, setStats] = useState({ total: 0, pending: 0, paid: 0, overdue: 0, totalValue: "0", paidValue: "0" })
  const [showCreate, setShowCreate] = useState(false)
  const [showRegisterAgent, setShowRegisterAgent] = useState(false)
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null)
  const [createdPaymentLink, setCreatedPaymentLink] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState("all")
  const [confirmVoidId, setConfirmVoidId] = useState<string | null>(null)
  const [agentLoading, setAgentLoading] = useState(false)
  const [agentForm, setAgentForm] = useState({ name: "", description: "", walletAddress: "", capabilitiesText: "" })

  useEffect(() => { fetchInvoices(); fetchAgents() }, [filterStatus])

  const fetchInvoices = async () => {
    const url = filterStatus === "all" ? "/api/invoices" : `/api/invoices?status=${filterStatus}`
    const res = await fetch(url)
    const data = await res.json()
    if (data.success) { setInvoices(data.data); setStats(data.stats) }
  }

  const fetchAgents = async () => {
    const res = await fetch("/api/agents")
    const data = await res.json()
    if (data.success) setAgents(data.data)
  }

  const registerAgent = async () => {
    setAgentLoading(true)
    const capabilities = agentForm.capabilitiesText.split(",").map(s => s.trim()).filter(Boolean)
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: agentForm.name, description: agentForm.description || null, walletAddress: agentForm.walletAddress || null, capabilities }),
    })
    const data = await res.json()
    if (data.success) { setShowRegisterAgent(false); setAgentForm({ name: "", description: "", walletAddress: "", capabilitiesText: "" }); fetchAgents() }
    setAgentLoading(false)
  }

  const markAsPaid = async (invoice: Invoice) => {
    await fetch("/api/invoices", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: invoice.id, status: "paid" }) })
    fetchInvoices()
    if (selectedInvoice?.id === invoice.id) setSelectedInvoice({ ...selectedInvoice, status: "paid", paidAt: new Date().toISOString() })
  }

  const voidInvoice = async (invoice: Invoice) => {
    await fetch("/api/invoices", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: invoice.id, status: "cancelled" }) })
    fetchInvoices()
    if (selectedInvoice?.id === invoice.id) setSelectedInvoice({ ...selectedInvoice, status: "cancelled" })
  }

  const copyToClipboard = (text: string) => navigator.clipboard.writeText(text)

  return (
    <div className="space-y-5">
      {/* Payment link created banner */}
      {createdPaymentLink && (
        <div className="flex items-center justify-between gap-4 p-4 bg-sky-500/10 border border-sky-500/20 rounded-2xl">
          <div className="flex items-center gap-3 min-w-0">
            <CheckCircle className="h-5 w-5 text-sky-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-sky-400 font-semibold text-sm">Invoice created — share with your client</p>
              <p className="font-mono text-xs text-sky-400/60 truncate">{createdPaymentLink}</p>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button size="sm" className="bg-sky-500/10 border border-sky-500/20 text-sky-400 hover:bg-sky-500/20 rounded-xl"
              onClick={() => copyToClipboard(createdPaymentLink)}>
              <Copy className="h-3 w-3 mr-1" /> Copy
            </Button>
            <Button size="sm" className="bg-white/[0.04] border border-white/10 text-slate-400 hover:bg-white/10 hover:text-white rounded-xl"
              onClick={() => setCreatedPaymentLink(null)}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: "Total", value: stats.total,
            svg: <svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="#34d399" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3 L17 3 L21 7 L21 23 L5 23 Z"/><polyline points="17,3 17,7 21,7"/><line x1="9" y1="11" x2="17" y2="11"/><line x1="9" y1="14" x2="14" y2="14"/></svg>
          },
          {
            label: "Pending", value: stats.pending,
            svg: <svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="#34d399" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="13" cy="13" r="9"/><polyline points="13,8 13,13 16,16"/></svg>
          },
          {
            label: "Paid", value: stats.paid,
            svg: <svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="#34d399" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="13" cy="13" r="9"/><polyline points="9,13 12,16 17,10"/></svg>
          },
          {
            label: "Total Value", value: `$${parseFloat(stats.totalValue).toLocaleString()}`,
            svg: <svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="#34d399" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="13" y1="3" x2="13" y2="23"/><path d="M18,7 H10.5 C8.5,7 7,8.5 7,10.5 C7,12.5 8.5,14 10.5,14 H15.5 C17.5,14 19,15.5 19,17.5 C19,19.5 17.5,21 15.5,21 H8"/></svg>
          },
        ].map(s => (
          <div key={s.label} className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 flex items-center gap-4 hover:bg-white/[0.05] transition-colors">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center shadow-md shrink-0" style={{ background: 'linear-gradient(135deg, #0a2e2e 0%, #0f3d3d 100%)' }}>
              {s.svg}
            </div>
            <div>
              <p className="text-slate-500 text-xs uppercase tracking-wide">{s.label}</p>
              <p className="text-white font-bold text-2xl mt-0.5 leading-none">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Main tabs */}
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
        <Tabs defaultValue="invoices">
          <TabsList className="mb-5 bg-white/[0.04] border border-white/[0.06] p-1 rounded-xl h-auto gap-0.5">
            <TabsTrigger value="invoices"
              className="data-[state=active]:bg-white/[0.08] data-[state=active]:text-white text-slate-500 rounded-lg px-4 py-2 text-sm font-medium transition-all gap-1.5">
              <FileText className="h-3.5 w-3.5" />Invoices
            </TabsTrigger>
            <TabsTrigger value="ai"
              className="data-[state=active]:bg-white/[0.08] data-[state=active]:text-white text-slate-500 rounded-lg px-4 py-2 text-sm font-medium transition-all gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />AI Assistant
            </TabsTrigger>
            <TabsTrigger value="agents"
              className="data-[state=active]:bg-white/[0.08] data-[state=active]:text-white text-slate-500 rounded-lg px-4 py-2 text-sm font-medium transition-all gap-1.5">
              <Bot className="h-3.5 w-3.5" />Agents
            </TabsTrigger>
          </TabsList>

          {/* ── Invoices tab ── */}
          <TabsContent value="invoices" className="mt-0">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div className="flex gap-1 bg-white/[0.04] border border-white/[0.06] rounded-xl p-1 flex-wrap">
                {["all", "pending", "paid", "overdue", "draft"].map(s => (
                  <button key={s} onClick={() => setFilterStatus(s)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all capitalize ${
                      filterStatus === s ? "bg-white/[0.08] text-white" : "text-slate-500 hover:text-slate-300"
                    }`}>
                    {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
              <Button className="bg-gradient-to-r from-sky-600 to-sky-500 hover:from-sky-500 hover:to-sky-400 text-white rounded-xl shadow-lg shadow-sky-900/30 gap-2"
                onClick={() => setShowCreate(true)}>
                <Plus className="h-4 w-4" /> New Invoice
              </Button>
            </div>

            {invoices.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 mx-auto" style={{ background: "linear-gradient(135deg, #0a2e2e, #0f3d3d)" }}>
                  <FileText className="h-7 w-7 text-sky-400" />
                </div>
                <p className="font-semibold text-white text-base">No invoices yet</p>
                <p className="text-slate-500 text-sm mt-1">Create your first invoice to get a shareable payment link</p>
                <Button className="mt-5 bg-gradient-to-r from-sky-600 to-sky-500 hover:from-sky-500 hover:to-sky-400 text-white rounded-xl shadow-lg shadow-sky-900/30 gap-2"
                  onClick={() => setShowCreate(true)}>
                  <Plus className="h-4 w-4" /> New Invoice
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {invoices.map(inv => (
                  <InvoiceRow key={inv.id} invoice={inv} onClick={() => setSelectedInvoice(inv)} />
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── AI Assistant tab ── */}
          <TabsContent value="ai" className="mt-0">
            <div className="mb-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg, #0a2e2e, #0f3d3d)" }}>
                <Sparkles className="h-5 w-5 text-sky-400" />
              </div>
              <div>
                <span className="font-semibold text-white text-sm">AI Invoice Assistant</span>
                <p className="text-xs text-slate-500">Describe your invoice and the AI will help you draft and send it to clients.</p>
              </div>
            </div>
            <AIAssistantPanel />
          </TabsContent>

          {/* ── Agents tab ── */}
          <TabsContent value="agents" className="mt-0">
            <div className="flex items-center justify-between mb-4">
              <p className="text-slate-500 text-sm">{agents.length} registered agent{agents.length !== 1 ? "s" : ""}</p>
              <Dialog open={showRegisterAgent} onOpenChange={setShowRegisterAgent}>
                <DialogTrigger asChild>
                  <Button className="bg-white/[0.04] border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white rounded-xl gap-2">
                    <Plus className="h-4 w-4" /> Register Agent
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg bg-[#0f172a] border border-white/10">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-white"><Bot className="h-5 w-5 text-sky-400" />Register Agent</DialogTitle>
                    <DialogDescription className="text-slate-500">Register an AI agent with a wallet to issue invoices on-chain autonomously.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 mt-2">
                    <div>
                      <Label className="text-xs text-slate-400">Agent Name *</Label>
                      <Input value={agentForm.name} onChange={e => setAgentForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Analytics Agent"
                        className="mt-1 bg-white/[0.04] border-white/10 text-white placeholder:text-slate-600 focus:border-sky-500/50 rounded-xl" />
                    </div>
                    <div>
                      <Label className="text-xs text-slate-400">Description</Label>
                      <Textarea value={agentForm.description} onChange={e => setAgentForm(f => ({ ...f, description: e.target.value }))} placeholder="What does this agent do?"
                        className="mt-1 bg-white/[0.04] border-white/10 text-white placeholder:text-slate-600 focus:border-sky-500/50 rounded-xl resize-none" rows={2} />
                    </div>
                    <div>
                      <Label className="text-xs text-slate-400">Wallet Address</Label>
                      <Input value={agentForm.walletAddress} onChange={e => setAgentForm(f => ({ ...f, walletAddress: e.target.value }))} placeholder="0x…"
                        className="mt-1 bg-white/[0.04] border-white/10 text-white placeholder:text-slate-600 focus:border-sky-500/50 rounded-xl font-mono text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs text-slate-400">Capabilities (comma-separated)</Label>
                      <Input value={agentForm.capabilitiesText} onChange={e => setAgentForm(f => ({ ...f, capabilitiesText: e.target.value }))} placeholder="data-analysis, reporting"
                        className="mt-1 bg-white/[0.04] border-white/10 text-white placeholder:text-slate-600 focus:border-sky-500/50 rounded-xl" />
                    </div>
                    <Button className="w-full bg-gradient-to-r from-sky-600 to-sky-500 hover:from-sky-500 hover:to-sky-400 text-white rounded-xl shadow-lg shadow-sky-900/30"
                      onClick={registerAgent} disabled={agentLoading || !agentForm.name}>
                      {agentLoading ? "Registering…" : "Register Agent"}<Bot className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            {agents.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 mx-auto" style={{ background: "linear-gradient(135deg, #0a2e2e, #0f3d3d)" }}>
                  <Bot className="h-7 w-7 text-sky-400" />
                </div>
                <p className="font-semibold text-white">No agents registered</p>
                <p className="text-slate-500 text-xs mt-1">Agents can autonomously issue invoices and receive payments to their own wallet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {agents.map(agent => (
                  <div key={agent.id} className="p-4 bg-white/[0.03] border border-white/[0.06] rounded-xl hover:bg-white/[0.05] transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-500/10 rounded-lg"><Bot className="h-4 w-4 text-indigo-400" /></div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-white font-medium text-sm">{agent.name}</p>
                            <Badge className={`text-xs border ${agent.status === "active" ? "bg-sky-500/10 text-sky-400 border-sky-500/20" : "bg-white/[0.06] text-slate-400 border-white/[0.08]"}`}>{agent.status}</Badge>
                          </div>
                          {agent.description && <p className="text-slate-500 text-xs mt-0.5">{agent.description}</p>}
                          {agent.walletAddress && (
                            <div className="flex items-center gap-1 mt-1">
                              <Wallet className="h-3 w-3 text-slate-500" />
                              <span className="text-slate-400 text-xs font-mono">{agent.walletAddress.slice(0, 10)}…{agent.walletAddress.slice(-6)}</span>
                              <button onClick={() => copyToClipboard(agent.walletAddress!)} className="text-slate-500 hover:text-slate-300"><Copy className="h-3 w-3" /></button>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="text-right space-y-1">
                        <p className="text-slate-500 text-xs">{agent.invoiceCount} invoice{agent.invoiceCount !== 1 ? "s" : ""}</p>
                        <p className="text-sky-400 text-xs font-mono">${agent.totalEarned.toLocaleString()} earned</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Create invoice dialog */}
      <CreateInvoiceDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        agents={agents}
        onCreated={link => { setCreatedPaymentLink(link); fetchInvoices(); fetchAgents() }}
      />

      {/* Invoice detail dialog */}
      <Dialog open={!!selectedInvoice} onOpenChange={() => { setSelectedInvoice(null); setConfirmVoidId(null) }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-[#0f172a] border border-white/10">
          {selectedInvoice && (
            <>
              <DialogHeader>
                <div className="flex items-center justify-between pr-6">
                  <DialogTitle className="flex items-center gap-2 text-white">
                    <FileText className="h-5 w-5 text-sky-400" />
                    {selectedInvoice.invoiceNumber}
                  </DialogTitle>
                  <Badge className={`border ${statusConfig[selectedInvoice.status].color}`}>
                    {statusConfig[selectedInvoice.status].label}
                  </Badge>
                </div>
              </DialogHeader>

              <div className="space-y-4 mt-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-white/[0.04] border border-white/[0.06] rounded-xl">
                    <p className="text-slate-500 text-xs font-medium mb-1">From</p>
                    <p className="text-white font-medium text-sm">
                      {selectedInvoice.agentName ? (
                        <span className="flex items-center gap-1"><Bot className="h-3.5 w-3.5 text-indigo-400" />{selectedInvoice.agentName}</span>
                      ) : "You"}
                    </p>
                  </div>
                  <div className="p-3 bg-white/[0.04] border border-white/[0.06] rounded-xl">
                    <p className="text-slate-500 text-xs font-medium mb-1">Billed To</p>
                    <p className="text-white font-medium text-sm">{selectedInvoice.issuedTo}</p>
                    {selectedInvoice.issuedToAddress && (
                      <div className="flex items-center gap-1 mt-1">
                        <p className="text-slate-500 text-xs font-mono">{selectedInvoice.issuedToAddress.slice(0, 10)}…</p>
                        <button onClick={() => copyToClipboard(selectedInvoice.issuedToAddress!)} className="text-slate-500 hover:text-slate-300"><Copy className="h-3 w-3" /></button>
                      </div>
                    )}
                  </div>
                </div>

                {selectedInvoice.description && (
                  <div><p className="text-slate-500 text-xs mb-1">Description</p><p className="text-slate-300 text-sm">{selectedInvoice.description}</p></div>
                )}

                <div>
                  <p className="text-slate-500 text-xs mb-2">Line Items</p>
                  <div className="rounded-xl border border-white/[0.06] overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-white/[0.04] border-white/[0.06]">
                          <TableHead className="text-slate-400 text-xs">Description</TableHead>
                          <TableHead className="text-slate-400 text-xs text-center">Qty</TableHead>
                          <TableHead className="text-slate-400 text-xs text-right">Unit Price</TableHead>
                          <TableHead className="text-slate-400 text-xs text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(selectedInvoice.lineItems ?? []).map((item, idx) => (
                          <TableRow key={idx} className="border-white/[0.04] even:bg-white/[0.02] hover:bg-white/[0.04]">
                            <TableCell className="text-slate-300 text-sm">{item.description}</TableCell>
                            <TableCell className="text-slate-400 text-sm text-center">{item.quantity}</TableCell>
                            <TableCell className="text-slate-400 text-sm text-right font-mono">${item.unitPrice}</TableCell>
                            <TableCell className="text-sky-400 text-sm text-right font-mono font-bold">${item.total}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="flex justify-end mt-2 pt-2 border-t border-white/[0.06]">
                    <div className="text-right">
                      <p className="text-slate-500 text-xs">Total Due</p>
                      <p className="text-sky-400 font-bold text-2xl font-mono">${parseFloat(String(selectedInvoice.amount)).toLocaleString()} {selectedInvoice.currency}</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div className="p-2 bg-white/[0.04] border border-white/[0.06] rounded-lg">
                    <p className="text-slate-500">Issued</p>
                    <p className="text-slate-300">{new Date(selectedInvoice.createdAt).toLocaleDateString()}</p>
                  </div>
                  <div className="p-2 bg-white/[0.04] border border-white/[0.06] rounded-lg">
                    <p className="text-slate-500">Due</p>
                    <p className={selectedInvoice.status === "overdue" ? "text-red-400" : "text-slate-300"}>
                      {selectedInvoice.dueAt ? new Date(selectedInvoice.dueAt).toLocaleDateString() : "—"}
                    </p>
                  </div>
                  {selectedInvoice.paidAt && (
                    <div className="p-2 bg-sky-500/10 border border-sky-500/20 rounded-lg">
                      <p className="text-slate-500">Paid</p>
                      <p className="text-sky-400">{new Date(selectedInvoice.paidAt).toLocaleDateString()}</p>
                    </div>
                  )}
                </div>

                {selectedInvoice.paymentLinkCode && selectedInvoice.status !== "paid" && (
                  <div className="space-y-2">
                    <a href={`/l/${selectedInvoice.paymentLinkCode}`} target="_blank" rel="noopener noreferrer">
                      <Button className="w-full bg-gradient-to-r from-sky-600 to-sky-500 hover:from-sky-500 hover:to-sky-400 text-white rounded-xl shadow-lg shadow-sky-900/30 gap-2">
                        <ExternalLink className="h-4 w-4" /> Pay Now
                      </Button>
                    </a>
                    <Button className="w-full bg-white/[0.04] border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white rounded-xl gap-2"
                      onClick={() => copyToClipboard(`${window.location.origin}/l/${selectedInvoice.paymentLinkCode}`)}>
                      <Copy className="h-4 w-4" /> Copy Payment Link
                    </Button>
                  </div>
                )}

                {selectedInvoice.status !== "paid" && selectedInvoice.status !== "cancelled" && (
                  <Button className="w-full bg-white/[0.04] border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white rounded-xl gap-2"
                    onClick={() => markAsPaid(selectedInvoice)}>
                    <CheckCircle className="h-4 w-4" /> Mark as Paid
                  </Button>
                )}

                {selectedInvoice.status !== "paid" && selectedInvoice.status !== "cancelled" && (
                  confirmVoidId === selectedInvoice.id ? (
                    <div className="flex gap-2">
                      <Button className="flex-1 bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 rounded-xl gap-2"
                        onClick={async () => { setConfirmVoidId(null); await voidInvoice(selectedInvoice) }}>
                        <Ban className="h-4 w-4" /> Confirm Void
                      </Button>
                      <Button className="flex-1 bg-white/[0.04] border border-white/10 text-slate-400 hover:bg-white/10 rounded-xl"
                        onClick={() => setConfirmVoidId(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button className="w-full bg-white/[0.04] border border-white/[0.08] text-slate-500 hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-400 rounded-xl gap-2 transition-colors"
                      onClick={() => setConfirmVoidId(selectedInvoice.id)}>
                      <Ban className="h-4 w-4" /> Void Invoice
                    </Button>
                  )
                )}

                {(selectedInvoice.status === "paid" || selectedInvoice.txHash) && (
                  <Button className="w-full bg-white/[0.04] border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white rounded-xl gap-2"
                    onClick={() => {
                      const inv = selectedInvoice
                      const itemRows = (inv.lineItems ?? []).map((it: LineItem) =>
                        `<tr><td>${it.description}</td><td style="text-align:center">${it.quantity}</td><td style="text-align:right">$${it.unitPrice}</td><td style="text-align:right">$${it.total}</td></tr>`
                      ).join("")
                      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt ${inv.invoiceNumber}</title>
<style>
  body{font-family:sans-serif;padding:40px;color:#111;max-width:700px;margin:auto}
  h1{font-size:22px;margin-bottom:4px}
  p{margin:4px 0;color:#555;font-size:14px}
  table{width:100%;border-collapse:collapse;margin:24px 0}
  th{text-align:left;border-bottom:2px solid #ddd;padding:8px 4px;font-size:13px}
  td{padding:8px 4px;border-bottom:1px solid #eee;font-size:13px}
  .total{text-align:right;font-size:18px;font-weight:bold;margin-top:8px}
  .badge{display:inline-block;background:#d1fae5;color:#065f46;padding:3px 12px;border-radius:999px;font-size:12px;font-weight:700;margin-bottom:16px;letter-spacing:.04em}
  .divider{border:none;border-top:1px solid #eee;margin:20px 0}
  .footer{font-size:11px;color:#aaa;margin-top:32px}
  @media print{.no-print{display:none}}
</style>
</head><body>
<h1 style="color:#059669">Thia-Term</h1>
<div class="badge">✓ PAID</div>
<hr class="divider">
<p><strong>Invoice #:</strong> ${inv.invoiceNumber}</p>
<p><strong>Billed to:</strong> ${inv.issuedTo ?? "—"}${inv.issuedToAddress ? ` &lt;${inv.issuedToAddress}&gt;` : ""}</p>
<p><strong>Issued:</strong> ${new Date(inv.createdAt).toLocaleDateString()}</p>
${inv.paidAt ? `<p><strong>Paid:</strong> ${new Date(inv.paidAt).toLocaleDateString()}</p>` : ""}
<p><strong>Network:</strong> ${inv.network} &nbsp;·&nbsp; <strong>Token:</strong> ${inv.currency}</p>
${itemRows ? `<table><thead><tr><th>Description</th><th style="text-align:center">Qty</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Total</th></tr></thead><tbody>${itemRows}</tbody></table>` : ""}
<div class="total">Total Paid: ${parseFloat(String(inv.amount)).toFixed(2)} ${inv.currency}</div>
${inv.txHash ? `<p class="footer">Transaction: ${inv.txHash}<br>Verified via T3N · thia-term.vercel.app</p>` : ""}
<button class="no-print" onclick="window.print()" style="margin-top:28px;padding:10px 24px;background:#059669;color:white;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600">Print / Save as PDF</button>
<script>window.onload = function(){ window.print(); }</script>
</body></html>`
                      // Open receipt in a new tab so user can read + print/save as PDF
                      const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
                      const url = URL.createObjectURL(blob)
                      const tab = window.open(url, '_blank')
                      // Fallback: if popup blocked, download the file instead
                      if (!tab) {
                        const a = document.createElement('a')
                        a.href = url
                        a.download = `receipt-${inv.invoiceNumber}.html`
                        document.body.appendChild(a)
                        a.click()
                        document.body.removeChild(a)
                      }
                      setTimeout(() => URL.revokeObjectURL(url), 30000)
                    }}>
                    <FileText className="h-4 w-4" /> Download Receipt
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
