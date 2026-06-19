// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Types} from "../libraries/Types.sol";

/// @title IProofLinkFacilitator
/// @notice Interface for the ProofLink x402 compliance-gated facilitator.
interface IProofLinkFacilitator {
    // ──────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────

    event PaymentFacilitated(
        address indexed sender, address indexed receiver, uint256 amount, bytes32 proofLinkReceipt
    );

    event PaymentBlocked(address indexed sender, address indexed receiver, uint256 amount, string reason);

    event PaymentSettled(
        bytes32 indexed settlementId,
        address indexed payer,
        address indexed payee,
        address token,
        uint128 amount,
        bytes32 proofLinkReceiptId
    );

    event ComplianceCheckFailed(address indexed payer, address indexed payee, uint128 amount, string reason);

    event RiskThresholdUpdated(uint8 oldThreshold, uint8 newThreshold);

    event FailModeChanged(bool failClosed);

    event SpendingLimitSet(address indexed agent, uint128 limit);

    // ──────────────────────────────────────────────
    // Simplified Facilitation
    // ──────────────────────────────────────────────

    function facilitate(address sender, address receiver, uint256 amount, bytes32 proofLinkReceipt)
        external
        returns (bool success);

    // ──────────────────────────────────────────────
    // Full Settlement API
    // ──────────────────────────────────────────────

    function verify(Types.PaymentPayload calldata payload, Types.ComplianceAttestation calldata compliance)
        external
        view
        returns (bool isCompliant, string memory reason);

    function settle(Types.PaymentPayload calldata payload, Types.ComplianceAttestation calldata compliance)
        external
        returns (bytes32 settlementId);

    function getSettlement(bytes32 settlementId) external view returns (Types.SettlementRecord memory);

    function isNonceUsed(uint256 nonce) external view returns (bool);

    function getRemainingDailyLimit(address agent) external view returns (uint128 remaining);

    // ──────────────────────────────────────────────
    // Admin
    // ──────────────────────────────────────────────

    function setSpendingLimit(address agent, uint128 limit) external;

    function setRiskThreshold(uint8 threshold) external;

    function setFailMode(bool failClosed_) external;

    function setContractAddresses(address proofLinkRegistry_, address kyaContract_) external;

    function pause() external;

    function unpause() external;
}
