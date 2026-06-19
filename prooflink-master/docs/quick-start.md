# Quick Start

Get up and running with ProofLink in under 5 minutes.

## Install

```bash
npm install @prooflink/sdk
```

## Initialize the client

```ts
import { ProofLinkClient } from "@prooflink/sdk";

const prooflink = new ProofLinkClient({ apiKey: "fl_live_your_api_key" });
```

| Option       | Default                          | Description                          |
|-------------|----------------------------------|--------------------------------------|
| `apiKey`    | --                               | Your ProofLink API key (required)     |
| `baseUrl`   | `https://api.prooflink.io/v1`     | Override for self-hosted deployments |
| `timeoutMs` | `30000`                          | Request timeout in milliseconds      |
| `maxRetries`| `3`                              | Auto-retries on transient errors     |

---

## Screen an address

Check a wallet against OFAC, EU, UN, and HMT sanctions lists.

```ts
const result = await prooflink.screenAddress("0x742d35Cc6634C0532925a3b844Bc9e7595f2bD68", "base");
console.log(result.matched); // false
```

---

## Run a full compliance check

Run sanctions screening, AML scoring, travel-rule transmission, and jurisdictional checks in one call.

```ts
const decision = await prooflink.checkCompliance({
  senderAddress: "0xAlice",
  recipientAddress: "0xBob",
  amount: 5000,
  currency: "USDC",
  chain: "base",
});
console.log(decision.status);    // "APPROVED"
console.log(decision.riskScore); // 12
```

---

## Create an invoice

Generate a compliance-stamped invoice for agent-to-agent services.

```ts
const invoice = await prooflink.createInvoice({
  seller: {
    walletAddress: "0xAlice",
    agentId: "did:prooflink:agent:data-processor",
    legalName: "DataCo AI",
  },
  buyer: {
    walletAddress: "0xBob",
    legalName: "Acme Corp",
  },
  lineItems: [
    {
      description: "Data analysis - 10k records",
      quantity: 1,
      unitPrice: 250,
      total: 250,
      serviceCategory: "analysis",
    },
  ],
  currency: "USDC",
  totalAmount: 250,
  paymentProtocol: "x402",
});
console.log(invoice.id);    // "a1b2c3d4-..."
console.log(invoice.state); // "DRAFT"
```

---

## Full flow: screen, check compliance, invoice, and settle

End-to-end example: verify the counterparty, run compliance, create an invoice, and transition it through settlement.

```ts
import { ProofLinkClient } from "@prooflink/sdk";

const prooflink = new ProofLinkClient({ apiKey: process.env.PROOFLINK_API_KEY! });

// 1. Screen the recipient
const screen = await prooflink.screenAddress("0xBob", "base");
if (screen.matched) {
  throw new Error(`Recipient sanctioned: ${JSON.stringify(screen.matchDetails)}`);
}

// 2. Verify the agent (if counterparty is an AI agent)
const verification = await prooflink.verifyAgent("did:prooflink:agent:bob-bot");
if (!verification.verified) {
  throw new Error("Agent KYA verification failed");
}

// 3. Run full compliance check
const decision = await prooflink.checkCompliance({
  senderAddress: "0xAlice",
  recipientAddress: "0xBob",
  amount: 5000,
  currency: "USDC",
  chain: "base",
});
if (decision.status === "REJECTED") {
  throw new Error(`Compliance rejected: risk score ${decision.riskScore}`);
}

// 4. Create the invoice
const invoice = await prooflink.createInvoice({
  seller: { walletAddress: "0xAlice", agentId: "did:prooflink:agent:alice-bot" },
  buyer: { walletAddress: "0xBob", agentId: "did:prooflink:agent:bob-bot" },
  lineItems: [
    { description: "GPU compute - 2 hours", quantity: 2, unitPrice: 2500, total: 5000, serviceCategory: "compute" },
  ],
  currency: "USDC",
  totalAmount: 5000,
  paymentProtocol: "x402",
});

// 5. Issue -> Pay -> Settle
await prooflink.updateInvoiceState(invoice.id, "ISSUED");
// ... execute payment via x402 ...
await prooflink.updateInvoiceState(invoice.id, "PAID");
await prooflink.updateInvoiceState(invoice.id, "SETTLED");

// 6. Retrieve the compliance receipt
const receipt = await prooflink.getReceipt(decision.receiptId);
console.log("ProofLink hash:", receipt.receiptHash);
```

---

## Next steps

- [API Reference](./api-reference.md) -- every endpoint, field, and error code
- [x402 Integration](./x402-integration.md) -- add compliance to x402 payment servers
- [MCP Integration](./mcp-integration.md) -- give Claude and LangChain agents compliance tools
- [Request Finance Integration](./request-finance-integration.md) -- bridge to Request Network invoicing
