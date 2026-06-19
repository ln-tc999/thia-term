// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Types} from "../libraries/Types.sol";

/// @title IProofLinkRegistry
/// @notice Interface for the ProofLink compliance receipt registry.
interface IProofLinkRegistry {
    // ──────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────

    event ReceiptAnchored(
        bytes32 indexed receiptId, address indexed payer, address indexed payee, bytes32 easAttestationUID
    );

    event ComplianceAttested(
        bytes32 indexed receiptHash,
        address indexed sender,
        address indexed receiver,
        uint256 amount,
        string chain,
        uint8 status
    );

    event ReceiptRevoked(bytes32 indexed receiptId, address indexed revokedBy, string reason);

    event AttestationRevoked(bytes32 indexed receiptHash, address indexed revokedBy);

    event SchemaRegistered(bytes32 indexed schemaUID);

    event RiskThresholdUpdated(uint8 oldThreshold, uint8 newThreshold);

    event ReceiptIpfsUpdated(bytes32 indexed receiptId, bytes32 ipfsContentHash);

    // ──────────────────────────────────────────────
    // Full EAS API
    // ──────────────────────────────────────────────

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
    ) external returns (bytes32 easUID);

    function verifyReceipt(bytes32 receiptId)
        external
        view
        returns (Types.ProofLinkReceipt memory receipt, bool isRevoked);

    function getReceiptByTxHash(bytes32 paymentTxHash)
        external
        view
        returns (Types.ProofLinkReceipt memory receipt, bool isRevoked);

    function revokeReceipt(bytes32 receiptId, string calldata reason) external;

    function isPaymentCompliant(bytes32 paymentTxHash) external view returns (bool isCompliant);

    function updateIpfsHash(bytes32 receiptId, bytes32 ipfsContentHash) external;

    // ──────────────────────────────────────────────
    // Simplified API
    // ──────────────────────────────────────────────

    function attest(
        bytes32 receiptHash,
        address sender,
        address receiver,
        uint256 amount,
        string calldata chain,
        uint8 status
    ) external;

    function verify(bytes32 receiptHash) external view returns (bool valid, uint256 timestamp, uint8 status);

    function revoke(bytes32 receiptHash) external;

    // ──────────────────────────────────────────────
    // Admin
    // ──────────────────────────────────────────────

    function registerSchema() external returns (bytes32 uid);

    function setRiskThreshold(uint8 threshold) external;

    function getEASAttestation(bytes32 receiptId) external view returns (bytes32);

    function getSchemaUID() external view returns (bytes32);
}
