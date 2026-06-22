# T3 ADK — VendorVerify: Implementation Plan

> **Bounty:** 9–22 Juni 2026 | Bobot: SDK 40%, Completeness 30%, Creativity 30%
> **Core Concept:** Buyer AI Agent verifikasi Supplier AI Agent sebelum transaksi — semua di TEE, tanpa exposed credential.

---

## 1. Konsep: VendorVerify

Thia-Term sekarang: payment platform + AI agent + managed wallets.

**VendorVerify:** Ubah jadi **B2B procurement + verification platform.** Dua sisi:

| Sisi | Agent | Job |
|------|-------|-----|
| **Buyer** | Buyer Agent | Cari supplier, verifikasi credential mereka via T3N, kirim PO, bayar |
| **Supplier** | Supplier Agent | Register DID + credential di T3N, buktikan identity saat diminta, terima payment |

### Flow Lengkap

```
                ┌──────────────────────────────────────────────────────────┐
                │                     T3 NETWORK                          │
                │                                                         │
BUYER DOMAIN    │    ┌─────────────────┐      ┌─────────────────┐   SUPPLIER DOMAIN
 ┌──────────┐   │    │ TEE Contract:   │      │ TEE Contract:   │   ┌──────────┐
 │ Buyer    │   │    │ z:buyer:vendor- │      │ z:supplier:cre- │   │ Supplier │
 │ Agent    │───┼───▶│ verify          │      │ dential-prover  │◀──│ Agent    │
 │ (Claude) │   │    │                 │      │                 │   │ (Claude) │
 └──────────┘   │    │ ① verifyVendor()│─────▶│ ② proveCred-   │   └──────────┘
      │         │    │   (input:       │      │   ential()      │        │
      │         │    │    supplierDID) │      │   (return:      │        │
      │         │    │                 │◀─────│    credential   │        │
      │         │    │ ③ processPay-   │      │    +signature)  │        │
      │         │    │   ment()        │──────┤                 │        │
      │         │    │   (sign +       │      └────────┬────────┘        │
      │         │    │    broadcast)   │               │                 │
      │         │    └────────┬────────┘               │                 │
      │         │             │                        │                 │
      │         │             ▼                         ▼                 │
      │         │    ┌──────────────────────────────────────────┐         │
      │         │    │          z-namespace (KV Store)          │         │
      │         │    │  z:buyer:secrets     │ z:supplier:creds  │         │
      │         │    │  z:buyer:audit       │ z:supplier:public │         │
      │         │    └──────────────────────────────────────────┘         │
      │         │                                                         │
      ▼         └──────────────────────────────────────────────────────────┘
 ┌──────────┐                                                      ┌──────────┐
 │ HashKey  │◄───────────────── txHash ────────────────────────────│          │
 │ Chain    │                                                     │  Done!   │
 │ (onchain)│                                                     │          │
 └──────────┘                                                     └──────────┘
```

---

## 2. Mapping: VendorVerify Concept → T3 Capability (5 Wajib)

| # | VendorVerify Concept | T3 Capability | Bobot |
|---|---------------------|---------------|-------|
| 1 | Supplier identity verification | **DID** — `did:t3n` untuk setiap supplier & buyer agent | SDK |
| 2 | Buyer agent simpan/read credential rules | **Maps** — `z:<tid>:secrets`, `z:<tid>:vendor-creds` | SDK |
| 3 | Buyer agent verify credential di TEE | **TEE Contract** — `verifyVendor()` Rust→WASM | SDK |
| 4 | Supplier PII tidak pernah ke buyer agent | **Placeholders** — `{{profile.*}}` di credential check | SDK |
| 5 | Buyer contract → Supplier contract comms | **Cross-tenant calls** — `executeBusinessContract()` | SDK |

**Bonus (Completeness + Creativity):**

| # | Fitur | T3 Capability |
|---|-------|---------------|
| 6 | Delegasi: user set limit buat agent-nya | `agent-auth-update` |
| 7 | Audit trail crypto-signed | `signing` host API + `kv-store` |
| 8 | Post-payment webhook | `outbox` host API |
| 9 | OFAC compliance di TEE | Contract logic + public maps |
| 10 | Token meter & balance | `getUsage()` |

---

## 3. Detail Implementasi

### 3a. DID Setup — Supplier & Buyer Registration

```typescript
// Setiap user/agent dapat did:t3n via T3N
setEnvironment("testnet");
const buyerClient = new T3nClient({ wasmComponent, handlers: { EthSign } });
await buyerClient.handshake();
const buyerDid = await buyerClient.authenticate(createEthAuthInput(buyerAddress));
// buyerDid.value → "did:t3n:8f3a..."

// Supplier juga gitu:
// supplierDid.value → "did:t3n:c91d..."
```

**Disimpan di:** `User.t3nDid` + `Agent.t3nDid` (kolom baru di Prisma)

**Capaian:** ✅ DID

---

### 3b. TEE Contract #1: `verifyVendor` (Buyer Side)

TEE contract yang dipanggil Buyer Agent untuk verifikasi supplier:

```wit
// wit/world.wit
world vendor-verify {
  import host:tenant/tenant-context@1.0.0;
  import host:interfaces/kv-store@2.1.0;
  import host:interfaces/logging@2.1.0;
  import host:interfaces/http-with-placeholders@2.1.0;  // ← PII substitution

  export contracts;
}

interface contracts {
  record generic-input { input, user-profile, context }

  // Buyer Agent panggil ini:
  verify-vendor:      func(req: generic-input) -> result<list<u8>, string>;
  // Untuk payment setelah verified:
  process-payment:    func(req: generic-input) -> result<list<u8>, string>;
}
```

#### `verify-vendor` — Logic:

```
verifyVendor(input: { supplierDID, poAmount, token }):
  1. Read OFAC list dari z:buyer:public:ofac-list (public map)
  2. Read buyer's payment credentials dari z:buyer:secrets (private map)
  
  3. Cross-tenant: call z:supplier:credential-prover → proveCredential()
     → Supplier contract return: { status, complianceHash, didSignature }
     → Semua PII supplier di-resolve via {{profile.*}} — buyer contract tidak lihat data mentah
  
  4. Validasi signature & compliance status di dalam TEE
  5. Log audit ke z:buyer:audit
  
  6. Return: { verified: true, supplierDid, score, timestamp, signedReceipt }
```

**Capaian:** ✅ TEE Contract, ✅ Maps, ✅ Cross-tenant calls, ✅ Placeholders

---

### 3c. TEE Contract #2: `credentialProver` (Supplier Side)

Dipanggil oleh Buyer's contract via cross-tenant call:

```wit
world credential-prover {
  import host:interfaces/kv-store@2.1.0;
  import host:interfaces/signing@2.1.0;
  import host:interfaces/logging@2.1.0;

  export contracts;
}

interface contracts {
  // Buyer's contract call ini:
  prove-credential: func(req: generic-input) -> result<list<u8>, string>;
}
```

```
proveCredential(input: { buyerDID }):
  1. Read supplier credentials dari z:supplier:creds
  2. Sign a proof via host `signing` interface
  3. Return: { status: "compliant", didSignature, timestamp }
```

**Capaian:** ✅ TEE Contract, ✅ Maps, ✅ Signing host API

---

### 3d. Payment Execution (Setelah Verified)

```
processPayment(input: { toAddress, amount, token }):
  1. Read private key dari z:buyer:secrets (TEE-only, tidak bisa di-read dari luar)
  2. Build HashKey Chain transaction
  3. Sign via host `signing` interface (di dalam TEE, private key never leaves enclave)
  4. Broadcast via http::call ke HashKey RPC
  5. Write receipt ke z:buyer:audit
  6. (Opsional) Enqueue webhook via outbox
  7. Return txHash
```

**Capaian:** ✅ Signing host API, ✅ http, ✅ outbox

---

### 3e. Agent Delegation — Scoping

User authorize agent-nya via `agent-auth-update`:

```typescript
await userClient.execute({
  script_name: "tee:user/contracts",
  function_name: "agent-auth-update",
  input: {
    agents: [{
      agentDid: "did:t3n:<buyer-agent>",
      scripts: [{
        scriptName: "z:<buyer>:vendor-contracts",
        functions: ["verify-vendor", "process-payment"],
        allowedHosts: ["https://mainnet.hsk.xyz"],
        policy: {
          maxAmount: "5000 USDC",
          allowedTokens: ["USDC", "HSK"],
          allowedSuppliers: ["did:t3n:<supplier1>", "did:t3n:<supplier2>"],
          expiry: "2026-07-01T00:00:00Z",
        }
      }]
    }]
  }
});
```

Policy di-enforce oleh TEE host di runtime — agent tidak bisa override.

**Capaian:** ✅ agent-auth-update

---

### 3f. Placeholders — Supplier PII Protection

Supplier credentials mengandung PII (registrasi bisnis, tax ID, dll). Buyer contract verify tanpa pernah lihat data mentah:

```rust
// Di TEE contract, panggil API verifikasi pajak:
let resp = hwp::call(&hwp::Request {
    method: "POST",
    url: "https://api.pajak.go.id/verify",
    headers: vec![("Authorization", format!("Bearer {api_key}"))],
    payload: serde_json::json!({
        "tax_id": "{{profile.tax_id}}",         // resolved host-side
        "company_name": "{{profile.company}}",   // never enters WASM
        "director": "{{profile.director_name}}", // never enters WASM
    }),
})?;

// Buyer contract cuma terima: { verified: true/false, timestamp }
// Tidak pernah lihat tax_id, company_name, atau director_name
```

**Capaian:** ✅ http-with-placeholders

---

## 4. Summary: Scoring Coverage

| Kriteria | Bobot | Yang Kita Capai |
|----------|-------|-----------------|
| **SDK Integration** | **40%** | ✅ DID ✅ Maps ✅ Contracts ✅ Placeholders ✅ Cross-tenant calls ✅ Agent-auth ✅ Signing ✅ Outbox |
| **Completeness** | 30% | End-to-end flow: register → verify → authorize → pay → audit |
| **Creativity** | 30% | VendorVerify sebagai use case B2B procurement; compliance + verification di TEE; dua arah agent communication via cross-tenant calls |

### Files Change Summary

| File | Action |
|------|--------|
| `prisma/schema.prisma` | Tambah `User.t3nDid`, `Agent.t3nDid` |
| `.env.example` | Tambah `T3N_API_KEY` |
| `lib/t3n-client.ts` | **NEW** — T3N client singleton |
| `contracts/tee/vendor-verify/Cargo.toml` | **NEW** — Rust TEE contract |
| `contracts/tee/vendor-verify/wit/world.wit` | **NEW** — WIT interface |
| `contracts/tee/vendor-verify/src/lib.rs` | **NEW** — Entry point |
| `contracts/tee/vendor-verify/src/verify.rs` | **NEW** — verifyVendor logic |
| `contracts/tee/vendor-verify/src/payment.rs` | **NEW** — processPayment logic |
| `contracts/tee/credential-prover/` | **NEW** — Supplier-side TEE contract |
| `lib/agent-engine.ts` | Tambah call TEE contract instead of derive wallet |
| `lib/agent-wallet.ts` | Deprecate BIP-44 derivation |
| `app/api/agents/vendor-verify/route.ts` | **NEW** — API endpoint |
| `app/api/agents/vendor-pay/route.ts` | **NEW** — Verified payment endpoint |
| `lib/hsp-client.ts` | HSP tetap sebagai fiat alternative rail |
