import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

const FROM = process.env.RESEND_FROM ?? 'onboarding@resend.dev'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://flowlink.ink'

function baseHtml(body: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body{font-family:sans-serif;background:#f6f9fc;margin:0;padding:0}
  .wrap{max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)}
  .header{background:linear-gradient(135deg,#059669,#10b981);padding:28px 32px}
  .header h1{margin:0;color:#fff;font-size:22px;font-weight:700;letter-spacing:-0.3px}
  .header p{margin:4px 0 0;color:rgba(255,255,255,0.8);font-size:13px}
  .body{padding:28px 32px}
  .badge{display:inline-block;background:#d1fae5;color:#065f46;padding:4px 14px;border-radius:999px;font-size:12px;font-weight:700;margin-bottom:20px;letter-spacing:.04em}
  .badge.red{background:#fee2e2;color:#991b1b}
  table{width:100%;border-collapse:collapse;margin:16px 0;font-size:14px}
  td{padding:9px 4px;border-bottom:1px solid #f0f0f0;color:#444}
  td:first-child{color:#888;width:140px}
  td:last-child{font-weight:600;color:#111}
  .btn{display:inline-block;margin-top:20px;padding:12px 28px;background:#059669;color:#fff !important;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px}
  .footer{padding:16px 32px;background:#f9fafb;border-top:1px solid #eee;font-size:11px;color:#aaa;text-align:center}
</style></head><body>
<div class="wrap">
  <div class="header">
    <h1>FlowLink</h1>
    <p>Crypto payment infrastructure</p>
  </div>
  <div class="body">${body}</div>
  <div class="footer">FlowLink · ${APP_URL}</div>
</div>
</body></html>`
}

export async function sendInvoicePaidEmail({
  toEmail,
  toName,
  invoiceNumber,
  amount,
  currency,
  issuedTo,
  paidAt,
  txHash,
  network,
}: {
  toEmail: string
  toName?: string
  invoiceNumber: string
  amount: number
  currency: string
  issuedTo: string | null
  paidAt?: string | null
  txHash?: string | null
  network?: string
}) {
  const body = `
    <div class="badge">✓ PAID</div>
    <p style="margin:0 0 16px;font-size:15px;color:#111;font-weight:600">Invoice ${invoiceNumber} has been paid.</p>
    <table>
      <tr><td>Invoice #</td><td>${invoiceNumber}</td></tr>
      <tr><td>Paid by</td><td>${issuedTo ?? '—'}</td></tr>
      <tr><td>Amount</td><td>${parseFloat(String(amount)).toFixed(2)} ${currency}</td></tr>
      ${network ? `<tr><td>Network</td><td>${network}</td></tr>` : ''}
      ${paidAt ? `<tr><td>Paid at</td><td>${new Date(paidAt).toLocaleString()}</td></tr>` : ''}
      ${txHash ? `<tr><td>Tx Hash</td><td style="font-family:monospace;font-size:12px;word-break:break-all">${txHash}</td></tr>` : ''}
    </table>
    <a href="${APP_URL}/dashboard?tab=ai-invoices" class="btn">View in FlowLink →</a>
  `

  return resend.emails.send({
    from: FROM,
    to: toEmail,
    subject: `✓ Invoice ${invoiceNumber} paid — ${parseFloat(String(amount)).toFixed(2)} ${currency}`,
    html: baseHtml(body),
  })
}

export async function sendInvoiceCreatedEmail({
  toEmail,
  invoiceNumber,
  amount,
  currency,
  issuedTo,
  dueAt,
  paymentLink,
}: {
  toEmail: string
  invoiceNumber: string
  amount: number
  currency: string
  issuedTo: string | null
  dueAt?: string | null
  paymentLink?: string | null
}) {
  const body = `
    <div class="badge" style="background:#dbeafe;color:#1e40af">INVOICE SENT</div>
    <p style="margin:0 0 16px;font-size:15px;color:#111;font-weight:600">Invoice ${invoiceNumber} created.</p>
    <table>
      <tr><td>Invoice #</td><td>${invoiceNumber}</td></tr>
      <tr><td>Billed to</td><td>${issuedTo ?? '—'}</td></tr>
      <tr><td>Amount</td><td>${parseFloat(String(amount)).toFixed(2)} ${currency}</td></tr>
      ${dueAt ? `<tr><td>Due</td><td>${new Date(dueAt).toLocaleDateString()}</td></tr>` : ''}
    </table>
    ${paymentLink ? `<p style="font-size:13px;color:#555;margin-top:12px">Payment link: <a href="${paymentLink}" style="color:#059669">${paymentLink}</a></p>` : ''}
    <a href="${APP_URL}/dashboard?tab=ai-invoices" class="btn">View in FlowLink →</a>
  `

  return resend.emails.send({
    from: FROM,
    to: toEmail,
    subject: `Invoice ${invoiceNumber} created — ${parseFloat(String(amount)).toFixed(2)} ${currency}`,
    html: baseHtml(body),
  })
}

export async function sendPaymentReceivedEmail({
  toEmail,
  amount,
  currency,
  network,
  txHash,
  paymentLinkName,
}: {
  toEmail: string
  amount: number
  currency: string
  network?: string
  txHash?: string | null
  paymentLinkName?: string | null
}) {
  const body = `
    <div class="badge">✓ PAYMENT RECEIVED</div>
    <p style="margin:0 0 16px;font-size:15px;color:#111;font-weight:600">You received a payment via FlowLink.</p>
    <table>
      <tr><td>Amount</td><td>${parseFloat(String(amount)).toFixed(2)} ${currency}</td></tr>
      ${network ? `<tr><td>Network</td><td>${network}</td></tr>` : ''}
      ${paymentLinkName ? `<tr><td>Via link</td><td>${paymentLinkName}</td></tr>` : ''}
      ${txHash ? `<tr><td>Tx Hash</td><td style="font-family:monospace;font-size:12px;word-break:break-all">${txHash}</td></tr>` : ''}
    </table>
    <a href="${APP_URL}/dashboard" class="btn">View Dashboard →</a>
  `

  return resend.emails.send({
    from: FROM,
    to: toEmail,
    subject: `💰 Payment received — ${parseFloat(String(amount)).toFixed(2)} ${currency}`,
    html: baseHtml(body),
  })
}
