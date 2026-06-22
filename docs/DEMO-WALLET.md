# Demo Wallet Feature

Auto-generate T3N DID for testing without manual setup.

## Overview

Demo wallet allows users to test Thia-Term without needing to:
- Manually generate T3N API keys
- Set up T3N DID manually
- Configure environment variables for testing

The system automatically generates:
- ✅ Ethereum wallet with BIP-39 mnemonic
- ✅ T3N DID derived from wallet address
- ✅ Encrypted credentials stored securely
- ✅ Test environment flag

## How It Works

### 1. **Auto-Generation**

```typescript
// Generate wallet
const { walletAddress, encryptedMnemonic } = await generateDemoWallet()

// Derive T3N DID
const t3nDid = generateDemoT3nDid(walletAddress)
// Format: did:t3n:<address_without_0x>
```

### 2. **Database Storage**

```prisma
model User {
  walletAddress  String?  @unique
  t3nDid         String?  @unique
  isDemo         Boolean  @default(false)  // ← Demo flag
  // ...
}
```

### 3. **UI Flow**

1. User clicks "Try Demo Wallet" in onboarding modal
2. System generates wallet + DID instantly
3. Demo banner appears at top of dashboard
4. User can test all features with demo credentials

### 4. **Security**

- Demo wallets use same encryption as production (`AES-256-GCM`)
- Clearly marked with `isDemo: true` flag
- Banner warns: "Do not send real funds"
- Can be removed and replaced with production wallet

## API Endpoints

### Create Demo Wallet

```bash
POST /api/wallet/demo
```

**Response:**
```json
{
  "success": true,
  "wallet": {
    "address": "0x...",
    "t3nDid": "did:t3n:...",
    "type": "managed",
    "isDemo": true
  },
  "message": "Demo wallet created successfully! 🎉",
  "note": "This is a test wallet. Do not send real funds."
}
```

### Remove Demo Wallet

```bash
DELETE /api/wallet/demo
```

Clears demo credentials so user can create production wallet.

## UI Components

### 1. **Demo Button** (`wallet-onboarding-modal.tsx`)

```tsx
<button onClick={handleCreateDemo}>
  <Wallet /> Try Demo Wallet
  <span className="badge">DEMO</span>
</button>
```

### 2. **Demo Banner** (`demo-wallet-banner.tsx`)

Shown at top of dashboard when `isDemo: true`:

```tsx
<DemoWalletBanner />
// → "Demo Wallet Active - T3N DID auto-generated"
```

### 3. **Remove Demo**

Button in banner allows switching to production:

```tsx
<Button onClick={handleRemoveDemo}>
  Remove Demo
</Button>
```

## T3N DID Generation

Demo DID is derived from Ethereum address:

```typescript
function generateDemoT3nDid(walletAddress: string): string {
  const address = walletAddress.toLowerCase().replace('0x', '')
  return `did:t3n:${address}`
}
```

**Example:**
- Wallet: `0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb`
- DID: `did:t3n:742d35cc6634c0532925a3b844bc9e7595f0beb`

## Migration

Add `isDemo` field to existing database:

```sql
-- Migration: add_demo_wallet_support
ALTER TABLE "User" 
ADD COLUMN IF NOT EXISTS "isDemo" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "User_isDemo_idx" 
ON "User"("isDemo");
```

Or use Prisma:

```bash
npx prisma migrate dev --name add_demo_wallet
```

## Testing Demo Wallet

1. **Login** to Thia-Term
2. **Click** "Try Demo Wallet" in onboarding modal
3. **Verify** demo banner appears
4. **Test** features:
   - Create payment links
   - Generate invoices
   - Execute agent payments (will use demo DID)
5. **Remove** demo when ready for production

## Limitations

- ⚠️ Demo wallets should not receive real funds
- ⚠️ T3N DID is derived locally (not registered on T3N testnet)
- ⚠️ Demo transactions may fail on actual blockchain
- ✅ Perfect for UI/UX testing and development

## Production Use

To upgrade from demo to production:

1. Click "Remove Demo" in banner
2. Create production wallet with recovery phrase
3. Or import existing wallet
4. Register actual T3N DID at https://terminal3.io

## Code References

- **Generation Logic**: `lib/demo-wallet.ts`
- **API Routes**: `app/api/wallet/demo/route.ts`
- **UI Components**: 
  - `components/wallet-onboarding-modal.tsx`
  - `components/demo-wallet-banner.tsx`
- **Auth Integration**: `lib/auth-config.ts`
