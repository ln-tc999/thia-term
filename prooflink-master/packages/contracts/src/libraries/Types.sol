// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

// Sanctions bitmask constants (file-level for gas efficiency)
uint16 constant SANCTIONS_SCREENED_MASK = 0x000F;
uint16 constant SANCTIONS_MATCH_MASK = 0x0F00;

/// @title Types
/// @notice Shared type definitions for ProofLink contracts.

library Types {
    // ──────────────────────────────────────────────
    // Invoice
    // ──────────────────────────────────────────────

    /// @notice Invoice lifecycle states.
    enum InvoiceState {
        DRAFT, // 0: Created but not finalized
        ISSUED, // 1: Finalized and sent to recipient
        PAID, // 2: Payment confirmed on-chain
        SETTLED, // 3: Settlement complete, compliance receipt anchored
        DISPUTED, // 4: Under dispute
        CANCELLED, // 5: Cancelled by issuer before payment
        REFUNDED // 6: Refunded after dispute

    }

    /// @notice On-chain invoice anchor.
    struct Invoice {
        bytes32 invoiceId;
        bytes32 contentHash;
        address issuer;
        address recipient;
        uint128 amount;
        InvoiceState state;
        uint40 createdAt;
        uint40 issuedAt;
        uint40 paidAt;
        uint40 settledAt;
        bytes32 paymentTxHash;
        bytes32 proofLinkReceiptId;
    }

    // ──────────────────────────────────────────────
    // KYA
    // ──────────────────────────────────────────────

    /// @notice KYA verification levels, escalating trust.
    enum KYALevel {
        NONE, // 0: No verification
        BASIC, // 1: Agent registered, basic metadata check
        STANDARD, // 2: Principal entity verified (KYB/vLEI)
        ENHANCED, // 3: Full compliance: sanctions, AML, Travel Rule
        INSTITUTIONAL // 4: SOC2/PCI-DSS audited, multi-sig governance

    }

    /// @notice Status of a KYA credential.
    enum CredentialStatus {
        ACTIVE,
        SUSPENDED,
        REVOKED,
        EXPIRED
    }

    /// @notice On-chain representation of a KYA credential.
    struct KYACredential {
        address agentWallet;
        bytes32 credentialHash;
        uint64 validUntil;
        CredentialStatus status;
        uint40 issuedAt;
    }

    // ──────────────────────────────────────────────
    // Agent Info (KYA Registry)
    // ──────────────────────────────────────────────

    /// @notice Agent type classification.
    enum AgentType {
        AUTONOMOUS, // 0
        SEMI_AUTONOMOUS, // 1
        HUMAN_SUPERVISED // 2

    }

    /// @notice On-chain agent identity info for KYA registry.
    struct AgentInfo {
        string did;
        address wallet;
        AgentType agentType;
        uint256 maxTxValue;
        uint256 dailyLimit;
        bool verified;
        uint40 registeredAt;
        uint40 updatedAt;
    }

    // ──────────────────────────────────────────────
    // Facilitator
    // ──────────────────────────────────────────────

    /// @notice Payment payload for x402 compliance-gated settlement.
    struct PaymentPayload {
        address payer;
        address payee;
        uint128 amount;
        address token;
        bytes32 paymentHash;
        uint64 chainId;
        uint256 nonce;
        uint256 deadline;
    }

    /// @notice Compliance attestation attached to facilitator operations.
    struct ComplianceAttestation {
        bytes32 proofLinkReceiptId;
        uint8 riskScore;
        uint16 sanctionsFlags;
        bool travelRuleCompliant;
        bool kyaVerified;
    }

    /// @notice Record of a completed settlement.
    struct SettlementRecord {
        bytes32 settlementId;
        address payer;
        address payee;
        address token;
        uint128 amount;
        uint40 settledAt;
        bytes32 proofLinkReceiptId;
    }

    // ──────────────────────────────────────────────
    // ProofLink Receipt
    // ──────────────────────────────────────────────

    /// @notice Simplified invoice info for the convenience API.
    struct InvoiceInfo {
        bytes32 invoiceHash;
        address payer;
        address payee;
        uint256 amount;
        string currency;
        bool paid;
        bytes32 txHash;
        uint40 createdAt;
        uint40 paidAt;
    }

    /// @notice Simplified attestation record for the convenience API.
    struct SimpleAttestation {
        bytes32 receiptHash;
        address sender;
        address receiver;
        uint256 amount;
        string chain;
        uint8 status; // 0=APPROVED, 1=REJECTED, 2=ESCALATED
        uint40 timestamp;
        bool revoked;
    }

    /// @notice Minimal on-chain compliance receipt.
    struct ProofLinkReceipt {
        bytes32 receiptId;
        bytes32 paymentTxHash;
        uint64 chainId;
        address payer;
        address payee;
        uint128 amount;
        address token;
        bytes32 ipfsContentHash;
        uint8 riskScore;
        uint16 sanctionsFlags;
        bool travelRuleCompliant;
        uint40 timestamp;
        bytes32 easAttestationUID;
    }
}
