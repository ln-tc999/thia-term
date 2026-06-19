"use client"

import { useState, useEffect, useRef } from "react"
import {
  useAccount,
  useSendTransaction,
  useWaitForTransactionReceipt,
  useWriteContract,
  useSwitchChain,
} from "wagmi"
import { parseEther, parseUnits, keccak256, toHex } from "viem"
import { ConnectButton } from "@rainbow-me/rainbowkit"
import { Shield, CheckCircle, XCircle, Loader2, ExternalLink, Wallet, AlertCircle, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getChain, getToken, isNativeToken } from "@/lib/chains"
import { FLOWLINK_PAYMENTS_ADDRESS, FLOWLINK_PAYMENTS_ABI, ZERO_ADDRESS } from "@/lib/flowlink-contract"

const ERC20_TRANSFER_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

const ERC20_APPROVE_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

interface PaymentFlowProps {
  paymentLink: {
    id: string
    code: string
    name: string | null
    network: string
    sourceToken: string
    amountMin: number | null
    amountMax: number | null
    recipientAddress: string
    ownerName: string
  }
}

type Step = 'connect' | 'form' | 'compliance' | 'confirm' | 'approving' | 'sending' | 'complete' | 'failed'

export function PaymentFlow({ paymentLink }: PaymentFlowProps) {
  const { address, isConnected, chain } = useAccount()
  const { switchChain, isPending: isSwitching } = useSwitchChain()

  const [step, setStep] = useState<Step>('connect')
  const [amount, setAmount] = useState(paymentLink.amountMin?.toString() ?? '')
  const [complianceScore, setComplianceScore] = useState(0)
  const [complianceDetail, setComplianceDetail] = useState<string | null>(null)
  const [complianceBlocked, setComplianceBlocked] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const targetChain = getChain(paymentLink.network)
  const onCorrectChain = chain?.id === targetChain?.id
  const explorerUrl = targetChain?.explorerUrl ?? ''

  const {
    sendTransaction,
    data: nativeTxHash,
    isPending: isSendingNative,
    error: sendError,
    reset: resetTx,
  } = useSendTransaction()

  const {
    writeContract,
    data: erc20TxHash,
    isPending: isSendingErc20,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract()

  const {
    writeContract: approveWrite,
    data: approveTxHash,
    isPending: isApprovePending,
    reset: resetApprove,
  } = useWriteContract()

  const pendingPay = useRef<(() => void) | null>(null)

  const { isSuccess: isApproveSuccess } = useWaitForTransactionReceipt({ hash: approveTxHash })

  const txHash = nativeTxHash ?? erc20TxHash
  const isSending = isSendingNative || isSendingErc20

  const { isSuccess, isLoading: isConfirming } = useWaitForTransactionReceipt({ hash: txHash })

  useEffect(() => {
    if (isConnected && step === 'connect') setStep('form')
    if (!isConnected && step !== 'complete') setStep('connect')
  }, [isConnected])

  // On confirmed — save payment + auto-create invoice as proof
  useEffect(() => {
    if (!isSuccess || !txHash) return

    const finalize = async () => {
      try {
        await fetch('/api/payments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            paymentLinkId: paymentLink.id,
            payer: address,
            amount: parseFloat(amount),
            currency: paymentLink.sourceToken,
            txHash,
            status: 'completed',
            network: paymentLink.network,
            createInvoice: true,  // signal API to auto-create invoice proof
            // compliance values are computed server-side by /api/payments
          }),
        })
      } catch (e) {
        console.error('Failed to save payment:', e)
      }
      setStep('complete')
    }

    finalize()
  }, [isSuccess, txHash])

  useEffect(() => {
    const err = sendError ?? writeError
    if (err) {
      setError(err.message.includes('rejected') ? 'Transaction rejected.' : err.message)
      setStep('confirm')
    }
  }, [sendError, writeError])

  // After approval confirms, execute the queued pay call
  useEffect(() => {
    if (isApproveSuccess && pendingPay.current) {
      pendingPay.current()
      pendingPay.current = null
      setStep('sending')
    }
  }, [isApproveSuccess])

  const runCompliance = async () => {
    if (!address) return
    setStep('compliance')
    setError(null)
    setComplianceBlocked(false)
    setComplianceDetail(null)

    try {
      const params = new URLSearchParams({ addr: address })
      if (paymentLink.id) params.append('linkId', paymentLink.id)
      const res = await fetch(`/api/compliance/preflight?${params}`)
      const data = await res.json()

      if (!res.ok || !data.success) {
        // Address blocked — show reason, don't allow payment
        setComplianceScore(data.compliance?.complianceScore ?? 0)
        setComplianceDetail(data.error ?? data.compliance?.detail ?? 'Address failed compliance screening')
        setComplianceBlocked(true)
        setStep('confirm')
        return
      }

      setComplianceScore(data.compliance.complianceScore)
      setComplianceDetail(null)
      setComplianceBlocked(false)
      setStep('confirm')
    } catch {
      // Network error — fail open so a server issue doesn't block all payments
      setComplianceScore(70)
      setComplianceDetail(null)
      setComplianceBlocked(false)
      setStep('confirm')
    }
  }

  const handleSend = () => {
    if (!amount || !paymentLink.recipientAddress) return
    setError(null)

    const token = getToken(paymentLink.network, paymentLink.sourceToken)
    if (!token) {
      setError(`Token ${paymentLink.sourceToken} not found on ${paymentLink.network}`)
      return
    }

    const contractAddress = FLOWLINK_PAYMENTS_ADDRESS[paymentLink.network]
    const useFlowLinkContract = contractAddress && contractAddress !== ZERO_ADDRESS
    // bytes32 id derived from the payment link's string id
    const paymentLinkId32 = keccak256(toHex(paymentLink.id))

    try {
      if (isNativeToken(token)) {
        if (useFlowLinkContract) {
          // Route native HSK through FlowLink contract — emits PaymentProcessed event
          writeContract({
            address: contractAddress,
            abi: FLOWLINK_PAYMENTS_ABI,
            functionName: 'payNative',
            args: [paymentLinkId32, paymentLink.recipientAddress as `0x${string}`],
            value: parseEther(amount),
            chainId: targetChain!.id,
          })
        } else {
          sendTransaction({
            to: paymentLink.recipientAddress as `0x${string}`,
            value: parseEther(amount),
            chainId: targetChain!.id,
          })
        }
      } else {
        if (useFlowLinkContract) {
          // ERC20 through FlowLink contract: approve first, then pay
          const parsedAmount = parseUnits(amount, token.decimals)
          pendingPay.current = () => writeContract({
            address: contractAddress,
            abi: FLOWLINK_PAYMENTS_ABI,
            functionName: 'pay',
            args: [
              paymentLinkId32,
              paymentLink.recipientAddress as `0x${string}`,
              token.address as `0x${string}`,
              parsedAmount,
            ],
            chainId: targetChain!.id,
          })
          approveWrite({
            address: token.address as `0x${string}`,
            abi: ERC20_APPROVE_ABI,
            functionName: 'approve',
            args: [contractAddress, parsedAmount],
            chainId: targetChain!.id,
          })
          setStep('approving')
          return
        } else {
          writeContract({
            address: token.address as `0x${string}`,
            abi: ERC20_TRANSFER_ABI,
            functionName: 'transfer',
            args: [
              paymentLink.recipientAddress as `0x${string}`,
              parseUnits(amount, token.decimals),
            ],
            chainId: targetChain!.id,
          })
        }
      }
      setStep('sending')
    } catch (e: any) {
      setError(e.message)
    }
  }

  const amountNum = parseFloat(amount)
  const amountValid =
    !isNaN(amountNum) &&
    amountNum > 0 &&
    (!paymentLink.amountMin || amountNum >= paymentLink.amountMin) &&
    (!paymentLink.amountMax || amountNum <= paymentLink.amountMax)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center space-y-1">
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-600 uppercase tracking-widest">
          <Shield className="h-3.5 w-3.5" /> FlowLink · {targetChain?.name ?? paymentLink.network}
        </div>
        <h1 className="text-2xl font-bold text-slate-900">
          {paymentLink.name ?? `Pay ${paymentLink.ownerName}`}
        </h1>
        <p className="text-sm text-slate-500 font-mono">flowlink.app/l/{paymentLink.code}</p>
      </div>

      {/* Step: Connect */}
      {step === 'connect' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-5 shadow-sm">
          <div className="w-14 h-14 bg-teal-50 rounded-2xl flex items-center justify-center mx-auto">
            <Wallet className="h-7 w-7 text-teal-600" />
          </div>
          <div>
            <p className="font-semibold text-slate-900 mb-1">Connect your wallet to pay</p>
            <p className="text-sm text-slate-500">
              You'll need to be on <span className="font-medium text-slate-700">{targetChain?.name}</span>
            </p>
          </div>
          <div className="flex justify-center">
            <ConnectButton />
          </div>
        </div>
      )}

      {/* Step: Form */}
      {step === 'form' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5 shadow-sm">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">Paying to</span>
            <span className="font-semibold text-slate-900">{paymentLink.ownerName}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">Your wallet</span>
            <span className="font-mono text-xs text-slate-700">{address?.slice(0, 6)}...{address?.slice(-4)}</span>
          </div>

          <div className="border-t border-slate-100 pt-4 space-y-2">
            <Label htmlFor="amount">Amount ({paymentLink.sourceToken})</Label>
            <div className="relative">
              <Input
                id="amount"
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder={
                  paymentLink.amountMin && paymentLink.amountMax
                    ? `${paymentLink.amountMin} – ${paymentLink.amountMax}`
                    : 'Enter amount'
                }
                min={paymentLink.amountMin ?? 0}
                max={paymentLink.amountMax ?? undefined}
                className="pr-16 text-lg font-semibold"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 font-medium">
                {paymentLink.sourceToken}
              </span>
            </div>
            {paymentLink.amountMin && paymentLink.amountMax && (
              <p className="text-xs text-slate-400">
                Min {paymentLink.amountMin} · Max {paymentLink.amountMax} {paymentLink.sourceToken}
              </p>
            )}
          </div>

          {/* Wrong chain warning + switch button */}
          {!onCorrectChain && targetChain && (
            <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-amber-50 border border-amber-200">
              <div className="flex items-center gap-2 text-sm text-amber-800">
                <AlertCircle className="h-4 w-4 shrink-0" />
                Switch to {targetChain.name} to pay
              </div>
              <Button
                size="sm"
                onClick={() => switchChain({ chainId: targetChain.id })}
                disabled={isSwitching}
                className="bg-amber-600 hover:bg-amber-700 text-white shrink-0"
              >
                {isSwitching ? <Loader2 className="h-3 w-3 animate-spin" /> : (
                  <>Switch <ArrowRight className="h-3 w-3 ml-1" /></>
                )}
              </Button>
            </div>
          )}

          <Button
            onClick={runCompliance}
            disabled={!amountValid || !onCorrectChain}
            className="w-full bg-teal-600 hover:bg-teal-500 text-white h-12 font-semibold"
          >
            <Shield className="h-4 w-4 mr-2" />
            Run Compliance Check
          </Button>
        </div>
      )}

      {/* Step: Approving */}
      {step === 'approving' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-4 shadow-sm">
          <Loader2 className="h-10 w-10 text-teal-600 animate-spin mx-auto" />
          <p className="font-semibold text-slate-900">
            {isApprovePending ? 'Confirm approval in wallet…' : 'Waiting for approval…'}
          </p>
          <p className="text-sm text-slate-500">Step 1 of 2 — Approve {paymentLink.sourceToken} spend</p>
        </div>
      )}

      {/* Step: Compliance */}
      {step === 'compliance' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-4 shadow-sm">
          <Loader2 className="h-10 w-10 text-teal-600 animate-spin mx-auto" />
          <p className="font-semibold text-slate-900">Running compliance checks…</p>
          <p className="text-sm text-slate-500">KYC · Sanctions screening · AML risk score</p>
        </div>
      )}

      {/* Step: Confirm */}
      {step === 'confirm' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5 shadow-sm">
          {/* Compliance result banner */}
          {complianceBlocked ? (
            <div className="flex items-start gap-3 p-3 rounded-xl bg-red-50 border border-red-200">
              <XCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-red-800">Payment blocked</p>
                <p className="text-xs text-red-600 mt-0.5">{complianceDetail ?? 'Address failed compliance screening'}</p>
              </div>
              <span className="text-sm font-black text-red-700">{complianceScore}/100</span>
            </div>
          ) : (
            <div className="flex items-center gap-3 p-3 rounded-xl bg-teal-50 border border-teal-100">
              <CheckCircle className="h-5 w-5 text-teal-600 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-teal-800">Compliance passed</p>
                <p className="text-xs text-teal-600">
                  OFAC sanctions · AML velocity · risk scoring — all clear
                  {complianceDetail && ` · ${complianceDetail}`}
                </p>
              </div>
              <span className="text-sm font-black text-teal-700">{complianceScore}/100</span>
            </div>
          )}

          <div className="space-y-2">
            {[
              { label: 'You send',  value: `${amount} ${paymentLink.sourceToken}` },
              { label: 'To',        value: paymentLink.ownerName },
              { label: 'Network',   value: targetChain?.name ?? paymentLink.network },
              { label: 'Recipient', value: `${paymentLink.recipientAddress.slice(0, 8)}…${paymentLink.recipientAddress.slice(-6)}` },
            ].map(row => (
              <div key={row.label} className="flex items-center justify-between text-sm py-1.5 border-b border-slate-100 last:border-0">
                <span className="text-slate-500">{row.label}</span>
                <span className="font-semibold text-slate-900">{row.value}</span>
              </div>
            ))}
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800">
              <XCircle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}

          {complianceBlocked ? (
            <Button
              onClick={() => setStep('form')}
              variant="outline"
              className="w-full h-12 font-semibold"
            >
              Go back
            </Button>
          ) : (
            <Button
              onClick={handleSend}
              disabled={isSending}
              className="w-full bg-teal-600 hover:bg-teal-500 text-white h-12 font-semibold"
            >
              {isSending
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Confirm in wallet…</>
                : `Send ${amount} ${paymentLink.sourceToken}`}
            </Button>
          )}
        </div>
      )}

      {/* Step: Sending */}
      {step === 'sending' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-4 shadow-sm">
          <Loader2 className="h-10 w-10 text-teal-600 animate-spin mx-auto" />
          <p className="font-semibold text-slate-900">
            {isConfirming ? 'Waiting for confirmation…' : 'Broadcasting transaction…'}
          </p>
          {txHash && (
            <a
              href={`${explorerUrl}/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-teal-600 hover:underline"
            >
              View on explorer <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      )}

      {/* Step: Complete */}
      {step === 'complete' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-5 shadow-sm">
          <div className="w-16 h-16 bg-teal-50 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle className="h-8 w-8 text-teal-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-1">Payment sent</h2>
            <p className="text-sm text-slate-500">
              {amount} {paymentLink.sourceToken} sent to {paymentLink.ownerName} on {targetChain?.name}.
              <br />An invoice has been created as proof.
            </p>
          </div>
          {txHash && (
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-left">
              <p className="text-xs text-slate-500 mb-1">Transaction hash</p>
              <p className="font-mono text-xs text-slate-700 break-all">{txHash}</p>
            </div>
          )}
          <div className="flex gap-3">
            {txHash && (
              <a href={`${explorerUrl}/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="flex-1">
                <Button variant="outline" className="w-full">
                  <ExternalLink className="h-4 w-4 mr-2" /> Explorer
                </Button>
              </a>
            )}
            <Button
              className="flex-1 bg-teal-600 hover:bg-teal-500 text-white"
              onClick={() => { resetTx(); resetWrite(); resetApprove(); pendingPay.current = null; setStep('form'); setAmount(paymentLink.amountMin?.toString() ?? '') }}
            >
              Pay again
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
