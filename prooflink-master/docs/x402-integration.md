# x402 Integration Guide

Add automated compliance checks to any x402 payment server. Every payment is screened against sanctions lists, scored for AML risk, and (when above threshold) transmitted through the Travel Rule pipeline -- all before settlement.

## What is x402?

[x402](https://www.x402.org/) is Coinbase's HTTP 402 payment protocol that enables native web payments using stablecoins. When a client requests a paid resource, the server responds with `402 Payment Required` and payment instructions. The client signs a payment authorization, resubmits the request, and the server verifies and settles the payment.

ProofLink's `@prooflink/x402-compliance` package intercepts this flow at three points to enforce compliance without modifying your application logic.

## Install

```bash
npm install @prooflink/x402-compliance
# or
pnpm add @prooflink/x402-compliance
```

## Quick Setup (3 Lines)

```ts
import { createProofLinkCompliance } from "@prooflink/x402-compliance";

const compliance = createProofLinkCompliance({
  chainalysisApiKey: process.env.CHAINALYSIS_API_KEY!,
  policy: {
    sanctionsLists: ["OFAC_SDN", "EU_CONSOLIDATED", "UN_CONSOLIDATED"],
    maxRiskScore: 70,
    travelRuleThresholdUsd: 3000,
  },
});

compliance.register(server); // server = your x402 ResourceServer
```

Every x402 payment through `server` now has compliance enforced at three hook points:

1. **Before verify** -- sanctions screening + AML scoring on the payer address
2. **Before settle** -- Travel Rule transmission for transfers above threshold
3. **After settle** -- ProofLink receipt generation + optional EAS on-chain attestation

---

## Full Configuration

```ts
import { createProofLinkCompliance } from "@prooflink/x402-compliance";

const compliance = createProofLinkCompliance({
  // Required: Chainalysis API key for sanctions screening
  chainalysisApiKey: process.env.CHAINALYSIS_API_KEY!,

  // Compliance policy
  policy: {
    sanctionsLists: ["OFAC_SDN", "OFAC_CONS", "EU_CONSOLIDATED", "UN_CONSOLIDATED", "HMT"],
    maxRiskScore: 70,              // Block payments with AML risk > 70
    travelRuleThresholdUsd: 3000,  // Travel Rule for transfers >= $3,000
    eddJurisdictions: ["IR", "KP", "SY"],  // Enhanced due diligence jurisdictions
    allowlist: ["0xTrustedTreasury"],       // Skip screening for known addresses
    blocklist: ["0xKnownBadActor"],         // Always reject
    failOpen: false,               // Fail-closed: block if screening API is down
  },

  // Optional: Travel Rule via Notabene
  notabene: {
    apiKey: process.env.NOTABENE_API_KEY!,
    vaspDID: "did:ethr:0xYourVASP",
    testnet: true,
  },

  // Optional: Redis cache for screening results
  redis: {
    url: "redis://localhost:6379",
    cleanCacheTtlSeconds: 3600,    // Cache clean results for 1 hour
    flaggedCacheTtlSeconds: 300,   // Cache flagged results for 5 min
  },

  // Optional: On-chain attestation via EAS
  eas: {
    schemaUid: "0xYourSchemaUid",
    privateKey: process.env.EAS_PRIVATE_KEY!,
    rpcUrl: "https://mainnet.base.org",
  },

  // Optional: Auto-generate invoices for settled payments
  invoicing: {
    enabled: true,
    companyName: "Your Company",
    companyAddress: "123 Main St",
    taxId: "US-EIN-123456",
    webhookUrl: "https://your-app.com/webhooks/invoices",
  },

  // Optional: structured logger
  logger: console,

  // Optional: Prometheus metrics prefix
  metricsPrefix: "prooflink_x402",
});
```

### Configuration Reference

| Field                            | Required | Description                                                |
|---------------------------------|----------|------------------------------------------------------------|
| `chainalysisApiKey`             | yes      | Chainalysis API key for sanctions/AML screening            |
| `policy.sanctionsLists`         | yes      | Lists to screen: `OFAC_SDN`, `OFAC_CONS`, `EU_CONSOLIDATED`, `UN_CONSOLIDATED`, `HMT` |
| `policy.maxRiskScore`           | yes      | AML risk threshold (0-100). Payments above are rejected.   |
| `policy.travelRuleThresholdUsd` | yes      | USD threshold for Travel Rule transmission                 |
| `policy.eddJurisdictions`       | no       | ISO 3166-1 alpha-2 codes requiring enhanced due diligence  |
| `policy.allowlist`              | no       | Addresses that bypass screening                            |
| `policy.blocklist`              | no       | Addresses that are always rejected                         |
| `policy.failOpen`               | no       | If `true`, payments proceed when screening API is down. Default: `false` |
| `notabene`                      | no       | Notabene config for VASP-to-VASP Travel Rule               |
| `redis`                         | no       | Redis config for caching screening results                 |
| `eas`                           | no       | EAS config for on-chain compliance attestation             |
| `invoicing`                     | no       | Auto-invoicing config for settled payments                 |
| `logger`                        | no       | Logger instance (must have `info`, `warn`, `error`, `debug`) |
| `metricsPrefix`                 | no       | Prefix for Prometheus metrics                              |

---

## Hook Customization

### Using hooks standalone

If you need finer control, attach hooks individually instead of using `register()`:

```ts
const compliance = createProofLinkCompliance(config);

// Attach individually
server.onBeforeVerify(compliance.onBeforeVerify);
server.onBeforeSettle(compliance.onBeforeSettle);
server.onAfterSettle(compliance.onAfterSettle);
```

### Custom service implementations

Override default screening, AML, or proof services with your own implementations:

```ts
import {
  createProofLinkCompliance,
  type SanctionsScreener,
  type AmlScorer,
  type TravelRuleService,
  type ProofLinkService,
  type KYAVerifier,
} from "@prooflink/x402-compliance";

const customScreener: SanctionsScreener = {
  async screen(address: string, network: string) {
    const result = await myScreeningService.check(address);
    return { address, clean: result.clear, latencyMs: result.ms };
  },
};

const compliance = createProofLinkCompliance(config, {
  screener: customScreener,
  amlScorer: customAmlScorer,
  travelRuleService: customTravelRule,
  proofLinkService: customProofLink,
  kyaVerifier: customKYA,
  kyaRegistry: customRegistry,
  priceConverter: customPriceConverter,
  invoiceService: customInvoiceService,
});
```

### Service interfaces

**SanctionsScreener:**

```ts
interface SanctionsScreener {
  screen(address: string, network: string): Promise<{
    address: string;
    clean: boolean;
    matchedList?: string;
    latencyMs: number;
  }>;
}
```

**AmlScorer:**

```ts
interface AmlScorer {
  score(address: string, amount: string, network: string): Promise<{
    address: string;
    score: number;       // 0-100
    latencyMs: number;
    factors: string[];
  }>;
}
```

**TravelRuleService:**

```ts
interface TravelRuleService {
  transmit(request: TravelRuleTransmitRequest): Promise<TravelRuleTransmitResult>;
}
```

**ProofLinkService:**

```ts
interface ProofLinkService {
  computeHash(receipt: {
    transactionHash: string;
    sender: string;
    receiver: string;
    amount: string;
    createdAt: string;
  }): string;
  attestOnChain(receipt: unknown): Promise<string | null>;
  storeAuditRecord(receipt: unknown): Promise<void>;
}
```

---

## ProofLink Receipt Handling

After every successful settlement, ProofLink generates a ProofLink receipt -- a cryptographically signed compliance proof that serves as an audit trail.

The receipt contains:

| Field                | Description                                   |
|---------------------|-----------------------------------------------|
| `version`           | ProofLink schema version (currently `1`)      |
| `transactionHash`   | On-chain transaction hash                     |
| `network`           | CAIP-2 chain ID (e.g. `eip155:8453`)          |
| `sender`            | Sender wallet address                         |
| `receiver`          | Receiver wallet address                       |
| `amount`            | Transfer amount (decimal string)              |
| `asset`             | Token symbol or contract address              |
| `complianceDecision`| Full decision with checks, risk score, status |
| `invoiceId`         | Linked invoice ID (if applicable)             |
| `attestationUid`    | EAS attestation UID (if on-chain attestation is enabled) |
| `ipfsCid`           | IPFS CID of the full compliance report        |
| `createdAt`         | ISO-8601 receipt creation timestamp           |

Access receipts programmatically:

```ts
compliance.on((event) => {
  if (event.type === "compliance:receipt:generated") {
    const receipt = event.payload;
    console.log("Receipt hash:", receipt.receiptHash);
    console.log("Attestation UID:", receipt.attestationUid);

    // Store for audit
    await auditLog.store(receipt);
  }
});
```

---

## Event Handling

Subscribe to compliance events for logging, alerting, or analytics:

```ts
const unsubscribe = compliance.on((event) => {
  switch (event.type) {
    case "compliance:check:started":
      console.log("Screening started for", event.payload.sender);
      break;
    case "compliance:check:failed":
      alertOps(`Payment blocked: ${event.payload.reason}`);
      break;
    case "compliance:settle:completed":
      analytics.track("payment_settled", event.payload);
      break;
    case "compliance:receipt:attested":
      console.log("EAS attestation:", event.payload.proofLinkHash);
      break;
  }
});

// Unsubscribe when no longer needed
unsubscribe();
```

**Event types:**

| Event                            | Emitted when                               |
|---------------------------------|---------------------------------------------|
| `compliance:check:started`      | Compliance pipeline begins                  |
| `compliance:check:passed`       | All checks pass                             |
| `compliance:check:failed`       | A check fails (payment blocked)             |
| `compliance:settle:completed`   | Payment settled on-chain                    |
| `compliance:receipt:generated`  | ProofLink receipt created                   |
| `compliance:receipt:attested`   | Receipt attested on-chain via EAS           |

---

## Example: Express Server with x402 + ProofLink

Complete example of an Express server using x402 for payments with ProofLink compliance:

```ts
import express from "express";
import { createResourceServer } from "@x402/server";
import { createProofLinkCompliance } from "@prooflink/x402-compliance";

const app = express();

// 1. Create the x402 resource server
const server = createResourceServer({
  payTo: "0xYourWallet",
  network: "base",
  facilitator: "https://facilitator.x402.org",
});

// 2. Add ProofLink compliance
const compliance = createProofLinkCompliance({
  chainalysisApiKey: process.env.CHAINALYSIS_API_KEY!,
  policy: {
    sanctionsLists: ["OFAC_SDN", "EU_CONSOLIDATED", "UN_CONSOLIDATED"],
    maxRiskScore: 70,
    travelRuleThresholdUsd: 3000,
  },
  notabene: {
    apiKey: process.env.NOTABENE_API_KEY!,
    vaspDID: "did:ethr:0xYourVASP",
    testnet: false,
  },
  eas: {
    schemaUid: process.env.EAS_SCHEMA_UID!,
    privateKey: process.env.EAS_PRIVATE_KEY!,
    rpcUrl: "https://mainnet.base.org",
  },
});

compliance.register(server);

// 3. Log compliance events
compliance.on((event) => {
  if (event.type === "compliance:check:failed") {
    console.warn("Payment blocked:", event.payload.reason);
  }
});

// 4. Define paid endpoints
app.get(
  "/api/premium-data",
  server.paywall("0.50", "USDC", { description: "Premium data access" }),
  (req, res) => {
    res.json({ data: "premium content" });
  },
);

// 5. Cleanup on shutdown
process.on("SIGTERM", () => {
  compliance.destroy();
  process.exit(0);
});

app.listen(3000, () => console.log("Server running on :3000"));
```

---

## Testing with Testnet

```ts
const compliance = createProofLinkCompliance({
  chainalysisApiKey: "test_key",
  notabene: {
    apiKey: process.env.NOTABENE_API_KEY!,
    vaspDID: "did:ethr:0xTestVASP",
    testnet: true,  // Notabene sandbox
  },
  policy: {
    sanctionsLists: ["OFAC_SDN"],
    maxRiskScore: 70,
    travelRuleThresholdUsd: 1000,
  },
});
```

---

## Cleanup

Stop background timers when shutting down your server:

```ts
process.on("SIGTERM", () => {
  compliance.destroy();
  server.close();
});
```

---

## Next Steps

- [API Reference](./api-reference.md) -- REST API for compliance checks outside x402
- [MCP Integration](./mcp-integration.md) -- give AI agents compliance tools via MCP
- [Compliance Concepts](./compliance-concepts.md) -- understand ProofLink, AML scoring, Travel Rule
- [Quick Start](./quickstart.md) -- SDK usage for direct API calls
