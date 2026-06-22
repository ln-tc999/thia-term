"use client"

import { useState, useEffect, useCallback } from "react"
import { motion } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { QrCode, Plus, Copy, Clock, Loader2, ExternalLink, Link2, Unlink, Share2, TrendingUp, Zap, CheckCircle } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

interface PaymentLink {
  id: string
  code: string
  name: string | null
  sourceToken: string
  destStable: string
  amountMin: number | null
  amountMax: number | null
  status: string
  totalVolume: number
  transactions: number
  createdAt: string
}

function SkeletonLinkCard() {
  return (
    <div className="card-surface p-5 animate-pulse">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-4 w-36 bg-white/10 rounded" />
            <div className="h-4 w-16 bg-white/[0.06] rounded" />
          </div>
          <div className="h-3 w-64 bg-white/[0.06] rounded" />
          <div className="flex gap-4 mt-2">
            <div className="h-3 w-16 bg-white/[0.06] rounded" />
            <div className="h-3 w-20 bg-white/[0.06] rounded" />
          </div>
        </div>
        <div className="flex gap-2">
          <div className="h-8 w-20 bg-white/[0.06] rounded-lg" />
          <div className="h-8 w-8 bg-white/[0.06] rounded-lg" />
        </div>
      </div>
    </div>
  )
}

export function PaymentLinksModule() {
  const [links, setLinks] = useState<PaymentLink[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateDialog, setShowCreateDialog] = useState(false)

  const fetchLinks = useCallback(async () => {
    try {
      const res = await fetch('/api/payment-links')
      const data = await res.json()
      if (data.success) setLinks(data.data)
    } catch (e) {
      console.error('Failed to fetch payment links:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchLinks() }, [fetchLinks])

  const copyLink = (code: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/l/${code}`)
    toast.success('Link copied to clipboard')
  }

  const deactivate = async (id: string) => {
    await fetch('/api/payment-links', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: 'inactive' }),
    })
    toast.success('Link deactivated')
    fetchLinks()
  }

  const deleteLink = async (id: string) => {
    if (!confirm('Are you sure you want to delete this link? This cannot be undone.')) return
    await fetch(`/api/payment-links?id=${id}`, { method: 'DELETE' })
    toast.success('Link deleted')
    fetchLinks()
  }

  const activeLinks = links.filter(l => l.status === 'active')
  const inactiveLinks = links.filter(l => l.status !== 'active')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Payment Links</h1>
          <p className="text-slate-500 mt-1 text-sm">Create and share compliant payment links</p>
        </div>
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogTrigger asChild>
            <Button className="bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white shadow-lg shadow-emerald-900/30 rounded-xl">
              <Plus className="h-4 w-4 mr-2" /> Create Link
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg bg-glass border border-white/[0.08] text-white">
            <DialogHeader>
              <DialogTitle className="text-white">New Payment Link</DialogTitle>
              <DialogDescription className="text-slate-500">Create a compliant payment link</DialogDescription>
            </DialogHeader>
            <CreateLinkForm onSuccess={() => { setShowCreateDialog(false); fetchLinks() }} />
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Active Links', value: activeLinks.length.toString(), icon: Zap },
          { label: 'Total Volume', value: `$${links.reduce((s, l) => s + l.totalVolume, 0).toLocaleString()}`, icon: TrendingUp },
          { label: 'Total Payments', value: links.reduce((s, l) => s + l.transactions, 0).toString(), icon: CheckCircle },
        ].map(({ label, value, icon: Icon }, i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.1 + i * 0.06 }}
            className="card-surface p-4"
          >
            <div className="flex items-center gap-2 mb-1">
              <Icon className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-xs text-slate-500">{label}</span>
            </div>
            <p className="text-2xl font-bold text-white">{value}</p>
          </motion.div>
        ))}
      </div>

      <Tabs defaultValue="active">
        <TabsList className="bg-white/[0.04] border border-white/[0.06] p-1 rounded-xl">
          <TabsTrigger
            value="active"
            className="rounded-lg text-slate-500 data-[state=active]:bg-white/[0.08] data-[state=active]:text-white data-[state=active]:shadow-sm"
          >
            Active
            <span className="ml-2 text-xs bg-emerald-500/20 text-emerald-400 rounded-md px-1.5 py-0.5">{activeLinks.length}</span>
          </TabsTrigger>
          <TabsTrigger
            value="inactive"
            className="rounded-lg text-slate-500 data-[state=active]:bg-white/[0.08] data-[state=active]:text-white data-[state=active]:shadow-sm"
          >
            Inactive
            <span className="ml-2 text-xs bg-white/10 text-slate-500 rounded-md px-1.5 py-0.5">{inactiveLinks.length}</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-4 space-y-3">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <SkeletonLinkCard key={i} />)}
            </div>
          ) : activeLinks.length === 0 ? (
            <div className="text-center py-16 card-ghost">
              <div className="icon-well-empty">
                <QrCode className="h-7 w-7 text-emerald-400" />
              </div>
              <p className="font-semibold text-slate-300">No active payment links</p>
              <p className="text-sm text-slate-600 mt-1 mb-4">Create a link to start accepting crypto payments</p>
              <Button
                onClick={() => setShowCreateDialog(true)}
                className="bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl"
              >
                <Plus className="h-4 w-4 mr-2" /> Create your first link
              </Button>
            </div>
          ) : (
            activeLinks.map((link, i) => (
              <motion.div
                key={link.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.04 }}
              >
                <LinkCard link={link} onCopy={copyLink} onDeactivate={deactivate} onDelete={deleteLink} />
              </motion.div>
            ))
          )}
        </TabsContent>

        <TabsContent value="inactive" className="mt-4 space-y-3">
          {inactiveLinks.length === 0 ? (
            <div className="text-center py-12 card-ghost">
              <Clock className="h-10 w-10 mx-auto mb-3 text-slate-600" />
              <p className="text-sm text-slate-500">No inactive links</p>
            </div>
          ) : (
            inactiveLinks.map(link => <LinkCard key={link.id} link={link} onCopy={copyLink} onDeactivate={deactivate} onDelete={deleteLink} />)
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function LinkCard({ link, onCopy, onDeactivate, onDelete }: { link: PaymentLink; onCopy: (c: string) => void; onDeactivate: (id: string) => void; onDelete: (id: string) => void }) {
  const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/l/${link.code}`
  const isActive = link.status === 'active'

  return (
    <div className={cn(
      "rounded-2xl border transition-all p-5 group",
      isActive ? "border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.05]" : "border-white/[0.04] bg-white/[0.02]"
    )}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 mb-2">
            <div className={cn(
              "w-8 h-8 rounded-xl flex items-center justify-center shrink-0",
              isActive ? "bg-emerald-500/10" : "bg-white/[0.04]"
            )}>
              {isActive
                ? <Link2 className="h-4 w-4 text-emerald-400" />
                : <Unlink className="h-4 w-4 text-slate-600" />}
            </div>
            <p className="font-semibold text-slate-200 truncate">{link.name ?? link.code}</p>
            <span className={cn(
              "shrink-0 text-xs px-2 py-0.5 rounded-full font-medium border",
              isActive
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : "bg-white/[0.06] text-slate-500 border-white/10"
            )}>
              {link.status}
            </span>
          </div>
          <p className="text-xs font-mono text-slate-600 mb-3 truncate">{url}</p>
          <div className="flex flex-wrap gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <Zap className="h-3 w-3 text-slate-600" />
              {link.sourceToken}
            </span>
            {(link.amountMin || link.amountMax) && (
              <span>{link.amountMin ?? '0'} – {link.amountMax ?? '∞'}</span>
            )}
            <span className="flex items-center gap-1">
              <Zap className="h-3 w-3 text-slate-600" />
              {link.transactions} payments
            </span>
            <span className="flex items-center gap-1">
              <TrendingUp className="h-3 w-3 text-slate-600" />
              ${link.totalVolume.toLocaleString()} volume
            </span>
          </div>
        </div>
        <div className="flex gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onCopy(link.code)}
            className="bg-white/[0.04] border-white/10 text-slate-300 hover:bg-white/10 hover:text-white rounded-xl"
          >
            <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy
          </Button>
          {typeof navigator !== 'undefined' && navigator.share && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigator.share({ url: `${window.location.origin}/l/${link.code}`, title: link.name ?? link.code })}
              className="bg-white/[0.04] border-white/10 text-slate-300 hover:bg-white/10 hover:text-white rounded-xl"
            >
              <Share2 className="h-3.5 w-3.5" />
            </Button>
          )}
          <a href={`/l/${link.code}`} target="_blank" rel="noopener noreferrer">
            <Button
              variant="outline"
              size="sm"
              className="bg-white/[0.04] border-white/10 text-slate-300 hover:bg-white/10 hover:text-white rounded-xl"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </a>
          {isActive && (
            <Button
              variant="outline"
              size="sm"
              className="bg-amber-500/10 border-amber-500/20 text-amber-400 hover:bg-amber-500/20 rounded-xl"
              onClick={() => onDeactivate(link.id)}
            >
              Pause
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20 rounded-xl"
            onClick={() => onDelete(link.id)}
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  )
}

function CreateLinkForm({ onSuccess }: { onSuccess: () => void }) {
  const [name, setName] = useState('')
  const [token, setToken] = useState('HSK')
  const [amountMin, setAmountMin] = useState('')
  const [amountMax, setAmountMax] = useState('')
  const [loading, setLoading] = useState(false)

  const handleCreate = async () => {
    setLoading(true)
    try {
      const code = `${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now().toString(36)}`
      const res = await fetch('/api/payment-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          name: name || null,
          sourceToken: token,
          destStable: token,
          amountMin: amountMin ? parseFloat(amountMin) : null,
          amountMax: amountMax ? parseFloat(amountMax) : null,
        }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Payment link created!')
        onSuccess()
      } else {
        toast.error(data.error ?? 'Failed to create link')
      }
    } catch (e) {
      toast.error('Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4 pt-2">
      <div className="space-y-1.5">
        <Label className="text-slate-400 text-xs">Link Name</Label>
        <Input
          placeholder="e.g. Conference Ticket"
          value={name}
          onChange={e => setName(e.target.value)}
          className="bg-white/[0.04] border-white/10 text-white placeholder:text-slate-600 focus:border-emerald-500/50 px-4 py-3"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-slate-400 text-xs">Token</Label>
        <Select value={token} onValueChange={setToken}>
          <SelectTrigger className="bg-white/[0.04] border-white/10 text-slate-300 px-4 py-6">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-glass border-white/[0.08] text-slate-300 [&_[role=option]]:px-4 [&_[role=option]]:py-3">
            <SelectItem value="HSK">HSK (native)</SelectItem>
            <SelectItem value="USDC">USDC (HashKey)</SelectItem>
            <SelectItem value="USDT">USDT (HashKey)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-slate-400 text-xs">Min Amount <span className="text-slate-600">(optional)</span></Label>
          <Input
            type="number"
            placeholder="0.00"
            value={amountMin}
            onChange={e => setAmountMin(e.target.value)}
            className="bg-white/[0.04] border-white/10 text-white placeholder:text-slate-600"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-slate-400 text-xs">Max Amount <span className="text-slate-600">(optional)</span></Label>
          <Input
            type="number"
            placeholder="∞"
            value={amountMax}
            onChange={e => setAmountMax(e.target.value)}
            className="bg-white/[0.04] border-white/10 text-white placeholder:text-slate-600"
          />
        </div>
      </div>
      <div className="flex gap-3 pt-2">
        <Button
          variant="outline"
          onClick={onSuccess}
          className="flex-1 bg-white/[0.04] border-white/10 text-slate-300 hover:bg-white/10 hover:text-white rounded-xl"
        >
          Cancel
        </Button>
        <Button
          onClick={handleCreate}
          disabled={loading}
          className="flex-1 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white rounded-xl shadow-lg shadow-emerald-900/30"
        >
          {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating…</> : 'Create Link'}
        </Button>
      </div>
    </div>
  )
}
