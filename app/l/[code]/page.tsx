import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { PaymentFlow } from '@/components/payment-flow'

interface Props {
  params: { code: string }
}

export default async function PaymentLinkPage({ params }: Props) {
  const link = await prisma.paymentLink.findUnique({
    where: { code: params.code },
    include: {
      user: { select: { walletAddress: true, name: true, email: true } },
    },
  })

  if (!link || link.status !== 'active') notFound()

  const recipientAddress = link.recipientAddress ?? link.user.walletAddress

  if (!recipientAddress) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center space-y-2">
          <p className="text-slate-900 font-semibold">Payment unavailable</p>
          <p className="text-sm text-slate-500">The payment link owner hasn't connected a wallet yet.</p>
        </div>
      </div>
    )
  }

  const isInvoiceLink = link.name?.startsWith('Invoice')
  const ownerName = isInvoiceLink
    ? (link.name ?? 'Invoice Payment')
    : (link.user.name ?? link.user.email ?? 'Unknown')

  return (
    <div className="min-h-screen bg-[#f8fafc]">
      {/* Header bar */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl overflow-hidden">
              <img src="/ai-assistant-icon.png" alt="Thia-Term" className="w-full h-full object-cover" />
            </div>
            <span className="font-bold text-lg tracking-tight">
              <span className="text-slate-900">Thia</span>
              <span className="text-sky-600">-Term</span>
            </span>
          </div>
        </div>
      </header>
      <div className="max-w-lg mx-auto px-4 py-10 space-y-4">
        {/* HSP hosted checkout — shown when available */}
        {link.hspCheckoutUrl && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-700">Pay via HashKey HSP</p>
              <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5 font-medium">
                Powered by HashKey HSP
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Use HashKey Settlement Protocol for a seamless fiat-to-crypto checkout experience.
            </p>
            <a
              href={link.hspCheckoutUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full bg-amber-500 hover:bg-amber-600 text-white font-semibold py-3 px-4 rounded-xl transition-colors text-sm"
            >
              Pay via HSK
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5z" clipRule="evenodd" />
                <path fillRule="evenodd" d="M6.194 12.753a.75.75 0 001.06.053L16.5 4.44v2.81a.75.75 0 001.5 0v-4.5a.75.75 0 00-.75-.75h-4.5a.75.75 0 000 1.5h2.553l-9.056 8.194a.75.75 0 00-.053 1.06z" clipRule="evenodd" />
              </svg>
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

        <PaymentFlow
          paymentLink={{
            id: link.id,
            code: link.code,
            name: link.name ?? 'Payment Link',
            network: link.network,
            sourceToken: link.sourceToken,
            amountMin: link.amountMin ?? 0,
            amountMax: link.amountMax ?? 0,
            recipientAddress,
            ownerName,
          }}
        />
      </div>
    </div>
  )
}
