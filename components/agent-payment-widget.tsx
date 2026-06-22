"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Bot, CheckCircle, ExternalLink, User, ArrowRight, Zap, Shield, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

interface AgentPaymentWidgetProps {
  agents: { id: string; name: string; walletAddress?: string | null }[]
}

export function AgentPaymentWidget({ agents }: AgentPaymentWidgetProps) {
  const [fromAgent, setFromAgent] = useState('')
  const [toType, setToType] = useState<'human' | 'agent'>('human')
  const [toAddress, setToAddress] = useState('')
  const [toAgent, setToAgent] = useState('')
  const [amount, setAmount] = useState('')
  const [token, setToken] = useState('HSK')
  const [memo, setMemo] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ txHash: string; txUrl: string } | null>(null)
  const [error, setError] = useState('')

  async function handlePay() {
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const res = await fetch('/api/agents/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: fromAgent,
          toAddress: toType === 'human' ? toAddress : undefined,
          toAgentId: toType === 'agent' ? toAgent : undefined,
          amount: parseFloat(amount),
          token,
          memo,
          paymentType: toType === 'agent' ? 'agent-to-agent' : 'agent-to-human',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Payment failed')
      setResult({ txHash: data.txHash, txUrl: data.txUrl })
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const canPay = fromAgent && amount && parseFloat(amount) > 0 && (toType === 'human' ? toAddress : toAgent)

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.55, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-6"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-500/10 flex items-center justify-center">
            <Bot className="w-5 h-5 text-sky-400" />
          </div>
          <div>
            <h3 className="font-bold text-white text-base">Agent Payments</h3>
            <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
              <Shield className="w-3 h-3 text-sky-400" />
              Autonomous settlements via T3N TEE
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {/* From Agent */}
        <div className="space-y-1.5">
          <Label className="text-xs text-slate-400 font-medium">From Agent</Label>
          <Select value={fromAgent} onValueChange={setFromAgent}>
            <SelectTrigger className="bg-white/[0.04] border-white/10 text-slate-300 h-12">
              <SelectValue placeholder="Select agent..." />
            </SelectTrigger>
            <SelectContent className="bg-glass border-white/[0.08] text-slate-300">
              {agents.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  <div className="flex items-center gap-2">
                    <Bot className="w-4 h-4 text-sky-400" />
                    {a.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Payment Type Toggle */}
        <div className="relative flex gap-2 p-1.5 bg-white/[0.04] backdrop-blur-xl rounded-xl border border-white/[0.08]">
          <AnimatePresence mode="wait">
            <motion.div
              key={toType}
              layoutId="payment-type-indicator"
              className="absolute inset-y-1.5 bg-gradient-to-r from-sky-500 to-sky-600 rounded-lg shadow-lg shadow-sky-500/20"
              style={{
                left: toType === 'human' ? '6px' : 'calc(50% + 2px)',
                right: toType === 'human' ? 'calc(50% + 2px)' : '6px',
              }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            />
          </AnimatePresence>
          <button
            onClick={() => setToType('human')}
            className={cn(
              "relative flex-1 py-2.5 text-sm font-semibold rounded-lg transition-colors z-10 flex items-center justify-center gap-1.5",
              toType === 'human' ? "text-white" : "text-slate-400 hover:text-white"
            )}
          >
            <User className="w-4 h-4" />
            Human
          </button>
          <button
            onClick={() => setToType('agent')}
            className={cn(
              "relative flex-1 py-2.5 text-sm font-semibold rounded-lg transition-colors z-10 flex items-center justify-center gap-1.5",
              toType === 'agent' ? "text-white" : "text-slate-400 hover:text-white"
            )}
          >
            <Bot className="w-4 h-4" />
            Agent
          </button>
        </div>

        {/* Destination */}
        <div className="space-y-1.5">
          <Label className="text-xs text-slate-400 font-medium">
            To {toType === 'human' ? 'Human' : 'Agent'}
          </Label>
          {toType === 'human' ? (
            <Input
              value={toAddress}
              onChange={(e) => setToAddress(e.target.value)}
              placeholder="0x..."
              className="bg-white/[0.04] border-white/10 text-white placeholder:text-slate-600 font-mono text-sm h-12"
            />
          ) : (
            <Select value={toAgent} onValueChange={setToAgent}>
              <SelectTrigger className="bg-white/[0.04] border-white/10 text-slate-300 h-12">
                <SelectValue placeholder="Select destination agent..." />
              </SelectTrigger>
              <SelectContent className="bg-glass border-white/[0.08] text-slate-300">
                {agents
                  .filter((a) => a.id !== fromAgent)
                  .map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      <div className="flex items-center gap-2">
                        <Bot className="w-4 h-4 text-sky-400" />
                        {a.name}
                      </div>
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Amount + Token */}
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs text-slate-400 font-medium">Amount</Label>
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              type="number"
              min="0"
              step="any"
              className="bg-white/[0.04] border-white/10 text-white placeholder:text-slate-600 text-lg font-semibold h-12"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-400 font-medium">Token</Label>
            <Select value={token} onValueChange={setToken}>
              <SelectTrigger className="bg-white/[0.04] border-white/10 text-slate-300 h-12">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-glass border-white/[0.08] text-slate-300">
                <SelectItem value="HSK">HSK</SelectItem>
                <SelectItem value="USDC">USDC</SelectItem>
                <SelectItem value="USDT">USDT</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Memo */}
        <div className="space-y-1.5">
          <Label className="text-xs text-slate-400 font-medium">
            Memo <span className="text-slate-600">(optional)</span>
          </Label>
          <Input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="Payment description..."
            className="bg-white/[0.04] border-white/10 text-white placeholder:text-slate-600 h-12"
          />
        </div>

        {/* Execute Button */}
        <Button
          onClick={handlePay}
          disabled={loading || !canPay}
          className="w-full bg-gradient-to-r from-sky-600 to-sky-500 hover:from-sky-500 hover:to-sky-400 text-white h-12 font-semibold shadow-lg shadow-sky-900/30 hover:shadow-sky-900/50 transition-all"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Executing via T3N TEE...
            </>
          ) : (
            <>
              <Zap className="w-4 h-4 mr-2" />
              Execute Payment
              <ArrowRight className="w-4 h-4 ml-2" />
            </>
          )}
        </Button>

        {/* Success Result */}
        <AnimatePresence>
          {result && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-sky-500/10 border border-sky-500/20 rounded-xl p-4"
            >
              <div className="flex items-start gap-3">
                <CheckCircle className="w-5 h-5 text-sky-400 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-sky-300">Payment Successful!</p>
                  <p className="text-xs text-slate-400 mt-1">Executed via T3N TEE enclave</p>
                  <a
                    href={result.txUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 mt-2 font-medium"
                  >
                    View on Explorer
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-red-500/10 border border-red-500/20 rounded-xl p-4"
            >
              <p className="text-sm text-red-300">{error}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
