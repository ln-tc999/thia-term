# ProofLink API Reference

Base URL: `https://api.prooflink.io/v1`

## Authentication

All requests require a Bearer token in the `Authorization` header:

```
Authorization: Bearer fl_live_your_api_key
```

API keys are scoped with fine-grained permissions:

| Scope              | Description                          |
|--------------------|--------------------------------------|
| `compliance:read`  | Read compliance checks and receipts  |
| `compliance:write` | Run compliance checks and screening  |
| `payments:read`    | Read payment status                  |
| `payments:write`   | Execute payments                     |
| `invoices:read`    | Read invoices                        |
| `invoices:write`   | Create and update invoices           |
| `analytics:read`   | Read analytics dashboards            |
| `webhooks:manage`  | Register and manage webhooks         |
| `admin`            | Full access                          |

## Response Envelope

All responses use a consistent envelope format.

**Success:**

```json
{
  "success": true,
  "data": { ... }
}
```

**Error:**

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description."
  }
}
```

## Rate Limiting

- **Default:** 100 requests/minute per API key
- Rate-limited requests return `429 Too Many Requests` with a `Retry-After` header (seconds)
- Rate limit headers are included on every response:

| Header                  | Description                         |
|-------------------------|-------------------------------------|
| `X-RateLimit-Limit`     | Requests allowed per window         |
| `X-RateLimit-Remaining` | Requests remaining in current window|
| `X-RateLimit-Reset`     | UTC epoch seconds when window resets|

## Pagination

All list endpoints return paginated results:

```json
{
  "success": true,
  "data": {
    "items": [ ... ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 42,
      "totalPages": 3
    }
  }
}
```

| Parameter | Type   | Default | Description           |
|-----------|--------|---------|-----------------------|
| `page`    | number | `1`     | Page number (1-based) |
| `limit`   | number | `20`    | Items per page (1-100)|

---

## Compliance

### Run a full compliance check

Execute the complete compliance pipeline: sanctions screening (sender + receiver), KYA verification, AML scoring, travel-rule transmission, and jurisdictional checks. Returns a single compliance decision with a ProofLink receipt.

```
POST /compliance/check
```

**Request body**

| Field              | Type   | Required | Description                                         |
|--------------------|--------|----------|-----------------------------------------------------|
| `sender.address`   | string | yes      | Sender wallet address                               |
| `sender.chain`     | string | yes      | Sender blockchain (e.g. `base`, `ethereum`)         |
| `sender.agentDID`  | string | no       | Sender agent DID (enables KYA verification)         |
| `receiver.address` | string | yes      | Receiver wallet address                             |
| `receiver.chain`   | string | yes      | Receiver blockchain                                 |
| `receiver.agentDID`| string | no       | Receiver agent DID                                  |
| `amount`           | string | yes      | Transfer amount (decimal string)                    |
| `asset`            | string | yes      | Token symbol (`USDC`, `USDT`, `EURC`)               |
| `protocol`         | string | no       | Payment protocol. Default: `x402`                   |

**Example request:**

```json
{
  "sender": {
    "address": "0xAlice",
    "chain": "base",
    "agentDID": "did:prooflink:agent:alice-bot"
  },
  "receiver": {
    "address": "0xBob",
    "chain": "base"
  },
  "amount": "5000",
  "asset": "USDC",
  "protocol": "x402"
}
```

**Response** `201 Created`

```json
{
  "success": true,
  "data": {
    "status": "APPROVED",
    "riskScore": 12,
    "receiptId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "receiptHash": "0x9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d",
    "checks": [
      {
        "checkType": "SANCTIONS_SCREENING",
        "target": "sender",
        "result": "PASSED",
        "provider": "chainalysis_free",
        "performedAt": "2026-03-21T12:00:00.000Z",
        "durationMs": 45
      },
      {
        "checkType": "SANCTIONS_SCREENING",
        "target": "receiver",
        "result": "PASSED",
        "provider": "chainalysis_free",
        "performedAt": "2026-03-21T12:00:00.000Z",
        "durationMs": 42
      },
      {
        "checkType": "KYA_VERIFICATION",
        "target": "sender",
        "result": "PASSED",
        "provider": "prooflink",
        "performedAt": "2026-03-21T12:00:00.000Z",
        "durationMs": 30
      },
      {
        "checkType": "AML_MONITORING",
        "target": "transaction",
        "result": "PASSED",
        "provider": "prooflink",
        "performedAt": "2026-03-21T12:00:00.000Z",
        "durationMs": 20
      },
      {
        "checkType": "TRAVEL_RULE",
        "target": "transaction",
        "result": "PASSED",
        "provider": "notabene",
        "performedAt": "2026-03-21T12:00:00.000Z",
        "durationMs": 5
      },
      {
        "checkType": "JURISDICTIONAL_RULES",
        "target": "transaction",
        "result": "PASSED",
        "provider": "prooflink",
        "performedAt": "2026-03-21T12:00:00.000Z",
        "durationMs": 3
      }
    ],
    "travelRuleStatus": "TRANSMITTED",
    "totalDurationMs": 148,
    "timestamp": "2026-03-21T12:00:00.000Z"
  }
}
```

**Decision status values:**

| Status      | Risk Score | Description                          |
|-------------|------------|--------------------------------------|
| `APPROVED`  | < 50       | Payment may proceed                  |
| `ESCALATED` | 50-79      | Requires manual review               |
| `REJECTED`  | >= 80      | Payment blocked                      |

**Check types:**

| Type                    | Description                                    |
|-------------------------|------------------------------------------------|
| `SANCTIONS_SCREENING`   | OFAC SDN, EU, UN, HMT sanctions list screening|
| `KYA_VERIFICATION`      | Agent identity and delegation scope check      |
| `AML_MONITORING`        | Anti-money laundering risk scoring             |
| `TRAVEL_RULE`           | FATF Travel Rule data transmission             |
| `JURISDICTIONAL_RULES`  | GENIUS Act, MiCA, and local regulations        |
| `INVOICE_VALIDATION`    | Invoice format and content validation          |

---

### Screen an address

Screen a single wallet address against global sanctions lists (OFAC SDN, EU Consolidated, UN Consolidated, HMT).

```
POST /compliance/screen
```

**Request body**

| Field        | Type   | Required | Description                           |
|-------------|--------|----------|---------------------------------------|
| `address`   | string | yes      | Wallet address to screen              |
| `chain`     | string | yes      | Blockchain identifier (e.g. `base`)   |
| `entityName`| string | no       | Legal name for fuzzy name matching    |

**Example request:**

```json
{
  "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD68",
  "chain": "base",
  "entityName": "Acme Corp"
}
```

**Response** `200 OK`

```json
{
  "success": true,
  "data": {
    "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD68",
    "chain": "base",
    "entityName": "Acme Corp",
    "matched": false,
    "listsChecked": ["OFAC_SDN", "EU_CONSOLIDATED", "UN_CONSOLIDATED", "HMT"],
    "matchDetails": [],
    "riskScore": 0,
    "provider": "chainalysis_free",
    "screenedAt": "2026-03-21T12:00:00.000Z"
  }
}
```

When `matched` is `true`, `matchDetails` contains:

```json
{
  "matchDetails": [
    {
      "list": "OFAC_SDN",
      "entryId": "12345",
      "name": "Sanctioned Entity",
      "matchConfidence": 0.98
    }
  ]
}
```

---

### Get a compliance receipt

Retrieve a previously issued compliance receipt by its UUID.

```
GET /compliance/receipt/:id
```

| Parameter | Type | Description        |
|-----------|------|--------------------|
| `id`      | UUID | Receipt identifier |

**Response** `200 OK`

```json
{
  "success": true,
  "data": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "checkId": "f0e1d2c3-b4a5-9687-fedc-ba0987654321",
    "receiptHash": "0x9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d",
    "overallStatus": "APPROVED",
    "riskScore": 12,
    "travelRuleStatus": "TRANSMITTED",
    "signature": "0x...",
    "checksPerformed": [ ... ],
    "ttl": 300,
    "createdAt": "2026-03-21T12:00:00.000Z"
  }
}
```

---

### Get compliance history

List compliance checks with pagination and filters. Results are scoped to the calling API key.

```
GET /compliance/history
```

**Query parameters**

| Parameter | Type   | Default | Description                                    |
|-----------|--------|---------|------------------------------------------------|
| `page`    | number | `1`     | Page number (1-based)                          |
| `limit`   | number | `20`    | Items per page (1-100)                         |
| `status`  | string | --      | Filter: `APPROVED`, `REJECTED`, `ESCALATED`    |
| `from`    | string | --      | ISO-8601 datetime lower bound                  |
| `to`      | string | --      | ISO-8601 datetime upper bound                  |

**Response** `200 OK`

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "...",
        "senderAddress": "0xAlice",
        "receiverAddress": "0xBob",
        "senderAgentDid": "did:prooflink:agent:alice-bot",
        "amount": "5000",
        "asset": "USDC",
        "chain": "base",
        "protocol": "x402",
        "status": "APPROVED",
        "riskScore": 12,
        "checks": [ ... ],
        "totalDurationMs": 148,
        "createdAt": "2026-03-21T12:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 42,
      "totalPages": 3
    }
  }
}
```

---

## Invoices

### Create an invoice

Create a new agent-to-agent invoice. Invoices start in `DRAFT` state.

```
POST /invoices
```

**Request body**

| Field                    | Type   | Required | Description                                              |
|--------------------------|--------|----------|----------------------------------------------------------|
| `seller.walletAddress`   | string | yes      | Seller wallet address                                    |
| `seller.agentId`         | string | no       | Seller agent DID                                         |
| `seller.legalName`       | string | no       | Seller legal name                                        |
| `buyer.walletAddress`    | string | yes      | Buyer wallet address                                     |
| `buyer.agentId`          | string | no       | Buyer agent DID                                          |
| `buyer.legalName`        | string | no       | Buyer legal name                                         |
| `lineItems`              | array  | yes      | At least one line item                                   |
| `currency`               | enum   | yes      | `USDC`, `USDT`, `USD`, `EUR`, `GBP`, `EURC`             |
| `totalAmount`            | number | yes      | Total invoice amount                                     |
| `paymentProtocol`        | enum   | no       | `x402`, `mpp`, `ap2`, `acp`, `direct`                   |
| `dueDate`                | string | no       | ISO-8601 due date                                        |

**Line item fields:**

| Field             | Type   | Required | Description                                                                      |
|-------------------|--------|----------|----------------------------------------------------------------------------------|
| `description`     | string | yes      | Line item description                                                            |
| `quantity`        | number | yes      | Quantity (must be positive)                                                       |
| `unit`            | string | no       | Unit label. Default: `unit`                                                      |
| `unitPrice`       | number | yes      | Price per unit                                                                   |
| `total`           | number | yes      | Line total                                                                       |
| `serviceCategory` | enum   | no       | `compute`, `data`, `api_call`, `content_generation`, `analysis`, `transaction_fee`, `other` |

**Example request:**

```json
{
  "seller": {
    "walletAddress": "0xAlice",
    "agentId": "did:prooflink:agent:data-processor",
    "legalName": "DataCo AI"
  },
  "buyer": {
    "walletAddress": "0xBob",
    "legalName": "Acme Corp"
  },
  "lineItems": [
    {
      "description": "Data analysis - 10k records",
      "quantity": 1,
      "unit": "job",
      "unitPrice": 250,
      "total": 250,
      "serviceCategory": "analysis"
    },
    {
      "description": "API calls consumed",
      "quantity": 5000,
      "unit": "call",
      "unitPrice": 0.01,
      "total": 50,
      "serviceCategory": "api_call"
    }
  ],
  "currency": "USDC",
  "totalAmount": 300,
  "paymentProtocol": "x402",
  "dueDate": "2026-04-01T00:00:00.000Z"
}
```

**Response** `201 Created`

```json
{
  "success": true,
  "data": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "issuerAgentDid": "did:prooflink:agent:data-processor",
    "recipientAgentDid": "0xBob",
    "sellerWalletAddress": "0xAlice",
    "buyerWalletAddress": "0xBob",
    "currency": "USDC",
    "totalAmount": "300",
    "state": "DRAFT",
    "lineItems": [ ... ],
    "paymentProtocol": "x402",
    "dueDate": "2026-04-01T00:00:00.000Z",
    "invoiceData": { ... },
    "createdAt": "2026-03-21T12:00:00.000Z",
    "updatedAt": "2026-03-21T12:00:00.000Z"
  }
}
```

---

### Get an invoice

```
GET /invoices/:id
```

| Parameter | Type | Description         |
|-----------|------|---------------------|
| `id`      | UUID | Invoice identifier  |

**Response** `200 OK` -- returns the full invoice object.

---

### Update invoice state

Transition an invoice to a new state. Only valid transitions are accepted.

```
PATCH /invoices/:id/state
```

**State machine:**

```
DRAFT     -> ISSUED, CANCELLED
ISSUED    -> PAID, DISPUTED, CANCELLED
PAID      -> SETTLED, DISPUTED
SETTLED   -> (terminal)
DISPUTED  -> ISSUED, CANCELLED
CANCELLED -> (terminal)
```

**Request body**

| Field    | Type   | Required | Description                                                         |
|---------|--------|----------|---------------------------------------------------------------------|
| `state` | enum   | yes      | `DRAFT`, `ISSUED`, `PAID`, `SETTLED`, `DISPUTED`, `CANCELLED`       |
| `reason`| string | no       | Reason for the transition                                           |

**Example request:**

```json
{
  "state": "ISSUED",
  "reason": "Ready for payment"
}
```

**Response** `200 OK` -- returns the updated invoice.

**Error** `422 Unprocessable Entity` for invalid transitions:

```json
{
  "success": false,
  "error": {
    "code": "INVALID_STATE_TRANSITION",
    "message": "Cannot transition from DRAFT to SETTLED. Allowed: ISSUED, CANCELLED."
  }
}
```

---

### List invoices

```
GET /invoices
```

**Query parameters**

| Parameter  | Type   | Default | Description                              |
|-----------|--------|---------|------------------------------------------|
| `page`    | number | `1`     | Page number (1-based)                    |
| `limit`   | number | `20`    | Items per page (1-100)                   |
| `state`   | enum   | --      | Filter by invoice state                  |
| `currency`| enum   | --      | Filter by currency                       |
| `seller`  | string | --      | Filter by seller address (partial match) |
| `buyer`   | string | --      | Filter by buyer address (partial match)  |
| `from`    | string | --      | ISO-8601 lower bound                     |
| `to`      | string | --      | ISO-8601 upper bound                     |

**Response** `200 OK` -- paginated list of invoices.

---

## Identity

### Verify an agent

Verify an agent's KYA (Know Your Agent) credential and return trust score, operator status, and delegation scope.

```
POST /identity/verify
```

**Request body**

| Field              | Type   | Required | Description                              |
|-------------------|--------|----------|------------------------------------------|
| `agentId`         | string | yes      | Agent DID or identifier                  |
| `registryAddress` | string | no       | ERC-8004 registry contract address       |
| `chain`           | string | no       | Chain identifier. Default: `eip155:8453` |

**Example request:**

```json
{
  "agentId": "did:prooflink:agent:data-processor",
  "chain": "eip155:8453"
}
```

**Response** `200 OK` (agent verified):

```json
{
  "success": true,
  "data": {
    "verified": true,
    "trustScore": 80,
    "agentMetadata": {
      "name": "DataProcessor",
      "type": "autonomous",
      "operator": "DataCo Inc",
      "registeredAt": "2026-01-15T10:00:00.000Z",
      "walletAddress": "0xAlice"
    },
    "operatorStatus": {
      "sanctionsCleared": true,
      "kycVerified": true
    },
    "delegationScope": {
      "maxTransactionValue": 10000,
      "dailyLimit": 50000,
      "allowedChains": ["eip155:8453", "eip155:1"],
      "allowedCurrencies": ["USDC", "USDT"],
      "expiresAt": "2027-01-15T10:00:00.000Z"
    },
    "receiptId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  }
}
```

**Response** `200 OK` (agent not found):

```json
{
  "success": true,
  "data": {
    "verified": false,
    "trustScore": 0,
    "agentMetadata": null,
    "message": "Agent did:prooflink:agent:unknown not found in registry."
  }
}
```

---

### Get agent identity

Retrieve the full identity profile of a registered agent.

```
GET /identity/:agentId
```

| Parameter | Type   | Description             |
|-----------|--------|-------------------------|
| `agentId` | string | Agent DID or identifier |

**Response** `200 OK`

```json
{
  "success": true,
  "data": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "agentDid": "did:prooflink:agent:data-processor",
    "name": "DataProcessor",
    "agentType": "autonomous",
    "walletAddress": "0xAlice",
    "controllingEntity": {
      "name": "DataCo Inc",
      "lei": "549300EXAMPLE00000"
    },
    "erc8004Id": 42,
    "erc8004Registry": "0xRegistryAddress",
    "complianceScore": 80,
    "isActive": true,
    "delegationScope": { ... },
    "validatedAt": "2026-03-01T10:00:00.000Z",
    "expiresAt": "2027-03-01T10:00:00.000Z",
    "createdAt": "2026-01-15T10:00:00.000Z",
    "updatedAt": "2026-03-01T10:00:00.000Z"
  }
}
```

---

### Issue a KYA credential

Issue a Know Your Agent verifiable credential. Creates or updates the agent record and returns a W3C Verifiable Credential.

```
POST /identity/kya/issue
```

**Request body**

| Field                                  | Type     | Required | Description                                        |
|----------------------------------------|----------|----------|----------------------------------------------------|
| `agentDid`                             | string   | yes      | Agent DID                                          |
| `agentType`                            | enum     | yes      | `autonomous`, `semi-autonomous`, `human-supervised`|
| `controllingEntity.name`               | string   | yes      | Operator legal name                                |
| `controllingEntity.lei`                | string   | no       | Legal Entity Identifier                            |
| `controllingEntity.did`                | string   | no       | Operator DID                                       |
| `controllingEntity.kybVerified`        | boolean  | yes      | Whether KYB is completed                           |
| `walletAddress`                        | string   | yes      | Agent wallet address                               |
| `delegationScope.maxTransactionValue`  | number   | yes      | Max per-transaction value (USD)                    |
| `delegationScope.dailyLimit`           | number   | no       | Daily spending limit (USD)                         |
| `delegationScope.allowedCounterparties`| string[] | no       | Whitelisted counterparty addresses                 |
| `delegationScope.blockedJurisdictions` | string[] | no       | Blocked jurisdiction codes (ISO 3166-1 alpha-2)    |
| `delegationScope.allowedChains`        | string[] | no       | Allowed blockchain networks                        |
| `delegationScope.allowedCurrencies`    | string[] | no       | Allowed token symbols                              |
| `delegationScope.expiresAt`            | string   | yes      | ISO-8601 credential expiration                     |
| `erc8004RegistryAddress`               | string   | no       | ERC-8004 registry contract address                 |
| `erc8004TokenId`                       | string   | no       | ERC-8004 token ID                                  |

**Example request:**

```json
{
  "agentDid": "did:prooflink:agent:data-processor",
  "agentType": "autonomous",
  "controllingEntity": {
    "name": "DataCo Inc",
    "lei": "549300EXAMPLE00000",
    "kybVerified": true
  },
  "walletAddress": "0xAlice",
  "delegationScope": {
    "maxTransactionValue": 10000,
    "dailyLimit": 50000,
    "allowedChains": ["eip155:8453"],
    "allowedCurrencies": ["USDC"],
    "expiresAt": "2027-03-21T00:00:00.000Z"
  },
  "erc8004RegistryAddress": "0xRegistryAddress",
  "erc8004TokenId": "42"
}
```

**Response** `201 Created`

```json
{
  "success": true,
  "data": {
    "agent": {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "agentDid": "did:prooflink:agent:data-processor",
      "agentType": "autonomous",
      "walletAddress": "0xAlice",
      "complianceScore": 80,
      "isActive": true
    },
    "credential": {
      "@context": [
        "https://www.w3.org/2018/credentials/v1",
        "https://prooflink.io/credentials/kya/v1"
      ],
      "type": ["VerifiableCredential", "KYACredential"],
      "id": "urn:uuid:a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "issuer": {
        "id": "did:prooflink:issuer",
        "name": "ProofLink"
      },
      "issuanceDate": "2026-03-21T12:00:00.000Z",
      "expirationDate": "2027-03-21T00:00:00.000Z",
      "credentialSubject": {
        "id": "did:prooflink:agent:data-processor",
        "agentType": "autonomous",
        "controllingEntity": { ... },
        "delegationScope": { ... },
        "walletAddress": "0xAlice"
      },
      "proof": {
        "type": "EcdsaSecp256k1Signature2019",
        "created": "2026-03-21T12:00:00.000Z",
        "verificationMethod": "did:prooflink:issuer#key-1",
        "proofPurpose": "assertionMethod",
        "jws": "..."
      }
    }
  }
}
```

---

## Webhooks

### Register a webhook

```
POST /webhooks
```

**Request body**

| Field    | Type     | Required | Description                              |
|---------|----------|----------|------------------------------------------|
| `url`   | string   | yes      | HTTPS endpoint URL                       |
| `secret`| string   | yes      | Signing secret (min 16 characters)       |
| `events`| string[] | no       | Event types to subscribe to (default: all)|

**Available event types:**

| Event                          | Description                                |
|--------------------------------|--------------------------------------------|
| `compliance.check.completed`   | Compliance check finished (any result)     |
| `compliance.check.failed`      | Compliance check resulted in rejection     |
| `compliance.sanctions.match`   | Sanctions match detected                   |
| `payment.completed`            | Payment settled on-chain                   |
| `payment.blocked`              | Payment blocked by compliance              |
| `payment.failed`               | Payment execution failed                   |
| `travel_rule.transmitted`      | Travel Rule data sent to counterparty VASP |
| `travel_rule.acknowledged`     | Counterparty VASP acknowledged receipt     |
| `travel_rule.failed`           | Travel Rule transmission failed            |
| `invoice.created`              | New invoice created                        |
| `invoice.paid`                 | Invoice marked as paid                     |
| `invoice.disputed`             | Invoice disputed                           |
| `kya.verified`                 | Agent KYA verification completed           |
| `kya.failed`                   | Agent KYA verification failed              |
| `attestation.created`          | On-chain EAS attestation created           |

**Example request:**

```json
{
  "url": "https://your-app.com/webhooks/prooflink",
  "secret": "whsec_a1b2c3d4e5f6g7h8",
  "events": ["compliance.check.completed", "payment.completed"]
}
```

**Response** `201 Created`

```json
{
  "success": true,
  "data": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "url": "https://your-app.com/webhooks/prooflink",
    "events": ["compliance.check.completed", "payment.completed"],
    "active": true,
    "createdAt": "2026-03-21T12:00:00.000Z"
  }
}
```

### List webhooks

```
GET /webhooks
```

**Response** `200 OK` -- array of registered webhooks (secrets are never returned).

### Delete a webhook

```
DELETE /webhooks/:id
```

**Response** `200 OK`

```json
{
  "success": true,
  "data": { "id": "...", "deleted": true }
}
```

### Test a webhook

Send a test event to verify delivery.

```
POST /webhooks/:id/test
```

**Response** `200 OK`

```json
{
  "success": true,
  "data": {
    "delivered": true,
    "attempts": 1,
    "lastStatus": 200
  }
}
```

**Webhook payload format:**

Webhook deliveries are `POST` requests with:

- `Content-Type: application/json`
- `X-ProofLink-Signature`: HMAC-SHA256 of the body using your webhook secret
- `X-ProofLink-Event`: Event type string
- `X-ProofLink-Delivery-Id`: Unique delivery ID for deduplication

```json
{
  "id": "evt_a1b2c3d4",
  "type": "compliance.check.completed",
  "timestamp": "2026-03-21T12:00:00.000Z",
  "payload": { ... },
  "idempotencyKey": "idem_xyz789"
}
```

---

## Analytics

### Dashboard overview

Retrieve aggregate analytics for compliance activity, volume, and risk distribution.

```
GET /analytics/dashboard?period=30d
```

**Query parameters**

| Parameter | Type | Default | Description                                |
|-----------|------|---------|--------------------------------------------|
| `period`  | enum | `30d`   | `1h`, `24h`, `7d`, `30d`, `90d`, `1y`, `all` |

**Response** `200 OK`

```json
{
  "success": true,
  "data": {
    "volume": {
      "period": "30d",
      "totalTransactions": 1234,
      "totalVolumeUsd": 2500000,
      "averageTransactionUsd": 2027,
      "uniqueSenders": 89,
      "uniqueReceivers": 145,
      "byChain": {
        "base": { "transactions": 980, "volumeUsd": 2000000 },
        "ethereum": { "transactions": 254, "volumeUsd": 500000 }
      },
      "byToken": {
        "USDC": { "transactions": 1100, "volumeUsd": 2200000 },
        "USDT": { "transactions": 134, "volumeUsd": 300000 }
      },
      "computedAt": "2026-03-21T12:00:00.000Z"
    },
    "risk": {
      "period": "30d",
      "totalScreened": 2468,
      "averageRiskScore": 8.5,
      "buckets": [
        { "rangeMin": 0, "rangeMax": 25, "label": "low", "count": 2300, "percentage": 93.2 },
        { "rangeMin": 26, "rangeMax": 50, "label": "medium", "count": 140, "percentage": 5.7 },
        { "rangeMin": 51, "rangeMax": 75, "label": "high", "count": 25, "percentage": 1.0 },
        { "rangeMin": 76, "rangeMax": 100, "label": "critical", "count": 3, "percentage": 0.1 }
      ],
      "sanctionsMatches": 0,
      "escalations": 25,
      "rejections": 3,
      "computedAt": "2026-03-21T12:00:00.000Z"
    },
    "compliance": {
      "period": "30d",
      "totalChecks": 1234,
      "byCheckType": {
        "SANCTIONS_SCREENING": { "passed": 2466, "failed": 2, "skipped": 0 },
        "AML_MONITORING": { "passed": 1220, "failed": 14, "skipped": 0 },
        "TRAVEL_RULE": { "passed": 890, "failed": 5, "skipped": 339 },
        "KYA_VERIFICATION": { "passed": 456, "failed": 12, "skipped": 766 }
      },
      "travelRule": {
        "required": 895,
        "transmitted": 890,
        "acknowledged": 880,
        "failed": 5
      },
      "kyaVerifications": {
        "total": 468,
        "verified": 456,
        "failed": 12
      },
      "averageLatencyMs": 145,
      "computedAt": "2026-03-21T12:00:00.000Z"
    }
  }
}
```

---

## Health

### Full health check

```
GET /health
```

Returns dependency status for database and external services.

**Response** `200 OK` (all healthy) or `503 Service Unavailable` (degraded):

```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "version": "0.1.0",
    "uptime": 86400,
    "timestamp": "2026-03-21T12:00:00.000Z",
    "checks": {
      "database": { "status": "healthy", "latencyMs": 2 }
    }
  }
}
```

### Readiness probe

```
GET /health/ready
```

Returns whether the service is ready to accept traffic (checks critical dependencies).

### Liveness probe

```
GET /health/live
```

Returns whether the process is alive (no dependency checks).

---

## Common Error Codes

| Code                       | HTTP | Description                                     |
|---------------------------|------|-------------------------------------------------|
| `BAD_REQUEST`              | 400  | Malformed request body or invalid parameters    |
| `VALIDATION_ERROR`         | 400  | Request failed schema validation                |
| `UNAUTHORIZED`             | 401  | Missing or invalid API key                      |
| `NOT_FOUND`                | 404  | Resource does not exist                         |
| `INVALID_STATE_TRANSITION` | 422  | Invoice state transition not allowed            |
| `RATE_LIMITED`             | 429  | Too many requests -- check `Retry-After` header |
| `INTERNAL_ERROR`           | 500  | Server-side failure                             |
