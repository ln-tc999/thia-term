// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import {Types, SANCTIONS_MATCH_MASK} from "./libraries/Types.sol";
import {ProofLinkRegistry} from "./ProofLinkRegistry.sol";
import {ProofLinkKYA} from "./ProofLinkKYA.sol";

/// @title ProofLinkFacilitator
/// @author ProofLink
/// @notice x402 compliance-gated facilitator. Verifies compliance before x402 verify,
///         executes settlement only if compliant, and anchors ProofLink receipts.
/// @dev Uses UUPS proxy pattern. Can be configured to fail-open or fail-closed.
///      Integrates with ProofLinkRegistry for receipt anchoring and ProofLinkKYA for
///      agent credential verification.
contract ProofLinkFacilitator is
    Initializable,
    AccessControlUpgradeable,
    UUPSUpgradeable,
    PausableUpgradeable,
    ReentrancyGuard
{
    // ──────────────────────────────────────────────
    // Roles
    // ──────────────────────────────────────────────

    /// @notice Role for addresses authorized to execute settlements.
    bytes32 public constant SETTLER_ROLE = keccak256("SETTLER_ROLE");

    /// @notice Role for emergency pause operations.
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // ──────────────────────────────────────────────
    // State
    // ──────────────────────────────────────────────

    /// @notice ProofLink compliance receipt registry.
    ProofLinkRegistry public proofLinkRegistry;

    /// @notice KYA credential management contract.
    ProofLinkKYA public kyaContract;

    /// @notice Maximum AML risk score accepted for settlement (0-100).
    uint8 public riskThreshold;

    /// @notice When true, compliance failures cause settlement to revert.
    ///         When false, settlement proceeds but logs a warning event.
    bool public failClosed;

    /// @dev nonce => used flag (replay prevention)
    mapping(uint256 => bool) internal _usedNonces;

    /// @dev settlementId => settlement record
    mapping(bytes32 => Types.SettlementRecord) internal _settlements;

    /// @dev agent address => daily spending tracker (dayNumber => spent)
    mapping(address => mapping(uint256 => uint128)) internal _dailySpent;

    /// @dev agent address => daily spending limit (0 = unlimited)
    mapping(address => uint128) public spendingLimits;

    // ──────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────

    /// @notice Emitted when a payment is settled.
    event PaymentSettled(
        bytes32 indexed settlementId,
        address indexed payer,
        address indexed payee,
        address token,
        uint128 amount,
        bytes32 proofLinkReceiptId
    );

    /// @notice Emitted when a compliant payment is facilitated via the simplified `facilitate` method.
    event PaymentFacilitated(
        address indexed sender, address indexed receiver, uint256 amount, bytes32 proofLinkReceipt
    );

    /// @notice Emitted when a payment is blocked during facilitation.
    event PaymentBlocked(address indexed sender, address indexed receiver, uint256 amount, string reason);

    /// @notice Emitted when a compliance check fails during verify.
    event ComplianceCheckFailed(address indexed payer, address indexed payee, uint128 amount, string reason);

    /// @notice Emitted when the risk threshold is updated.
    event RiskThresholdUpdated(uint8 oldThreshold, uint8 newThreshold);

    /// @notice Emitted when fail-open/fail-closed mode changes.
    event FailModeChanged(bool failClosed);

    /// @notice Emitted when a spending limit is set for an agent.
    event SpendingLimitSet(address indexed agent, uint128 limit);

    /// @notice Emitted when contract addresses are updated.
    event ContractAddressesUpdated(address proofLinkRegistry, address kyaContract);

    // ──────────────────────────────────────────────
    // Errors
    // ──────────────────────────────────────────────

    /// @notice Zero address provided.
    error ZeroAddress();

    /// @notice Nonce has already been used (replay attack).
    error NonceAlreadyUsed();

    /// @notice Settlement deadline has passed.
    error DeadlineExpired();

    /// @notice Sanctions flags indicate a hit — settlement blocked.
    error SanctionsHit();

    /// @notice AML risk score exceeds threshold.
    error RiskScoreTooHigh();

    /// @notice Agent KYA verification failed.
    error KYAVerificationFailed();

    /// @notice Settlement not found.
    error SettlementNotFound();

    /// @notice Daily spending limit exceeded for agent.
    error SpendingLimitExceeded();

    /// @notice Invalid risk threshold (must be 0-100).
    error InvalidRiskThreshold();

    /// @notice Payment amount is zero.
    error ZeroAmount();

    /// @notice Amount exceeds uint128 max.
    error AmountExceedsUint128Max();

    // ──────────────────────────────────────────────
    // Initializer
    // ──────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initialize the ProofLinkFacilitator.
    /// @param proofLinkRegistry_ ProofLink compliance receipt registry address.
    /// @param kyaContract_ ProofLinkKYA credential contract address.
    /// @param admin Initial admin address.
    function initialize(address proofLinkRegistry_, address kyaContract_, address admin) external initializer {
        if (proofLinkRegistry_ == address(0) || kyaContract_ == address(0) || admin == address(0)) {
            revert ZeroAddress();
        }

        __AccessControl_init();
        // UUPSUpgradeable does not require init in OZ v5
        __Pausable_init();
        // OZ v5 ReentrancyGuard uses ERC-7201 namespaced storage (slot-based).
        // Uninitialized (0) is safe: _nonReentrantBefore only reverts when value == ENTERED (2).
        // First nonReentrant call transitions 0 -> 2 -> 1 correctly.

        proofLinkRegistry = ProofLinkRegistry(proofLinkRegistry_);
        kyaContract = ProofLinkKYA(kyaContract_);
        riskThreshold = 50;
        failClosed = true; // Default: fail-closed (block non-compliant payments)

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(SETTLER_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    // ──────────────────────────────────────────────
    // Compliance Verification
    // ──────────────────────────────────────────────

    /// @notice Verify compliance for a payment payload before x402 verify.
    /// @dev Checks: sanctions, risk score, KYA credential, spending limits.
    ///      Does NOT execute settlement — only validates.
    /// @param payload The payment payload to verify.
    /// @param compliance The compliance attestation from the off-chain engine.
    /// @return isCompliant True if all compliance checks pass.
    /// @return reason Empty string if compliant, otherwise the failure reason.
    function verify(Types.PaymentPayload calldata payload, Types.ComplianceAttestation calldata compliance)
        external
        view
        returns (bool isCompliant, string memory reason)
    {
        // Check sanctions flags (bits 8-11 are match indicators)
        if ((compliance.sanctionsFlags & SANCTIONS_MATCH_MASK) != 0) {
            return (false, "SANCTIONS_HIT");
        }

        // Check risk score
        if (compliance.riskScore > riskThreshold) {
            return (false, "RISK_TOO_HIGH");
        }

        // Check KYA if attestation says it should be verified
        if (compliance.kyaVerified) {
            (bool kyaValid,,) = kyaContract.verifyKYA(payload.payer);
            if (!kyaValid) {
                return (false, "KYA_INVALID");
            }
        }

        // Check spending limits
        uint128 limit = spendingLimits[payload.payer];
        if (limit > 0) {
            uint256 dayNumber = block.timestamp / 1 days;
            uint128 spent = _dailySpent[payload.payer][dayNumber];
            if (spent + payload.amount > limit) {
                return (false, "SPENDING_LIMIT_EXCEEDED");
            }
        }

        return (true, "");
    }

    // ──────────────────────────────────────────────
    // Settlement
    // ──────────────────────────────────────────────

    /// @notice Execute settlement only if compliant. Anchors a ProofLink receipt.
    /// @dev Only callable by SETTLER_ROLE. Runs compliance checks, then records settlement
    ///      and anchors the compliance receipt in ProofLinkRegistry.
    /// @param payload The payment payload.
    /// @param compliance The compliance attestation from the off-chain engine.
    /// @return settlementId The unique settlement identifier.
    function settle(Types.PaymentPayload calldata payload, Types.ComplianceAttestation calldata compliance)
        external
        onlyRole(SETTLER_ROLE)
        whenNotPaused
        nonReentrant
        returns (bytes32 settlementId)
    {
        if (payload.amount == 0) revert ZeroAmount();
        if (_usedNonces[payload.nonce]) revert NonceAlreadyUsed();
        if (payload.deadline != 0 && block.timestamp > payload.deadline) revert DeadlineExpired();

        // Run compliance checks
        bool compliancePassed = _enforceCompliance(payload, compliance);

        // Mark nonce as used (before external calls — CEI pattern)
        _usedNonces[payload.nonce] = true;

        // Generate settlement ID
        settlementId = keccak256(abi.encodePacked(payload.paymentHash, payload.nonce, block.timestamp));

        // Record daily spend
        uint256 dayNumber = block.timestamp / 1 days;
        _dailySpent[payload.payer][dayNumber] += payload.amount;

        // Store settlement record
        _settlements[settlementId] = Types.SettlementRecord({
            settlementId: settlementId,
            payer: payload.payer,
            payee: payload.payee,
            token: payload.token,
            amount: payload.amount,
            settledAt: uint40(block.timestamp),
            proofLinkReceiptId: compliance.proofLinkReceiptId
        });

        // Anchor compliance receipt in ProofLinkRegistry only if compliance passed.
        // In fail-open mode, skip anchoring to avoid recording non-compliant receipts.
        if (compliancePassed) {
            proofLinkRegistry.anchorReceipt(
                compliance.proofLinkReceiptId,
                payload.paymentHash,
                payload.chainId,
                payload.payer,
                payload.payee,
                payload.amount,
                payload.token,
                bytes32(0), // IPFS hash set by off-chain engine later
                compliance.riskScore,
                compliance.sanctionsFlags,
                compliance.travelRuleCompliant
            );
        }

        emit PaymentSettled(
            settlementId, payload.payer, payload.payee, payload.token, payload.amount, compliance.proofLinkReceiptId
        );
    }

    // ──────────────────────────────────────────────
    // Read Functions
    // ──────────────────────────────────────────────

    /// @notice Get a settlement record.
    /// @param settlementId The settlement identifier.
    /// @return The settlement record.
    function getSettlement(bytes32 settlementId) external view returns (Types.SettlementRecord memory) {
        Types.SettlementRecord memory record = _settlements[settlementId];
        if (record.settlementId == bytes32(0)) revert SettlementNotFound();
        return record;
    }

    /// @notice Check if a nonce has been used.
    /// @param nonce The nonce to check.
    /// @return True if the nonce has been used.
    function isNonceUsed(uint256 nonce) external view returns (bool) {
        return _usedNonces[nonce];
    }

    /// @notice Get the remaining daily spending allowance for an agent.
    /// @param agent The agent address.
    /// @return remaining The remaining daily allowance. Returns type(uint128).max if unlimited.
    function getRemainingDailyLimit(address agent) external view returns (uint128 remaining) {
        uint128 limit = spendingLimits[agent];
        if (limit == 0) return type(uint128).max;
        uint256 dayNumber = block.timestamp / 1 days;
        uint128 spent = _dailySpent[agent][dayNumber];
        if (spent >= limit) return 0;
        return limit - spent;
    }

    // ──────────────────────────────────────────────
    // Simplified Facilitation API
    // ──────────────────────────────────────────────

    /// @notice Facilitate a compliant payment via the simplified x402 compliance gate.
    /// @dev Checks ProofLinkRegistry for a valid attestation before allowing the payment.
    ///      Uses the simplified `verify` method on ProofLinkRegistry.
    /// @param sender The payment sender address.
    /// @param receiver The payment receiver address.
    /// @param amount Payment amount in base units.
    /// @param proofLinkReceipt The ProofLink receipt hash to verify compliance.
    /// @return success True if the payment was facilitated successfully.
    function facilitate(address sender, address receiver, uint256 amount, bytes32 proofLinkReceipt)
        external
        onlyRole(SETTLER_ROLE)
        whenNotPaused
        nonReentrant
        returns (bool success)
    {
        if (sender == address(0) || receiver == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        // Verify compliance attestation via ProofLinkRegistry
        (bool valid, , uint8 status) = proofLinkRegistry.verify(proofLinkReceipt);

        if (!valid || status != 0) {
            // status 0 = APPROVED
            if (failClosed) {
                emit PaymentBlocked(sender, receiver, amount, "ATTESTATION_INVALID");
                revert SanctionsHit();
            }
            emit PaymentBlocked(sender, receiver, amount, "ATTESTATION_INVALID");
            return false;
        }

        // Check spending limits
        uint128 limit = spendingLimits[sender];
        if (limit > 0) {
            if (amount > type(uint128).max) revert AmountExceedsUint128Max();
            uint256 dayNumber = block.timestamp / 1 days;
            uint128 spent = _dailySpent[sender][dayNumber];
            if (spent + uint128(amount) > limit) {
                if (failClosed) revert SpendingLimitExceeded();
                emit PaymentBlocked(sender, receiver, amount, "SPENDING_LIMIT_EXCEEDED");
                return false;
            }
            _dailySpent[sender][dayNumber] += uint128(amount);
        }

        emit PaymentFacilitated(sender, receiver, amount, proofLinkReceipt);
        return true;
    }

    // ──────────────────────────────────────────────
    // Admin Functions
    // ──────────────────────────────────────────────

    /// @notice Set the daily spending limit for an agent address.
    /// @param agent The agent address.
    /// @param limit The daily spending limit (0 = unlimited).
    function setSpendingLimit(address agent, uint128 limit) external onlyRole(DEFAULT_ADMIN_ROLE) {
        spendingLimits[agent] = limit;
        emit SpendingLimitSet(agent, limit);
    }

    /// @notice Set the maximum acceptable AML risk score.
    /// @param threshold New risk threshold (0-100).
    function setRiskThreshold(uint8 threshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (threshold > 100) revert InvalidRiskThreshold();
        uint8 old = riskThreshold;
        riskThreshold = threshold;
        emit RiskThresholdUpdated(old, threshold);
    }

    /// @notice Toggle fail-open / fail-closed mode.
    /// @param failClosed_ True for fail-closed (revert on compliance failure),
    ///                     false for fail-open (log warning, proceed).
    function setFailMode(bool failClosed_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        failClosed = failClosed_;
        emit FailModeChanged(failClosed_);
    }

    /// @notice Update contract references.
    /// @param proofLinkRegistry_ New ProofLink registry address.
    /// @param kyaContract_ New KYA contract address.
    function setContractAddresses(address proofLinkRegistry_, address kyaContract_)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (proofLinkRegistry_ == address(0) || kyaContract_ == address(0)) revert ZeroAddress();
        proofLinkRegistry = ProofLinkRegistry(proofLinkRegistry_);
        kyaContract = ProofLinkKYA(kyaContract_);
        emit ContractAddressesUpdated(proofLinkRegistry_, kyaContract_);
    }

    /// @notice Pause all settlements (emergency kill switch).
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @notice Resume settlements.
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ──────────────────────────────────────────────
    // Internal
    // ──────────────────────────────────────────────

    /// @dev Enforce compliance checks. Reverts if fail-closed and checks fail.
    ///      Emits ComplianceCheckFailed if fail-open and checks fail.
    /// @return passed True if all compliance checks passed; false if fail-open and a check failed.
    function _enforceCompliance(
        Types.PaymentPayload calldata payload,
        Types.ComplianceAttestation calldata compliance
    ) internal returns (bool passed) {
        // Check sanctions (bits 8-11 are match indicators)
        if ((compliance.sanctionsFlags & SANCTIONS_MATCH_MASK) != 0) {
            if (failClosed) revert SanctionsHit();
            emit ComplianceCheckFailed(payload.payer, payload.payee, payload.amount, "SANCTIONS_HIT");
            return false;
        }

        // Check risk score
        if (compliance.riskScore > riskThreshold) {
            if (failClosed) revert RiskScoreTooHigh();
            emit ComplianceCheckFailed(payload.payer, payload.payee, payload.amount, "RISK_TOO_HIGH");
            return false;
        }

        // Check KYA if required
        if (compliance.kyaVerified) {
            (bool kyaValid,,) = kyaContract.verifyKYA(payload.payer);
            if (!kyaValid) {
                if (failClosed) revert KYAVerificationFailed();
                emit ComplianceCheckFailed(payload.payer, payload.payee, payload.amount, "KYA_INVALID");
                return false;
            }
        }

        // Check spending limits
        uint128 limit = spendingLimits[payload.payer];
        if (limit > 0) {
            uint256 dayNumber = block.timestamp / 1 days;
            uint128 spent = _dailySpent[payload.payer][dayNumber];
            if (spent + payload.amount > limit) {
                if (failClosed) revert SpendingLimitExceeded();
                emit ComplianceCheckFailed(payload.payer, payload.payee, payload.amount, "SPENDING_LIMIT_EXCEEDED");
                return false;
            }
        }

        return true;
    }

    // ──────────────────────────────────────────────
    // Storage Gap
    // ──────────────────────────────────────────────

    /// @dev Reserved storage for future upgrades.
    uint256[50] private __gap;

    /// @dev Authorize UUPS proxy upgrades to DEFAULT_ADMIN_ROLE holders only.
    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
