// PDF Receipt Generation Script
// This script generates professional PDF receipts for compliant payments

interface ReceiptData {
  receiptId: string
  linkId: string
  txHash: string
  payer: string
  merchant: string
  amount: string
  token: string
  timestamp: string
  kycPassed: boolean
  sanctionsChecked: boolean
  memo?: string
}

export function generatePDFReceipt(data: ReceiptData): string {
  // In a real implementation, this would use PDFKit or similar library
  // For this MVP, we'll generate a structured text receipt that can be converted to PDF

  const receipt = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Payment Receipt - ${data.receiptId}</title>
    <style>
        body {
            font-family: 'Arial', sans-serif;
            max-width: 600px;
            margin: 0 auto;
            padding: 40px 20px;
            color: #333;
            line-height: 1.6;
        }
        .header {
            text-align: center;
            border-bottom: 3px solid #164e63;
            padding-bottom: 20px;
            margin-bottom: 30px;
        }
        .logo {
            font-size: 28px;
            font-weight: bold;
            color: #164e63;
            margin-bottom: 5px;
        }
        .subtitle {
            color: #6b7280;
            font-size: 14px;
        }
        .receipt-info {
            background: #f8fafc;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 30px;
        }
        .info-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 10px;
            padding: 5px 0;
        }
        .info-row:last-child {
            margin-bottom: 0;
        }
        .label {
            font-weight: 600;
            color: #374151;
        }
        .value {
            color: #1f2937;
            font-family: 'Courier New', monospace;
        }
        .amount {
            font-size: 24px;
            font-weight: bold;
            color: #164e63;
            text-align: center;
            padding: 20px;
            background: #ecfeff;
            border-radius: 8px;
            margin: 20px 0;
        }
        .compliance {
            background: #f0fdf4;
            border: 1px solid #bbf7d0;
            border-radius: 8px;
            padding: 15px;
            margin: 20px 0;
        }
        .compliance-title {
            font-weight: 600;
            color: #166534;
            margin-bottom: 10px;
        }
        .compliance-item {
            display: flex;
            align-items: center;
            margin-bottom: 5px;
        }
        .check-mark {
            color: #16a34a;
            margin-right: 8px;
            font-weight: bold;
        }
        .footer {
            text-align: center;
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #e5e7eb;
            color: #6b7280;
            font-size: 12px;
        }
        .blockchain-info {
            background: #fef3c7;
            border: 1px solid #fbbf24;
            border-radius: 8px;
            padding: 15px;
            margin: 20px 0;
        }
        .blockchain-title {
            font-weight: 600;
            color: #92400e;
            margin-bottom: 10px;
        }
        @media print {
            body { margin: 0; }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="logo">CompliantPay</div>
        <div class="subtitle">Web3 Payment Compliance Platform</div>
    </div>

    <div class="receipt-info">
        <div class="info-row">
            <span class="label">Receipt ID:</span>
            <span class="value">${data.receiptId}</span>
        </div>
        <div class="info-row">
            <span class="label">Payment Link:</span>
            <span class="value">${data.linkId}</span>
        </div>
        <div class="info-row">
            <span class="label">Date & Time:</span>
            <span class="value">${new Date(data.timestamp).toLocaleString()}</span>
        </div>
        <div class="info-row">
            <span class="label">Payer Address:</span>
            <span class="value">${data.payer}</span>
        </div>
        <div class="info-row">
            <span class="label">Merchant Address:</span>
            <span class="value">${data.merchant}</span>
        </div>
        ${
          data.memo
            ? `
        <div class="info-row">
            <span class="label">Memo:</span>
            <span class="value">${data.memo}</span>
        </div>
        `
            : ""
        }
    </div>

    <div class="amount">
        ${data.amount} ${data.token}
    </div>

    <div class="blockchain-info">
        <div class="blockchain-title">Blockchain Transaction</div>
        <div class="info-row">
            <span class="label">Transaction Hash:</span>
            <span class="value">${data.txHash}</span>
        </div>
        <div class="info-row">
            <span class="label">Network:</span>
            <span class="value">Base Sepolia Testnet</span>
        </div>
        <div class="info-row">
            <span class="label">Status:</span>
            <span class="value">Confirmed</span>
        </div>
    </div>

    <div class="compliance">
        <div class="compliance-title">Compliance Verification</div>
        <div class="compliance-item">
            <span class="check-mark">${data.kycPassed ? "✓" : "✗"}</span>
            <span>KYC Verification: ${data.kycPassed ? "Passed" : "Not Required"}</span>
        </div>
        <div class="compliance-item">
            <span class="check-mark">${data.sanctionsChecked ? "✓" : "✗"}</span>
            <span>Sanctions Check: ${data.sanctionsChecked ? "Clear" : "Not Required"}</span>
        </div>
    </div>

    <div class="footer">
        <p>This receipt was generated automatically by CompliantPay.</p>
        <p>Transaction verified on blockchain at ${new Date(data.timestamp).toISOString()}</p>
        <p>For support, please contact support@compliantpay.com</p>
    </div>
</body>
</html>
  `

  return receipt.trim()
}

export function generateCSVExport(payments: any[]): string {
  const headers = [
    "Receipt ID",
    "Link ID",
    "Date",
    "Payer Address",
    "Merchant Address",
    "Amount",
    "Token",
    "Transaction Hash",
    "KYC Status",
    "Sanctions Status",
    "Memo",
  ]

  const rows = payments.map((payment) => [
    `receipt_${payment.id}`,
    payment.linkId,
    new Date(payment.timestamp).toISOString(),
    payment.payer,
    payment.merchant || "N/A",
    payment.amount,
    payment.token,
    payment.txHash,
    payment.kycPassed ? "Verified" : "Not Required",
    payment.sanctionsChecked ? "Clear" : "Not Required",
    payment.memo || "",
  ])

  const csvContent = [headers.join(","), ...rows.map((row) => row.map((field) => `"${field}"`).join(","))].join("\n")

  return csvContent
}

// Mock function to simulate PDF generation
export async function createPDFFromHTML(html: string): Promise<Buffer> {
  // In a real implementation, you would use puppeteer or similar to convert HTML to PDF
  // For this MVP, we'll return the HTML as a buffer
  return Buffer.from(html, "utf-8")
}
