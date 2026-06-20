# Thia-Term — agent-readable bundle (single file)

> Compliance-first crypto payments for the agent economy on HashKey Chain (id&nbsp;133).
> One file. Every skill. No SDK. **Markdown is the API.**

- **Live API base:** `https://app.thia-term.vercel.app`
- **Settlement chain:** HashKey Chain testnet (id 133)
- **RPC:** `https://hashkeychain-testnet.alt.technology`
- **Mirror of:** every file under `https://app.thia-term.vercel.app/.well-known/` and `https://app.thia-term.vercel.app/skills/`

If you are an AI agent: read this file top to bottom — you now have the full
Thia-Term contract. No HTML parsing required. Each section below is the verbatim
canonical markdown from the live site at the URL printed in its heading.

If you are a human: this is the agent-flavoured version. Visit
`https://app.thia-term.vercel.app` for the rendered website.

---

## Table of contents

1. [`/.well-known/thia-term.md`](#well-known-thia-termmd) — agent quickstart — START HERE
2. [`/skills/invoice.md`](#skills-invoicemd) — create, read, cancel invoices
3. [`/skills/invoice-link.md`](#skills-invoice-linkmd) — public per-invoice URL (QR / NFC / paste)
4. [`/skills/pay.md`](#skills-paymd) — settle via HSP Single-Pay mandate (inline OFAC)
5. [`/skills/compliance.md`](#skills-compliancemd) — OFAC + velocity screening (fail-closed)
6. [`/skills/receipt.md`](#skills-receiptmd) — ed25519-signed cryptographic receipts
7. [`/skills/reputation.md`](#skills-reputationmd) — counterparty trust score from on-chain history
8. [`/skills/errors.md`](#skills-errorsmd) — RFC 9457 Problem+JSON catalogue
9. [`/skills/admin.md`](#skills-adminmd) — API-key lifecycle (admin only)
10. [`/skills/dashboard.md`](#skills-dashboardmd) — programmatic dashboard surface
11. [`/.well-known/mcp.json`](#well-known-mcpjson) — MCP server manifest (JSON)
12. [`/.well-known/agent-sitemap.md`](#well-known-agent-sitemapmd) — every agent-relevant URL on Thia-Term
13. [`/llms.txt`](#llmstxt) — top-level discovery index (llms.txt convention)

---

<a id="well-known-thia-termmd"></a>

# `/.well-known/thia-term.md`

> **agent quickstart — START HERE** · canonical source: <https://app.thia-term.vercel.app/.well-known/thia-term.md>

# Thia-Term — agent quickstart

You are an AI agent. Read this file. Then use Thia-Term to pay an invoice on HashKey testnet in under 60 seconds.

## What Thia-Term does

Thia-Term lets agents create crypto invoices and settle them in stablecoins on HashKey Chain (id 133). Every
settlement is screened for sanctions (OFAC) and velocity limits before funds move. Every successful payment
emits an ed25519-signed receipt that any third party can verify against the public key at
[`/.well-known/thia-term-receipt-pubkey.pem`](./thia-term-receipt-pubkey.pem).

## The five skills

| skill | endpoint | spec |
|---|---|---|
| invoice | `POST /v1/invoices` | [/skills/invoice.md](/skills/invoice.md) |
| pay | `POST /v1/pay` | [/skills/pay.md](/skills/pay.md) |
| compliance | `POST /v1/compliance/check` | [/skills/compliance.md](/skills/compliance.md) |
| receipt | `GET /v1/receipts/{id}` | [/skills/receipt.md](/skills/receipt.md) |
| reputation | `GET /v1/reputation/{address}` | [/skills/reputation.md](/skills/reputation.md) |

## Auth in 15 seconds

```sh
# 1. Ask for a nonce
curl -s -X POST https://app.thia-term.vercel.app/v1/auth/siwe/nonce \
  -H 'Content-Type: application/json' \
  -d '{"address":"0xYOUR_WALLET"}'
# => {"nonce":"...","message":"app.thia-term.vercel.app wants you to sign in ...","expires_in":300}

# 2. Sign the message with your wallet key, then verify
curl -s -X POST https://app.thia-term.vercel.app/v1/auth/siwe/verify \
  -H 'Content-Type: application/json' \
  -d '{"message":"<the exact message>","signature":"0x..."}'
# => {"access_token":"eyJ...","scopes":["invoice:write","pay:execute",...],"expires_in":3600}
```

For dev/test without a wallet, generate a scoped API key at `/dashboard/keys` (human login required) and
send it as `Authorization: Bearer flk_test_...`.

## Happy-path curl (invoice → pay → receipt)

```sh
JWT="eyJ..."                           # from the SIWE step above
IDEM=$(uuidgen)

# Create an invoice
INVOICE=$(curl -s -X POST https://app.thia-term.vercel.app/v1/invoices \
  -H "Authorization: Bearer $JWT" \
  -H "Idempotency-Key: $IDEM-inv" \
  -H 'Content-Type: application/json' \
  -d '{"amount":"0.01","token":"USDC","receiver_address":"0xPAYEE","purpose":"test"}')

INVOICE_ID=$(echo "$INVOICE" | jq -r .invoice_id)

# Pay it
curl -s -X POST https://app.thia-term.vercel.app/v1/pay \
  -H "Authorization: Bearer $JWT" \
  -H "Idempotency-Key: $IDEM-pay" \
  -H 'Content-Type: application/json' \
  -d "{\"invoice_id\":\"$INVOICE_ID\",\"payer_address\":\"0xPAYER\",\"token\":\"USDC\"}"
# => {"transaction_id":"txn_...","status":"mandate_created","checkout_url":"https://checkout.hsp...",...}

# Wait for settlement (SSE)
curl -N -H "Authorization: Bearer $JWT" \
  https://app.thia-term.vercel.app/v1/transactions/$TXN/events

# Fetch signed receipt
curl -s -H "Authorization: Bearer $JWT" \
  https://app.thia-term.vercel.app/v1/receipts/$RECEIPT_ID
```

## Contract guarantees

- Every `/v1/*` call requires `Authorization: Bearer` and returns Problem+JSON errors.
- Every write call requires `Idempotency-Key`; duplicate keys replay the original response.
- OFAC screening fails **closed** — if our upstream check is unreachable, your pay call is blocked.
- Receipts are ed25519-signed; verify with the public key at `/.well-known/thia-term-receipt-pubkey.pem`.

## If anything fails

Every error has a `code` and an `agent_action` field telling you what to do. See
[`/skills/errors.md`](/skills/errors.md) for the full catalogue.

---

<a id="skills-invoicemd"></a>

# `/skills/invoice.md`

> **create, read, cancel invoices** · canonical source: <https://app.thia-term.vercel.app/skills/invoice.md>

---
skill: invoice
version: 1.0.0
stability: stable
auth: [siwe, api-key]
scopes: [invoice:read, invoice:write]
idempotent: true
related_skills: [pay, compliance]
---

# invoice

Create and read Thia-Term invoices. An invoice is the canonical object a payer settles against.

## create_invoice

**Request**

```http
POST /v1/invoices HTTP/1.1
Authorization: Bearer <token>
Content-Type: application/json
Idempotency-Key: 01HV9ZBXC8N5KEXAMPLE

{
  "receiver_address": "0xPAYEE...",
  "amount": "10.00",
  "token": "USDC",
  "purpose": "Q3 compliance audit",
  "due_at": "2026-05-15T23:59:59Z"
}
```

**Response 201 Created**

```json
{
  "invoice_id": "inv_01HV9Z...",
  "status": "pending",
  "receiver_address": "0xPAYEE...",
  "amount": "10.00",
  "token": "USDC",
  "chain_id": 133,
  "due_at": "2026-05-15T23:59:59Z",
  "created_at": "2026-04-22T14:02:11Z",
  "thia-term_id": "thia-term:inv/01HV9Z..."
}
```

Request fields:

| field | type | required | notes |
|---|---|---|---|
| `receiver_address` | EIP-55 address | yes | Must pass `compliance.check` or request rejected. |
| `amount` | decimal string | yes | Positive. Max 6 decimals for USDC/USDT, 18 for HSK. |
| `token` | enum | yes | `USDC` \| `USDT` \| `HSK`. |
| `purpose` | string ≤500 | no | Human-readable. Stored verbatim. |
| `due_at` | ISO 8601 | no | Defaults to 30 days from creation. Past dates rejected. |

## get_invoice

```http
GET /v1/invoices/inv_01HV9Z... HTTP/1.1
Authorization: Bearer <token>
```

Returns the full invoice record. `status` ∈ `pending | paying | paid | expired | cancelled`.

## cancel_invoice

```http
DELETE /v1/invoices/inv_01HV9Z... HTTP/1.1
Authorization: Bearer <token>
Idempotency-Key: ...
```

Only callable by the invoice creator. Only valid while `status == pending`.

## Errors

| code | status | agent should |
|---|---|---|
| `auth_required` | 401 | Provide bearer token. |
| `insufficient_scope` | 403 | Need `invoice:write` to create. |
| `validation_error` | 400 | Fix the field in `detail`. |
| `compliance_blocked_sanctions` | 403 | Receiver flagged. Do NOT retry. |
| `invoice_not_found` | 404 | Verify id. |
| `invoice_not_cancellable` | 409 | Already paid or expired. |
| `idempotency_conflict` | 409 | Different body with same key. |

Full catalogue: [/skills/errors.md](./errors.md)

## Related

- [pay](./pay.md) — settle an invoice
- [compliance](./compliance.md) — preflight the receiver before creating

---

<a id="skills-invoice-linkmd"></a>

# `/skills/invoice-link.md`

> **public per-invoice URL (QR / NFC / paste)** · canonical source: <https://app.thia-term.vercel.app/skills/invoice-link.md>

---
skill: invoice-link
version: 1.0.0
stability: stable
auth: [none]
scopes: []
related_skills: [invoice, pay, compliance, receipt]
---

# invoice-link

A public, agent-readable view of any Thia-Term invoice. Designed to be encoded in QR codes,
NFC tags, deep links, or simply pasted into a chat — anywhere a fresh agent needs to
understand "what is this charge?" without an SDK.

## URL pattern

```
https://app.thia-term.vercel.app/i/{invoice_id}        # human-friendly HTML page (with QR)
https://app.thia-term.vercel.app/i/{invoice_id}/agent  # agent-friendly markdown
```

Same invoice, two representations. The HTML page links the markdown via `<link rel="alternate">`
and HTTP `Link:` header. Agents can hit either URL.

## Agent flow

1. Get a URL (from QR scan, NFC, deep link, paste).
2. `GET <url>/agent` with `Accept: text/markdown`.
3. Parse the YAML frontmatter — that's the canonical machine-readable header:

   ```yaml
   thia-term_invoice_id: inv_01ABC...
   amount: "10.00"
   token: USDC
   chain_id: 133
   receiver_address: 0x...
   status: pending
   due_at: 2026-05-23T00:00:00Z
   spec: https://app.thia-term.vercel.app/skills/pay.md
   ```

4. Decide whether to pay (compliance checks, user consent, etc.).
5. Auth via SIWE per [/skills/pay.md](./pay.md).
6. `POST /v1/pay {invoice_id, payer_address, token}` — done.

## Why a dedicated route (not just /v1/invoices/{id})

`GET /v1/invoices/{id}` requires `invoice:read` scope and an authenticated principal.
That works for a logged-in agent but breaks the "scan a QR with no prior context" flow.

`/i/{id}/agent` is the public, no-auth equivalent — every payable invoice is discoverable.
It returns ONLY the fields needed to decide whether to pay; sensitive metadata (issuer
identity, internal status timestamps beyond `created_at`, audit log) is omitted.

## Why markdown

- Trivially parseable from any HTTP client (no JSON Schema needed for the basics).
- Human-readable when an agent surfaces it to a user for confirmation.
- YAML frontmatter gives you machine fields; the body is the explainer.
- Smaller than the equivalent JSON+OpenAPI pair (~1.2 KB typical).

## Errors

| code | status | agent should |
|---|---|---|
| `not_found` | 404 | Invoice ID is wrong or expired. Stop. |

That's it — this is a public read endpoint, no other failures by design.

## Cache

`Cache-Control: public, max-age=30, s-maxage=60`. Status changes (pending→paid) propagate
within ~60s. Agents that need real-time settlement should subscribe to
`/v1/transactions/{id}/events` after paying.

## See also

- [pay.md](./pay.md) — the authenticated pay endpoint
- [compliance.md](./compliance.md) — preflight the receiver
- [receipt.md](./receipt.md) — verify the ed25519 receipt after settlement
- [invoice.md](./invoice.md) — the authenticated CRUD surface

---

<a id="skills-paymd"></a>

# `/skills/pay.md`

> **settle via HSP Single-Pay mandate (inline OFAC)** · canonical source: <https://app.thia-term.vercel.app/skills/pay.md>

---
skill: pay
version: 1.0.0
stability: stable
auth: [siwe, api-key]
scopes: [pay:execute]
idempotent: true
rate_limit: "20 requests / minute / key"
settlement_chain: hashkey-testnet-133
related_skills: [invoice, compliance, receipt]
---

# pay

Settle a Thia-Term invoice via HashKey Settlement Protocol (HSP) Single-Pay Mandate. Compliance (OFAC +
velocity) runs inline — if the payer address is sanctioned or exceeds velocity limits, the call is
rejected before any on-chain activity.

## When to use

- You have a valid `invoice_id` from a prior `invoice.create` response.
- You want OFAC + velocity screening before funds move.
- You want a cryptographically signed receipt afterward.

## When NOT to use

- Only want to screen an address? Use `compliance.check`.
- Only want to create an invoice? Use `invoice.create`.
- Need recurring pulls? Not supported in v1.

## Contract

### pay_invoice

**Request**

```http
POST /v1/pay HTTP/1.1
Host: app.thia-term.vercel.app
Authorization: Bearer <jwt-or-api-key>
Content-Type: application/json
Idempotency-Key: 01HV9ZBXC8N5KEXAMPLE

{
  "invoice_id": "inv_01HV9Z...",
  "payer_address": "0xabc...",
  "token": "USDC"
}
```

**Response 202 Accepted**

```json
{
  "transaction_id": "txn_01HV9Z...",
  "status": "mandate_created",
  "checkout_url": "https://checkout.hsp.hashkey.com/c/xyz",
  "hsp_mandate_id": "CM-abc-123",
  "compliance": {
    "score": 92,
    "sanctions_ok": true,
    "checked_at": "2026-04-22T14:02:11Z"
  },
  "events_url": "/v1/transactions/txn_01HV9Z.../events",
  "expected_settlement_sec": 30
}
```

### wait_for_settlement (SSE)

```http
GET /v1/transactions/txn_01HV9Z.../events HTTP/1.1
Accept: text/event-stream
Authorization: Bearer <token>
```

```
event: compliance_passed
data: {"transaction_id":"txn_...","score":92}

event: mandate_created
data: {"transaction_id":"txn_...","hsp_mandate_id":"CM-..."}

event: settled
data: {"transaction_id":"txn_...","tx_hash":"0x...","amount":"10.00","token":"USDC","block":18402913}

event: receipt_ready
data: {"transaction_id":"txn_...","receipt_id":"rcp_..."}
```

Clients can resume with `Last-Event-ID`. Channel TTL is 1 hour.

## Errors (agent-actionable)

| code | status | title | agent should |
|---|---|---|---|
| `auth_required` | 401 | Missing bearer token | Complete SIWE or provide API key. |
| `token_expired` | 401 | JWT expired | Refresh via `/v1/auth/siwe/refresh` or re-SIWE. |
| `insufficient_scope` | 403 | Token lacks `pay:execute` | Request a new token with correct scope. |
| `invoice_not_found` | 404 | Invoice does not exist | Stop. Verify `invoice_id` came from a successful create. |
| `invoice_already_paid` | 409 | Already settled | Call `receipt.get` with `invoice_id`. Do NOT retry. |
| `invoice_expired` | 410 | Past due date | Ask payee to issue a new invoice. |
| `compliance_blocked_sanctions` | 403 | Payer is sanctioned | Stop. Escalate to human. Do NOT retry. |
| `compliance_blocked_velocity` | 429 | 24h velocity ceiling exceeded | Retry after `retry_after` seconds. |
| `compliance_upstream_unavailable` | 503 | OFAC check failed; blocked fail-closed | Retry with backoff; if persistent, surface. |
| `idempotency_conflict` | 409 | Same key + different body | Use a fresh `Idempotency-Key`, or resend the original body byte-for-byte. |
| `rate_limited` | 429 | Over per-minute limit | Respect `Retry-After`. Do NOT parallel-retry. |
| `invalid_token` | 400 | Token not supported | Use USDC, USDT, or HSK. |
| `chain_id_mismatch` | 400 | Wallet wrong chain | Switch wallet to HashKey chain id 133. |
| `hsp_upstream_error` | 502 | HSP unavailable | Backoff 1→2→4 s, max 3 retries, then surface. |

Full error catalogue: [/skills/errors.md](./errors.md)

All errors are returned as `application/problem+json`:

```json
{
  "type": "https://app.thia-term.vercel.app/errors/compliance_blocked_sanctions",
  "title": "Payer address is sanctioned",
  "status": 403,
  "detail": "OFAC SDN match: Tornado Cash",
  "code": "compliance_blocked_sanctions",
  "instance": "/v1/pay",
  "request_id": "req_01HV9Z...",
  "retry_after": null,
  "agent_action": "Stop. Escalate to human. Do NOT retry."
}
```

## Guarantees

- Settlement on HashKey Chain (id 133) via HSP Single-Pay Mandate.
- ProofLink emitted atomically with the settle tx (same block).
- Failed compliance → no on-chain state change.
- Idempotent within 24h per `Idempotency-Key`.
- Ed25519-signed receipt available after `receipt_ready` event.

## Copy-paste (bash)

```sh
# 1. SIWE auth (see /.well-known/thia-term.md for the signing step)
JWT="eyJ..."

# 2. Pay
curl -X POST https://app.thia-term.vercel.app/v1/pay \
  -H "Authorization: Bearer $JWT" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"invoice_id":"inv_...","payer_address":"0xYOU","token":"USDC"}'
```

## Related

- [invoice](./invoice.md) — create the `invoice_id`
- [compliance](./compliance.md) — preflight without committing
- [receipt](./receipt.md) — fetch the signed receipt after settlement

---

<a id="skills-compliancemd"></a>

# `/skills/compliance.md`

> **OFAC + velocity screening (fail-closed)** · canonical source: <https://app.thia-term.vercel.app/skills/compliance.md>

---
skill: compliance
version: 1.0.0
stability: stable
auth: [siwe, api-key, none]
scopes: [compliance:check]
idempotent: true
fail_mode: closed
related_skills: [pay, invoice]
---

# compliance

OFAC sanctions screening + 24-hour velocity check for a wallet address. Fails **closed** — if our upstream
OFAC source is unreachable, the check returns `compliance_upstream_unavailable` rather than silently
passing.

## check_sanctions

**Request**

```http
POST /v1/compliance/check HTTP/1.1
Content-Type: application/json

{
  "address": "0xabc..."
}
```

Auth optional. Public endpoint for preflights. Rate-limited per IP when anonymous.

**Response 200**

```json
{
  "address": "0xabc...",
  "sanctions_ok": true,
  "score": 92,
  "checked_at": "2026-04-22T14:02:11Z",
  "sources": ["ofac-sdn", "velocity-24h"],
  "velocity": {
    "window_hours": 24,
    "total_usd": 120.50,
    "tx_count": 3,
    "limit_usd": 10000
  },
  "details": {
    "ofac": "clear",
    "velocity": "within_limits"
  }
}
```

**Response 403 (sanctioned)**

```json
{
  "type": "https://app.thia-term.vercel.app/errors/compliance_blocked_sanctions",
  "title": "Address is sanctioned",
  "status": 403,
  "code": "compliance_blocked_sanctions",
  "detail": "OFAC SDN match: Tornado Cash 0x..."
}
```

## Scoring

`score` is 0–100, where:

- 100 = fully clear (no hits, no velocity concern)
- 60–99 = clear (within velocity limits, no OFAC hit)
- 30–59 = velocity concern (approaching daily limits)
- 0–29 = blocked (OFAC hit or velocity ceiling exceeded)

The minimum acceptable score for `pay` is **60** by default. A score below 60 causes `pay` calls to return
`compliance_blocked_velocity` or `compliance_blocked_sanctions`.

## batch_check (up to 20 addresses)

```http
POST /v1/compliance/check/batch HTTP/1.1
Content-Type: application/json

{"addresses": ["0xabc...", "0xdef...", ...]}
```

Returns an array in the same order. Individual failures are reported inline; the overall request does not
fail unless all addresses fail.

## Upstream sources

- OFAC SDN Ethereum list (refreshed nightly from `api.ofac.dev`)
- Known-bad-actor list (Tornado Cash, Lazarus, etc. — hardcoded fallback)
- Thia-Term velocity ledger (24h rolling window, per address)

## Errors

| code | status | agent should |
|---|---|---|
| `validation_error` | 400 | Address not EIP-55 formatted. Fix and retry. |
| `compliance_upstream_unavailable` | 503 | OFAC source down. Retry with backoff. This is **intentional** — we fail closed. |
| `rate_limited` | 429 | Slow down, respect `Retry-After`. |

## Related

- [pay](./pay.md) — this check runs inline on every pay
- [invoice](./invoice.md) — receiver is preflighted at create time

---

<a id="skills-receiptmd"></a>

# `/skills/receipt.md`

> **ed25519-signed cryptographic receipts** · canonical source: <https://app.thia-term.vercel.app/skills/receipt.md>

---
skill: receipt
version: 1.0.0
stability: stable
auth: [siwe, api-key]
scopes: [receipt:read]
related_skills: [pay, invoice]
signing: ed25519
public_key_url: /.well-known/thia-term-receipt-pubkey.pem
---

# receipt

Fetch a cryptographic receipt for a settled transaction. Every receipt is ed25519-signed by Thia-Term and
verifiable by any third party against the published public key.

## get_receipt

```http
GET /v1/receipts/{receipt_id} HTTP/1.1
Authorization: Bearer <token>
```

Also callable by `transaction_id` or `invoice_id`:

```http
GET /v1/receipts?invoice_id=inv_... HTTP/1.1
GET /v1/receipts?transaction_id=txn_... HTTP/1.1
```

**Response 200**

```json
{
  "receipt_id": "rcp_01HV9Z...",
  "transaction_id": "txn_01HV9Z...",
  "invoice_id": "inv_01HV9Z...",
  "payer_address": "0xPAYER...",
  "receiver_address": "0xPAYEE...",
  "amount": "10.00",
  "token": "USDC",
  "chain_id": 133,
  "tx_hash": "0xabc...",
  "block": 18402913,
  "settled_at": "2026-04-22T14:02:41Z",
  "compliance": {
    "ofac": "clear",
    "velocity": "within_limits",
    "score": 92
  },
  "signature": {
    "algo": "ed25519",
    "signer": "app.thia-term.vercel.app",
    "key_id": "flk-receipt-2026-04",
    "signed_payload_hash": "sha256:abc...",
    "signature": "base64:...",
    "public_key_url": "https://app.thia-term.vercel.app/.well-known/thia-term-receipt-pubkey.pem"
  }
}
```

## Verifying a receipt (any language)

The `signed_payload_hash` is a SHA-256 digest over the canonical JSON of every receipt field **except**
`signature`. The signature is ed25519 over that hash.

```python
# pseudocode
import json, hashlib, ed25519
pub = load_pem("thia-term-receipt-pubkey.pem")
payload = {k: v for k, v in receipt.items() if k != "signature"}
canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
digest = hashlib.sha256(canonical).digest()
sig = base64.b64decode(receipt["signature"]["signature"])
pub.verify(sig, digest)  # raises on mismatch
```

## Key rotation

The current key id is published in the `signature.key_id` field. Old receipts remain verifiable after
rotation — historical public keys are listed at
[/.well-known/thia-term-receipt-pubkey.pem](/.well-known/thia-term-receipt-pubkey.pem) with the active key
first and rotated keys after.

## Errors

| code | status | agent should |
|---|---|---|
| `auth_required` | 401 | Authenticate first — receipts are never public. Provide `Authorization: Bearer <token>`. |
| `insufficient_scope` | 403 | Need `receipt:read`. |
| `receipt_not_ready` | 202 | Transaction still settling. Retry in 5 s. |
| `receipt_not_found` | 404 | Only visible after auth. Wait for `receipt_ready` SSE event, then retry. |

## Related

- [pay](./pay.md) — `receipt_id` emitted in the final SSE event
- [invoice](./invoice.md) — `invoice_id` works as a lookup key

---

<a id="skills-reputationmd"></a>

# `/skills/reputation.md`

> **counterparty trust score from on-chain history** · canonical source: <https://app.thia-term.vercel.app/skills/reputation.md>

---
skill: reputation
version: 1.0.0
stability: beta
auth: [none, siwe, api-key]
scopes: [reputation:read]
related_skills: [compliance]
---

# reputation

Query the portable reputation score of any wallet address. Derived from the history of signed Thia-Term
receipts involving that address — **no self-reporting**.

> **Beta.** Scoring weights may change. The raw fact fields (`tx_count`, `volume_usd`, `first_seen`) are
> stable; the derived `score` is not pinned until v1.1.

## get_reputation

```http
GET /v1/reputation/{address} HTTP/1.1
```

No auth required. Public data — a reputation score visible only to the queryer defeats the point.

**Response 200**

```json
{
  "address": "0xabc...",
  "score": 94,
  "tx_count": 142,
  "volume_usd": 82400.50,
  "on_time_rate": 0.99,
  "disputes": 0,
  "first_seen": "2026-01-14T10:22:00Z",
  "last_seen": "2026-04-22T13:58:00Z",
  "as_payer": { "count": 87, "volume_usd": 60400.00 },
  "as_payee": { "count": 55, "volume_usd": 22000.50 },
  "compliance_flags": []
}
```

**Response 404** — no Thia-Term activity found for the address.

## Score factors (current weighting, subject to change)

| factor | weight | direction |
|---|---|---|
| `tx_count` (log-scaled) | 25% | more is better, saturates around 200 |
| `on_time_rate` | 25% | higher is better |
| `volume_usd` (log-scaled) | 20% | more is better, saturates around $100k |
| `disputes` | 20% | zero is baseline, each dispute -10 points |
| `account_age_days` | 10% | older is better, saturates at 1 year |

## Why it matters

- Agent-to-agent commerce needs a trust signal no single party controls.
- DeFi protocols can accept the score as soft collateral.
- TradFi can consume the score as proof of financial behavior.

## Errors

| code | status | agent should |
|---|---|---|
| `validation_error` | 400 | Address not EIP-55 formatted. |
| `not_found` | 404 | No Thia-Term activity for this address yet. |
| `rate_limited` | 429 | Slow down, respect `Retry-After`. |

## Related

- [compliance](./compliance.md) — different surface: sanctions + velocity, not reputation

---

<a id="skills-errorsmd"></a>

# `/skills/errors.md`

> **RFC 9457 Problem+JSON catalogue** · canonical source: <https://app.thia-term.vercel.app/skills/errors.md>

---
skill: errors
version: 1.0.0
stability: stable
---

# errors

Every `/v1/*` error response is `application/problem+json` (RFC 9457) with these fields:

| field | type | always present | purpose |
|---|---|---|---|
| `type` | URL | yes | Link back to this catalogue: `https://app.thia-term.vercel.app/errors/<code>` |
| `title` | string | yes | Human-readable one-liner |
| `status` | int | yes | Equals the HTTP status |
| `code` | string | yes | Machine-readable. Match on this, not `title`. |
| `detail` | string | yes | Context-specific diagnostic |
| `instance` | path | yes | The route that emitted the error |
| `request_id` | ULID | yes | Echoes `X-Request-Id` header |
| `retry_after` | int seconds | on 429/503 | How long to wait before retrying |
| `agent_action` | string | yes | What an agent should do. Read this first. |

## Full catalogue

### Auth (401 / 403)

| code | status | agent action |
|---|---|---|
| `auth_required` | 401 | Provide `Authorization: Bearer <token>`. See /.well-known/thia-term.md. |
| `invalid_credentials` | 401 | Token signature invalid or malformed. Re-SIWE. |
| `token_expired` | 401 | Refresh via `/v1/auth/siwe/refresh` or re-SIWE. |
| `insufficient_scope` | 403 | Token lacks the required scope. Request a new token. |

### Validation (400)

| code | status | agent action |
|---|---|---|
| `validation_error` | 400 | Fix the field in `detail`. |
| `invalid_token` | 400 | Use one of: USDC, USDT, HSK. |
| `chain_id_mismatch` | 400 | Switch wallet to HashKey chain id 133. |
| `missing_idempotency_key` | 400 | Provide `Idempotency-Key: <ULID>` header. |

### Not found / not ready (202 / 404)

| code | status | agent action |
|---|---|---|
| `receipt_not_ready` | 202 | Transaction still settling. Retry in 5 seconds. |
| `invoice_not_found` | 404 | Verify `invoice_id` came from a successful create. |
| `receipt_not_found` | 404 | Wait for `receipt_ready` SSE event first. |
| `transaction_not_found` | 404 | Verify `transaction_id`. |
| `not_found` | 404 | Generic. Resource doesn't exist. |

### Conflict (409 / 410)

| code | status | agent action |
|---|---|---|
| `invoice_already_paid` | 409 | Call `receipt.get` with `invoice_id`. Do NOT retry. |
| `invoice_not_cancellable` | 409 | Already paid or expired. |
| `invoice_expired` | 410 | Ask payee to issue a new invoice. |
| `idempotency_conflict` | 409 | Same key + different body. Use a fresh `Idempotency-Key`. |

### Compliance (403 / 429 / 503)

| code | status | agent action |
|---|---|---|
| `compliance_blocked_sanctions` | 403 | **Stop. Do NOT retry.** Escalate to human. |
| `compliance_blocked_velocity` | 429 | Wait `retry_after` seconds and retry. |
| `compliance_upstream_unavailable` | 503 | OFAC source down, blocked fail-closed. Retry with backoff. |

### Rate limits (429)

| code | status | agent action |
|---|---|---|
| `rate_limited` | 429 | Respect `Retry-After`. Do NOT parallel-retry. |

### Upstream (502 / 503)

| code | status | agent action |
|---|---|---|
| `hsp_upstream_error` | 502 | Backoff 1→2→4 s. Max 3 retries. Surface after. |
| `rpc_upstream_error` | 502 | HashKey RPC issue. Backoff + retry. |
| `mandate_creation_failed` | 502 | Usually HSP. Same recovery as `hsp_upstream_error`. |

### Internal (500)

| code | status | agent action |
|---|---|---|
| `internal_error` | 500 | Not your fault. Retry once. If persistent, file `request_id` with support. |

## Retry strategy cheat-sheet

| status | retry? | how |
|---|---|---|
| 2xx | — | success |
| 4xx (non-429) | no | fix input |
| 401/403 | only after changing token | don't hammer |
| 409 `invoice_already_paid` | no | call receipt.get |
| 429 | yes | respect `Retry-After` |
| 502/503/504 | yes | exp backoff 1s → 2s → 4s, max 3 |
| 500 | once | then surface |

---

<a id="skills-adminmd"></a>

# `/skills/admin.md`

> **API-key lifecycle (admin only)** · canonical source: <https://app.thia-term.vercel.app/skills/admin.md>

---
skill: admin
version: 1.0.0
stability: beta
auth: [admin-token]
scopes: []
idempotent: false
related_skills: [dashboard, errors]
---

# admin

Raw HTTP contract for Thia-Term's admin surface: API-key lifecycle and observability.
Agent-friendly wrapper: [dashboard](./dashboard.md).

All endpoints live at `/api/admin/*` (internal, not `/v1/*`). All require `X-Admin-Token`.
If `ADMIN_TOKEN` is unset server-side, every endpoint returns 503 `internal_error`
(`detail: "admin disabled"`).

## list_keys

GET keys an admin has minted. No raw secrets. Capped at 100, ordered `createdAt desc`.

```http
GET /api/admin/keys HTTP/1.1
X-Admin-Token: <shared-secret>
```

**Response 200**

```json
{
  "data": [{
    "id": "ck_01HV...",
    "name": "checkout-bot",
    "prefix": "flk_test_AbCd",
    "scopes": ["pay:execute", "invoice:read"],
    "env": "test",
    "created_at": "2026-04-22T14:02:11Z",
    "last_used_at": "2026-04-22T14:18:02Z",
    "revoked_at": null,
    "expires_at": null
  }],
  "count": 1
}
```

## mint_key

Create a fresh scoped key. **The raw key is returned ONCE in `rawKey`.** Persist immediately —
`list_keys` only returns prefix + hash. No recovery path.

Scopes: `invoice:read`, `invoice:write`, `pay:execute`, `receipt:read`, `compliance:check`,
`reputation:read`. Env: `live` | `test` (default `test`).

```http
POST /api/admin/keys HTTP/1.1
X-Admin-Token: <shared-secret>
Content-Type: application/json

{"name":"checkout-bot","scopes":["pay:execute","invoice:read"],"env":"test"}
```

**Response 201**

```json
{
  "id": "ck_01HV...",
  "rawKey": "flk_test_3xK9qP...REDACT_AFTER_COPY",
  "prefix": "flk_test_3xK9",
  "scopes": ["pay:execute", "invoice:read"],
  "env": "test"
}
```

Format: `flk_{live|test}_<base58(32 bytes)>`. Stored as sha256.

## revoke_key

Disable a leaked or rotated key. Idempotent: re-revoking is a no-op success. Defence-in-depth:
a stolen `X-Admin-Token` cannot revoke keys belonging to unrelated users — route enforces
ownership and returns 404 `not_found` otherwise.

```http
DELETE /api/admin/keys HTTP/1.1
X-Admin-Token: <shared-secret>
Content-Type: application/json

{"id": "ck_01HV..."}
```

**Response 200** — `{"id": "ck_01HV...", "revoked": true}`

## observability

Rolling summary of `/v1/*` traffic: top fingerprints, latency p50/p95, status breakdown.
No PII; fingerprints are coarse route+method buckets. `Cache-Control: no-store`.

```http
GET /api/admin/observability?window=300 HTTP/1.1
X-Admin-Token: <shared-secret>
```

`window` is seconds, default 300, max 86400. Invalid values fall back to 300.

**Response 200**

```json
{
  "window_sec": 300,
  "totals": {"requests": 1284, "errors": 17},
  "latency_ms": {"p50": 42, "p95": 318},
  "status_breakdown": {"2xx": 1242, "4xx": 25, "5xx": 17},
  "top_fingerprints": [
    {"route": "POST /v1/pay", "count": 412, "p95_ms": 612, "error_rate": 0.012}
  ]
}
```

## Errors

`application/problem+json` with `X-Request-Id`. Codes: `auth_required` (401, bad/missing token),
`validation_error` (400), `not_found` (404), `internal_error` (500/503, "admin disabled"). Full
shape: [errors](./errors.md).

## Security note

`X-Admin-Token` is a **single shared secret** from `process.env.ADMIN_TOKEN`. **Dev-only** —
anyone holding it has full keys+observability access. Acceptable for v0.2 (local dev, single
operator, no external exposure). **v0.3 will replace this with per-user NextAuth-style sessions
and scoped JWTs.** Do not expose these endpoints publicly. Do not commit the token.

## Copy-paste (bash)

```sh
H="X-Admin-Token: $ADMIN_TOKEN"; B=https://app.thia-term.vercel.app/api/admin
curl -H "$H" $B/keys
curl -X POST $B/keys -H "$H" -H "Content-Type: application/json" \
  -d '{"name":"checkout-bot","scopes":["pay:execute"],"env":"test"}'
curl -X DELETE $B/keys -H "$H" -H "Content-Type: application/json" \
  -d '{"id":"ck_01HV..."}'
curl -H "$H" "$B/observability?window=300"
```

## Related

- [dashboard](./dashboard.md) — agent-friendliness wrapper over this surface
- [errors](./errors.md) — full problem+json catalogue

---

<a id="skills-dashboardmd"></a>

# `/skills/dashboard.md`

> **programmatic dashboard surface** · canonical source: <https://app.thia-term.vercel.app/skills/dashboard.md>

---
skill: dashboard
version: 1.0.0
stability: stable
auth: [admin-token]
scopes: [admin]
related_skills: [invoice, pay, receipt]
---

# dashboard

`/dashboard/keys` and `/dashboard/agents` are thin React shells over
two JSON endpoints. Do NOT scrape the HTML — call the admin API.

## What the human pages do

- `/dashboard/keys` — mint/list/revoke scoped API keys. Six scopes:
  `invoice:read`, `invoice:write`, `pay:execute`, `receipt:read`,
  `compliance:check`, `reputation:read`. Raw key shown once.
- `/dashboard/agents` — live obs over `/v1/*`, grouped by a 12-char
  fingerprint of `User-Agent + Accept + Accept-Language`. P50/P95/5xx,
  top fingerprint, per-route counts. Polls every 5s.

Nothing in the DOM the JSON does not already give you.

## Auth

`/api/admin/*` gated by `X-Admin-Token` matched against
`process.env.ADMIN_TOKEN`. Unset env → `internal_error` /
`detail: "admin disabled"`. v0.2 shared secret, no per-user id.

**Do NOT bake `X-Admin-Token` into production integrations.** v0.3
swaps this for a scoped JWT via the SIWE flow used by `/v1/*`, with a
dedicated `admin:*` scope family. Treat the current token as throwaway.

## mint_api_key

POST a name + scope set, get the raw key exactly once. Server stores
only a SHA-256 hash; lose the response and the key is gone — mint another.

```http
POST /api/admin/keys HTTP/1.1
X-Admin-Token: <ADMIN_TOKEN>
Content-Type: application/json

{"name":"mcp-bridge-laptop","scopes":["invoice:read","receipt:read"],"env":"test"}
```

| field | type | req | notes |
|---|---|---|---|
| `name` | string 1..80 | yes | Human label. Trimmed. |
| `scopes` | string[] | yes | ≥1. Subset of the six above. |
| `env` | enum | no | `test` (default) or `live`. Test keys never settle real funds. |

**Response 201**

```json
{
  "id": "key_01HV9Z...",
  "rawKey": "flk_test_abcd...xyz",
  "prefix": "flk_test_abcd",
  "scopes": ["invoice:read", "receipt:read"],
  "env": "test"
}
```

`rawKey` → `Authorization: Bearer <rawKey>` for `/v1/*`. Persist now.

`GET /api/admin/keys` lists up to 100 keys (newest first) with
`prefix`/`scopes`/`env`/`last_used_at`/`revoked_at`; raw key never
returned again. `DELETE /api/admin/keys` with `{"id":"..."}` revokes;
calls signed with that key fail immediately.

## query_observability

`GET /api/admin/observability?window=300` with `X-Admin-Token` header.
`window` is seconds (default 300, max 86400).

**Response 200**

```json
{
  "windowSec": 300,
  "totalCount": 1284,
  "p50": 47,
  "p95": 312,
  "fivexxRate": 0.0023,
  "topFingerprints": [{"fingerprint":"a1b2c3d4e5f6","count":812}],
  "statusBreakdown": [{"status":200,"count":1248},{"status":429,"count":33}],
  "routes": [
    {"fingerprint":"a1b2c3d4e5f6","route":"/v1/invoices","method":"POST","p50":41,"p95":188,"count":402,"topStatus":201}
  ],
  "generatedAt": "2026-04-22T14:02:11Z"
}
```

Latencies in ms. `fivexxRate` is a fraction in [0,1]. Fingerprints are
deterministic per `(User-Agent, Accept, Accept-Language)` triple — same
agent stack from the same machine collapses to one row.

## Errors

Same `application/problem+json` as `/v1/*`. Relevant codes:

| code | status | agent should |
|---|---|---|
| `auth_required` | 401 | Provide `X-Admin-Token`. |
| `validation_error` | 400 | Fix field in `detail`. |
| `not_found` | 404 | Verify `id` belongs to this admin user. |
| `internal_error` | 500 | `detail: "admin disabled"` → `ADMIN_TOKEN` unset; surface to operator. |

Full catalogue: [/skills/errors.md](./errors.md)

## Copy-paste

```sh
T="$ADMIN_TOKEN"

# mint
curl -X POST https://app.thia-term.vercel.app/api/admin/keys \
  -H "X-Admin-Token: $T" -H "Content-Type: application/json" \
  -d '{"name":"mcp-bridge","scopes":["invoice:read","receipt:read"],"env":"test"}'

# observe
curl -H "X-Admin-Token: $T" \
  "https://app.thia-term.vercel.app/api/admin/observability?window=300"
```

## Related

[invoice](./invoice.md), [pay](./pay.md), [receipt](./receipt.md) —
the `/v1/*` surface minted keys authenticate against.

---

<a id="well-known-mcpjson"></a>

# `/.well-known/mcp.json`

> **MCP server manifest (JSON)** · canonical source: <https://app.thia-term.vercel.app/.well-known/mcp.json>

```json
{
  "$schema": "https://modelcontextprotocol.io/schemas/mcp.schema.json",
  "name": "thia-term",
  "version": "1.0.0",
  "description": "Compliance-first payments for the agent economy on HashKey Chain (id 133). Markdown is the API.",
  "vendor": {
    "name": "Thia-Term",
    "url": "https://app.thia-term.vercel.app"
  },
  "servers": [
    {
      "name": "thia-term-remote",
      "transport": "sse",
      "url": "https://app.thia-term.vercel.app/mcp",
      "auth": {
        "type": "bearer",
        "token_url": "https://app.thia-term.vercel.app/v1/auth/siwe/verify",
        "scopes": [
          "invoice:read",
          "invoice:write",
          "pay:execute",
          "receipt:read",
          "compliance:check",
          "reputation:read"
        ]
      }
    }
  ],
  "tools": [
    {
      "name": "create_invoice",
      "description": "Create an invoice with a stable invoice_id. See /skills/invoice.md.",
      "description_url": "https://app.thia-term.vercel.app/skills/invoice.md"
    },
    {
      "name": "get_invoice",
      "description": "Fetch an invoice by id. See /skills/invoice.md.",
      "description_url": "https://app.thia-term.vercel.app/skills/invoice.md"
    },
    {
      "name": "pay_invoice",
      "description": "Settle an invoice via HSP Single-Pay mandate with inline OFAC screening. See /skills/pay.md.",
      "description_url": "https://app.thia-term.vercel.app/skills/pay.md"
    },
    {
      "name": "check_sanctions",
      "description": "OFAC + velocity screen a wallet address. Fails closed on upstream error. See /skills/compliance.md.",
      "description_url": "https://app.thia-term.vercel.app/skills/compliance.md"
    },
    {
      "name": "get_receipt",
      "description": "Fetch an ed25519-signed receipt for a settled transaction. See /skills/receipt.md.",
      "description_url": "https://app.thia-term.vercel.app/skills/receipt.md"
    },
    {
      "name": "get_reputation",
      "description": "Query the counterparty reputation score for a wallet address. See /skills/reputation.md.",
      "description_url": "https://app.thia-term.vercel.app/skills/reputation.md"
    },
    {
      "name": "list_api_keys",
      "description": "List minted API keys for the local admin user (sanitized \u2014 no raw key, no hash). Dev-only. See /skills/admin.md.",
      "description_url": "https://app.thia-term.vercel.app/skills/admin.md",
      "admin": true
    },
    {
      "name": "mint_api_key",
      "description": "Create a fresh scoped API key. The raw key is returned ONCE \u2014 persist immediately. Dev-only. See /skills/admin.md.",
      "description_url": "https://app.thia-term.vercel.app/skills/admin.md",
      "admin": true
    },
    {
      "name": "revoke_api_key",
      "description": "Revoke a previously minted API key by id. Idempotent. Dev-only. See /skills/admin.md.",
      "description_url": "https://app.thia-term.vercel.app/skills/admin.md",
      "admin": true
    },
    {
      "name": "query_observability",
      "description": "Rolling /v1/* traffic summary: top fingerprints, latency p50/p95, status mix. Dev-only. See /skills/dashboard.md.",
      "description_url": "https://app.thia-term.vercel.app/skills/dashboard.md",
      "admin": true
    }
  ]
}
```

---

<a id="well-known-agent-sitemapmd"></a>

# `/.well-known/agent-sitemap.md`

> **every agent-relevant URL on Thia-Term** · canonical source: <https://app.thia-term.vercel.app/.well-known/agent-sitemap.md>

# Thia-Term agent-sitemap

Human-readable companion to [`/sitemap-agent.json`](/sitemap-agent.json). Same content, grouped by `kind`.

This sitemap exists so an autonomous agent crawling Thia-Term does not have to guess what URLs are agent-relevant. Every URL on the site that a reasoning agent might want to fetch — skill specs, manifests, signed signals, page descriptions, human pages, and live API endpoints — is enumerated here with a one-line summary and, where applicable, the address of the agent-flavoured or human-flavoured sibling. Entries are sorted by `kind`, then by `url`, so diffs are deterministic and reviewers can see what was added or removed at a glance.

Generated: `2026-04-22T00:00:00Z` (schema version 1.0.0)

## skill

| URL | Summary | Agent alternate | Human alternate |
|---|---|---|---|
| `/skills/admin.md` | Admin operations: API key lifecycle and observability aggregates | — | `/dashboard/keys` |
| `/skills/compliance.md` | Pre-flight OFAC + velocity screening (fail-closed) before settlement | — | — |
| `/skills/dashboard.md` | Programmatic equivalents of the human dashboard surfaces | — | `/dashboard` |
| `/skills/errors.md` | RFC 9457 Problem+JSON error catalogue with codes and agent_action hints | — | — |
| `/skills/invoice.md` | Create, read, and cancel invoices | — | — |
| `/skills/pay.md` | Settle invoices via HSP Single-Pay mandate on HashKey Chain (id 133) | — | — |
| `/skills/receipt.md` | Fetch ed25519-signed cryptographic proof of settlement | — | — |
| `/skills/reputation.md` | Read counterparty trust score derived from on-chain history | — | — |

## manifest

| URL | Summary | Agent alternate | Human alternate |
|---|---|---|---|
| `/.well-known/thia-term.md` | Agent quickstart: pay an invoice on HashKey testnet in under 60 seconds | — | — |
| `/.well-known/mcp.json` | MCP server manifest advertising Thia-Term skills as remote tools | — | — |
| `/.well-known/openapi.yaml` | OpenAPI 3.1 specification for all `/v1/*` endpoints | — | — |
| `/llms.txt` | Top-level agent discovery index (llms.txt convention) | — | — |
| `/sitemap-agent.json` | Canonical machine-readable sitemap of every agent-relevant URL on Thia-Term | — | `/.well-known/agent-sitemap.md` |

## signal

| URL | Summary | Agent alternate | Human alternate |
|---|---|---|---|
| `/.well-known/agent-sitemap.md` | Human-readable companion to `sitemap-agent.json` (markdown table grouped by kind) | `/sitemap-agent.json` | — |
| `/.well-known/thia-term-receipt-pubkey.pem` | ed25519 public key used to verify Thia-Term settlement receipts | — | — |
| `/.well-known/jwks.json` | JWKS for verifying SIWE-derived session bearer tokens | — | — |
| `/robots.txt` | Crawler policy: explicitly allows GPTBot, ClaudeBot, Claude-Web, anthropic-ai, Google-Extended, PerplexityBot | — | — |

## page-spec

| URL | Summary | Agent alternate | Human alternate |
|---|---|---|---|
| `/dashboard/agents` | Page-spec sibling: structured description of `/dashboard/agents` for agents | `/skills/dashboard.md` | `/dashboard/agents` |
| `/dashboard/keys` | Page-spec sibling: structured description of `/dashboard/keys` for agents | `/skills/dashboard.md` | `/dashboard/keys` |

## human-page

| URL | Summary | Agent alternate | Human alternate |
|---|---|---|---|
| `/` | Marketing landing page describing Thia-Term and the agent-payments thesis | `/llms.txt` | — |
| `/dashboard` | Human dashboard root (overview + nav into keys, agents, settings) | `/skills/dashboard.md` | — |
| `/dashboard/agents` | Human UI for live observability of agent traffic per key fingerprint | `/skills/dashboard.md` | — |
| `/dashboard/keys` | Human UI for minting and revoking API keys | `/skills/dashboard.md` | — |

## api

| URL | Summary | Agent alternate | Human alternate |
|---|---|---|---|
| `/api/admin/keys` | Admin: mint, list, and revoke API keys (admin token required) | `/skills/admin.md` | `/dashboard/keys` |
| `/api/admin/observability` | Admin: aggregate per-key request volume, latency, and error stats | `/skills/admin.md` | `/dashboard/agents` |
| `/api/webhooks/hsp` | Inbound HSP settlement callback (signed by HashKey, verified server-side) | — | — |
| `/mcp` | MCP SSE endpoint exposing Thia-Term skills as remote tools (bearer auth) | `/.well-known/mcp.json` | — |
| `/v1/auth/siwe/nonce` | Mint a single-use EIP-4361 nonce for Sign-In-With-Ethereum | — | — |
| `/v1/auth/siwe/verify` | Verify a signed SIWE message and exchange it for a session bearer token | — | — |
| `/v1/auth/whoami` | Return the caller identity (address or key fingerprint) and active scopes | — | — |
| `/v1/compliance/check` | Pre-flight OFAC + velocity screening for a counterparty (fail-closed) | `/skills/compliance.md` | — |
| `/v1/invoices` | Create a new invoice or list invoices for the authenticated principal | `/skills/invoice.md` | — |
| `/v1/invoices/[id]` | Read or cancel a specific invoice by id | `/skills/invoice.md` | — |
| `/v1/pay` | Settle an invoice via HSP Single-Pay mandate on HashKey Chain (id 133) | `/skills/pay.md` | — |
| `/v1/receipts` | List ed25519-signed settlement receipts for the authenticated principal | `/skills/receipt.md` | — |
| `/v1/receipts/[id]` | Fetch a single ed25519-signed settlement receipt by id | `/skills/receipt.md` | — |
| `/v1/reputation/[address]` | Counterparty trust score and on-chain history for an address | `/skills/reputation.md` | — |
| `/v1/transactions/[id]` | Read a settlement transaction lifecycle record by id | — | — |
| `/v1/transactions/[id]/events` | Stream lifecycle events for a settlement transaction (compliance, broadcast, receipt) | — | — |

---

<a id="llmstxt"></a>

# `/llms.txt`

> **top-level discovery index (llms.txt convention)** · canonical source: <https://app.thia-term.vercel.app/llms.txt>

# Thia-Term

> Compliance-first payment layer for the agent economy on HashKey Chain (id 133).
> No SDK. Wallet signature (SIWE) or scoped API key for write access. Receipts are ed25519-signed.

## Start here

- Agent quickstart: https://app.thia-term.vercel.app/.well-known/thia-term.md
- Agent sitemap:    https://app.thia-term.vercel.app/sitemap-agent.json
- MCP manifest:     https://app.thia-term.vercel.app/.well-known/mcp.json
- OpenAPI 3.1:      (ships in v0.2 — for now use the skill files below)

## Skills

- [invoice](https://app.thia-term.vercel.app/skills/invoice.md) — create, read, cancel invoices
- [invoice-link](https://app.thia-term.vercel.app/skills/invoice-link.md) — public per-invoice URL agents read from QR / NFC / paste
- [pay](https://app.thia-term.vercel.app/skills/pay.md) — settle an invoice via HSP Single-Pay mandate
- [compliance](https://app.thia-term.vercel.app/skills/compliance.md) — OFAC + velocity screening
- [receipt](https://app.thia-term.vercel.app/skills/receipt.md) — cryptographic proof of settlement
- [reputation](https://app.thia-term.vercel.app/skills/reputation.md) — counterparty trust score

## Auth

- SIWE (recommended): POST /v1/auth/siwe/nonce -> sign EIP-4361 -> POST /v1/auth/siwe/verify
- API key (dashboard generator ships in v0.2; lib/auth/apikey.ts is already wired)
- Send as `Authorization: Bearer <token>` on all /v1/* calls

## Conventions

- Base URL: https://app.thia-term.vercel.app
- Errors: RFC 9457 Problem+JSON, every error has `code` and `agent_action`
- Idempotency: required on POST/PUT/DELETE, `Idempotency-Key` header, 24h replay window
- Rate limits: surfaced in `X-RateLimit-*` headers, `Retry-After` on 429
- Request IDs: echoed in `X-Request-Id`, minted as ULID if client omits

## Error catalogue

https://app.thia-term.vercel.app/skills/errors.md

## Settlement chain

HashKey Chain testnet, chain id 133. RPC: https://hashkeychain-testnet.alt.technology

---

## Programmatic discovery summary

| URL                                  | What it returns                                          |
|--------------------------------------|----------------------------------------------------------|
| `GET /llms.txt`                      | top-level llms.txt index (plain text)                    |
| `GET /.well-known/thia-term.md`       | agent quickstart in markdown                             |
| `GET /.well-known/mcp.json`          | MCP server manifest                                      |
| `GET /.well-known/agent-sitemap.md`  | every agent-relevant URL grouped by kind                 |
| `GET /.well-known/openapi.yaml`      | OpenAPI 3.1 for every `/v1/*` endpoint                   |
| `GET /skills/{name}.md`              | individual skill spec (any of the 9 above)               |
| `GET /sitemap-agent.json`            | machine-readable sitemap                                 |
| `GET /i/{invoice_id}`                | public, no-auth invoice page (HTML for humans)           |
| `GET /i/{invoice_id}/agent`          | same invoice as agent-friendly markdown                  |

## Standard auth flow (one-shot)

```bash
# 1. SIWE: ask for a nonce
curl -s -X POST https://app.thia-term.vercel.app/v1/auth/siwe/nonce \
  -H 'Content-Type: application/json' \
  -d '{"address":"0xYOUR_WALLET"}'

# 2. Sign the returned message with the wallet, then exchange for a JWT
curl -s -X POST https://app.thia-term.vercel.app/v1/auth/siwe/verify \
  -H 'Content-Type: application/json' \
  -d '{"message":"<exact message>","signature":"0x..."}'
# => {"access_token":"eyJ...","scopes":[...],"expires_in":3600}

# 3. Use the JWT on every /v1/* call
curl https://app.thia-term.vercel.app/v1/auth/whoami -H "Authorization: Bearer <jwt>"
```

For dev-only, mint a scoped API key at `/dashboard/keys` and send it as
`Authorization: Bearer flk_test_...` instead of the JWT.

---

*Generated bundle. MIT licence. Source: <https://github.com/Akasxh/thia-term>*
