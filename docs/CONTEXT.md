# Terminal 3 ADK — Resources

> Bounty Challenge: 9–22 Juni 2026 | $2,000 cash + $3,000 Google Credits

---

## 🔗 Link Utama

| Resource | URL |
|---|---|
| Claim Token + API Key | https://www.terminal3.io/claim-page |
| Dokumentasi Utama | https://docs.terminal3.io |
| Index Semua Docs (llms.txt) | https://docs.terminal3.io/llms.txt |
| OpenAPI Spec | https://docs.terminal3.io/terminal-3-openapi.yml |
| API Reference (JSON) | https://docs.terminal3.io/api-reference/openapi.json |
| GitHub Terminal-3 | https://github.com/Terminal-3 |
| Dev Community (Telegram) | https://t.me/terminal3developer |
| DevRel Email | devrel@terminal3.io |
| Trust Center | https://trust.terminal3.io |

---

## 📦 SDK & Stack Teknis

### Install

```bash
npm install @terminal3/t3n-sdk   # Node >= 18
```

### TEE Contract (Rust → WASM)

```bash
rustup target add wasm32-wasip2   # WASI Preview 2
cargo install wasm-tools           # opsional — inspect/verify component
```

### Bahasa yang Didukung

- TypeScript / JavaScript (saat ini)
- Rust (untuk TEE contract, dikompilasi ke WASM)

### Protokol yang Didukung

- A2A
- ERC-8004
- Entra Agent ID
- MCP
- Web Bot Auth

---

## 📖 Dokumentasi — Halaman Penting

### Getting Started

| Halaman | URL |
|---|---|
| Request Test Tokens | https://docs.terminal3.io/developers/adk/get-started/prerequisites/request-test-tokens.md |
| Setup Dev Environment | https://docs.terminal3.io/developers/adk/get-started/prerequisites/set-up-dev-env.md |
| 1. Write TEE Contract | https://docs.terminal3.io/developers/adk/get-started/walkthrough/write-contract.md |
| 2. Build Contract | https://docs.terminal3.io/developers/adk/get-started/walkthrough/build-contract.md |
| 3. Register Contract | https://docs.terminal3.io/developers/adk/get-started/walkthrough/register-contract.md |
| 4. Invoke Contract | https://docs.terminal3.io/developers/adk/get-started/walkthrough/invoke-contract.md |

### Overview & Architecture

| Halaman | URL |
|---|---|
| What is T3 ADK? | https://docs.terminal3.io/developers/adk/overview/what-is-adk.md |
| Why T3 ADK? | https://docs.terminal3.io/developers/adk/overview/why-adk.md |
| Platform Overview | https://docs.terminal3.io/intro/platform.md |
| What is T3N? | https://docs.terminal3.io/t3n/overview/what-is-t3n.md |
| Architecture (T3N) | https://docs.terminal3.io/t3n/how-t3n-works/architecture.md |
| TEE Node | https://docs.terminal3.io/t3n/how-t3n-works/tees.md |
| Host API | https://docs.terminal3.io/t3n/how-t3n-works/host-api.md |
| Storage Namespaces (z-namespace) | https://docs.terminal3.io/t3n/how-t3n-works/z-namespace.md |
| Tokens | https://docs.terminal3.io/t3n/how-t3n-works/tokens.md |
| DID | https://docs.terminal3.io/t3n/how-t3n-works/did.md |

### Identity

| Halaman | URL |
|---|---|
| Decentralized ID (DID) | https://docs.terminal3.io/intro/components/did.md |
| Smart VCs (Verifiable Credentials) | https://docs.terminal3.io/intro/components/vc.md |

### Tips & Tricks (Wajib Baca)

| Halaman | URL |
|---|---|
| Placeholders in outbound calls | https://docs.terminal3.io/developers/adk/tips/placeholders-outbound-calls.md |
| Common Errors | https://docs.terminal3.io/developers/adk/tips/common-errors.md |
| Create Tenant KV Maps | https://docs.terminal3.io/developers/adk/tips/create-kv-maps.md |
| Seed API Key into Secrets Map | https://docs.terminal3.io/developers/adk/tips/seed-api-key.md |
| Outbound HTTP Auth by User | https://docs.terminal3.io/developers/adk/tips/outbound-http-auth-by-user.md |
| Capabilities from WIT Imports | https://docs.terminal3.io/developers/adk/tips/capabilities-from-wit-import.md |

### Use Cases (Referensi Arsitektur)

| Halaman | URL |
|---|---|
| Delegate Access to AI Agents (B2B Procurement + Payroll) | https://docs.terminal3.io/t3n/use-cases/delegate-access-to-agent.md |
| Delegate Access to Human Helpers | https://docs.terminal3.io/t3n/use-cases/delegate-access-to-human.md |
| Reusable Verified User Data | https://docs.terminal3.io/t3n/use-cases/reusable-user-data.md |
| Confidential Multi-Party Computation | https://docs.terminal3.io/t3n/use-cases/mpc.md |
| Delegate Access (Data Owner Guide) | https://docs.terminal3.io/t3n/data-owner-guide/delegate-access.md |

---


| Repo | Deskripsi |
|---|---|
| [z-tenant-flight](https://github.com/Terminal-3/z-tenant-flight) | Flight booking agent — **template terbaik untuk mulai** (A2A delegation, PII via placeholders) |
| [hedera-t3n-plugin](https://github.com/Terminal-3/hedera-t3n-plugin) | Plugin Hedera untuk T3N (TypeScript) |

---

## ⚡ Sandbox Allocation

| Item | Jumlah |
|---|---|
| Test T3N Tokens | 20,000 |
| Verifiable Agent Identities (DID) | 25 did:t3n |
| Protected Actions | ~5,000 |
| Stripe Test Merchant | Tersedia (end-to-end payment intents) |

---

## 🏗️ Arsitektur Kunci

### TEE Contract Key Design Rules

- Export functions via `contracts` interface — setiap fungsi menerima `generic-input` dan return `result<list<u8>, string>`
- `kv-store` calls pakai full `z:<tid>:<map>` name — bangun dari `tenant_context::tenant_did()` saat runtime
- Import hanya host interfaces yang dipakai — ini adalah satu-satunya capability contract
- `http::call` sinkronus — response tersedia sebelum fungsi return
- Untuk data PII, pakai `http-with-placeholders` dengan marker `{{profile.<field>}}` — PII tidak pernah masuk WASM memory

### Placeholder Pattern (Kritis untuk Privacy)

```rust
// PII via http-with-placeholders — plaintext tidak pernah masuk WASM
let order_body = json!({
    "given_name":  "{{profile.first_name}}",
    "family_name": "{{profile.last_name}}",
    "email":       "{{profile.verified_contacts.email.value}}",
});
```

### SDK Setup Minimal

```typescript
import { T3nClient, loadWasmComponent, setEnvironment,
         createEthAuthInput, eth_get_address, metamask_sign } from "@terminal3/t3n-sdk";

setEnvironment("testnet");
const key = process.env.T3N_API_KEY!;
const address = eth_get_address(key);

const client = new T3nClient({
  wasmComponent: await loadWasmComponent(),
  handlers: { EthSign: metamask_sign(address, undefined, key) },
});

await client.handshake();
const did = await client.authenticate(createEthAuthInput(address));
```

---

## 🎯 Relevansi untuk VendorVerify Agent

Arsitektur **B2B Procurement** di docs Terminal 3 sangat aligned dengan konsep VendorVerify:

| VendorVerify Concept | T3 ADK Equivalent |
|---|---|
| Buyer agent verifikasi vendor | Buyer AI Agent dengan policy-bound delegation |
| Supplier identity verification | did:t3n verifiable agent identity |
| TEE-based credential check | TEE contract + http-with-placeholders |
| Audit trail | T3N ledger row per protected action |
| No credential exposure | KV secrets map — agent tidak pernah hold raw credentials |

Flow referensi: [B2B Procurement Use Case](https://docs.terminal3.io/t3n/use-cases/delegate-access-to-agent.md)

---

## 📋 Scoring Criteria Reminder

| Kriteria | Bobot |
|---|---|
| SDK Integration (seberapa dalam/menyeluruh) | **40%** |
| Completeness of solution | 30% |
| Creativity | 30% |

> **Prioritas:** Pastikan semua capability SDK (maps, contracts, placeholders, DID, cross-tenant calls) terpakai — bukan hanya handshake + basic execute.

---

## 🛠️ Dev Commands (Thia-Term)

```sh
npm run dev         # next dev
npm run build       # prisma generate && next build
npm run typecheck   # tsc --noEmit
npm run lint        # next lint
cp .env.example .env.local && npx prisma db push && npm run dev   # first-time setup
```

- `@/*` maps to project root (e.g. `@/lib/prisma`)
- API routes under `app/api/`
- Build ignores TS/lint errors — run `typecheck` and `lint` separately to verify