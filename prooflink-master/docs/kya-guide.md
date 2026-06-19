# Know Your Agent (KYA) Guide

KYA is ProofLink's identity verification framework for AI agents participating in financial transactions. It extends traditional KYC/KYB concepts to autonomous software agents, establishing a trust layer that enables compliant agent-to-agent commerce.

## What is Know Your Agent?

As AI agents increasingly participate in financial transactions -- purchasing compute, paying for data, settling invoices -- the traditional KYC paradigm breaks down. Agents are not natural persons and do not have passports. KYA bridges this gap by creating a verifiable identity framework for autonomous software agents.

KYA answers four questions:

1. **Who is the agent?** -- DID, name, type, wallet address
2. **Who controls the agent?** -- Operator/principal entity, KYB status
3. **What can the agent do?** -- Delegation scope (spending limits, chains, currencies)
4. **Is the agent compliant?** -- Trust score, sanctions clearance, credential validity

---

## Registering an Agent

Register an agent through the API or SDK. This creates the agent record and issues a W3C Verifiable Credential.

### Via SDK

```ts
import { ProofLinkClient } from "@prooflink/sdk";

const prooflink = new ProofLinkClient({ apiKey: process.env.PROOFLINK_API_KEY! });

const result = await prooflink.registerAgent({
  agentDid: "did:prooflink:agent:my-data-processor",
  agentType: "autonomous",
  controllingEntity: {
    name: "DataCo Inc",
    lei: "549300EXAMPLE00000",
    kybVerified: true,
  },
  walletAddress: "0xAgentWallet",
  delegationScope: {
    maxTransactionValue: 10000,
    dailyLimit: 50000,
    allowedCounterparties: ["0xTrustedPartner"],
    blockedJurisdictions: ["KP", "IR", "SY"],
    allowedChains: ["eip155:8453"],
    allowedCurrencies: ["USDC"],
    expiresAt: "2027-03-21T00:00:00.000Z",
  },
  erc8004RegistryAddress: "0xRegistryContract",
  erc8004TokenId: "42",
});
```

### Via API

```
POST /api/v1/identity/kya/issue
```

See the [API Reference](./api-reference.md#issue-a-kya-credential) for the full request schema.

### On-Chain Registration

Register the agent on-chain via the `ProofLinkKYA` contract:

```ts
import { createWalletClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount("0xVERIFIER_PRIVATE_KEY");
const client = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http("https://sepolia.base.org"),
});

const txHash = await client.writeContract({
  address: "0xPROOFLINK_KYA_ADDRESS",
  abi: proofLinkKYAAbi,
  functionName: "registerAgent",
  args: [
    "did:web:agent.acmecorp.com",       // agent DID
    "0xAGENT_WALLET_ADDRESS",            // wallet address
    1,                                    // agentType: SEMI_AUTONOMOUS
    50000n * 10n ** 6n,                   // maxTxValue: $50,000 (USDC decimals)
  ],
});
```

---

## KYA Credential Structure

A KYA credential is a [W3C Verifiable Credential](https://www.w3.org/TR/vc-data-model/) with ProofLink-specific extensions. The canonical schema is defined in `@prooflink/shared` (`packages/shared/src/types/identity.ts`).

```json
{
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
    "id": "did:prooflink:agent:my-data-processor",
    "agentType": "autonomous",
    "controllingEntity": {
      "name": "DataCo Inc",
      "lei": "549300EXAMPLE00000",
      "did": "did:ethr:0xOperator",
      "kybVerified": true
    },
    "delegationScope": {
      "maxTransactionValue": 10000,
      "dailyLimit": 50000,
      "allowedChains": ["eip155:8453"],
      "allowedCurrencies": ["USDC"],
      "expiresAt": "2027-03-21T00:00:00.000Z"
    },
    "walletAddress": "0xAgentWallet",
    "erc8004RegistryAddress": "0xRegistryContract",
    "erc8004TokenId": "42",
    "validationEvidence": "ipfs://bafybeig..."
  },
  "proof": {
    "type": "EcdsaSecp256k1Signature2019",
    "created": "2026-03-21T12:00:00.000Z",
    "verificationMethod": "did:prooflink:issuer#key-1",
    "proofPurpose": "assertionMethod",
    "jws": "eyJhbGciOiJFUzI1NksiLC..."
  }
}
```

### Key Fields

| Field                                  | Description                                              |
|----------------------------------------|----------------------------------------------------------|
| `credentialSubject.id`                 | Agent's Decentralized Identifier (DID)                   |
| `credentialSubject.agentType`          | `autonomous`, `semi-autonomous`, or `human-supervised`   |
| `credentialSubject.controllingEntity`  | The human/company behind the agent, with KYB status      |
| `credentialSubject.delegationScope`    | What the agent is authorized to do                       |
| `credentialSubject.walletAddress`      | The agent's on-chain wallet address                      |
| `credentialSubject.erc8004TokenId`     | Token ID in the ERC-8004 Identity Registry               |
| `credentialSubject.validationEvidence` | URI to TEE attestation or auditor report                 |
| `proof.jws`                           | ECDSA signature from the credential issuer               |

---

## Agent Types

ProofLink defines three agent autonomy levels, each with different compliance implications:

| Type                | Description                                              | Compliance implications                     |
|--------------------|----------------------------------------------------------|----------------------------------------------|
| `autonomous`       | Operates without human intervention. Makes payment decisions independently. | Strictest delegation scope. Lower limits. Enhanced monitoring. |
| `semi-autonomous`  | Operates within guardrails. May request human approval for edge cases.      | Moderate delegation scope. Higher limits with human escalation. |
| `human-supervised` | Every action requires human approval before execution.                       | Most flexible scope. Limits set by supervising human's authority. |

Agent type is stored both off-chain (in the KYA credential) and on-chain (in the `ProofLinkKYA` contract):

```solidity
enum AgentType {
    AUTONOMOUS,       // 0
    SEMI_AUTONOMOUS,  // 1
    HUMAN_SUPERVISED  // 2
}
```

---

## Verification Flow

When a compliance check encounters an agent DID, ProofLink verifies the agent through this pipeline:

```
Agent DID submitted
    |
    v
[1. Validate W3C VC structure]
    |
    +-- Malformed --> verification failed
    |
    v
[2. Check issuer trust]
    |
    +-- Untrusted issuer --> verification failed
    |
    v
[3. Check credential expiration]
    |
    +-- Expired or revoked --> verification failed
    |
    v
[4. Check ERC-8004 registration]
    |
    +-- Not registered (if required) --> verification failed
    |
    v
[5. Validate controlling entity]
    |
    +-- KYB not verified or sanctions match --> verification failed
    |
    v
[6. Validate delegation scope]
    |
    +-- Transaction exceeds limits --> verification failed
    |
    v
[7. Compute trust score]
    |
    v
verified: true, trustScore: 0-100
```

### Verify via SDK

```ts
const result = await prooflink.verifyAgent("did:prooflink:agent:my-data-processor");

if (result.verified) {
  console.log("Trust score:", result.trustScore);
  console.log("Operator:", result.agentMetadata?.operator);
  console.log("Max tx value:", result.spendingLimits?.perTransactionUsd);
} else {
  console.log("Verification failed");
}
```

### Verify via ProofLink Engine

KYA verification happens automatically as part of the compliance pipeline:

```ts
import { ProofLinkEngine } from "@prooflink/core";

const engine = new ProofLinkEngine(config);

const decision = await engine.checkCompliance({
  sender: "0xSENDER_WALLET",
  receiver: "0xRECEIVER_WALLET",
  amountUsd: 25000,
  asset: "USDC",
  chain: "eip155:8453",
  kyaCredential: kyaCredential,       // Triggers KYA verification
  senderJurisdiction: "US",
});

// decision.checks includes KYA_VERIFICATION result
```

### On-Chain Verification

Smart contracts can verify KYA status directly:

```ts
const [isValid, credentialHash, validUntil] = await publicClient.readContract({
  address: "0xPROOFLINK_KYA_ADDRESS",
  abi: proofLinkKYAAbi,
  functionName: "verifyKYA",
  args: ["0xAGENT_WALLET_ADDRESS"],
});
// isValid: true if credential is ACTIVE and not expired
```

---

## Delegation Scopes Explained

A delegation scope defines the boundaries of what an agent is authorized to do -- the machine-readable equivalent of a power of attorney.

```ts
interface DelegationScope {
  maxTransactionValue: number;         // Per-transaction cap in USD
  dailyLimit?: number;                 // Rolling 24h spending cap in USD
  allowedCounterparties?: string[];    // Restrict to specific wallet addresses
  blockedJurisdictions?: string[];     // ISO 3166-1 alpha-2 codes to block
  allowedChains?: string[];            // CAIP-2 chain IDs (e.g., "eip155:8453")
  allowedCurrencies?: string[];        // Token symbols (e.g., "USDC", "EURC")
  expiresAt: string;                   // ISO-8601 datetime
}
```

### Enforcement points

Delegation scopes are enforced at multiple layers:

1. **Off-chain (KYAVerifier)**: Checks amount limits, jurisdiction restrictions, and delegation expiry before the transaction reaches the blockchain.
2. **On-chain (ProofLinkKYA)**: The `AgentInfo` struct stores `maxTxValue` and `dailyLimit`, enforced at settlement time.
3. **On-chain (ProofLinkFacilitator)**: The `_enforceCompliance` function checks daily spending limits and reverts if exceeded.

### Example: Restrictive scope (new agent)

```ts
delegationScope: {
  maxTransactionValue: 100,
  dailyLimit: 500,
  allowedCounterparties: ["0xPartnerA", "0xPartnerB"],
  blockedJurisdictions: ["KP", "IR", "SY", "CU"],
  allowedChains: ["eip155:8453"],
  allowedCurrencies: ["USDC"],
  expiresAt: "2026-06-21T00:00:00.000Z",  // 3-month credential
}
```

### Example: Broad scope (mature agent)

```ts
delegationScope: {
  maxTransactionValue: 50000,
  dailyLimit: 200000,
  blockedJurisdictions: ["KP", "IR"],
  allowedChains: ["eip155:8453", "eip155:1", "eip155:137"],
  allowedCurrencies: ["USDC", "USDT", "EURC"],
  expiresAt: "2027-03-21T00:00:00.000Z",
}
```

---

## ERC-8004 Integration

[ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) defines an on-chain identity registry for AI agents with three registries:

1. **Identity Registry** -- maps agent IDs to on-chain identities and wallet addresses
2. **Capability Registry** -- declares what an agent can do
3. **Delegation Registry** -- tracks who authorized the agent

### Identity Registry interface

```solidity
interface IERC8004IdentityRegistry {
    function getAgentWallet(uint256 agentId) external view returns (address);
    function getAgentByWallet(address wallet) external view returns (uint256);
    function isOwnerOf(uint256 agentId, address account) external view returns (bool);
    function isApprovedOperator(uint256 agentId, address operator) external view returns (bool);
}
```

### Validation Registry

When ProofLink issues a KYA credential, it writes a validation response to the ERC-8004 Validation Registry:

```solidity
interface IERC8004ValidationRegistry {
    function validationResponse(
        bytes32 requestHash,
        uint256 response,            // Validation score (0-100)
        string calldata responseURI, // IPFS URI to full credential
        bytes32 responseHash,
        string calldata tag          // "kya"
    ) external;
}
```

Any contract or protocol that reads ERC-8004 validation data can see ProofLink's KYA status for an agent without directly integrating with ProofLink's contracts.

### Linking an existing ERC-8004 agent

```ts
await prooflink.registerAgent({
  agentDid: "did:prooflink:agent:my-bot",
  agentType: "autonomous",
  controllingEntity: { name: "My Company", kybVerified: true },
  walletAddress: "0xAgentWallet",
  delegationScope: { ... },
  erc8004RegistryAddress: "0x1234...Registry",
  erc8004TokenId: "42",
});
```

---

## Trust Scoring

The KYA verification result includes a `trustScore` (0-100) computed from multiple signals:

| Signal                | Weight | Description                                      |
|-----------------------|--------|--------------------------------------------------|
| KYB verification      | 30     | Controlling entity passed KYB                    |
| Sanctions clearance   | 25     | Controlling entity cleared all sanctions lists   |
| ERC-8004 registration | 15     | Agent is registered on-chain in ERC-8004         |
| Credential freshness  | 10     | Time since issuance (newer = higher)             |
| Agent type            | 10     | `human-supervised` > `semi-autonomous` > `autonomous` |
| Validation evidence   | 10     | TEE attestation or auditor report exists         |

The trust score is included in the `KYAVerificationResult` and propagated into compliance receipts. Counterparties can set minimum trust score thresholds for accepting payments from agents.

---

## Credential Lifecycle

KYA credentials follow a state machine managed by the `ProofLinkKYA` contract:

```
ACTIVE --> SUSPENDED --> ACTIVE (reinstate)
ACTIVE --> REVOKED (permanent)
ACTIVE --> EXPIRED (automatic when block.timestamp > validUntil)
```

| Operation        | Role Required   | Reversible |
|-----------------|-----------------|------------|
| `issueKYA`       | `VERIFIER_ROLE` | N/A        |
| `suspendKYA`     | `VERIFIER_ROLE` | Yes        |
| `reinstateKYA`   | `VERIFIER_ROLE` | N/A        |
| `revokeKYA`      | `VERIFIER_ROLE` | No         |

### Caching

The `KYAVerifier` uses an LRU cache (default TTL: 15 minutes, max entries: 10,000) to avoid redundant on-chain lookups. Cache entries are keyed by `credentialSubject.id`. Transaction-specific verifications (those with amount or jurisdiction parameters) are never cached because their results depend on variable inputs.

---

## KYA in the Compliance Pipeline

When either party provides an `agentDID` in a compliance check, the pipeline automatically:

1. Looks up the agent in the KYA registry
2. Validates the credential (not expired, not revoked)
3. Checks the controlling entity against sanctions lists
4. Validates the transaction against the delegation scope
5. Includes the KYA result in the compliance decision

```ts
const decision = await prooflink.checkCompliance({
  sender: {
    address: "0xAlice",
    chain: "base",
    agentDID: "did:prooflink:agent:alice-bot",  // Triggers KYA verification
  },
  receiver: { address: "0xBob", chain: "base" },
  amount: "5000",
  asset: "USDC",
});

const kyaCheck = decision.checks.find(c => c.checkType === "KYA_VERIFICATION");
console.log(kyaCheck?.result); // "PASSED" or "SKIPPED" (if no agentDID)
```

---

## Next Steps

- [API Reference](./api-reference.md) -- full identity endpoint documentation
- [Compliance Concepts](./compliance-concepts.md) -- understand ProofLink and the compliance pipeline
- [MCP Integration](./mcp-integration.md) -- `verify_kya` MCP tool for AI agents
- [Architecture Guide](./architecture.md) -- how KYA fits in the system
