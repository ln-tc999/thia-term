# Compliance Concepts

This guide explains the core compliance concepts behind ProofLink: how ProofLink receipts work, what each compliance check does, and which regulatory frameworks drive the requirements.

## ProofLink Explained

ProofLink is ProofLink's compliance receipt system -- a cryptographically signed proof that a transaction passed all required compliance checks. Every compliance check produces a ProofLink receipt that serves as an audit trail.

### What a ProofLink receipt contains

```json
{
  "version": 1,
  "transactionHash": "0xa1b2c3...",
  "network": "eip155:8453",
  "sender": "0xAlice",
  "receiver": "0xBob",
  "amount": "5000",
  "asset": "USDC",
  "complianceDecision": {
    "status": "APPROVED",
    "riskScore": 12,
    "receiptId": "rcpt_abc123",
    "receiptHash": "0x9a8b...",
    "checks": [ ... ],
    "travelRuleStatus": "TRANSMITTED",
    "timestamp": "2026-03-21T12:00:00.000Z",
    "ttl": 300
  },
  "invoiceId": "inv_xyz789",
  "attestationUid": "0xeas...",
  "ipfsCid": "bafybeig...",
  "createdAt": "2026-03-21T12:00:00.000Z"
}
```

### Receipt lifecycle

1. **Generation** -- created immediately after the compliance pipeline completes
2. **Signing** -- signed with ProofLink's issuer key (EcdsaSecp256k1)
3. **Storage** -- stored in the ProofLink database with a unique `receiptId`
4. **Attestation** (optional) -- anchored on-chain via Ethereum Attestation Service (EAS)
5. **Archival** (optional) -- full report pinned to IPFS for permanent auditability

### TTL (Time to Live)

Receipts have a default TTL of 300 seconds (5 minutes). After expiry, the compliance check should be re-run before proceeding with settlement. This ensures that screening results are current -- an address could be added to a sanctions list between the check and settlement.

---

## Sanctions Screening

Sanctions screening is the first and most critical compliance check. ProofLink screens wallet addresses and entity names against global sanctions lists.

### Lists screened

| List              | Issuing authority                    | Coverage                |
|-------------------|--------------------------------------|-------------------------|
| `OFAC_SDN`        | U.S. Treasury OFAC                   | Specially Designated Nationals |
| `OFAC_CONS`       | U.S. Treasury OFAC                   | Consolidated non-SDN list |
| `EU_CONSOLIDATED` | European Union                       | EU sanctions targets    |
| `UN_CONSOLIDATED` | United Nations Security Council      | UN sanctions targets    |
| `HMT`             | UK HM Treasury                       | UK financial sanctions  |

### How it works

1. The wallet address is submitted to the sanctions screening provider (default: Chainalysis)
2. The provider checks the address against all configured lists
3. If a match is found, the `matchDetails` array contains the list, entry ID, name, and confidence score
4. A risk score (0-100) is computed based on match confidence and list severity

### Match confidence

| Confidence | Meaning                                    |
|------------|---------------------------------------------|
| 0.0 - 0.5  | Low confidence -- possible false positive   |
| 0.5 - 0.8  | Medium confidence -- requires review        |
| 0.8 - 1.0  | High confidence -- likely true match        |

### Caching

Clean screening results are cached for 1 hour (configurable). Flagged results are cached for 5 minutes. This reduces API calls while ensuring flagged addresses are re-checked frequently.

---

## AML Risk Scoring

Anti-Money Laundering risk scoring evaluates a transaction context against behavioral risk factors.

### Risk factors

| Factor                    | Description                                      |
|--------------------------|--------------------------------------------------|
| `velocity_anomaly`       | Unusual transaction frequency                    |
| `destination_risk`       | Recipient is in a high-risk jurisdiction         |
| `amount_anomaly`         | Transaction amount deviates from pattern         |
| `indirect_exposure`      | Address interacted with risky addresses           |
| `new_wallet`             | Wallet is recently created                       |
| `mixer_interaction`      | Address has used mixing/tumbling services        |
| `darknet_exposure`       | Address has darknet marketplace connections      |
| `structuring`            | Multiple transactions just below reporting thresholds |
| `time_of_day_anomaly`    | Transaction at unusual time for the entity       |
| `cross_chain_correlation`| Suspicious cross-chain movement patterns         |

### Risk score thresholds

| Score    | Label    | Action                    |
|----------|----------|---------------------------|
| 0 - 24   | Low      | Auto-approve              |
| 25 - 49  | Medium   | Auto-approve with logging |
| 50 - 79  | High     | Escalate for manual review|
| 80 - 100 | Critical | Auto-reject               |

The threshold between approve/escalate/reject is configurable via the compliance policy (`maxRiskScore`).

### AML risk score structure

```ts
interface AMLRiskScore {
  score: number;           // 0-100
  factors: Array<{
    factor: AMLRiskFactor; // e.g., "velocity_anomaly"
    weight: number;        // 0-1 contribution weight
    detail: string;        // Human-readable explanation
  }>;
  threshold: number;       // Configured rejection threshold
  exceeds: boolean;        // Whether score > threshold
  evaluatedAt: string;     // ISO-8601 timestamp
}
```

---

## Travel Rule Compliance

The FATF Travel Rule requires Virtual Asset Service Providers (VASPs) to share originator and beneficiary information for transfers above a jurisdiction-specific threshold.

### When the Travel Rule applies

| Jurisdiction | Threshold  | Regulation           |
|-------------|------------|----------------------|
| United States | $3,000   | GENIUS Act (2025)    |
| European Union | EUR 1,000 | MiCA TFR (2024)   |
| FATF default  | $1,000   | FATF Recommendation 16 |

### IVMS101 data format

Travel Rule data follows the IVMS101 standard:

```ts
interface TravelRuleData {
  originator: {
    name?: string;
    walletAddress: string;
    physicalAddress?: string;
    nationalId?: string;
    accountNumber?: string;
    agentId?: string;
    vaspDid?: string;
  };
  beneficiary: {
    name?: string;
    walletAddress: string;
    agentId?: string;
    vaspDid?: string;
  };
  amountUsd: number;
  asset: string;
  chain: string;
  direction: "outgoing" | "incoming";
  preTransaction: boolean;
  txHash?: string;
}
```

### Travel Rule status values

| Status          | Description                                    |
|----------------|------------------------------------------------|
| `NOT_REQUIRED` | Transaction below threshold                    |
| `TRANSMITTED`  | Data sent to counterparty VASP                 |
| `PENDING`      | Awaiting counterparty acknowledgment           |
| `FAILED`       | Transmission failed                            |
| `ACK_RECEIVED` | Counterparty VASP acknowledged receipt         |

### Travel Rule provider

ProofLink integrates with [Notabene](https://notabene.id/) for VASP-to-VASP Travel Rule messaging. Notabene handles the counterparty discovery, data exchange, and acknowledgment protocol.

---

## Jurisdictional Rules

ProofLink evaluates transactions against jurisdiction-specific regulations.

### GENIUS Act (United States)

The Stablecoin (GENIUS) Act, signed July 2025, requires:

- Stablecoin issuers to maintain 1:1 reserves
- Payment service providers to implement AML/CFT programs
- Travel Rule compliance for transfers >= $3,000
- Monthly reserve attestations

**ProofLink enforcement:** Transactions involving U.S. counterparties trigger enhanced Travel Rule checks at the $3,000 threshold and require originator name and address.

### MiCA (European Union)

The Markets in Crypto-Assets Regulation (fully enforceable mid-2026) requires:

- CASP (Crypto-Asset Service Provider) licensing
- Travel Rule compliance for transfers >= EUR 1,000
- Mandatory originator and beneficiary identification
- Enhanced due diligence for third-country transfers

**ProofLink enforcement:** Transactions involving EU counterparties trigger Travel Rule checks at the EUR 1,000 threshold, with enhanced data requirements for transfers to non-EU jurisdictions.

### FATF Recommendations

99 jurisdictions implement the FATF Travel Rule with varying thresholds and data requirements. ProofLink maintains a jurisdiction database and applies the correct rules based on the sender and receiver locations.

---

## Compliance Receipts

Every compliance check produces a receipt that can be retrieved later for audit purposes.

### Receipt fields

| Field              | Description                                     |
|-------------------|-------------------------------------------------|
| `receiptId`       | Unique receipt identifier (UUID)                |
| `receiptHash`     | Cryptographic hash of the receipt contents      |
| `overallStatus`   | `COMPLIANT`, `BLOCKED`, or `REVIEW_REQUIRED`    |
| `riskScore`       | Aggregate AML risk score (0-100)                |
| `travelRuleStatus`| Travel Rule transmission status                 |
| `checksPerformed` | Array of individual check results               |
| `signature`       | ECDSA signature from ProofLink's issuer key      |
| `ttl`             | Time-to-live in seconds (default: 300)          |
| `easAttestationUid` | On-chain EAS attestation UID (if enabled)     |
| `ipfsCid`         | IPFS CID of the full compliance report          |

### Retrieving receipts

```ts
// Via SDK
const receipt = await prooflink.getComplianceReceipt("rcpt_abc123");

// Via API
// GET /api/v1/compliance/receipt/rcpt_abc123
```

### On-chain attestation via EAS

When EAS is configured, ProofLink creates an on-chain attestation for each compliance receipt on the Ethereum Attestation Service. This provides tamper-proof evidence that the compliance check occurred and what the result was.

The EAS attestation includes:
- Receipt hash
- Overall status
- Risk score
- Timestamp
- Issuer signature

---

## The Compliance Pipeline

When you call `checkCompliance()`, ProofLink runs six checks in sequence:

```
Payment request received
    |
    v
[1. SANCTIONS_SCREENING - sender]
    +-- Match found --> REJECTED
    |
    v
[2. SANCTIONS_SCREENING - receiver]
    +-- Match found --> REJECTED
    |
    v
[3. KYA_VERIFICATION - sender agent]
    +-- Failed (if agentDID provided) --> ESCALATED
    +-- Skipped (if no agentDID)
    |
    v
[4. AML_MONITORING - transaction context]
    +-- Risk > threshold --> REJECTED
    +-- Risk 50-79 --> ESCALATED
    |
    v
[5. TRAVEL_RULE - if above threshold]
    +-- Transmission failed --> ESCALATED
    |
    v
[6. JURISDICTIONAL_RULES - applicable regulations]
    +-- Violation detected --> REJECTED
    |
    v
APPROVED (risk < 50)
```

Each check records its result, provider, duration, and timestamp. The aggregate risk score determines the final decision:

| Risk score | Decision    |
|------------|-------------|
| < 50       | `APPROVED`  |
| 50 - 79    | `ESCALATED` |
| >= 80      | `REJECTED`  |

---

## Next Steps

- [API Reference](./api-reference.md) -- run compliance checks via the REST API
- [x402 Integration](./x402-integration.md) -- automated compliance for x402 payments
- [KYA Guide](./kya-guide.md) -- deep dive into agent identity
- [Architecture Guide](./architecture.md) -- system design and data flow
