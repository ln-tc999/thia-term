// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import {Types} from "./libraries/Types.sol";

/// @title AgentInvoice
/// @author ProofLink
/// @notice On-chain invoice anchoring and lifecycle management for agent-to-agent commerce.
/// @dev Invoices are content-addressed (IPFS). On-chain storage is minimal: hashes,
///      amounts, parties, and state transitions. Uses UUPS proxy pattern.
contract AgentInvoice is Initializable, AccessControlUpgradeable, UUPSUpgradeable {
    using Types for Types.InvoiceState;

    // ──────────────────────────────────────────────
    // Roles
    // ──────────────────────────────────────────────

    /// @notice Role for the ProofLinkFacilitator to mark invoices as paid/settled.
    bytes32 public constant FACILITATOR_ROLE = keccak256("FACILITATOR_ROLE");

    // ──────────────────────────────────────────────
    // State
    // ──────────────────────────────────────────────

    /// @dev invoiceId => Invoice data
    mapping(bytes32 => Types.Invoice) internal _invoices;

    /// @dev issuer address => array of invoice IDs
    mapping(address => bytes32[]) internal _issuerInvoices;

    /// @dev recipient address => array of invoice IDs
    mapping(address => bytes32[]) internal _recipientInvoices;

    // ──────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────

    /// @notice Emitted when a new invoice is anchored.
    event InvoiceAnchored(
        bytes32 indexed invoiceId, address indexed issuer, address indexed recipient, uint128 amount, bytes32 contentHash
    );

    /// @notice Emitted when an invoice state changes.
    event InvoiceStateChanged(
        bytes32 indexed invoiceId, Types.InvoiceState indexed oldState, Types.InvoiceState indexed newState
    );

    /// @notice Emitted when a new invoice is created via the simplified `createInvoice` method.
    event InvoiceCreated(
        bytes32 indexed invoiceHash,
        address indexed payer,
        address indexed payee,
        uint256 amount,
        string currency
    );

    /// @notice Emitted when an invoice is marked as paid via the simplified `markPaid` method.
    event InvoicePaid(bytes32 indexed invoiceHash, bytes32 txHash);

    /// @notice Emitted when an invoice is cancelled.
    event InvoiceCancelled(bytes32 indexed invoiceHash, address indexed cancelledBy);

    // ──────────────────────────────────────────────
    // Errors
    // ──────────────────────────────────────────────

    /// @notice Zero address provided.
    error ZeroAddress();

    /// @notice Invoice already exists with this ID.
    error InvoiceAlreadyExists();

    /// @notice Invoice not found.
    error InvoiceNotFound();

    /// @notice Invalid state transition.
    error InvalidStateTransition();

    /// @notice Caller is not the invoice issuer.
    error NotIssuer();

    /// @notice Caller is not authorised to perform this state transition.
    error NotAuthorized();

    /// @notice Zero amount not allowed.
    error ZeroAmount();

    /// @notice Empty content hash.
    error EmptyContentHash();

    // ──────────────────────────────────────────────
    // Initializer
    // ──────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initialize the AgentInvoice contract.
    /// @param admin Initial admin address.
    function initialize(address admin) external initializer {
        if (admin == address(0)) revert ZeroAddress();

        __AccessControl_init();
        // UUPSUpgradeable does not require init in OZ v5

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ──────────────────────────────────────────────
    // Write Functions
    // ──────────────────────────────────────────────

    /// @notice Anchor a new invoice on-chain in DRAFT state.
    /// @dev Caller must be the issuer or hold FACILITATOR_ROLE (for platform-anchored invoices).
    ///      This prevents third parties from anchoring invoices on behalf of arbitrary addresses.
    /// @param invoiceId Unique invoice identifier.
    /// @param contentHash IPFS CID of the full JSON-LD invoice.
    /// @param issuer The invoicing party's address.
    /// @param recipient The paying party's address.
    /// @param amount Invoice total in token base units.
    /// @return The invoice ID.
    function anchorInvoice(bytes32 invoiceId, bytes32 contentHash, address issuer, address recipient, uint128 amount)
        external
        returns (bytes32)
    {
        if (issuer == address(0) || recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (contentHash == bytes32(0)) revert EmptyContentHash();
        if (_invoices[invoiceId].invoiceId != bytes32(0)) revert InvoiceAlreadyExists();
        // Caller must be the issuer or an authorised facilitator
        if (msg.sender != issuer && !hasRole(FACILITATOR_ROLE, msg.sender)) revert NotAuthorized();

        uint40 now_ = uint40(block.timestamp);

        _invoices[invoiceId] = Types.Invoice({
            invoiceId: invoiceId,
            contentHash: contentHash,
            issuer: issuer,
            recipient: recipient,
            amount: amount,
            state: Types.InvoiceState.DRAFT,
            createdAt: now_,
            issuedAt: 0,
            paidAt: 0,
            settledAt: 0,
            paymentTxHash: bytes32(0),
            proofLinkReceiptId: bytes32(0)
        });

        _issuerInvoices[issuer].push(invoiceId);
        _recipientInvoices[recipient].push(invoiceId);

        emit InvoiceAnchored(invoiceId, issuer, recipient, amount, contentHash);

        return invoiceId;
    }

    /// @notice Transition an invoice to a new state following the lifecycle state machine.
    /// @dev State machine: DRAFT -> ISSUED -> PAID -> SETTLED
    ///      Also supports: DRAFT -> CANCELLED, ISSUED -> CANCELLED,
    ///      PAID -> DISPUTED, DISPUTED -> REFUNDED
    /// @param invoiceId The invoice to update.
    /// @param newState The target state.
    function updateState(bytes32 invoiceId, Types.InvoiceState newState) external {
        Types.Invoice storage inv = _invoices[invoiceId];
        if (inv.invoiceId == bytes32(0)) revert InvoiceNotFound();

        Types.InvoiceState currentState = inv.state;

        // Validate state transition
        if (!_isValidTransition(currentState, newState)) {
            revert InvalidStateTransition();
        }

        // Access control based on transition
        if (newState == Types.InvoiceState.ISSUED) {
            // Only issuer can issue
            if (msg.sender != inv.issuer) revert NotIssuer();
            inv.issuedAt = uint40(block.timestamp);
        } else if (newState == Types.InvoiceState.PAID) {
            // Facilitator or issuer can mark as paid
            if (!hasRole(FACILITATOR_ROLE, msg.sender) && msg.sender != inv.issuer) {
                revert NotAuthorized();
            }
            inv.paidAt = uint40(block.timestamp);
        } else if (newState == Types.InvoiceState.SETTLED) {
            // Only facilitator can settle
            _checkRole(FACILITATOR_ROLE, msg.sender);
            inv.settledAt = uint40(block.timestamp);
        } else if (newState == Types.InvoiceState.CANCELLED) {
            // Only issuer can cancel
            if (msg.sender != inv.issuer) revert NotIssuer();
        } else if (newState == Types.InvoiceState.DISPUTED) {
            // Recipient or facilitator can open a dispute
            if (msg.sender != inv.recipient && !hasRole(FACILITATOR_ROLE, msg.sender)) {
                revert NotAuthorized();
            }
        } else if (newState == Types.InvoiceState.REFUNDED) {
            // Only facilitator can authorise a refund
            _checkRole(FACILITATOR_ROLE, msg.sender);
        }

        inv.state = newState;

        emit InvoiceStateChanged(invoiceId, currentState, newState);
    }

    // ──────────────────────────────────────────────
    // Read Functions
    // ──────────────────────────────────────────────

    /// @notice Get full invoice data.
    /// @param invoiceId The invoice identifier.
    /// @return invoice The full invoice data.
    function verifyInvoice(bytes32 invoiceId) external view returns (Types.Invoice memory invoice) {
        invoice = _invoices[invoiceId];
        if (invoice.invoiceId == bytes32(0)) revert InvoiceNotFound();
    }

    /// @notice Get all invoice IDs issued by an address.
    /// @param issuer The issuer address.
    /// @return Array of invoice IDs.
    function getInvoicesByIssuer(address issuer) external view returns (bytes32[] memory) {
        return _issuerInvoices[issuer];
    }

    /// @notice Get all invoice IDs received by an address.
    /// @param recipient The recipient address.
    /// @return Array of invoice IDs.
    function getInvoicesByRecipient(address recipient) external view returns (bytes32[] memory) {
        return _recipientInvoices[recipient];
    }

    // ──────────────────────────────────────────────
    // Simplified Invoice API
    // ──────────────────────────────────────────────

    /// @dev invoiceHash => simplified invoice data
    mapping(bytes32 => Types.InvoiceInfo) internal _simpleInvoices;

    /// @notice Anchor a new invoice on-chain (simplified API).
    /// @param invoiceHash Unique hash identifying the invoice.
    /// @param payer The paying party's address.
    /// @param payee The receiving party's address.
    /// @param amount Invoice amount in base units.
    /// @param currency Currency identifier (e.g., "USDC", "EURC").
    function createInvoice(
        bytes32 invoiceHash,
        address payer,
        address payee,
        uint256 amount,
        string calldata currency
    ) external {
        if (payer == address(0) || payee == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (invoiceHash == bytes32(0)) revert EmptyContentHash();
        if (_simpleInvoices[invoiceHash].createdAt != 0) revert InvoiceAlreadyExists();
        // Caller must be the payer or an authorised facilitator
        if (msg.sender != payer && !hasRole(FACILITATOR_ROLE, msg.sender)) revert NotAuthorized();

        _simpleInvoices[invoiceHash] = Types.InvoiceInfo({
            invoiceHash: invoiceHash,
            payer: payer,
            payee: payee,
            amount: amount,
            currency: currency,
            paid: false,
            txHash: bytes32(0),
            createdAt: uint40(block.timestamp),
            paidAt: 0
        });

        emit InvoiceCreated(invoiceHash, payer, payee, amount, currency);
    }

    /// @notice Mark an invoice as paid (simplified API).
    /// @param invoiceHash The invoice hash.
    /// @param txHash The payment transaction hash.
    function markPaid(bytes32 invoiceHash, bytes32 txHash) external {
        Types.InvoiceInfo storage inv = _simpleInvoices[invoiceHash];
        if (inv.createdAt == 0) revert InvoiceNotFound();
        if (inv.paid) revert InvalidStateTransition();
        // Only payee or facilitator can mark as paid
        if (msg.sender != inv.payee && !hasRole(FACILITATOR_ROLE, msg.sender)) revert NotAuthorized();

        inv.paid = true;
        inv.txHash = txHash;
        inv.paidAt = uint40(block.timestamp);

        emit InvoicePaid(invoiceHash, txHash);
    }

    /// @notice Get invoice info (simplified API).
    /// @param invoiceHash The invoice hash.
    /// @return info The invoice info.
    function getInvoice(bytes32 invoiceHash) external view returns (Types.InvoiceInfo memory info) {
        info = _simpleInvoices[invoiceHash];
        if (info.createdAt == 0) revert InvoiceNotFound();
    }

    /// @notice Cancel a simplified invoice.
    /// @param invoiceHash The invoice hash.
    function cancelInvoice(bytes32 invoiceHash) external {
        Types.InvoiceInfo storage inv = _simpleInvoices[invoiceHash];
        if (inv.createdAt == 0) revert InvoiceNotFound();
        if (inv.paid) revert InvalidStateTransition();
        if (msg.sender != inv.payer && !hasRole(FACILITATOR_ROLE, msg.sender)) revert NotAuthorized();

        // Zero out the invoice to mark as cancelled
        delete _simpleInvoices[invoiceHash];

        emit InvoiceCancelled(invoiceHash, msg.sender);
    }

    // ──────────────────────────────────────────────
    // Internal
    // ──────────────────────────────────────────────

    /// @dev Validate state machine transitions.
    /// @param from Current state.
    /// @param to Target state.
    /// @return True if the transition is valid.
    function _isValidTransition(Types.InvoiceState from, Types.InvoiceState to) internal pure returns (bool) {
        if (from == Types.InvoiceState.DRAFT) {
            return to == Types.InvoiceState.ISSUED || to == Types.InvoiceState.CANCELLED;
        }
        if (from == Types.InvoiceState.ISSUED) {
            return to == Types.InvoiceState.PAID || to == Types.InvoiceState.CANCELLED;
        }
        if (from == Types.InvoiceState.PAID) {
            return to == Types.InvoiceState.SETTLED || to == Types.InvoiceState.DISPUTED;
        }
        if (from == Types.InvoiceState.DISPUTED) {
            return to == Types.InvoiceState.REFUNDED;
        }
        return false;
    }

    // ──────────────────────────────────────────────
    // Storage Gap
    // ──────────────────────────────────────────────

    /// @dev Reserved storage for future upgrades.
    uint256[50] private __gap;

    /// @dev Authorize UUPS proxy upgrades to DEFAULT_ADMIN_ROLE holders only.
    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
