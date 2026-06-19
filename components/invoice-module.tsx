"use client"

import React, { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Bot,
  FilePlus,
  FileText,
  FileEdit,
  CheckCircle,
  CheckCircle2,
  Clock,
  AlertCircle,
  AlertTriangle,
  DollarSign,
  Send,
  Copy,
  ExternalLink,
  Trash2,
  Calendar,
  X,
  User,
  Eye,
  MoreHorizontal,
  ChevronDown,
  Plus,
} from "lucide-react"
import type { Invoice } from "@/app/api/invoices/route"
import { SUPPORTED_CHAINS, DEFAULT_CHAIN_KEY } from "@/lib/chains"
import { toast } from "sonner"
import { AgentRulesWidget } from "@/components/agent-rules-widget"
import { cn } from "@/lib/utils"

// All chains (including testnet for hackathon)
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

interface LineItem {
  description: string
  quantity: number
  unitPrice: string
  total: string
}

const statusConfig: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  draft: { label: "Draft", color: "bg-slate-500/10 text-slate-400 border border-slate-500/20", icon: FileEdit },
  pending: { label: "Pending", color: "bg-amber-500/10 text-amber-400 border border-amber-500/20", icon: Clock },
  paid: { label: "Paid", color: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20", icon: CheckCircle2 },
  overdue: { label: "Overdue", color: "bg-red-500/10 text-red-400 border border-red-500/20", icon: AlertCircle },
  cancelled: { label: "Cancelled", color: "bg-slate-500/10 text-slate-500 border border-slate-500/20", icon: AlertTriangle },
}

const CURRENCIES = ["USDC", "USDT", "HSK", "cUSD"]

const emptyLineItem = (): LineItem => ({ description: "", quantity: 1, unitPrice: "", total: "0.00" })

// ─── Create Invoice Modal ────────────────────────────────────────────────────

interface CreateInvoiceModalProps {
  open: boolean
  onClose: () => void
  onCreated: (invoice: Invoice, paymentUrl?: string) => void
  agents: Agent[]
}

function CreateInvoiceModal({ open, onClose, onCreated, agents }: CreateInvoiceModalProps) {
  const today = new Date().toISOString().split("T")[0]
  const defaultDue = new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0]

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [loading, setLoading] = useState(false)

  // Form fields
  const [recipientName, setRecipientName] = useState("")
  const [recipientEmail, setRecipientEmail] = useState("")
  const [invoiceNumber, setInvoiceNumber] = useState("")
  const [issueDate, setIssueDate] = useState(today)
  const [dueDate, setDueDate] = useState(defaultDue)
  const [currency, setCurrency] = useState("USDC")
  const [network, setNetwork] = useState(DEFAULT_CHAIN_KEY)
  const [notes, setNotes] = useState("")
  const [lineItems, setLineItems] = useState<LineItem[]>([emptyLineItem()])
  const [saveDraft, setSaveDraft] = useState(false)

  // Fetch next invoice number on open
  useEffect(() => {
    if (!open) return
    setStep(1)
    setRecipientName("")
    setRecipientEmail("")
    setIssueDate(today)
    setDueDate(defaultDue)
    setCurrency("USDC")
    setNetwork(DEFAULT_CHAIN_KEY)
    setNotes("")
    setLineItems([emptyLineItem()])
    setSaveDraft(false)
    // Fetch next number
    fetch("/api/invoices")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          const year = new Date().getFullYear()
          const next = (d.stats?.total ?? 0) + 1
          setInvoiceNumber(`FL-${year}-${String(next).padStart(3, "0")}`)
        }
      })
      .catch(() => {})
  }, [open])

  const updateLineItem = (idx: number, field: keyof LineItem, value: string | number) => {
    const updated = [...lineItems]
    updated[idx] = { ...updated[idx], [field]: value }
    if (field === "quantity" || field === "unitPrice") {
      const qty = field === "quantity" ? Number(value) : Number(updated[idx].quantity)
      const price =
        field === "unitPrice" ? parseFloat(value as string) || 0 : parseFloat(updated[idx].unitPrice) || 0
      updated[idx].total = (qty * price).toFixed(2)
    }
    setLineItems(updated)
  }

  const subtotal = lineItems.reduce((s, i) => s + parseFloat(i.total || "0"), 0)
  const total = subtotal

  const canProceedStep1 = recipientName.trim() || recipientEmail.trim()
  const canProceedStep2 = lineItems.some((i) => i.description && parseFloat(i.total) > 0)

  const handleSubmit = async (asDraft: boolean) => {
    setLoading(true)
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceNumber,
          recipientName,
          recipientEmail,
          issuedTo: recipientName || recipientEmail,
          issuedToAddress: recipientEmail,
          issueDate,
          dueAt: dueDate,
          currency,
          network,
          notes,
          lineItems,
          subtotal,
          amount: total,
          status: asDraft ? "draft" : "pending",
        }),
      })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error || "Failed to create invoice")
        return
      }
      const paymentUrl = data.data.paymentLinkCode
        ? `${window.location.origin}/pay/invoice/${data.data.id}`
        : undefined
      toast.success(asDraft ? "Invoice saved as draft" : "Invoice sent!")
      onCreated(data.data, paymentUrl)
      onClose()
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-[#0f172a] border border-white/10">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <FileText className="h-5 w-5 text-emerald-400" />
            New Invoice
          </DialogTitle>
          <DialogDescription className="text-slate-500">
            {step === 1 && "Recipient details"}
            {step === 2 && "Line items"}
            {step === 3 && "Review & send"}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-2">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={cn(
                  "w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors",
                  s === step
                    ? "bg-emerald-500 text-white"
                    : s < step
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "bg-white/[0.06] text-slate-500"
                )}
              >
                {s < step ? <CheckCircle className="h-4 w-4" /> : s}
              </div>
              {s < 3 && (
                <div className={cn("h-px w-8", s < step ? "bg-emerald-500/40" : "bg-white/[0.06]")} />
              )}
            </div>
          ))}
          <span className="ml-2 text-xs text-slate-500">Step {step} of 3</span>
        </div>

        {/* ── Step 1: Recipient ── */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-400">Recipient Name</Label>
                <Input
                  placeholder="Acme Corp"
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  className="bg-white/[0.04] border-white/10 text-white placeholder:text-slate-600 focus:border-emerald-500/50 rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-400">Email or Wallet Address</Label>
                <Input
                  placeholder="client@example.com or 0x..."
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  className="bg-white/[0.04] border-white/10 text-white placeholder:text-slate-600 focus:border-emerald-500/50 rounded-xl"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-400">Invoice #</Label>
                <Input
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  className="bg-white/[0.04] border-white/10 text-white placeholder:text-slate-600 focus:border-emerald-500/50 rounded-xl font-mono text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-400 flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  Issue Date
                </Label>
                <Input
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                  className="bg-white/[0.04] border-white/10 text-white placeholder:text-slate-600 focus:border-emerald-500/50 rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-400 flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  Due Date
                </Label>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="bg-white/[0.04] border-white/10 text-white placeholder:text-slate-600 focus:border-emerald-500/50 rounded-xl"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-400">Currency</Label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger className="bg-white/[0.04] border-white/10 text-slate-300 focus:border-emerald-500/50 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1e293b] border-white/10 text-slate-300">
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-400">Network</Label>
                <Select value={network} onValueChange={setNetwork}>
                  <SelectTrigger className="bg-white/[0.04] border-white/10 text-slate-300 focus:border-emerald-500/50 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1e293b] border-white/10 text-slate-300">
                    {CHAINS.map((c) => (
                      <SelectItem key={c.key} value={c.key}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                className="bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white rounded-xl shadow-lg shadow-emerald-900/30"
                disabled={!canProceedStep1}
                onClick={() => setStep(2)}
              >
                Next: Line Items
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 2: Line Items ── */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="rounded-xl border border-white/[0.06] overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-white/[0.04] border-white/[0.06]">
                    <TableHead className="text-slate-400 font-medium">Description</TableHead>
                    <TableHead className="text-slate-400 font-medium w-20 text-center">Qty</TableHead>
                    <TableHead className="text-slate-400 font-medium w-32 text-right">Unit Price</TableHead>
                    <TableHead className="text-slate-400 font-medium w-28 text-right">Amount</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lineItems.map((item, idx) => (
                    <TableRow key={idx} className="border-white/[0.04] even:bg-white/[0.02] hover:bg-white/[0.04]">
                      <TableCell className="py-2 pr-2">
                        <Input
                          placeholder="Service description"
                          value={item.description}
                          onChange={(e) => updateLineItem(idx, "description", e.target.value)}
                          className="border-0 bg-transparent shadow-none focus-visible:ring-0 p-0 h-8 text-white placeholder:text-slate-600"
                        />
                      </TableCell>
                      <TableCell className="py-2 px-2">
                        <Input
                          type="number"
                          min={1}
                          value={item.quantity}
                          onChange={(e) => updateLineItem(idx, "quantity", Number(e.target.value))}
                          className="border-0 bg-transparent shadow-none focus-visible:ring-0 p-0 h-8 text-center text-white"
                        />
                      </TableCell>
                      <TableCell className="py-2 px-2">
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          placeholder="0.00"
                          value={item.unitPrice}
                          onChange={(e) => updateLineItem(idx, "unitPrice", e.target.value)}
                          className="border-0 bg-transparent shadow-none focus-visible:ring-0 p-0 h-8 text-right text-white placeholder:text-slate-600"
                        />
                      </TableCell>
                      <TableCell className="py-2 px-2 text-right font-medium text-white">
                        {parseFloat(item.total).toLocaleString("en-US", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </TableCell>
                      <TableCell className="py-2 pl-0">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-slate-500 hover:text-red-400 hover:bg-red-500/10"
                          disabled={lineItems.length === 1}
                          onClick={() => setLineItems(lineItems.filter((_, i) => i !== idx))}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="bg-white/[0.04] border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white rounded-xl"
              onClick={() => setLineItems([...lineItems, emptyLineItem()])}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Line Item
            </Button>

            {/* Subtotal */}
            <div className="flex justify-end">
              <div className="w-64 space-y-2 border-t border-white/[0.06] pt-3">
                <div className="flex justify-between text-sm text-slate-400">
                  <span>Subtotal</span>
                  <span>{subtotal.toFixed(2)} {currency}</span>
                </div>
                <div className="flex justify-between font-semibold text-white text-base">
                  <span>Total</span>
                  <span>{total.toFixed(2)} {currency}</span>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400">Notes (optional)</Label>
              <Textarea
                placeholder="Payment terms, bank details, or any other notes..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="bg-white/[0.04] border-white/10 text-white placeholder:text-slate-600 focus:border-emerald-500/50 rounded-xl resize-none"
                rows={3}
              />
            </div>

            <div className="flex justify-between">
              <Button
                className="bg-white/[0.04] border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white rounded-xl"
                onClick={() => setStep(1)}
              >
                Back
              </Button>
              <Button
                className="bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white rounded-xl shadow-lg shadow-emerald-900/30"
                disabled={!canProceedStep2}
                onClick={() => setStep(3)}
              >
                Review Invoice
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 3: Review ── */}
        {step === 3 && (
          <div className="space-y-5">
            {/* Invoice preview */}
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-6 space-y-5">
              {/* Header */}
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-2xl font-bold text-white tracking-tight">Invoice</p>
                  <p className="text-slate-500 font-mono text-sm mt-0.5">{invoiceNumber}</p>
                </div>
                <div className="text-right text-sm text-slate-500 space-y-0.5">
                  <p>Issue: <span className="text-slate-300">{issueDate}</span></p>
                  <p>Due: <span className="text-slate-300">{dueDate}</span></p>
                </div>
              </div>

              {/* Bill to */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Bill To</p>
                  <p className="font-medium text-white">{recipientName || "—"}</p>
                  <p className="text-slate-400">{recipientEmail || "—"}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Payment</p>
                  <p className="font-medium text-white">{currency}</p>
                  <p className="text-slate-400">{CHAINS.find(c => c.key === network)?.name || network}</p>
                </div>
              </div>

              {/* Line items */}
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    <th className="text-left text-slate-500 font-normal py-1.5">Description</th>
                    <th className="text-center text-slate-500 font-normal py-1.5 w-12">Qty</th>
                    <th className="text-right text-slate-500 font-normal py-1.5 w-24">Price</th>
                    <th className="text-right text-slate-500 font-normal py-1.5 w-24">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.filter(i => i.description).map((item, idx) => (
                    <tr key={idx} className="border-b border-white/[0.04]">
                      <td className="py-2 text-slate-300">{item.description}</td>
                      <td className="py-2 text-center text-slate-400">{item.quantity}</td>
                      <td className="py-2 text-right text-slate-400">{parseFloat(item.unitPrice || "0").toFixed(2)}</td>
                      <td className="py-2 text-right font-medium text-white">{parseFloat(item.total).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Total */}
              <div className="flex justify-end pt-1">
                <div className="w-48 space-y-1.5">
                  <div className="flex justify-between text-sm text-slate-400">
                    <span>Subtotal</span>
                    <span>{subtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-white text-base border-t border-white/[0.06] pt-1.5">
                    <span>Total</span>
                    <span>{total.toFixed(2)} {currency}</span>
                  </div>
                </div>
              </div>

              {notes && (
                <div className="pt-2 border-t border-white/[0.06] text-sm text-slate-400">
                  <span className="font-medium text-slate-300">Notes: </span>{notes}
                </div>
              )}
            </div>

            <div className="flex justify-between">
              <Button
                className="bg-white/[0.04] border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white rounded-xl"
                onClick={() => setStep(2)}
              >
                Back
              </Button>
              <div className="flex gap-2">
                <Button
                  className="bg-white/[0.04] border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white rounded-xl"
                  disabled={loading}
                  onClick={() => handleSubmit(true)}
                >
                  Save as Draft
                </Button>
                <Button
                  className="bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white rounded-xl shadow-lg shadow-emerald-900/30 gap-1.5"
                  disabled={loading}
                  onClick={() => handleSubmit(false)}
                >
                  {loading ? (
                    <span className="flex items-center gap-1.5">
                      <div className="h-3.5 w-3.5 bg-white/[0.06] rounded animate-pulse" />
                      Sending...
                    </span>
                  ) : (
                    <>
                      <Send className="h-3.5 w-3.5" />
                      Send Invoice
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Invoice Detail Modal ────────────────────────────────────────────────────

interface InvoiceDetailModalProps {
  invoice: Invoice | null
  onClose: () => void
  onMarkPaid: (invoice: Invoice) => void
}

function InvoiceDetailModal({ invoice, onClose, onMarkPaid }: InvoiceDetailModalProps) {
  if (!invoice) return null

  const paymentUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/pay/invoice/${invoice.id}`
  const cfg = statusConfig[invoice.status] ?? statusConfig.draft

  const copyLink = () => {
    navigator.clipboard.writeText(paymentUrl)
    toast.success("Payment link copied!")
  }

  return (
    <Dialog open={!!invoice} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl bg-[#0f172a] border border-white/10 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center justify-between pr-6">
            <span className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-emerald-400" />
              {invoice.invoiceNumber}
            </span>
            <Badge className={cn("text-xs flex items-center gap-1", cfg.color)}>
              <cfg.icon className="h-3 w-3" />{cfg.label}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Meta */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-0.5">Bill To</p>
              <p className="font-medium text-white">{invoice.issuedTo || "—"}</p>
              {invoice.issuedToAddress && (
                <p className="text-slate-400 font-mono text-xs truncate">{invoice.issuedToAddress}</p>
              )}
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-0.5">Amount</p>
              <p className="font-bold text-white text-lg">
                {invoice.amount.toFixed(2)}{" "}
                <span className="text-sm font-normal text-slate-400">{invoice.currency}</span>
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs text-slate-500">Network</p>
              <p className="text-slate-300 capitalize">{invoice.network}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Due</p>
              <p className="text-slate-300">{invoice.dueAt ? new Date(invoice.dueAt).toLocaleDateString() : "—"}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Creator</p>
              <p className="text-slate-300">{invoice.agentId ? `Agent: ${invoice.agentName}` : "You"}</p>
            </div>
          </div>

          {/* Line items */}
          {Array.isArray(invoice.lineItems) && invoice.lineItems.length > 0 && (
            <div className="rounded-xl border border-white/[0.06] overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-white/[0.04]">
                  <tr>
                    <th className="text-left text-slate-400 font-normal px-3 py-2">Description</th>
                    <th className="text-center text-slate-400 font-normal px-3 py-2 w-12">Qty</th>
                    <th className="text-right text-slate-400 font-normal px-3 py-2 w-24">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(invoice.lineItems as LineItem[]).map((item, i) => (
                    <tr key={i} className="border-t border-white/[0.04] even:bg-white/[0.02] hover:bg-white/[0.04]">
                      <td className="px-3 py-2 text-slate-300">{item.description}</td>
                      <td className="px-3 py-2 text-center text-slate-400">{item.quantity}</td>
                      <td className="px-3 py-2 text-right font-medium text-white">{parseFloat(item.total).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Total */}
          <div className="flex justify-end">
            <div className="font-bold text-white text-base">
              Total: {invoice.amount.toFixed(2)} {invoice.currency}
            </div>
          </div>

          {/* Payment link */}
          {invoice.status !== "draft" && (
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-3 space-y-2">
              <p className="text-xs text-slate-500 font-medium">Payment Link</p>
              <div className="flex items-center gap-2">
                <code className="text-xs text-slate-400 flex-1 truncate">{paymentUrl}</code>
                <Button
                  size="sm"
                  className="shrink-0 h-7 text-xs bg-white/[0.04] border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white rounded-xl"
                  onClick={copyLink}
                >
                  <Copy className="h-3 w-3 mr-1" /> Copy
                </Button>
                <a href={paymentUrl} target="_blank" rel="noopener noreferrer">
                  <Button
                    size="sm"
                    className="shrink-0 h-7 text-xs bg-white/[0.04] border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white rounded-xl"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                </a>
              </div>
            </div>
          )}

          {/* Notes */}
          {(invoice as any).notes && (
            <div className="text-sm text-slate-400 border-t border-white/[0.06] pt-3">
              <span className="font-medium text-slate-300">Notes: </span>
              {(invoice as any).notes}
            </div>
          )}

          {/* TX hash */}
          {invoice.txHash && (
            <div className="text-xs text-slate-500 border-t border-white/[0.06] pt-3">
              <span className="font-medium text-slate-400">Tx: </span>
              <code className="font-mono">{invoice.txHash.slice(0, 12)}…{invoice.txHash.slice(-8)}</code>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            {invoice.status === "pending" && (
              <Button
                size="sm"
                className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 rounded-xl"
                onClick={() => onMarkPaid(invoice)}
              >
                <CheckCircle className="h-3.5 w-3.5 mr-1.5" /> Mark as Paid
              </Button>
            )}
            {invoice.status !== "draft" && (
              <Button
                size="sm"
                className="bg-white/[0.04] border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white rounded-xl"
                onClick={copyLink}
              >
                <Send className="h-3.5 w-3.5 mr-1.5" /> Share Link
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Register Agent Modal ────────────────────────────────────────────────────

interface RegisterAgentModalProps {
  open: boolean
  onClose: () => void
  onCreated: () => void
}

function RegisterAgentModal({ open, onClose, onCreated }: RegisterAgentModalProps) {
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ name: "", description: "", walletAddress: "", capabilitiesText: "" })

  const handleSubmit = async () => {
    setLoading(true)
    const capabilities = form.capabilitiesText.split(",").map((s) => s.trim()).filter(Boolean)
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name, description: form.description || null, walletAddress: form.walletAddress || null, capabilities }),
    })
    const data = await res.json()
    setLoading(false)
    if (data.success) {
      setForm({ name: "", description: "", walletAddress: "", capabilitiesText: "" })
      toast.success("Agent registered!")
      onCreated()
      onClose()
    } else {
      toast.error(data.error || "Failed to register agent")
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md bg-[#0f172a] border border-white/10">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Bot className="h-5 w-5 text-emerald-400" />
            Register Agent
          </DialogTitle>
          <DialogDescription className="text-slate-500">
            Add an AI agent that can issue invoices autonomously.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-400">Agent Name *</Label>
            <Input
              placeholder="My Invoice Bot"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="bg-white/[0.04] border-white/10 text-white placeholder:text-slate-600 focus:border-emerald-500/50 rounded-xl"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-400">Description</Label>
            <Textarea
              placeholder="What this agent does..."
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="bg-white/[0.04] border-white/10 text-white placeholder:text-slate-600 focus:border-emerald-500/50 rounded-xl resize-none"
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-400">Wallet Address (optional)</Label>
            <Input
              placeholder="0x... (auto-derived if blank)"
              value={form.walletAddress}
              onChange={(e) => setForm({ ...form, walletAddress: e.target.value })}
              className="bg-white/[0.04] border-white/10 text-white placeholder:text-slate-600 focus:border-emerald-500/50 rounded-xl font-mono text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-400">Capabilities (comma-separated)</Label>
            <Input
              placeholder="invoicing, payroll, billing"
              value={form.capabilitiesText}
              onChange={(e) => setForm({ ...form, capabilitiesText: e.target.value })}
              className="bg-white/[0.04] border-white/10 text-white placeholder:text-slate-600 focus:border-emerald-500/50 rounded-xl"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              className="bg-white/[0.04] border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white rounded-xl"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              className="bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white rounded-xl shadow-lg shadow-emerald-900/30"
              disabled={!form.name || loading}
              onClick={handleSubmit}
            >
              {loading ? "Registering..." : "Register Agent"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main Module ─────────────────────────────────────────────────────────────

export function InvoiceModule() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [stats, setStats] = useState({ total: 0, pending: 0, paid: 0, overdue: 0, totalValue: "0", paidValue: "0" })
  const [filterStatus, setFilterStatus] = useState("all")
  const [filterCreator, setFilterCreator] = useState("all") // "all" | "human" | "agent"
  const [showCreate, setShowCreate] = useState(false)
  const [showRegisterAgent, setShowRegisterAgent] = useState(false)
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null)
  const [createdPaymentUrl, setCreatedPaymentUrl] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState("invoices")

  const fetchInvoices = useCallback(async () => {
    const params = new URLSearchParams()
    if (filterStatus !== "all") params.set("status", filterStatus)
    if (filterCreator !== "all") params.set("creatorType", filterCreator)
    const res = await fetch(`/api/invoices${params.toString() ? "?" + params.toString() : ""}`)
    const data = await res.json()
    if (data.success) {
      setInvoices(data.data)
      setStats(data.stats)
    }
  }, [filterStatus, filterCreator])

  const fetchAgents = useCallback(async () => {
    const res = await fetch("/api/agents")
    const data = await res.json()
    if (data.success) setAgents(data.data)
  }, [])

  useEffect(() => {
    fetchInvoices()
    fetchAgents()
  }, [fetchInvoices, fetchAgents])

  const markAsPaid = async (invoice: Invoice) => {
    await fetch("/api/invoices", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: invoice.id, status: "paid" }),
    })
    fetchInvoices()
    if (selectedInvoice?.id === invoice.id) {
      setSelectedInvoice({ ...selectedInvoice, status: "paid", paidAt: new Date().toISOString() })
    }
    toast.success("Invoice marked as paid")
  }

  const handleCreated = (invoice: Invoice, paymentUrl?: string) => {
    if (paymentUrl) setCreatedPaymentUrl(paymentUrl)
    fetchInvoices()
    fetchAgents()
  }

  const filteredInvoices = invoices // already filtered by API

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Invoices</h1>
          <p className="text-slate-500 text-sm mt-0.5">Send and manage crypto-native invoices. Human or AI-generated.</p>
        </div>
      </div>

      {/* Payment URL banner */}
      {createdPaymentUrl && (
        <div className="flex items-center justify-between gap-4 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl">
          <div className="flex items-center gap-3 min-w-0">
            <CheckCircle className="h-5 w-5 text-emerald-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-emerald-400 font-semibold text-sm">Invoice sent — share this link with your client</p>
              <p className="font-mono text-xs text-emerald-400/60 truncate">{createdPaymentUrl}</p>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              size="sm"
              className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 rounded-xl"
              onClick={() => { navigator.clipboard.writeText(createdPaymentUrl); toast.success("Copied!") }}
            >
              <Copy className="h-3 w-3 mr-1" /> Copy
            </Button>
            <Button
              size="sm"
              className="bg-white/[0.04] border border-white/10 text-slate-400 hover:bg-white/10 hover:text-white rounded-xl"
              onClick={() => setCreatedPaymentUrl(null)}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: "Total",
            value: stats.total,
            icon: (
              <svg viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/>
              </svg>
            ),
          },
          {
            label: "Pending",
            value: stats.pending,
            icon: (
              <svg viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
            ),
          },
          {
            label: "Paid",
            value: stats.paid,
            icon: (
              <svg viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
            ),
          },
          {
            label: "Total Value",
            value: `$${parseFloat(stats.totalValue).toLocaleString()}`,
            icon: (
              <svg viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
                <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
              </svg>
            ),
          },
        ].map((s) => (
          <div key={s.label} className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 flex items-center gap-4 hover:bg-white/[0.05] transition-colors">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: "linear-gradient(135deg, #0a2e2e, #0f3d3d)" }}
            >
              {s.icon}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{s.label}</p>
              <p className="text-white font-bold text-2xl mt-0.5 leading-none">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center justify-between mb-5">
          <TabsList className="bg-white/[0.04] border border-white/[0.06] p-1 rounded-xl h-auto gap-0.5">
            <TabsTrigger
              value="invoices"
              className="data-[state=active]:bg-white/[0.08] data-[state=active]:text-white text-slate-500 rounded-lg px-4 py-2 text-sm font-medium transition-all"
            >
              <FileText className="h-3.5 w-3.5 mr-1.5" />
              Invoices
            </TabsTrigger>
            <TabsTrigger
              value="agents"
              className="data-[state=active]:bg-white/[0.08] data-[state=active]:text-white text-slate-500 rounded-lg px-4 py-2 text-sm font-medium transition-all"
            >
              <Bot className="h-3.5 w-3.5 mr-1.5" />
              Agents
              {agents.length > 0 && (
                <span className="ml-1.5 bg-white/[0.06] text-slate-400 text-xs rounded-full px-1.5 py-0.5 leading-none">{agents.length}</span>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="rules"
              className="data-[state=active]:bg-white/[0.08] data-[state=active]:text-white text-slate-500 rounded-lg px-4 py-2 text-sm font-medium transition-all"
            >
              <Send className="h-3.5 w-3.5 mr-1.5" />
              Rules
            </TabsTrigger>
          </TabsList>
          <Button
            className="bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white rounded-xl shadow-lg shadow-emerald-900/30 gap-2 px-5"
            onClick={() => setShowCreate(true)}
          >
            <Plus className="h-4 w-4" />
            New Invoice
          </Button>
        </div>

        {/* ── Invoices Tab ── */}
        <TabsContent value="invoices" className="mt-0">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="flex gap-1 bg-white/[0.04] border border-white/[0.06] rounded-xl p-1">
              {["all", "pending", "paid", "overdue", "draft"].map((s) => (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-medium transition-all capitalize",
                    filterStatus === s
                      ? "bg-white/[0.08] text-white"
                      : "text-slate-500 hover:text-slate-300"
                  )}
                >
                  {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
            <div className="flex gap-1 bg-white/[0.04] border border-white/[0.06] rounded-xl p-1">
              {[
                { value: "all", label: "All" },
                { value: "human", label: "Human" },
                { value: "agent", label: "Agent" },
              ].map((c) => (
                <button
                  key={c.value}
                  onClick={() => setFilterCreator(c.value)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                    filterCreator === c.value
                      ? "bg-white/[0.08] text-white"
                      : "text-slate-500 hover:text-slate-300"
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden">
            {filteredInvoices.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
                  style={{ background: "linear-gradient(135deg, #0a2e2e, #0f3d3d)" }}
                >
                  <FileText className="h-7 w-7 text-emerald-400" />
                </div>
                <p className="text-white font-semibold text-base">No invoices yet</p>
                <p className="text-slate-500 text-sm mt-1 max-w-xs">Create your first invoice to start getting paid on-chain.</p>
                <Button
                  className="mt-5 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white rounded-xl shadow-lg shadow-emerald-900/30 gap-2"
                  onClick={() => setShowCreate(true)}
                >
                  <Plus className="h-4 w-4" />
                  New Invoice
                </Button>
              </div>
            ) : (
              <div className="divide-y divide-white/[0.04]">
                {filteredInvoices.map((inv) => {
                  const cfg = statusConfig[inv.status] ?? statusConfig.draft
                  return (
                    <div
                      key={inv.id}
                      className="flex items-center gap-4 px-5 py-4 hover:bg-white/[0.04] cursor-pointer transition-colors group"
                      onClick={() => setSelectedInvoice(inv)}
                    >
                      {/* Icon */}
                      <div className="w-10 h-10 rounded-xl bg-white/[0.04] flex items-center justify-center shrink-0 group-hover:bg-emerald-500/10 transition-colors">
                        <FileText className="h-4.5 w-4.5 text-slate-500 group-hover:text-emerald-400 transition-colors" />
                      </div>

                      {/* Invoice info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-semibold text-white leading-none">{inv.invoiceNumber}</span>
                          <span className="text-[11px] bg-white/[0.06] text-slate-400 px-2 py-0.5 rounded-full capitalize leading-none">{inv.network}</span>
                          {inv.agentId && (
                            <span className="text-[11px] bg-purple-500/10 text-purple-400 border border-purple-500/20 px-2 py-0.5 rounded-full leading-none flex items-center gap-1">
                              <Bot className="h-2.5 w-2.5" />{inv.agentName || "Agent"}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mt-1 truncate">
                          {inv.issuedTo
                            ? inv.issuedTo
                            : inv.issuedToAddress
                            ? <span className="font-mono">{inv.issuedToAddress.slice(0, 10)}…</span>
                            : "No recipient"}
                        </p>
                      </div>

                      {/* Status + amount */}
                      <div className="flex items-center gap-4 shrink-0">
                        <Badge className={cn("text-xs flex items-center gap-1 hidden sm:flex", cfg.color)}>
                          <cfg.icon className="h-3 w-3" />{cfg.label}
                        </Badge>
                        <div className="text-right min-w-[88px]">
                          <p className="font-semibold text-white text-sm leading-none">
                            {inv.amount.toFixed(2)}{" "}
                            <span className="font-normal text-slate-500 text-xs">{inv.currency}</span>
                          </p>
                          {inv.dueAt && (
                            <p className="text-xs text-slate-500 mt-1">
                              Due {new Date(inv.dueAt).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })}
                            </p>
                          )}
                        </div>
                        {/* Hover actions */}
                        <div
                          className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 text-slate-500 hover:text-white hover:bg-white/[0.06]"
                            onClick={(e) => { e.stopPropagation(); setSelectedInvoice(inv) }}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          {inv.status === "pending" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0 text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10"
                              onClick={(e) => { e.stopPropagation(); markAsPaid(inv) }}
                            >
                              <CheckCircle className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Agents Tab ── */}
        <TabsContent value="agents" className="mt-0">
          <div className="flex justify-end mb-4">
            <Button
              className="bg-white/[0.04] border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white rounded-xl gap-1.5"
              onClick={() => setShowRegisterAgent(true)}
            >
              <Plus className="h-4 w-4" />
              Register Agent
            </Button>
          </div>
          {agents.length === 0 ? (
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl">
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
                  style={{ background: "linear-gradient(135deg, #0a2e2e, #0f3d3d)" }}
                >
                  <Bot className="h-7 w-7 text-emerald-400" />
                </div>
                <p className="text-white font-semibold">No agents registered</p>
                <p className="text-slate-500 text-sm mt-1">Register an AI agent to issue invoices autonomously</p>
                <Button
                  className="mt-4 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white rounded-xl shadow-lg shadow-emerald-900/30 gap-1.5"
                  onClick={() => setShowRegisterAgent(true)}
                >
                  <Plus className="h-4 w-4" />
                  Register Agent
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {agents.map((agent) => (
                <div key={agent.id} className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 hover:bg-white/[0.05] transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                        <Bot className="h-5 w-5 text-purple-400" />
                      </div>
                      <div>
                        <p className="font-semibold text-white">{agent.name}</p>
                        {agent.description && <p className="text-slate-500 text-xs mt-0.5">{agent.description}</p>}
                      </div>
                    </div>
                    <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs">
                      {agent.status}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
                    <div>
                      <p className="text-xs text-slate-500">Invoices</p>
                      <p className="font-semibold text-white">{agent.invoiceCount}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Total Earned</p>
                      <p className="font-semibold text-white">${agent.totalEarned.toFixed(2)}</p>
                    </div>
                  </div>
                  {agent.walletAddress && (
                    <p className="mt-3 text-xs text-slate-500 font-mono truncate">{agent.walletAddress}</p>
                  )}
                  {Array.isArray(agent.capabilities) && agent.capabilities.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {agent.capabilities.map((cap) => (
                        <span key={cap} className="text-xs bg-white/[0.04] border border-white/[0.06] text-slate-400 px-2 py-0.5 rounded-full">{cap}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Rules Tab ── */}
        <TabsContent value="rules" className="mt-0">
          <AgentRulesWidget agents={agents} />
        </TabsContent>
      </Tabs>

      {/* Modals */}
      <CreateInvoiceModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={handleCreated}
        agents={agents}
      />
      <RegisterAgentModal
        open={showRegisterAgent}
        onClose={() => setShowRegisterAgent(false)}
        onCreated={fetchAgents}
      />
      <InvoiceDetailModal
        invoice={selectedInvoice}
        onClose={() => setSelectedInvoice(null)}
        onMarkPaid={markAsPaid}
      />
    </div>
  )
}
