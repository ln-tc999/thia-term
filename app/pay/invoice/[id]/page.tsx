import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { InvoicePaymentClient } from "./client"

interface Props {
  params: { id: string }
}

export default async function InvoicePayPage({ params }: Props) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: params.id },
    include: {
      user: { select: { name: true, email: true, walletAddress: true } },
    },
  })

  if (!invoice) notFound()

  // Resolve recipient wallet: user's wallet is where they receive payment
  const recipientAddress = invoice.user.walletAddress ?? null
  const senderName = invoice.user.name ?? invoice.user.email ?? "FlowLink User"

  return (
    <InvoicePaymentClient
      invoice={{
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        issuedTo: invoice.issuedTo,
        issuedToAddress: invoice.issuedToAddress,
        amount: invoice.amount,
        subtotal: invoice.subtotal,
        currency: invoice.currency,
        network: invoice.network,
        status: invoice.status,
        lineItems: invoice.lineItems as any,
        notes: invoice.notes,
        dueAt: invoice.dueAt?.toISOString() ?? null,
        paidAt: invoice.paidAt?.toISOString() ?? null,
        txHash: invoice.txHash,
        paymentLinkCode: invoice.paymentLinkCode,
        hspCheckoutUrl: (invoice as any).hspCheckoutUrl ?? null,
        createdAt: invoice.createdAt.toISOString(),
      }}
      senderName={senderName}
      recipientAddress={recipientAddress}
    />
  )
}
