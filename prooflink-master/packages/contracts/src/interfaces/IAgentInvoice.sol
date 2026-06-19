// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Types} from "../libraries/Types.sol";

/// @title IAgentInvoice
/// @notice Interface for the AgentInvoice on-chain anchoring contract.
interface IAgentInvoice {
    // ──────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────

    event InvoiceAnchored(
        bytes32 indexed invoiceId, address indexed issuer, address indexed recipient, uint128 amount, bytes32 contentHash
    );

    event InvoiceStateChanged(
        bytes32 indexed invoiceId, Types.InvoiceState indexed oldState, Types.InvoiceState indexed newState
    );

    event InvoiceCreated(
        bytes32 indexed invoiceHash,
        address indexed payer,
        address indexed payee,
        uint256 amount,
        string currency
    );

    event InvoicePaid(bytes32 indexed invoiceHash, bytes32 txHash);

    event InvoiceCancelled(bytes32 indexed invoiceHash, address indexed cancelledBy);

    // ──────────────────────────────────────────────
    // Full Invoice API
    // ──────────────────────────────────────────────

    function anchorInvoice(bytes32 invoiceId, bytes32 contentHash, address issuer, address recipient, uint128 amount)
        external
        returns (bytes32);

    function updateState(bytes32 invoiceId, Types.InvoiceState newState) external;

    function verifyInvoice(bytes32 invoiceId) external view returns (Types.Invoice memory invoice);

    function getInvoicesByIssuer(address issuer) external view returns (bytes32[] memory);

    function getInvoicesByRecipient(address recipient) external view returns (bytes32[] memory);

    // ──────────────────────────────────────────────
    // Simplified Invoice API
    // ──────────────────────────────────────────────

    function createInvoice(
        bytes32 invoiceHash,
        address payer,
        address payee,
        uint256 amount,
        string calldata currency
    ) external;

    function markPaid(bytes32 invoiceHash, bytes32 txHash) external;

    function getInvoice(bytes32 invoiceHash) external view returns (Types.InvoiceInfo memory info);

    function cancelInvoice(bytes32 invoiceHash) external;
}
