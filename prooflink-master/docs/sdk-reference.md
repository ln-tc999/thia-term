# SDK Reference

`@prooflink/sdk` is the TypeScript client SDK for the ProofLink compliance API. It provides typed methods for every endpoint with automatic retries, error handling, and full type coverage.

## Installation

```bash
npm install @prooflink/sdk
# or
pnpm add @prooflink/sdk
```

## ProofLinkClient

### Constructor

```ts
import { ProofLinkClient } from "@prooflink/sdk";

const client = new ProofLinkClient(config: ProofLinkClientConfig);
```

**ProofLinkClientConfig:**

| Property     | Type   | Required | Default                        | Description                       |
|-------------|--------|----------|--------------------------------|-----------------------------------|
| `apiKey`    | string | yes      | --                             | Your ProofLink API key             |
| `baseUrl`   | string | no       | `https://api.prooflink.io/v1`   | API base URL                      |
| `timeout`   | number | no       | `30000`                        | Request timeout in milliseconds   |
| `maxRetries`| number | no       | `3`                            | Max retries for transient errors  |

---

## Compliance Methods

### checkCompliance

Run the full compliance pipeline: sanctions screening, AML scoring, KYA verification, Travel Rule transmission, and jurisdictional checks.

```ts
async checkCompliance(params: ComplianceCheckParams): Promise<ComplianceDecision>
```

**ComplianceCheckParams:**

| Property           | Type   | Required | Description                    |
|--------------------|--------|----------|--------------------------------|
| `sender.address`   | string | yes      | Sender wallet address          |
| `sender.chain`     | string | yes      | Sender blockchain              |
| `sender.agentDID`  | string | no       | Sender agent DID               |
| `receiver.address` | string | yes      | Receiver wallet address        |
| `receiver.chain`   | string | yes      | Receiver blockchain            |
| `receiver.agentDID`| string | no       | Receiver agent DID             |
| `amount`           | string | yes      | Transfer amount (decimal string)|
| `asset`            | string | yes      | Token symbol                   |
| `protocol`         | string | no       | Payment protocol (default: `x402`) |

**Example:**

```ts
const decision = await client.checkCompliance({
  sender: { address: "0xAlice", chain: "base", agentDID: "did:prooflink:agent:alice" },
  receiver: { address: "0xBob", chain: "base" },
  amount: "5000",
  asset: "USDC",
});
console.log(decision.status);    // "APPROVED" | "ESCALATED" | "REJECTED"
console.log(decision.riskScore); // 0-100
console.log(decision.receiptId); // UUID
```

---

### screenAddress

Screen a wallet address against global sanctions lists.

```ts
async screenAddress(address: string, chain: string): Promise<SanctionsCheckResult>
```

**Example:**

```ts
const result = await client.screenAddress("0x742d35Cc6634C0532925a3b844Bc9e7595f2bD68", "base");
console.log(result.matched);      // false
console.log(result.listsChecked); // ["OFAC_SDN", "EU_CONSOLIDATED", ...]
console.log(result.riskScore);    // 0
```

**Throws:** `ProofLinkValidationError` if `address` or `chain` is empty.

---

### calculateRiskScore

Calculate the AML risk score for a transaction context.

```ts
async calculateRiskScore(context: TransactionContext): Promise<AMLRiskScore>
```

**TransactionContext:**

| Property         | Type           | Required | Description              |
|-----------------|----------------|----------|--------------------------|
| `senderAddress` | string         | yes      | Sender wallet address    |
| `receiverAddress`| string        | yes      | Receiver wallet address  |
| `amount`        | string         | yes      | Transfer amount          |
| `asset`         | SupportedToken | yes      | Token symbol             |
| `chain`         | SupportedChain | yes      | Blockchain               |
| `metadata`      | Record         | no       | Additional context       |

**Example:**

```ts
const risk = await client.calculateRiskScore({
  senderAddress: "0xAlice",
  receiverAddress: "0xBob",
  amount: "5000",
  asset: "USDC",
  chain: "base",
});
console.log(risk.score);    // 12
console.log(risk.exceeds);  // false
console.log(risk.factors);  // [{ factor: "new_wallet", weight: 0.1, detail: "..." }]
```

---

### checkTravelRule

Submit Travel Rule data and check transmission status.

```ts
async checkTravelRule(data: TravelRuleData): Promise<TravelRuleResult>
```

**Example:**

```ts
const result = await client.checkTravelRule({
  originator: { walletAddress: "0xAlice", name: "Alice Corp" },
  beneficiary: { walletAddress: "0xBob" },
  amountUsd: 5000,
  asset: "USDC",
  chain: "base",
  direction: "outgoing",
  preTransaction: false,
});
console.log(result.status); // "TRANSMITTED" | "NOT_REQUIRED" | "FAILED"
```

---

### getComplianceReceipt

Retrieve a compliance receipt by ID.

```ts
async getComplianceReceipt(receiptId: string): Promise<ComplianceReceipt>
```

**Example:**

```ts
const receipt = await client.getComplianceReceipt("a1b2c3d4-...");
console.log(receipt.overallStatus);     // "APPROVED"
console.log(receipt.receiptHash);       // "0x..."
console.log(receipt.travelRuleStatus);  // "TRANSMITTED"
```

**Throws:** `ProofLinkValidationError` if `receiptId` is empty.

---

### getComplianceHistory

List historical compliance checks with pagination and filters.

```ts
async getComplianceHistory(params?: ComplianceHistoryParams): Promise<PaginatedResponse<CheckPerformed>>
```

**ComplianceHistoryParams:**

| Property | Type   | Description                              |
|----------|--------|------------------------------------------|
| `page`   | number | Page number (1-based)                    |
| `limit`  | number | Items per page (1-100)                   |
| `status` | string | Filter: `APPROVED`, `REJECTED`, `ESCALATED` |
| `from`   | string | ISO-8601 lower bound                     |
| `to`     | string | ISO-8601 upper bound                     |

**Example:**

```ts
const history = await client.getComplianceHistory({
  page: 1,
  limit: 50,
  status: "REJECTED",
  from: "2026-03-01T00:00:00.000Z",
});
console.log(history.items.length);
console.log(history.pagination.total);
```

---

## Invoice Methods

### createInvoice

Create a new agent-to-agent invoice (starts in `DRAFT` state).

```ts
async createInvoice(params: CreateInvoiceParams): Promise<AgentInvoice>
```

**CreateInvoiceParams:**

| Property          | Type   | Required | Description                    |
|------------------|--------|----------|--------------------------------|
| `seller`         | object | yes      | `{ walletAddress, agentId?, legalName? }` |
| `buyer`          | object | yes      | `{ walletAddress, agentId?, legalName? }` |
| `lineItems`      | array  | yes      | At least one line item         |
| `currency`       | enum   | yes      | `USDC`, `USDT`, `USD`, `EUR`, `GBP`, `EURC` |
| `totalAmount`    | number | yes      | Total invoice amount           |
| `paymentProtocol`| enum   | no       | `x402`, `mpp`, `ap2`, `acp`, `direct` |
| `dueDate`        | string | no       | ISO-8601 due date              |

**Example:**

```ts
const invoice = await client.createInvoice({
  seller: { walletAddress: "0xAlice", agentId: "did:prooflink:agent:alice" },
  buyer: { walletAddress: "0xBob" },
  lineItems: [
    { description: "Data analysis", quantity: 1, unitPrice: 250, total: 250, serviceCategory: "analysis" },
  ],
  currency: "USDC",
  totalAmount: 250,
});
```

---

### getInvoice

Fetch an invoice by ID.

```ts
async getInvoice(id: string): Promise<AgentInvoice>
```

**Throws:** `ProofLinkValidationError` if `id` is empty.

---

### listInvoices

List invoices with pagination and filters.

```ts
async listInvoices(params?: ListInvoicesParams): Promise<PaginatedResponse<AgentInvoice>>
```

**ListInvoicesParams:**

| Property  | Type   | Description                              |
|-----------|--------|------------------------------------------|
| `page`    | number | Page number (1-based)                    |
| `limit`   | number | Items per page (1-100)                   |
| `state`   | enum   | Filter by invoice state                  |
| `currency`| enum   | Filter by currency                       |
| `seller`  | string | Filter by seller address (partial match) |
| `buyer`   | string | Filter by buyer address (partial match)  |
| `from`    | string | ISO-8601 lower bound                     |
| `to`      | string | ISO-8601 upper bound                     |

---

### updateInvoiceState

Transition an invoice to a new state.

```ts
async updateInvoiceState(invoiceId: string, state: InvoiceState, reason?: string): Promise<AgentInvoice>
```

**Valid transitions:**

| From       | To                                |
|------------|-----------------------------------|
| `DRAFT`    | `ISSUED`, `CANCELLED`             |
| `ISSUED`   | `PAID`, `DISPUTED`, `CANCELLED`   |
| `PAID`     | `SETTLED`, `DISPUTED`             |
| `DISPUTED` | `ISSUED`, `CANCELLED`             |

**Example:**

```ts
await client.updateInvoiceState(invoice.id, "ISSUED", "Ready for payment");
await client.updateInvoiceState(invoice.id, "PAID");
await client.updateInvoiceState(invoice.id, "SETTLED");
```

**Throws:** `ProofLinkValidationError` if `invoiceId` is empty.

---

## Identity Methods

### verifyAgent

Verify an agent's KYA credential and return trust score.

```ts
async verifyAgent(agentId: string): Promise<KYAVerificationResult>
```

**Example:**

```ts
const result = await client.verifyAgent("did:prooflink:agent:bob-bot");
if (result.verified) {
  console.log("Trust score:", result.trustScore);
  console.log("Operator:", result.agentMetadata?.operator);
}
```

**Throws:** `ProofLinkValidationError` if `agentId` is empty.

---

### registerAgent

Register a new agent and receive an `AgentIdentity` (also issues a KYA credential server-side).

```ts
async registerAgent(agent: AgentRegistration): Promise<AgentIdentity>
```

**AgentRegistration:**

| Property                 | Type     | Required | Description                    |
|--------------------------|----------|----------|--------------------------------|
| `agentDid`               | string   | yes      | Agent DID                      |
| `agentType`              | enum     | yes      | `autonomous`, `semi-autonomous`, `human-supervised` |
| `controllingEntity`      | object   | yes      | `{ name, lei?, did?, kybVerified }` |
| `walletAddress`          | string   | yes      | Agent wallet address           |
| `delegationScope`        | object   | yes      | Spending limits and restrictions|
| `erc8004RegistryAddress` | string   | no       | ERC-8004 registry contract     |
| `erc8004TokenId`         | string   | no       | ERC-8004 token ID              |

---

### getAgentIdentity

Retrieve the full identity profile of a registered agent.

```ts
async getAgentIdentity(agentId: string): Promise<AgentIdentity>
```

**Throws:** `ProofLinkValidationError` if `agentId` is empty.

---

### listAgents

List all registered agents with pagination.

```ts
async listAgents(params?: PaginationParams): Promise<PaginatedResponse<AgentIdentity>>
```

---

### issueKYA

Issue a new KYA verifiable credential.

```ts
async issueKYA(params: IssueKYAParams): Promise<KYACredential>
```

**IssueKYAParams:**

| Property                 | Type            | Required | Description                    |
|--------------------------|-----------------|----------|--------------------------------|
| `agentId`                | string          | yes      | Agent identifier               |
| `agentType`              | AgentType       | yes      | Agent autonomy level           |
| `controllingEntity`      | object          | yes      | Operator details with KYB status|
| `delegationScope`        | DelegationScope | yes      | Authorization boundaries       |
| `walletAddress`          | string          | yes      | Agent wallet                   |
| `erc8004RegistryAddress` | string          | no       | ERC-8004 registry              |
| `erc8004TokenId`         | string          | no       | ERC-8004 token ID              |
| `validationEvidence`     | string          | no       | URI to TEE attestation         |

---

## Error Handling

The SDK provides a typed error hierarchy:

```ts
ProofLinkError                     // Base class for all SDK errors
  +-- ProofLinkAPIError            // API returned non-2xx response
  +-- ProofLinkValidationError     // Client-side validation failed
  +-- ProofLinkTimeoutError        // Request exceeded timeout
  +-- ProofLinkNetworkError        // DNS, connection, or network failure
```

### ProofLinkAPIError

Thrown when the API returns a non-2xx HTTP response.

```ts
class ProofLinkAPIError extends ProofLinkError {
  readonly status: number;         // HTTP status code
  readonly body: ApiErrorBody | null; // Parsed error body
  readonly headers: Headers;       // Response headers
}

interface ApiErrorBody {
  code: string;                    // Error code (e.g., "NOT_FOUND")
  message: string;                 // Human-readable message
  details?: Record<string, unknown>;
}
```

### ProofLinkValidationError

Thrown when client-side validation fails (no network call is made).

```ts
class ProofLinkValidationError extends ProofLinkError {
  readonly field?: string;         // Which field failed validation
}
```

### ProofLinkTimeoutError

Thrown when a request exceeds the configured timeout after all retries.

```ts
class ProofLinkTimeoutError extends ProofLinkError {
  readonly timeoutMs: number;      // Configured timeout
  readonly url: string;            // Request URL
}
```

### ProofLinkNetworkError

Thrown on network-level failures after all retries are exhausted.

```ts
class ProofLinkNetworkError extends ProofLinkError {
  // Wraps the underlying network error as `cause`
}
```

### Error handling example

```ts
import {
  ProofLinkClient,
  ProofLinkAPIError,
  ProofLinkValidationError,
  ProofLinkTimeoutError,
  ProofLinkNetworkError,
} from "@prooflink/sdk";

try {
  const decision = await client.checkCompliance({ ... });
} catch (err) {
  if (err instanceof ProofLinkAPIError) {
    console.error(`API error ${err.status}: ${err.body?.code}`);

    if (err.status === 429) {
      const retryAfter = err.headers.get("Retry-After");
      console.log(`Rate limited. Retry after ${retryAfter}s`);
    }
  } else if (err instanceof ProofLinkValidationError) {
    console.error(`Validation: ${err.field} - ${err.message}`);
  } else if (err instanceof ProofLinkTimeoutError) {
    console.error(`Timeout after ${err.timeoutMs}ms`);
  } else if (err instanceof ProofLinkNetworkError) {
    console.error("Network error:", err.message);
  }
}
```

---

## HTTP Transport

For advanced use cases, the `HttpClient` is also exported:

```ts
import { HttpClient } from "@prooflink/sdk";

const http = new HttpClient({
  baseUrl: "https://api.prooflink.io/v1",
  apiKey: "fl_live_...",
  timeoutMs: 30000,
  maxRetries: 3,
});

// Direct HTTP methods
const data = await http.get<MyType>("/custom/endpoint", { page: 1 });
const result = await http.post<MyType>("/custom/endpoint", { body: "data" });
```

### Retry behavior

- Retries on: `408`, `429`, `500`, `502`, `503`, `504`
- Exponential backoff: 500ms, 1s, 2s, ... capped at 8s (with jitter)
- Respects `Retry-After` header on 429 responses
- Timeout errors and network errors are also retried

---

## TypeScript Types

All types from `@prooflink/shared` are re-exported from `@prooflink/sdk` for convenience:

```ts
import type {
  // Compliance
  ComplianceDecision,
  ComplianceReceipt,
  SanctionsCheckResult,
  AMLRiskScore,
  TravelRuleData,

  // Identity
  AgentIdentity,
  KYACredential,
  KYAVerificationResult,
  DelegationScope,

  // Invoice
  AgentInvoice,
  InvoiceState,
  InvoiceLineItem,

  // Protocol
  PaymentProtocol,
  SupportedChain,
  SupportedToken,
} from "@prooflink/sdk";
```

---

## Next Steps

- [Quick Start](./quickstart.md) -- get running in 5 minutes
- [API Reference](./api-reference.md) -- full REST API documentation
- [Compliance Concepts](./compliance-concepts.md) -- understand ProofLink receipts
- [KYA Guide](./kya-guide.md) -- agent identity deep dive
