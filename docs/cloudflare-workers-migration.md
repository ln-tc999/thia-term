# Cloudflare Workers Migration Strategy

## Why migrate

| Concern | Current (Vercel/Next.js) | After migration |
|---|---|---|
| Cold-start latency | ~400ms (Node.js serverless) | ~5ms (V8 isolate, always warm) |
| Edge-native crypto | Not available in Node runtime | `crypto.subtle` available globally |
| DDoS surface | Vercel IP space, limited WAF | Cloudflare network + WAF + rate limiting |
| Secret handling | Vercel env vars (unencrypted at rest in dashboard) | Cloudflare Workers Secrets (encrypted, never in logs) |
| Webhook replay protection | App-level timestamp check | Can add at CDN/WAF layer before code runs |

---

## Routes to migrate first (highest security impact)

### Phase A — Webhook handler
`POST /api/webhooks/hsp`

This is the highest-priority route because it processes financial events unauthenticated (only HMAC-signed). On Workers:
- HMAC verification runs at the edge before any DB call
- Timestamp replay check can be enforced via a Cloudflare WAF custom rule (free, no code needed)
- Automatic DDoS protection absorbs HSP retry storms

### Phase B — AI chat
`POST /api/ai/chat`

Benefits from Cloudflare AI Gateway:
- Logs all LLM requests/responses for audit
- Caches identical prompts (cost reduction)
- Rate-limits per user at the edge

### Phase C — Compliance preflight
`POST /api/compliance/preflight`

Screening requests never touch a user's personal data — safe to run fully at the edge with no DB dependency.

---

## Architecture after migration

```
Client
  │
  ▼
Cloudflare CDN / WAF
  │  ├── Rate limiting (per IP, per user JWT)
  │  └── WAF rules (block timestamp-stale webhook replays)
  │
  ▼
Cloudflare Workers (Edge)
  │  ├── /api/webhooks/hsp  ← HMAC verify + replay check → D1 or Queue
  │  ├── /api/ai/chat       ← Injection filter → AI Gateway → Claude
  │  └── /api/compliance/*  ← Screening logic (no DB needed)
  │
  ▼
Origin (Vercel / Node.js) — remaining routes that need Prisma/PostgreSQL
  └── /api/invoices, /api/payments, /api/agents, /api/user, ...
```

---

## Implementation steps

### 1. Set up Wrangler project

```bash
npx wrangler init flowlink-edge --no-delegate-c3
cd flowlink-edge
```

### 2. Migrate webhook handler

```typescript
// workers/webhooks-hsp/index.ts
import { verifyHmac } from './lib/hmac'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

    const body = await request.text()
    const timestamp = request.headers.get('X-Timestamp') ?? ''
    const nonce     = request.headers.get('X-Nonce') ?? ''
    const signature = request.headers.get('X-Signature') ?? ''

    // Replay window check
    const ts = parseInt(timestamp, 10)
    const now = Math.floor(Date.now() / 1000)
    if (isNaN(ts) || Math.abs(now - ts) > 300) {
      return new Response(JSON.stringify({ error: 'Timestamp out of window' }), { status: 400 })
    }

    // HMAC verification using Web Crypto (no Node.js crypto needed)
    const valid = await verifyHmac(env.HSP_APP_SECRET, 'POST', '/api/webhooks/hsp', '', body, timestamp, nonce, signature)
    if (!valid) return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401 })

    // Forward verified payload to origin
    return fetch('https://app.flowlink.io/api/webhooks/hsp/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Worker-Auth': env.WORKER_SECRET },
      body,
    })
  }
}
```

### 3. Migrate AI chat with AI Gateway

```typescript
// workers/ai-chat/index.ts
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Verify session JWT (use a lightweight JWT verify with Web Crypto)
    // ... auth check ...

    const { message } = await request.json()

    // Route through Cloudflare AI Gateway for logging + caching
    const response = await fetch(
      `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/flowlink/anthropic/v1/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.ANTHROPIC_API_KEY}`,
        },
        body: JSON.stringify({ /* Claude payload */ }),
      }
    )

    return response
  }
}
```

### 4. Move secrets to Cloudflare

```bash
# Never store these in wrangler.toml — use Secrets
wrangler secret put HSP_APP_SECRET
wrangler secret put HSP_APP_KEY
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put WORKER_SECRET        # shared secret for worker→origin calls
wrangler secret put WALLET_ENCRYPTION_KEY
```

### 5. Add WAF rules (Cloudflare dashboard)

| Rule | Expression | Action |
|---|---|---|
| Block stale webhook timestamps | `http.request.uri.path eq "/api/webhooks/hsp" and http.request.headers["x-timestamp"][0] lt (now() - 300)` | Block |
| Rate-limit AI chat | `http.request.uri.path eq "/api/ai/chat"` | Rate limit: 20 req/min per IP |
| Block missing HMAC headers | `http.request.uri.path eq "/api/webhooks/hsp" and not http.request.headers["x-signature"] exists` | Block |

---

## Routes that stay on Vercel/Node

These routes require Prisma + PostgreSQL and cannot run in a V8 isolate without a connection pool:

- `/api/invoices` — complex Prisma queries
- `/api/payments` — financial writes
- `/api/agents` — wallet derivation + DB
- `/api/user` — profile management
- `/api/payroll` — multi-step DB transactions
- `/api/vaults` — vault state management

Use Cloudflare as a WAF/auth proxy in front of Vercel for these routes.

---

## Timeline estimate

| Week | Work |
|---|---|
| 1 | Set up Wrangler, deploy webhook Worker to staging |
| 2 | Validate HMAC + replay protection end-to-end with HSP testnet |
| 3 | Deploy AI chat Worker + AI Gateway, confirm injection filter parity |
| 4 | WAF rules live, migrate compliance preflight, load test |
| 5 | Cut over production DNS, deprecate direct Vercel webhook endpoint |
