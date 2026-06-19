// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import {
    IEAS,
    AttestationRequest,
    AttestationRequestData,
    RevocationRequest,
    RevocationRequestData,
    MultiAttestationRequest,
    Attestation
} from "./interfaces/IEAS.sol";
import {ISchemaRegistry} from "./interfaces/IEAS.sol";
import {Types, SANCTIONS_MATCH_MASK} from "./libraries/Types.sol";

/// @title ProofLinkRegistry
/// @author ProofLink
/// @notice EAS-integrated compliance receipt registry. Anchors cryptographically
///         signed compliance receipts on-chain as Ethereum Attestation Service attestations.
/// @dev Uses UUPS proxy pattern. Each receipt maps a payment transaction to its
///      compliance checks. Full receipt data is stored on IPFS; only hashes are on-chain.
contract ProofLinkRegistry is Initializable, AccessControlUpgradeable, UUPSUpgradeable {
    // ──────────────────────────────────────────────
    // Roles
    // ──────────────────────────────────────────────

    /// @notice Role for addresses authorized to anchor compliance receipts.
    bytes32 public constant ATTESTER_ROLE = keccak256("ATTESTER_ROLE");

    // ──────────────────────────────────────────────
    // State
    // ──────────────────────────────────────────────

    /// @notice EAS contract reference (0x4200...0021 on Base).
    IEAS public eas;

    /// @notice EAS SchemaRegistry contract reference (0x4200...0020 on Base).
    ISchemaRegistry public schemaRegistry;

    /// @notice EAS schema UID for ProofLink compliance receipts.
    bytes32 public schemaUID;

    /// @notice Maximum acceptable AML risk score (0-100). Default: 50.
    uint8 public riskThreshold;

    /// @notice EAS schema string matching the ProofLink compliance receipt format.
    string public constant SCHEMA_STRING =
        "bytes32 receiptId, bytes32 paymentTxHash, uint64 chainId, "
        "address payer, address payee, uint128 amount, address token, "
        "bytes32 ipfsContentHash, uint8 riskScore, uint16 sanctionsFlags, "
        "bool travelRuleCompliant";

    /// @dev receiptId => full receipt data
    mapping(bytes32 => Types.ProofLinkReceipt) internal _receipts;

    /// @dev receiptId => EAS attestation UID
    mapping(bytes32 => bytes32) public receiptToEAS;

    /// @dev paymentTxHash => receiptId
    mapping(bytes32 => bytes32) public txHashToReceipt;

    /// @dev receiptId => revoked flag
    mapping(bytes32 => bool) public revoked;

    // ──────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────

    /// @notice Emitted when a new compliance receipt is anchored.
    event ReceiptAnchored(
        bytes32 indexed receiptId, address indexed payer, address indexed payee, bytes32 easAttestationUID
    );

    /// @notice Emitted when a compliance attestation is recorded via the simplified `attest` method.
    event ComplianceAttested(
        bytes32 indexed receiptHash,
        address indexed sender,
        address indexed receiver,
        uint256 amount,
        string chain,
        uint8 status
    );

    /// @notice Emitted when a receipt is revoked.
    event ReceiptRevoked(bytes32 indexed receiptId, address indexed revokedBy, string reason);

    /// @notice Emitted when an attestation is revoked via the simplified `revoke` method.
    event AttestationRevoked(bytes32 indexed receiptHash, address indexed revokedBy);

    /// @notice Emitted when the EAS schema is registered.
    event SchemaRegistered(bytes32 indexed schemaUID);

    /// @notice Emitted when the risk threshold is updated.
    event RiskThresholdUpdated(uint8 oldThreshold, uint8 newThreshold);

    /// @notice Emitted when the IPFS content hash for a receipt is updated.
    event ReceiptIpfsUpdated(bytes32 indexed receiptId, bytes32 ipfsContentHash);

    // ──────────────────────────────────────────────
    // Errors
    // ──────────────────────────────────────────────

    /// @notice Schema has already been registered.
    error SchemaAlreadyRegistered();

    /// @notice Schema has not been registered yet.
    error SchemaNotRegistered();

    /// @notice Receipt with this ID already exists.
    error ReceiptAlreadyExists();

    /// @notice Receipt not found.
    error ReceiptNotFound();

    /// @notice Receipt has been revoked.
    error ReceiptAlreadyRevoked();

    /// @notice Risk score exceeds maximum (100).
    error InvalidRiskScore();

    /// @notice Invalid status value (must be 0-2).
    error InvalidStatus();

    /// @notice Risk threshold exceeds maximum (100).
    error InvalidRiskThreshold();

    /// @notice Zero address provided.
    error ZeroAddress();

    /// @notice IPFS content hash is empty (zero bytes32).
    error InvalidIpfsHash();

    /// @notice A receipt already exists for this payment tx hash.
    error DuplicateReceipt();

    // ──────────────────────────────────────────────
    // Initializer
    // ──────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initialize the ProofLinkRegistry.
    /// @param eas_ EAS contract address.
    /// @param schemaRegistry_ EAS SchemaRegistry contract address.
    /// @param admin Initial admin address (receives DEFAULT_ADMIN_ROLE and ATTESTER_ROLE).
    function initialize(address eas_, address schemaRegistry_, address admin) external initializer {
        if (eas_ == address(0) || schemaRegistry_ == address(0) || admin == address(0)) {
            revert ZeroAddress();
        }

        __AccessControl_init();
        // UUPSUpgradeable does not require init in OZ v5

        eas = IEAS(eas_);
        schemaRegistry = ISchemaRegistry(schemaRegistry_);
        riskThreshold = 50;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ATTESTER_ROLE, admin);
    }

    // ──────────────────────────────────────────────
    // Admin Functions
    // ──────────────────────────────────────────────

    /// @notice Register the ProofLink compliance receipt schema on EAS.
    /// @dev Only callable once by DEFAULT_ADMIN_ROLE.
    /// @return uid The registered schema UID.
    function registerSchema() external onlyRole(DEFAULT_ADMIN_ROLE) returns (bytes32 uid) {
        if (schemaUID != bytes32(0)) revert SchemaAlreadyRegistered();

        uid = schemaRegistry.register(SCHEMA_STRING, address(this), true);
        schemaUID = uid;

        emit SchemaRegistered(uid);
    }

    /// @notice Set the maximum acceptable risk score for compliance checks.
    /// @param threshold New risk threshold (0-100).
    function setRiskThreshold(uint8 threshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (threshold > 100) revert InvalidRiskThreshold();
        uint8 old = riskThreshold;
        riskThreshold = threshold;
        emit RiskThresholdUpdated(old, threshold);
    }

    // ──────────────────────────────────────────────
    // Write Functions
    // ──────────────────────────────────────────────

    /// @notice Anchor a single compliance receipt and create an EAS attestation.
    /// @param receiptId Unique receipt identifier (keccak256(paymentTxHash, chainId, timestamp)).
    /// @param paymentTxHash The settled payment transaction hash.
    /// @param chainId Chain where the payment settled.
    /// @param payer Wallet that signed the payment.
    /// @param payee Wallet that received funds.
    /// @param amount Payment amount in token base units.
    /// @param token ERC-20 token address (USDC, EURC).
    /// @param ipfsContentHash IPFS CID of the full compliance report JSON.
    /// @param riskScore AML risk score (0-100, 0 = clean).
    /// @param sanctionsFlags Bitmask: bit0=OFAC, bit1=EU, bit2=UN, bit3=HMT.
    /// @param travelRuleCompliant Whether FATF Travel Rule was satisfied.
    /// @return easUID The EAS attestation UID.
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
    ) external onlyRole(ATTESTER_ROLE) returns (bytes32 easUID) {
        if (schemaUID == bytes32(0)) revert SchemaNotRegistered();
        if (receiptToEAS[receiptId] != bytes32(0)) revert ReceiptAlreadyExists();
        if (txHashToReceipt[paymentTxHash] != bytes32(0)) revert DuplicateReceipt();
        if (riskScore > 100) revert InvalidRiskScore();

        // ABI-encode data matching SCHEMA_STRING
        bytes memory encodedData = abi.encode(
            receiptId, paymentTxHash, chainId, payer, payee, amount, token, ipfsContentHash, riskScore, sanctionsFlags, travelRuleCompliant
        );

        // Create EAS attestation
        easUID = eas.attest(
            AttestationRequest({
                schema: schemaUID,
                data: AttestationRequestData({
                    recipient: payee,
                    expirationTime: 0,
                    revocable: true,
                    refUID: bytes32(0),
                    data: encodedData,
                    value: 0
                })
            })
        );

        // Store receipt
        _receipts[receiptId] = Types.ProofLinkReceipt({
            receiptId: receiptId,
            paymentTxHash: paymentTxHash,
            chainId: chainId,
            payer: payer,
            payee: payee,
            amount: amount,
            token: token,
            ipfsContentHash: ipfsContentHash,
            riskScore: riskScore,
            sanctionsFlags: sanctionsFlags,
            travelRuleCompliant: travelRuleCompliant,
            timestamp: uint40(block.timestamp),
            easAttestationUID: easUID
        });

        receiptToEAS[receiptId] = easUID;
        txHashToReceipt[paymentTxHash] = receiptId;

        emit ReceiptAnchored(receiptId, payer, payee, easUID);
    }

    /// @notice Update the IPFS content hash for an existing receipt.
    /// @dev Allows the off-chain engine to backfill the IPFS CID after settlement anchoring.
    ///      Only callable by ATTESTER_ROLE. Cannot update a revoked receipt.
    /// @param receiptId The receipt to update.
    /// @param ipfsContentHash The new IPFS content hash.
    function updateIpfsHash(bytes32 receiptId, bytes32 ipfsContentHash) external onlyRole(ATTESTER_ROLE) {
        if (ipfsContentHash == bytes32(0)) revert InvalidIpfsHash();
        bytes32 easUID = receiptToEAS[receiptId];
        if (easUID == bytes32(0)) revert ReceiptNotFound();
        if (revoked[receiptId]) revert ReceiptAlreadyRevoked();

        _receipts[receiptId].ipfsContentHash = ipfsContentHash;

        emit ReceiptIpfsUpdated(receiptId, ipfsContentHash);
    }

    /// @notice Revoke a previously anchored receipt and its EAS attestation.
    /// @param receiptId The receipt to revoke.
    /// @param reason Human-readable revocation reason.
    function revokeReceipt(bytes32 receiptId, string calldata reason) external onlyRole(DEFAULT_ADMIN_ROLE) {
        bytes32 easUID = receiptToEAS[receiptId];
        if (easUID == bytes32(0)) revert ReceiptNotFound();
        if (revoked[receiptId]) revert ReceiptAlreadyRevoked();

        revoked[receiptId] = true;

        eas.revoke(RevocationRequest({schema: schemaUID, data: RevocationRequestData({uid: easUID, value: 0})}));

        emit ReceiptRevoked(receiptId, msg.sender, reason);
    }

    // ──────────────────────────────────────────────
    // Read Functions
    // ──────────────────────────────────────────────

    /// @notice Look up a receipt by its ID.
    /// @dev Reverts if the receipt does not exist. Callers must separately check
    ///      `revoked[receiptId]` or use `isPaymentCompliant` if they need validity.
    /// @param receiptId The receipt identifier.
    /// @return receipt The full compliance receipt data.
    /// @return isRevoked True if the receipt has been revoked.
    function verifyReceipt(bytes32 receiptId)
        external
        view
        returns (Types.ProofLinkReceipt memory receipt, bool isRevoked)
    {
        receipt = _receipts[receiptId];
        if (receipt.receiptId == bytes32(0)) revert ReceiptNotFound();
        isRevoked = revoked[receiptId];
    }

    /// @notice Look up a receipt by the payment transaction hash.
    /// @param paymentTxHash The payment tx hash.
    /// @return receipt The full compliance receipt data.
    /// @return isRevoked True if the receipt has been revoked.
    function getReceiptByTxHash(bytes32 paymentTxHash)
        external
        view
        returns (Types.ProofLinkReceipt memory receipt, bool isRevoked)
    {
        bytes32 rid = txHashToReceipt[paymentTxHash];
        if (rid == bytes32(0)) revert ReceiptNotFound();
        receipt = _receipts[rid];
        isRevoked = revoked[rid];
    }

    /// @notice Check whether a payment has a valid (non-revoked) compliance receipt.
    /// @param paymentTxHash The settled payment tx hash.
    /// @return isCompliant True if receipt exists, is not revoked, and risk < threshold.
    function isPaymentCompliant(bytes32 paymentTxHash) external view returns (bool isCompliant) {
        bytes32 rid = txHashToReceipt[paymentTxHash];
        if (rid == bytes32(0)) return false;
        if (revoked[rid]) return false;
        Types.ProofLinkReceipt storage receipt = _receipts[rid];
        if (receipt.riskScore > riskThreshold) return false;
        // Sanctions match bits (bits 8-11) must be zero for compliance
        if ((receipt.sanctionsFlags & SANCTIONS_MATCH_MASK) != 0) return false;
        return true;
    }

    /// @notice Get the EAS attestation UID for a receipt.
    /// @param receiptId The receipt identifier.
    /// @return The EAS attestation UID.
    function getEASAttestation(bytes32 receiptId) external view returns (bytes32) {
        return receiptToEAS[receiptId];
    }

    /// @notice Return the EAS schema UID used by this registry.
    function getSchemaUID() external view returns (bytes32) {
        return schemaUID;
    }

    // ──────────────────────────────────────────────
    // Simplified API (requested convenience methods)
    // ──────────────────────────────────────────────

    /// @dev receiptHash => simplified attestation data
    mapping(bytes32 => Types.SimpleAttestation) internal _simpleAttestations;

    /// @notice Record a compliance decision on-chain (simplified API).
    /// @param receiptHash Keccak256 hash of the compliance receipt.
    /// @param sender The payment sender address.
    /// @param receiver The payment receiver address.
    /// @param amount Payment amount in base units.
    /// @param chain Chain identifier (e.g., "base", "ethereum").
    /// @param status Compliance status: 0=APPROVED, 1=REJECTED, 2=ESCALATED.
    function attest(
        bytes32 receiptHash,
        address sender,
        address receiver,
        uint256 amount,
        string calldata chain,
        uint8 status
    ) external onlyRole(ATTESTER_ROLE) {
        if (receiptHash == bytes32(0)) revert ReceiptNotFound();
        if (sender == address(0) || receiver == address(0)) revert ZeroAddress();
        if (status > 2) revert InvalidStatus();
        if (_simpleAttestations[receiptHash].timestamp != 0) revert ReceiptAlreadyExists();

        _simpleAttestations[receiptHash] = Types.SimpleAttestation({
            receiptHash: receiptHash,
            sender: sender,
            receiver: receiver,
            amount: amount,
            chain: chain,
            status: status,
            timestamp: uint40(block.timestamp),
            revoked: false
        });

        emit ComplianceAttested(receiptHash, sender, receiver, amount, chain, status);
    }

    /// @notice Check if a receipt hash has a valid attestation (simplified API).
    /// @param receiptHash The receipt hash to verify.
    /// @return valid True if attested and not revoked.
    /// @return timestamp The attestation timestamp.
    /// @return status The compliance status (0=APPROVED, 1=REJECTED, 2=ESCALATED).
    function verify(bytes32 receiptHash) external view returns (bool valid, uint256 timestamp, uint8 status) {
        Types.SimpleAttestation storage att = _simpleAttestations[receiptHash];
        if (att.timestamp == 0) {
            return (false, 0, 0);
        }
        valid = !att.revoked;
        timestamp = att.timestamp;
        status = att.status;
    }

    /// @notice Revoke a simplified attestation (admin only).
    /// @param receiptHash The receipt hash to revoke.
    function revoke(bytes32 receiptHash) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Types.SimpleAttestation storage att = _simpleAttestations[receiptHash];
        if (att.timestamp == 0) revert ReceiptNotFound();
        if (att.revoked) revert ReceiptAlreadyRevoked();

        att.revoked = true;

        emit AttestationRevoked(receiptHash, msg.sender);
    }

    // ──────────────────────────────────────────────
    // Internal
    // ──────────────────────────────────────────────

    // ──────────────────────────────────────────────
    // Storage Gap
    // ──────────────────────────────────────────────

    /// @dev Reserved storage for future upgrades.
    uint256[50] private __gap;

    /// @dev Authorize UUPS proxy upgrades to DEFAULT_ADMIN_ROLE holders only.
    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
