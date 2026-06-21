"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { CheckCircle, Loader2, ShieldCheck, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"

interface InvoicePayClientProps {
  invoiceId: string
  amount: number
  currency: string
  network: string
  recipientAddress: string
}

export function InvoicePayClient({
  invoiceId,
  amount,
  currency,
  network,
  recipientAddress,
}: InvoicePayClientProps) {
  const { data: session } = useSession()
  const router = useRouter()
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const [txHash, setTxHash] = useState<string | null>(null)

  const handlePay = async () => {
    if (!session) {
      router.push(`/login?redirect=/pay/invoice/${invoiceId}`)
      return
    }
    setSending(true)
    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId,
          amount,
          currency,
          network,
        }),
      })
      const data = await res.json()
      if (data.success) {
        setDone(true)
        setTxHash(data.txHash || null)
      } else {
        alert(data.error || "Payment failed")
      }
    } catch {
      alert("Network error")
    } finally {
      setSending(false)
    }
  }

  if (done) {
    return (
      <div className="bg-white rounded-2xl border border-emerald-200 shadow-sm p-8 text-center space-y-3">
        <CheckCircle className="h-12 w-12 text-emerald-500 mx-auto" />
        <p className="text-lg font-semibold text-slate-900">Payment Successful</p>
        <p className="text-sm text-slate-500">
          Your payment has been submitted for processing via T3N.
        </p>
        {txHash && (
          <p className="text-xs font-mono text-slate-400 break-all">TX: {txHash}</p>
        )}
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-700">Pay with T3N Wallet</p>
        <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5 font-medium flex items-center gap-1">
          <ShieldCheck className="h-3 w-3" />
          T3N
        </span>
      </div>

      <div className="space-y-2">
        <p className="text-2xl font-bold text-slate-900">
          {amount} {currency}
        </p>
        <p className="text-xs text-slate-500">Network: {network}</p>
        <p className="text-xs text-slate-500">
          Recipient: {recipientAddress.slice(0, 10)}...{recipientAddress.slice(-6)}
        </p>
      </div>

      <Button
        onClick={handlePay}
        disabled={sending}
        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white h-11 font-semibold"
      >
        {sending ? (
          <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing...</>
        ) : (
          <><Lock className="mr-2 h-4 w-4" /> {session ? "Pay Now" : "Sign in to Pay"}</>
        )}
      </Button>
    </div>
  )
}
