"use client"

import { useState } from "react"
import {
  useAccount,
  useSendTransaction,
  useWaitForTransactionReceipt,
  useWriteContract,
  useSwitchChain,
} from "wagmi"
import { parseEther, parseUnits } from "viem"
import { ConnectButton } from "@rainbow-me/rainbowkit"
import { CheckCircle, AlertTriangle, Clock, ExternalLink, Loader2, ShieldCheck, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getChain, getToken, isNativeToken } from "@/lib/chains"
import { toast } from "sonner"

const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const

interface LineItem {
  description: string
  quantity: number
  unitPrice: string
  total: string
}

interface InvoiceData {
  id: string
  invoiceNumber: string
  issuedTo: string | null
  issuedToAddress: string | null
  amount: number
  subtotal: number | null
  currency: string
  network: string
  status: string
  lineItems: LineItem[] | null
  notes: string | null
  dueAt: string | null
  paidAt: string | null
  txHash: string | null
  paymentLinkCode: string | null
  hspCheckoutUrl: string | null
  createdAt: string
}

interface Props {
  invoice: InvoiceData
  senderName: string
  recipientAddress: string | null
}

const statusConfig: Record<string, { label: string; bg: string; text: string; icon: React.ElementType }> = {
  draft:   { label: "Draft",            bg: "bg-slate-100",   text: "text-slate-500",  icon: Clock },
  pending: { label: "Pending Payment",  bg: "bg-amber-50",    text: "text-amber-700",  icon: Clock },
  paid:    { label: "Paid",             bg: "bg-emerald-50",  text: "text-emerald-700",icon: CheckCircle },
  overdue: { label: "Overdue",          bg: "bg-red-50",      text: "text-red-700",    icon: AlertTriangle },
}

function isOverdue(dueAt: string | null, status: string) {
  if (status === "paid" || !dueAt) return false
  return new Date(dueAt) < new Date()
}

export function InvoicePaymentClient({ invoice, senderName, recipientAddress }: Props) {
  const { address, isConnected, chain } = useAccount()
  const { switchChain, isPending: isSwitching } = useSwitchChain()

  const [txSubmitted, setTxSubmitted] = useState(false)
  const [localStatus, setLocalStatus] = useState(invoice.status)
  const [localTxHash, setLocalTxHash] = useState(invoice.txHash)

  const targetChain = getChain(invoice.network)
  const onCorrectChain = chain?.id === targetChain?.id
  const explorerUrl = targetChain?.explorerUrl ?? ""

  const { sendTransaction, data: nativeTxHash, isPending: isSendingNative } = useSendTransaction()
  const { writeContract, data: erc20TxHash, isPending: isSendingErc20 } = useWriteContract()

  const txHash = localTxHash ?? nativeTxHash ?? erc20TxHash
  const isSending = isSendingNative || isSendingErc20

  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash: (nativeTxHash ?? erc20TxHash) as `0x${string}` | undefined,
    query: { enabled: !!(nativeTxHash ?? erc20TxHash) },
  })

  const handleConfirmed = async (hash: string) => {
    setLocalTxHash(hash)
    setLocalStatus("paid")
    setTxSubmitted(true)
    try {
      await fetch(`/api/invoices/${invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paid", txHash: hash }),
      })
      toast.success("Payment confirmed!")
    } catch {
      // non-fatal
    }
  }

  if ((nativeTxHash || erc20TxHash) && isConfirmed && !txSubmitted) {
    handleConfirmed((nativeTxHash ?? erc20TxHash) as string)
  }

  const handlePay = async () => {
    if (!recipientAddress || !targetChain) {
      toast.error("Payment not available — no wallet configured")
      return
    }
    if (!onCorrectChain) {
      switchChain({ chainId: targetChain.id })
      return
    }

    const tokenInfo = getToken(invoice.network, invoice.currency)
    const native = tokenInfo ? isNativeToken(tokenInfo) : false

    try {
      if (native) {
        sendTransaction({
          to: recipientAddress as `0x${string}`,
          value: parseEther(invoice.amount.toString()),
          chainId: targetChain.id,
        })
      } else {
        if (!tokenInfo?.address) {
          toast.error(`No contract address for ${invoice.currency} on ${invoice.network}`)
          return
        }
        writeContract({
          address: tokenInfo.address as `0x${string}`,
          abi: ERC20_TRANSFER_ABI,
          functionName: "transfer",
          args: [
            recipientAddress as `0x${string}`,
            parseUnits(invoice.amount.toString(), tokenInfo.decimals ?? 6),
          ],
          chainId: targetChain.id,
        })
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Transaction failed")
    }
  }

  const effectiveStatus = isOverdue(invoice.dueAt, localStatus) ? "overdue" : localStatus
  const cfg = statusConfig[effectiveStatus] ?? statusConfig.pending
  const StatusIcon = cfg.icon
  const isPaid = localStatus === "paid" || txSubmitted

  return (
    <div className="min-h-screen bg-[#f8fafc]">
      {/* Top nav — Stripe-style */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl overflow-hidden">
              <img src="/ai-assistant-icon.png" alt="FlowLink" className="w-full h-full object-cover" />
            </div>
            <span className="font-bold text-lg tracking-tight">
              <span className="text-slate-900">Flow</span><span className="text-emerald-600">Link</span>
            </span>
          </div>
          <div className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${cfg.bg} ${cfg.text}`}>
            <StatusIcon className="h-3 w-3" />
            {cfg.label}
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-10 space-y-5">

        {/* Invoice card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Header */}
          <div className="px-6 pt-6 pb-5 border-b border-slate-100">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Invoice from</p>
                <p className="font-semibold text-slate-900 text-base">{senderName}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Invoice #</p>
                <p className="font-mono text-sm text-slate-600">{invoice.invoiceNumber}</p>
              </div>
            </div>

            {invoice.dueAt && (
              <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between text-sm">
                <span className="text-slate-500">Due date</span>
                <span className={`font-medium ${effectiveStatus === "overdue" ? "text-red-600" : "text-slate-700"}`}>
                  {new Date(invoice.dueAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                </span>
              </div>
            )}
          </div>

          {/* Line items */}
          {Array.isArray(invoice.lineItems) && invoice.lineItems.length > 0 && (
            <div className="px-6 py-4 border-b border-slate-100 space-y-0">
              {invoice.lineItems.map((item, i) => (
                <div key={i} className="flex items-center justify-between py-2.5 border-b border-slate-50 last:border-0">
                  <div>
                    <p className="text-sm text-slate-700 font-medium">{item.description}</p>
                    {item.quantity > 1 && (
                      <p className="text-xs text-slate-400 mt-0.5">
                        {item.quantity} × {parseFloat(item.unitPrice || "0").toFixed(2)}
                      </p>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-slate-800 ml-6 whitespace-nowrap tabular-nums">
                    {parseFloat(item.total).toFixed(2)} {invoice.currency}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Total */}
          <div className="px-6 py-5 flex items-center justify-between">
            <span className="text-slate-600 font-medium">Total due</span>
            <div className="text-right">
              <span className="text-3xl font-bold text-slate-900 tabular-nums">
                {invoice.amount.toFixed(2)}
              </span>
              <span className="text-lg text-slate-400 ml-1.5">{invoice.currency}</span>
            </div>
          </div>

          {/* Notes */}
          {invoice.notes && (
            <div className="px-6 pb-5 text-sm text-slate-500 border-t border-slate-100 pt-4">
              <span className="font-medium text-slate-600">Note: </span>
              {invoice.notes}
            </div>
          )}
        </div>

        {/* HSP hosted checkout — shown when available and invoice unpaid */}
        {!isPaid && invoice.hspCheckoutUrl && effectiveStatus !== 'draft' && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-700">Pay via HashKey HSP</p>
              <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5 font-medium">
                Powered by HashKey HSP
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Use HashKey Settlement Protocol for a seamless checkout experience.
            </p>
            <a
              href={invoice.hspCheckoutUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full bg-amber-500 hover:bg-amber-600 text-white font-semibold py-3 px-4 rounded-xl transition-colors text-sm"
            >
              Pay via HSK
              <ExternalLink className="h-4 w-4" />
            </a>
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-100" />
              </div>
              <div className="relative flex justify-center text-xs text-slate-400">
                <span className="bg-white px-2">or pay with wallet below</span>
              </div>
            </div>
          </div>
        )}

        {/* Payment section */}
        {isPaid ? (
          <div className="bg-white rounded-2xl border border-emerald-200 shadow-sm p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="h-8 w-8 text-emerald-600" />
            </div>
            <p className="font-bold text-slate-900 text-xl">Payment Complete</p>
            <p className="text-slate-500 text-sm mt-1">Thank you — this invoice has been paid.</p>
            {txHash && (
              <a
                href={`${explorerUrl}/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-emerald-600 hover:text-emerald-700 underline mt-4"
              >
                View on-chain transaction <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        ) : effectiveStatus === "draft" ? (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-center">
            <p className="text-slate-700 font-medium">Invoice not yet sent</p>
            <p className="text-slate-400 text-sm mt-1">The sender needs to finalize and send this invoice first.</p>
          </div>
        ) : !recipientAddress ? (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-center">
            <p className="text-slate-700 font-medium">Payment unavailable</p>
            <p className="text-slate-400 text-sm mt-1">The invoice owner hasn&apos;t connected a wallet yet.</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
            <p className="text-sm font-semibold text-slate-700">Pay with your wallet</p>

            {!isConnected ? (
              <div className="flex justify-center py-2">
                <ConnectButton />
              </div>
            ) : !onCorrectChain ? (
              <Button
                className="w-full h-12 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-xl"
                onClick={() => targetChain && switchChain({ chainId: targetChain.id })}
                disabled={isSwitching}
              >
                {isSwitching && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Switch to {targetChain?.name ?? invoice.network}
              </Button>
            ) : isConfirming ? (
              <Button className="w-full h-12 bg-emerald-600 text-white font-semibold rounded-xl" disabled>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Confirming on chain...
              </Button>
            ) : (
              <Button
                className="w-full h-12 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white text-base font-bold rounded-xl shadow-lg shadow-emerald-200"
                disabled={isSending}
                onClick={handlePay}
              >
                {isSending ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Confirm in wallet...
                  </span>
                ) : (
                  `Pay ${invoice.amount.toFixed(2)} ${invoice.currency}`
                )}
              </Button>
            )}

            {isConnected && (
              <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
                <span className="font-mono">{address?.slice(0, 6)}…{address?.slice(-4)}</span>
                <ConnectButton.Custom>
                  {({ openAccountModal }) => (
                    <button onClick={openAccountModal} className="underline hover:text-slate-600">
                      Change wallet
                    </button>
                  )}
                </ConnectButton.Custom>
              </div>
            )}

            <div className="flex items-center justify-center gap-1.5 text-xs text-slate-400 border-t border-slate-100 pt-4">
              <Lock className="h-3 w-3" />
              Secured by FlowLink · {targetChain?.name ?? invoice.network}
            </div>
          </div>
        )}

        {/* Trust badge */}
        <div className="flex items-center justify-center gap-2 text-xs text-slate-400 py-2">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
          KYC/AML compliant · HashKey Chain
        </div>
      </div>
    </div>
  )
}
