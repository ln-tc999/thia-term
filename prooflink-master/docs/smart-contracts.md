# Smart Contract Guide

This guide covers ProofLink's on-chain infrastructure: four upgradeable smart contracts deployed on Base (and Base Sepolia for testnet) that handle compliance receipt anchoring, agent identity management, invoice lifecycle, and x402 payment gating.

## Contract Overview

| Contract | Purpose | Key Dependencies |
|---|---|---|
| `ProofLinkRegistry` | Anchors compliance receipts as EAS attestations | EAS, SchemaRegistry |
| `ProofLinkKYA` | Agent identity registry and KYA credential management | ERC-8004 Identity Registry, ERC-8004 Validation Registry |
| `AgentInvoice` | Invoice anchoring and lifecycle state machine | None (standalone) |
| `ProofLinkFacilitator` | x402 compliance-gated settlement coordinator | ProofLinkRegistry, ProofLinkKYA |

All contracts use:
- Solidity `^0.8.25`
- OpenZeppelin Upgradeable (UUPS proxy pattern)
- `AccessControlUpgradeable` for role-based permissions

### On-Chain Address Layout (Base Sepolia)

EAS contracts are at fixed addresses on Base:
- **EAS**: `0x4200000000000000000000000000000000000021`
- **SchemaRegistry**: `0x4200000000000000000000000000000000000020`

---

## ProofLinkRegistry

**File**: `packages/contracts/src/ProofLinkRegistry.sol`

The ProofLinkRegistry anchors cryptographically signed compliance receipts on-chain as Ethereum Attestation Service attestations. Each receipt maps a payment transaction to its compliance checks.

### EAS Schema

The registry uses a custom EAS schema registered on-chain:

```
bytes32 receiptId,
bytes32 paymentTxHash,
uint64 chainId,
address payer,
address payee,
uint128 amount,
address token,
bytes32 ipfsContentHash,
uint8 riskScore,
uint16 sanctionsFlags,
bool travelRuleCompliant
```

### Sanctions Flags Bitmask

| Bit | List | Bit | Meaning |
|-----|------|-----|---------|
| 0 | OFAC | 8 | OFAC match found |
| 1 | EU | 9 | EU match found |
| 2 | UN | 10 | UN match found |
| 3 | HMT | 11 | HMT match found |

Bits 0-3 indicate which lists were checked. Bits 8-11 indicate which lists produced a match.

### Key Functions

#### `anchorReceipt`

Anchors a compliance receipt and creates an EAS attestation.

```solidity
function anchorReceipt(
    bytes32 receiptId,
    bytes32 paymentTxHash,
    uint64 chainId,
    address payer,
    address payee,
    uint128 amount,
    address token,
    bytes32 ipfsContentHash,
    uint8 riskScore,
    uint16 sanctionsFlags,
    bool travelRuleCompliant
) external onlyRole(ATTESTER_ROLE) returns (bytes32 easUID);
```

**Access**: `ATTESTER_ROLE`
**Emits**: `ReceiptAnchored(receiptId, payer, payee, easAttestationUID)`

#### `verifyReceipt`

Look up a receipt by ID. Returns the full receipt data and revocation status.

```solidity
function verifyReceipt(bytes32 receiptId)
    external view
    returns (Types.ProofLinkReceipt memory receipt, bool isRevoked);
```

#### `isPaymentCompliant`

Check whether a payment has a valid (non-revoked) compliance receipt with risk below threshold.

```solidity
function isPaymentCompliant(bytes32 paymentTxHash)
    external view
    returns (bool isCompliant);
```

#### `revokeReceipt`

Revoke a receipt and its EAS attestation.

```solidity
function revokeReceipt(bytes32 receiptId, string calldata reason)
    external onlyRole(DEFAULT_ADMIN_ROLE);
```

**Emits**: `ReceiptRevoked(receiptId, revokedBy, reason)`

#### Simplified API

For lighter integrations, the registry also offers a simplified attest/verify/revoke API:

```solidity
// Record a compliance decision
function attest(
    bytes32 receiptHash,
    address sender,
    address receiver,
    uint256 amount,
    string calldata chain,
    uint8 status    // 0=APPROVED, 1=REJECTED, 2=ESCALATED
) external onlyRole(ATTESTER_ROLE);

// Verify a receipt hash
function verify(bytes32 receiptHash)
    external view
    returns (bool valid, uint256 timestamp, uint8 status);

// Revoke an attestation
function revoke(bytes32 receiptHash) external onlyRole(DEFAULT_ADMIN_ROLE);
```

### Interacting with ProofLinkRegistry

```typescript
import { createPublicClient, createWalletClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const REGISTRY_ADDRESS = "0xREGISTRY_PROXY_ADDRESS";

// Read: check if a payment is compliant
const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(),
});

const isCompliant = await publicClient.readContract({
  address: REGISTRY_ADDRESS,
  abi: proofLinkRegistryAbi,
  functionName: "isPaymentCompliant",
  args: ["0xPAYMENT_TX_HASH_AS_BYTES32"],
});

// Read: get receipt details
const [receipt, isRevoked] = await publicClient.readContract({
  address: REGISTRY_ADDRESS,
  abi: proofLinkRegistryAbi,
  functionName: "verifyReceipt",
  args: ["0xRECEIPT_ID_AS_BYTES32"],
});

console.log("Risk score:", receipt.riskScore);
console.log("Travel Rule compliant:", receipt.travelRuleCompliant);
console.log("Revoked:", isRevoked);

// Write: anchor a receipt (requires ATTESTER_ROLE)
const account = privateKeyToAccount("0xATTESTER_PRIVATE_KEY");
const walletClient = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http(),
});

const txHash = await walletClient.writeContract({
  address: REGISTRY_ADDRESS,
  abi: proofLinkRegistryAbi,
  functionName: "anchorReceipt",
  args: [
    "0xRECEIPT_ID",        // receiptId
    "0xPAYMENT_TX_HASH",   // paymentTxHash
    8453n,                  // chainId (Base)
    "0xPAYER_ADDRESS",      // payer
    "0xPAYEE_ADDRESS",      // payee
    5000000000n,            // amount (5000 USDC in 6 decimals)
    "0xUSDC_ADDRESS",       // token
    "0xIPFS_HASH",          // ipfsContentHash
    12,                     // riskScore
    0x0001,                 // sanctionsFlags (OFAC checked, no match)
    true,                   // travelRuleCompliant
  ],
});
```

---

## ProofLinkKYA

**File**: `packages/contracts/src/ProofLinkKYA.sol`

The ProofLinkKYA contract manages agent identities and KYA credentials. It integrates with ERC-8004 for cross-protocol identity recognition.

### Agent Registration

```solidity
function registerAgent(
    string calldata did,
    address wallet,
    uint8 agentType,     // 0=AUTONOMOUS, 1=SEMI_AUTONOMOUS, 2=HUMAN_SUPERVISED
    uint256 maxTxValue
) external onlyRole(VERIFIER_ROLE);
```

**Emits**: `AgentRegistered(wallet, did, agentType, maxTxValue, registeredAt)`

### KYA Credential Issuance

```solidity
function issueKYA(
    address agentWallet,
    bytes32 credentialHash,  // keccak256 of the full W3C VC JSON
    uint64 validUntil        // expiry timestamp
) external onlyRole(VERIFIER_ROLE);
```

When an ERC-8004 Validation Registry is configured, `issueKYA` also writes a validation response:

```solidity
validationRegistry.validationResponse(
    keccak256(abi.encodePacked(agentWallet, "prooflink-kya")),
    75,  // ENHANCED level score
    string(abi.encodePacked("ipfs://", credentialHash)),
    credentialHash,
    "kya"
);
```

**Emits**: `KYAIssued(agentWallet, credentialHash, validUntil, issuedAt)`

### KYA Verification

```solidity
function verifyKYA(address agentWallet)
    external view
    returns (bool isValid, bytes32 credentialHash, uint64 validUntil);
```

Returns `isValid = true` only if the credential status is `ACTIVE` and `block.timestamp <= validUntil`.

### Credential Lifecycle

```solidity
function suspendKYA(address agentWallet) external onlyRole(VERIFIER_ROLE);
function reinstateKYA(address agentWallet) external onlyRole(VERIFIER_ROLE);
function revokeKYA(address agentWallet) external onlyRole(VERIFIER_ROLE);
```

### Delegation Scope Updates

```solidity
function updateDelegationScope(
    address wallet,
    uint256 maxTxValue,
    uint256 dailyLimit
) external onlyRole(VERIFIER_ROLE);
```

### Interacting with ProofLinkKYA

```typescript
// Register an agent
await walletClient.writeContract({
  address: KYA_ADDRESS,
  abi: proofLinkKYAAbi,
  functionName: "registerAgent",
  args: [
    "did:web:payment-bot.acme.com",
    "0xAGENT_WALLET",
    1,                              // SEMI_AUTONOMOUS
    50000n * 10n ** 6n,             // $50,000 max per tx
  ],
});

// Issue a KYA credential
const credentialJson = JSON.stringify(kyaCredential);
const credHash = keccak256(toBytes(credentialJson));
const oneYearFromNow = BigInt(Math.floor(Date.now() / 1000) + 365 * 86400);

await walletClient.writeContract({
  address: KYA_ADDRESS,
  abi: proofLinkKYAAbi,
  functionName: "issueKYA",
  args: ["0xAGENT_WALLET", credHash, oneYearFromNow],
});

// Verify KYA
const [isValid, credentialHash, validUntil] = await publicClient.readContract({
  address: KYA_ADDRESS,
  abi: proofLinkKYAAbi,
  functionName: "verifyKYA",
  args: ["0xAGENT_WALLET"],
});

// Check if agent is verified
const verified = await publicClient.readContract({
  address: KYA_ADDRESS,
  abi: proofLinkKYAAbi,
  functionName: "isVerified",
  args: ["0xAGENT_WALLET"],
});

// Get full agent info
const agentInfo = await publicClient.readContract({
  address: KYA_ADDRESS,
  abi: proofLinkKYAAbi,
  functionName: "getAgent",
  args: ["0xAGENT_WALLET"],
});
console.log("DID:", agentInfo.did);
console.log("Agent type:", agentInfo.agentType); // 0, 1, or 2
console.log("Max tx value:", agentInfo.maxTxValue);
```

---

## AgentInvoice

**File**: `packages/contracts/src/AgentInvoice.sol`

The AgentInvoice contract provides on-chain invoice anchoring and lifecycle management for agent-to-agent commerce. Invoices are content-addressed (IPFS). Only hashes, amounts, parties, and state transitions live on-chain.

### Invoice State Machine

```
DRAFT --> ISSUED --> PAID --> SETTLED
  |         |         |
  v         v         v
CANCELLED CANCELLED DISPUTED --> REFUNDED
```

| Transition | Who Can Do It |
|---|---|
| DRAFT -> ISSUED | Issuer only |
| DRAFT -> CANCELLED | Issuer only |
| ISSUED -> PAID | Facilitator or issuer |
| ISSUED -> CANCELLED | Issuer only |
| PAID -> SETTLED | Facilitator only |
| PAID -> DISPUTED | Recipient or facilitator |
| DISPUTED -> REFUNDED | Facilitator only |

### Anchoring an Invoice

```solidity
function anchorInvoice(
    bytes32 invoiceId,
    bytes32 contentHash,     // IPFS CID of full JSON-LD invoice
    address issuer,
    address recipient,
    uint128 amount
) external returns (bytes32);
```

**Access**: Caller must be the `issuer` or hold `FACILITATOR_ROLE`.
**Emits**: `InvoiceAnchored(invoiceId, issuer, recipient, amount, contentHash)`

### State Transitions

```solidity
function updateState(bytes32 invoiceId, Types.InvoiceState newState) external;
```

Access control is enforced per-transition (see table above).
**Emits**: `InvoiceStateChanged(invoiceId, oldState, newState)`

### Simplified Invoice API

For lighter integrations:

```solidity
// Create
function createInvoice(
    bytes32 invoiceHash,
    address payer,
    address payee,
    uint256 amount,
    string calldata currency
) external;

// Mark as paid
function markPaid(bytes32 invoiceHash, bytes32 txHash) external;

// Cancel
function cancelInvoice(bytes32 invoiceHash) external;

// Read
function getInvoice(bytes32 invoiceHash)
    external view
    returns (Types.InvoiceInfo memory info);
```

### Interacting with AgentInvoice

```typescript
import { keccak256, toBytes, encodePacked } from "viem";

const INVOICE_ADDRESS = "0xINVOICE_PROXY_ADDRESS";

// Create an invoice (full API)
const invoiceId = keccak256(
  encodePacked(
    ["address", "address", "uint256", "uint256"],
    ["0xISSUER", "0xRECIPIENT", 1000000000n, BigInt(Date.now())]
  )
);

const contentHash = keccak256(toBytes(JSON.stringify(invoiceJsonLd)));

await walletClient.writeContract({
  address: INVOICE_ADDRESS,
  abi: agentInvoiceAbi,
  functionName: "anchorInvoice",
  args: [
    invoiceId,
    contentHash,
    "0xISSUER_ADDRESS",
    "0xRECIPIENT_ADDRESS",
    1000000000n,   // 1000 USDC
  ],
});

// Transition to ISSUED
await walletClient.writeContract({
  address: INVOICE_ADDRESS,
  abi: agentInvoiceAbi,
  functionName: "updateState",
  args: [invoiceId, 1], // InvoiceState.ISSUED
});

// Read invoice
const invoice = await publicClient.readContract({
  address: INVOICE_ADDRESS,
  abi: agentInvoiceAbi,
  functionName: "verifyInvoice",
  args: [invoiceId],
});

console.log("State:", invoice.state);       // 1 = ISSUED
console.log("Amount:", invoice.amount);
console.log("Issuer:", invoice.issuer);

// Create via simplified API
const invoiceHash = keccak256(toBytes("invoice-123"));
await walletClient.writeContract({
  address: INVOICE_ADDRESS,
  abi: agentInvoiceAbi,
  functionName: "createInvoice",
  args: [invoiceHash, "0xPAYER", "0xPAYEE", 5000000000n, "USDC"],
});

// Mark paid
await walletClient.writeContract({
  address: INVOICE_ADDRESS,
  abi: agentInvoiceAbi,
  functionName: "markPaid",
  args: [invoiceHash, "0xPAYMENT_TX_HASH"],
});
```

---

## ProofLinkFacilitator

**File**: `packages/contracts/src/ProofLinkFacilitator.sol`

The ProofLinkFacilitator is the x402 compliance gate. It verifies compliance before settlement, executes settlement only if compliant, and anchors ProofLink receipts.

### Compliance Verification

```solidity
function verify(
    Types.PaymentPayload calldata payload,
    Types.ComplianceAttestation calldata compliance
) external view returns (bool isCompliant, string memory reason);
```

Checks:
1. Sanctions flags (bits 8-11 are match indicators)
2. Risk score vs threshold
3. KYA credential validity (via `ProofLinkKYA.verifyKYA`)
4. Daily spending limits

### Settlement

```solidity
function settle(
    Types.PaymentPayload calldata payload,
    Types.ComplianceAttestation calldata compliance
) external onlyRole(SETTLER_ROLE) whenNotPaused nonReentrant
    returns (bytes32 settlementId);
```

The `settle` function:
1. Validates the payment payload (amount > 0, nonce unused, deadline not expired)
2. Runs `_enforceCompliance()` (sanctions, risk, KYA, spending limits)
3. Marks nonce as used (replay prevention)
4. Updates daily spending tracker
5. Records settlement in storage
6. Calls `ProofLinkRegistry.anchorReceipt()` to create EAS attestation
7. Emits `PaymentSettled`

**Note**: Actual token transfer happens via EIP-3009 or Permit2 in the off-chain layer. The facilitator only records the settlement and anchors compliance.

### Simplified Facilitation

```solidity
function facilitate(
    address sender,
    address receiver,
    uint256 amount,
    bytes32 proofLinkReceipt
) external onlyRole(SETTLER_ROLE) whenNotPaused nonReentrant
    returns (bool success);
```

Checks the `ProofLinkRegistry.verify()` for a valid attestation before allowing the payment.

### Fail-Open / Fail-Closed

```solidity
bool public failClosed; // default: true

function setFailMode(bool failClosed_)
    external onlyRole(DEFAULT_ADMIN_ROLE);
```

- **Fail-closed** (`failClosed = true`): Compliance failures revert the transaction.
- **Fail-open** (`failClosed = false`): Compliance failures emit `ComplianceCheckFailed` or `PaymentBlocked` events but do not revert.

### Spending Limits

```solidity
function setSpendingLimit(address agent, uint128 limit)
    external onlyRole(DEFAULT_ADMIN_ROLE);

function getRemainingDailyLimit(address agent)
    external view returns (uint128 remaining);
```

Daily limits are tracked per-agent, per-day. The day boundary is `block.timestamp / 1 days`.

### Emergency Controls

```solidity
function pause() external onlyRole(PAUSER_ROLE);
function unpause() external onlyRole(DEFAULT_ADMIN_ROLE);
```

When paused, `settle()` and `facilitate()` revert with `EnforcedPause`.

### Interacting with ProofLinkFacilitator

```typescript
const FACILITATOR_ADDRESS = "0xFACILITATOR_PROXY_ADDRESS";

// Verify compliance (view call, no gas)
const [isCompliant, reason] = await publicClient.readContract({
  address: FACILITATOR_ADDRESS,
  abi: facilitatorAbi,
  functionName: "verify",
  args: [
    {
      payer: "0xPAYER",
      payee: "0xPAYEE",
      amount: 5000000000n,
      token: "0xUSDC",
      paymentHash: "0xHASH",
      chainId: 8453n,
      nonce: 1n,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
    },
    {
      proofLinkReceiptId: "0xRECEIPT_ID",
      riskScore: 12,
      sanctionsFlags: 0x000F,  // all lists checked, no matches
      travelRuleCompliant: true,
      kyaVerified: true,
    },
  ],
});

if (!isCompliant) {
  console.error("Compliance failed:", reason);
  // reason: "SANCTIONS_HIT" | "RISK_TOO_HIGH" | "KYA_INVALID" | "SPENDING_LIMIT_EXCEEDED"
}

// Check remaining daily limit
const remaining = await publicClient.readContract({
  address: FACILITATOR_ADDRESS,
  abi: facilitatorAbi,
  functionName: "getRemainingDailyLimit",
  args: ["0xAGENT_WALLET"],
});
// remaining: uint128 (type(uint128).max if unlimited)

// Facilitate a payment (simplified API)
await walletClient.writeContract({
  address: FACILITATOR_ADDRESS,
  abi: facilitatorAbi,
  functionName: "facilitate",
  args: [
    "0xSENDER",
    "0xRECEIVER",
    5000000000n,
    "0xPROOFLINK_RECEIPT_HASH",
  ],
});
```

---

## Shared Types

**File**: `packages/contracts/src/libraries/Types.sol`

The `Types` library defines all shared structs and enums used across contracts:

| Type | Fields | Used By |
|---|---|---|
| `Invoice` | invoiceId, contentHash, issuer, recipient, amount, state, timestamps, paymentTxHash, proofLinkReceiptId | AgentInvoice |
| `InvoiceState` | DRAFT, ISSUED, PAID, SETTLED, DISPUTED, CANCELLED, REFUNDED | AgentInvoice |
| `KYACredential` | agentWallet, credentialHash, validUntil, status, issuedAt | ProofLinkKYA |
| `CredentialStatus` | ACTIVE, SUSPENDED, REVOKED, EXPIRED | ProofLinkKYA |
| `AgentType` | AUTONOMOUS, SEMI_AUTONOMOUS, HUMAN_SUPERVISED | ProofLinkKYA |
| `AgentInfo` | did, wallet, agentType, maxTxValue, dailyLimit, verified, timestamps | ProofLinkKYA |
| `PaymentPayload` | payer, payee, amount, token, paymentHash, chainId, nonce, deadline | ProofLinkFacilitator |
| `ComplianceAttestation` | proofLinkReceiptId, riskScore, sanctionsFlags, travelRuleCompliant, kyaVerified | ProofLinkFacilitator |
| `SettlementRecord` | settlementId, payer, payee, token, amount, settledAt, proofLinkReceiptId | ProofLinkFacilitator |
| `ProofLinkReceipt` | receiptId, paymentTxHash, chainId, payer, payee, amount, token, ipfsContentHash, riskScore, sanctionsFlags, travelRuleCompliant, timestamp, easAttestationUID | ProofLinkRegistry |

---

## Deployment Guide (Foundry)

### Prerequisites

- [Foundry](https://book.getfoundry.sh/) installed
- Base Sepolia RPC URL
- Deployer private key with Base Sepolia ETH

### Deployment Script

The deployment script is at `packages/contracts/script/Deploy.s.sol`. It deploys all four contracts behind UUPS proxies and configures cross-contract roles.

### Steps

```bash
cd packages/contracts

# Install dependencies
forge install

# Compile
forge build

# Deploy to Base Sepolia
forge script script/Deploy.s.sol \
  --rpc-url base_sepolia \
  --broadcast \
  --verify \
  -vvvv

# Required environment variable
export DEPLOYER_PRIVATE_KEY=0x...
```

### What the Deploy Script Does

1. Deploys `ProofLinkRegistry` implementation + proxy, initializes with EAS addresses
2. Registers the ProofLink EAS schema
3. Deploys `ProofLinkKYA` implementation + proxy, initializes with ERC-8004 registry addresses
4. Deploys `AgentInvoice` implementation + proxy
5. Deploys `ProofLinkFacilitator` implementation + proxy, linked to registry and KYA
6. Grants `ATTESTER_ROLE` on ProofLinkRegistry to the Facilitator
7. Grants `FACILITATOR_ROLE` on AgentInvoice to the Facilitator

### Post-Deployment Verification

```bash
# Verify all contracts on Basescan
forge verify-contract \
  --chain base-sepolia \
  --compiler-version 0.8.25 \
  IMPLEMENTATION_ADDRESS \
  src/ProofLinkRegistry.sol:ProofLinkRegistry
```

---

## Security Considerations

### Access Control

All state-changing functions are gated by OpenZeppelin `AccessControlUpgradeable` roles. No function relies on `tx.origin`.

### Reentrancy Protection

`ProofLinkFacilitator.settle()` and `facilitate()` use OpenZeppelin's `ReentrancyGuard`. State updates (nonce marking, daily spend tracking) happen before external calls (CEI pattern).

### Replay Prevention

The `ProofLinkFacilitator` tracks used nonces in `_usedNonces[nonce]`. Each nonce can only be used once. Combined with `deadline` enforcement, this prevents both replay and stale settlement attacks.

### Upgrade Safety

- All contracts use UUPS proxy pattern
- `_authorizeUpgrade()` restricted to `DEFAULT_ADMIN_ROLE`
- Constructors call `_disableInitializers()` to prevent implementation contract initialization
- Storage layout follows OpenZeppelin upgrade-safe patterns

### Emergency Shutdown

The `ProofLinkFacilitator` supports emergency pause via `PausableUpgradeable`:
- `PAUSER_ROLE` can call `pause()` to halt all settlements
- `DEFAULT_ADMIN_ROLE` is required to call `unpause()`
- This asymmetry ensures that pause is fast (any pauser) but unpause requires admin review

### Input Validation

All contracts validate:
- No zero addresses for critical parameters
- No zero amounts for financial operations
- No empty hashes for content identifiers
- No expired deadlines for time-sensitive operations
- Risk scores within 0-100 range
- Agent types within 0-2 range
- Valid state transitions (AgentInvoice state machine)

### Gas Optimization

- Structs use packed storage types: `uint40` for timestamps, `uint128` for amounts, `uint8` for scores, `uint16` for flags
- Minimal on-chain storage: full data lives on IPFS, only hashes stored on-chain
- Mappings use `bytes32` keys (no dynamic arrays for lookups)
- Events carry indexed parameters for efficient log filtering
