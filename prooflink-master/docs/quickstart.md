# Quick Start Guide

Get up and running with ProofLink compliance in under 5 minutes.

## Install the SDK

```bash
npm install @prooflink/sdk
# or
pnpm add @prooflink/sdk
# or
bun add @prooflink/sdk
```

## Set Up Your API Key

Get an API key from the [ProofLink Dashboard](https://dashboard.prooflink.io). Store it as an environment variable:

```bash
export PROOFLINK_API_KEY=fl_live_your_api_key
```

## Initialize the Client

```ts
import { ProofLinkClient } from "@prooflink/sdk";

const prooflink = new ProofLinkClient({
  apiKey: process.env.PROOFLINK_API_KEY!,
});
```

**Configuration options:**

| Option       | Default                        | Description                       |
|-------------|--------------------------------|-----------------------------------|
| `apiKey`    | --                             | Your ProofLink API key (required)  |
| `baseUrl`   | `https://api.prooflink.io/v1`   | Override for self-hosted deploys  |
| `timeout`   | `30000`                        | Request timeout in ms             |
| `maxRetries`| `3`                            | Auto-retries on transient errors  |

---

## First Compliance Check (5 Lines)

```ts
import { ProofLinkClient } from "@prooflink/sdk";

const prooflink = new ProofLinkClient({ apiKey: process.env.PROOFLINK_API_KEY! });

const decision = await prooflink.checkCompliance({
  sender: { address: "0xAlice", chain: "base" },
  receiver: { address: "0xBob", chain: "base" },
  amount: "5000",
  asset: "USDC",
});

console.log(decision.status);    // "APPROVED"
console.log(decision.riskScore); // 12
```

This single call runs the full pipeline: sanctions screening on both parties, AML risk scoring, Travel Rule transmission, and jurisdictional checks. The result includes a ProofLink receipt ID for audit trails.

---

## Screen an Address

Check a wallet against OFAC, EU, UN, and HMT sanctions lists:

```ts
const result = await prooflink.screenAddress(
  "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD68",
  "base"
);

if (result.matched) {
  console.error("Sanctions match!", result.matchDetails);
} else {
  console.log("Clear -- risk score:", result.riskScore);
}
```

---

## First Invoice Creation

Create a compliance-stamped invoice for agent-to-agent services:

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

console.log(invoice.id);    // UUID
console.log(invoice.state); // "DRAFT"

// Transition through the invoice lifecycle
await prooflink.updateInvoiceState(invoice.id, "ISSUED");
```

---

## Verify an Agent (KYA)

Check if an AI agent has a valid KYA credential:

```ts
const verification = await prooflink.verifyAgent("did:prooflink:agent:bob-bot");

if (verification.verified) {
  console.log("Trust score:", verification.trustScore);
  console.log("Operator:", verification.agentMetadata?.operator);
  console.log("Max tx value:", verification.spendingLimits?.perTransactionUsd);
} else {
  console.log("Agent not verified");
}
```

---

## Register an Agent

Register an AI agent and issue a KYA verifiable credential:

```ts
const agent = await prooflink.registerAgent({
  agentDid: "did:prooflink:agent:my-bot",
  agentType: "autonomous",
  controllingEntity: {
    name: "My Company Inc",
    lei: "549300EXAMPLE00000",
    kybVerified: true,
  },
  walletAddress: "0xMyAgentWallet",
  delegationScope: {
    maxTransactionValue: 10000,
    dailyLimit: 50000,
    allowedChains: ["eip155:8453"],
    allowedCurrencies: ["USDC"],
    expiresAt: "2027-03-21T00:00:00.000Z",
  },
});
```

---

## Full Flow Example

End-to-end: screen, verify, check compliance, invoice, and settle.

```ts
import { ProofLinkClient } from "@prooflink/sdk";

const prooflink = new ProofLinkClient({ apiKey: process.env.PROOFLINK_API_KEY! });

// 1. Screen the recipient
const screen = await prooflink.screenAddress("0xBob", "base");
if (screen.matched) {
  throw new Error(`Recipient sanctioned: ${JSON.stringify(screen.matchDetails)}`);
}

// 2. Verify the counterparty agent
const verification = await prooflink.verifyAgent("did:prooflink:agent:bob-bot");
if (!verification.verified) {
  throw new Error("Agent KYA verification failed");
}

// 3. Run full compliance check
const decision = await prooflink.checkCompliance({
  sender: { address: "0xAlice", chain: "base", agentDID: "did:prooflink:agent:alice-bot" },
  receiver: { address: "0xBob", chain: "base", agentDID: "did:prooflink:agent:bob-bot" },
  amount: "5000",
  asset: "USDC",
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

// 5. Progress through invoice lifecycle
await prooflink.updateInvoiceState(invoice.id, "ISSUED");
// ... execute payment via x402 ...
await prooflink.updateInvoiceState(invoice.id, "PAID");
await prooflink.updateInvoiceState(invoice.id, "SETTLED");

// 6. Retrieve the compliance receipt for audit
const receipt = await prooflink.getComplianceReceipt(decision.receiptId);
console.log("ProofLink receipt hash:", receipt.receiptHash);
```

---

## Dashboard Setup

The ProofLink dashboard provides real-time visibility into compliance activity:

1. Start infrastructure:
   ```bash
   docker compose up -d postgres redis
   ```

2. Run the API server:
   ```bash
   pnpm --filter=@prooflink/api db:migrate
   pnpm --filter=@prooflink/api dev
   # -> http://localhost:3001
   ```

3. Start the dashboard:
   ```bash
   pnpm --filter=@prooflink/dashboard dev
   # -> http://localhost:3100
   ```

The dashboard shows:
- Real-time compliance check feed
- Risk score distribution
- Transaction volume by chain and token
- Travel Rule transmission status
- Agent KYA verification history

---

## Error Handling

The SDK provides typed error classes for precise error handling:

```ts
import {
  ProofLinkClient,
  ProofLinkAPIError,
  ProofLinkValidationError,
  ProofLinkTimeoutError,
  ProofLinkNetworkError,
} from "@prooflink/sdk";

try {
  const decision = await prooflink.checkCompliance({ ... });
} catch (err) {
  if (err instanceof ProofLinkAPIError) {
    // API returned an error (4xx, 5xx)
    console.error(`API error ${err.status}: ${err.body?.code} - ${err.body?.message}`);
  } else if (err instanceof ProofLinkValidationError) {
    // Client-side validation failed (no network call made)
    console.error(`Validation error on field "${err.field}": ${err.message}`);
  } else if (err instanceof ProofLinkTimeoutError) {
    // Request timed out after all retries
    console.error(`Timeout after ${err.timeoutMs}ms: ${err.url}`);
  } else if (err instanceof ProofLinkNetworkError) {
    // DNS, connection refused, etc.
    console.error("Network error:", err.message);
  }
}
```

---

## Next Steps

- [API Reference](./api-reference.md) -- every endpoint, field, and error code
- [x402 Integration](./x402-integration.md) -- add compliance to x402 payment servers
- [MCP Integration](./mcp-integration.md) -- give AI agents compliance tools via MCP
- [KYA Guide](./kya-guide.md) -- deep dive into agent identity
- [Compliance Concepts](./compliance-concepts.md) -- understand ProofLink, sanctions screening, and Travel Rule
- [SDK Reference](./sdk-reference.md) -- full SDK method documentation
