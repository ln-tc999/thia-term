// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test, console2} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {AgentInvoice} from "../src/AgentInvoice.sol";
import {Types} from "../src/libraries/Types.sol";

contract AgentInvoiceTest is Test {
    AgentInvoice public invoice;

    address public admin = makeAddr("admin");
    address public issuer = makeAddr("issuer");
    address public recipient = makeAddr("recipient");
    address public facilitator = makeAddr("facilitator");
    address public unauthorized = makeAddr("unauthorized");

    bytes32 public invoiceId = keccak256("invoice-001");
    bytes32 public contentHash = keccak256("ipfs-content-hash");
    uint128 public amount = 5_000_000_000; // 5000 USDC

    function setUp() public {
        AgentInvoice impl = new AgentInvoice();
        bytes memory initData = abi.encodeCall(AgentInvoice.initialize, (admin));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        invoice = AgentInvoice(address(proxy));

        // Grant facilitator role
        bytes32 facilitatorRole = invoice.FACILITATOR_ROLE();
        vm.prank(admin);
        invoice.grantRole(facilitatorRole, facilitator);
    }

    /// @dev Helper: anchor an invoice as the issuer.
    function _anchorDefault() internal {
        vm.prank(issuer);
        invoice.anchorInvoice(invoiceId, contentHash, issuer, recipient, amount);
    }

    // ──────────────────────────────────────────────
    // Initialization
    // ──────────────────────────────────────────────

    function test_initialize() public view {
        assertTrue(invoice.hasRole(invoice.DEFAULT_ADMIN_ROLE(), admin));
    }

    // ──────────────────────────────────────────────
    // Invoice Anchoring
    // ──────────────────────────────────────────────

    function test_anchorInvoice() public {
        _anchorDefault();

        Types.Invoice memory inv = invoice.verifyInvoice(invoiceId);
        assertEq(inv.invoiceId, invoiceId);
        assertEq(inv.contentHash, contentHash);
        assertEq(inv.issuer, issuer);
        assertEq(inv.recipient, recipient);
        assertEq(inv.amount, amount);
        assertTrue(inv.state == Types.InvoiceState.DRAFT);
    }

    function test_anchorInvoice_emitsEvent() public {
        vm.prank(issuer);
        vm.expectEmit(true, true, true, true);
        emit AgentInvoice.InvoiceAnchored(invoiceId, issuer, recipient, amount, contentHash);
        invoice.anchorInvoice(invoiceId, contentHash, issuer, recipient, amount);
    }

    function test_anchorInvoice_revert_duplicate() public {
        _anchorDefault();

        vm.prank(issuer);
        vm.expectRevert(AgentInvoice.InvoiceAlreadyExists.selector);
        invoice.anchorInvoice(invoiceId, contentHash, issuer, recipient, amount);
    }

    function test_anchorInvoice_revert_zeroAmount() public {
        vm.prank(issuer);
        vm.expectRevert(AgentInvoice.ZeroAmount.selector);
        invoice.anchorInvoice(invoiceId, contentHash, issuer, recipient, 0);
    }

    function test_anchorInvoice_revert_zeroAddress() public {
        vm.prank(issuer);
        vm.expectRevert(AgentInvoice.ZeroAddress.selector);
        invoice.anchorInvoice(invoiceId, contentHash, address(0), recipient, amount);
    }

    function test_anchorInvoice_revert_emptyContentHash() public {
        vm.prank(issuer);
        vm.expectRevert(AgentInvoice.EmptyContentHash.selector);
        invoice.anchorInvoice(invoiceId, bytes32(0), issuer, recipient, amount);
    }

    // ──────────────────────────────────────────────
    // State Machine: DRAFT -> ISSUED
    // ──────────────────────────────────────────────

    function test_updateState_draftToIssued() public {
        _anchorDefault();

        vm.prank(issuer);
        invoice.updateState(invoiceId, Types.InvoiceState.ISSUED);

        Types.Invoice memory inv = invoice.verifyInvoice(invoiceId);
        assertTrue(inv.state == Types.InvoiceState.ISSUED);
        assertTrue(inv.issuedAt > 0);
    }

    function test_updateState_draftToIssued_revert_notIssuer() public {
        _anchorDefault();

        vm.prank(unauthorized);
        vm.expectRevert(AgentInvoice.NotIssuer.selector);
        invoice.updateState(invoiceId, Types.InvoiceState.ISSUED);
    }

    // ──────────────────────────────────────────────
    // State Machine: ISSUED -> PAID
    // ──────────────────────────────────────────────

    function test_updateState_issuedToPaid() public {
        _anchorDefault();

        vm.prank(issuer);
        invoice.updateState(invoiceId, Types.InvoiceState.ISSUED);

        vm.prank(facilitator);
        invoice.updateState(invoiceId, Types.InvoiceState.PAID);

        Types.Invoice memory inv = invoice.verifyInvoice(invoiceId);
        assertTrue(inv.state == Types.InvoiceState.PAID);
        assertTrue(inv.paidAt > 0);
    }

    function test_updateState_issuedToPaid_revert_notAuthorized() public {
        _anchorDefault();

        vm.prank(issuer);
        invoice.updateState(invoiceId, Types.InvoiceState.ISSUED);

        // unauthorized is neither issuer nor facilitator
        vm.prank(unauthorized);
        vm.expectRevert(AgentInvoice.NotAuthorized.selector);
        invoice.updateState(invoiceId, Types.InvoiceState.PAID);
    }

    function test_updateState_issuedToPaid_byIssuer() public {
        _anchorDefault();

        vm.prank(issuer);
        invoice.updateState(invoiceId, Types.InvoiceState.ISSUED);

        // Issuer can also mark as paid
        vm.prank(issuer);
        invoice.updateState(invoiceId, Types.InvoiceState.PAID);

        Types.Invoice memory inv = invoice.verifyInvoice(invoiceId);
        assertTrue(inv.state == Types.InvoiceState.PAID);
    }

    // ──────────────────────────────────────────────
    // State Machine: PAID -> SETTLED
    // ──────────────────────────────────────────────

    function test_updateState_paidToSettled() public {
        _anchorDefault();

        vm.prank(issuer);
        invoice.updateState(invoiceId, Types.InvoiceState.ISSUED);

        vm.prank(facilitator);
        invoice.updateState(invoiceId, Types.InvoiceState.PAID);

        vm.prank(facilitator);
        invoice.updateState(invoiceId, Types.InvoiceState.SETTLED);

        Types.Invoice memory inv = invoice.verifyInvoice(invoiceId);
        assertTrue(inv.state == Types.InvoiceState.SETTLED);
        assertTrue(inv.settledAt > 0);
    }

    // ──────────────────────────────────────────────
    // State Machine: Invalid Transitions
    // ──────────────────────────────────────────────

    function test_updateState_revert_invalidTransition_draftToPaid() public {
        _anchorDefault();

        vm.prank(facilitator);
        vm.expectRevert(AgentInvoice.InvalidStateTransition.selector);
        invoice.updateState(invoiceId, Types.InvoiceState.PAID);
    }

    function test_updateState_revert_invalidTransition_issuedToSettled() public {
        _anchorDefault();

        vm.prank(issuer);
        invoice.updateState(invoiceId, Types.InvoiceState.ISSUED);

        vm.prank(facilitator);
        vm.expectRevert(AgentInvoice.InvalidStateTransition.selector);
        invoice.updateState(invoiceId, Types.InvoiceState.SETTLED);
    }

    function test_updateState_revert_settledToAnything() public {
        _anchorDefault();

        vm.prank(issuer);
        invoice.updateState(invoiceId, Types.InvoiceState.ISSUED);

        vm.prank(facilitator);
        invoice.updateState(invoiceId, Types.InvoiceState.PAID);

        vm.prank(facilitator);
        invoice.updateState(invoiceId, Types.InvoiceState.SETTLED);

        vm.prank(issuer);
        vm.expectRevert(AgentInvoice.InvalidStateTransition.selector);
        invoice.updateState(invoiceId, Types.InvoiceState.CANCELLED);
    }

    // ──────────────────────────────────────────────
    // State Machine: Cancellation
    // ──────────────────────────────────────────────

    function test_updateState_draftToCancelled() public {
        _anchorDefault();

        vm.prank(issuer);
        invoice.updateState(invoiceId, Types.InvoiceState.CANCELLED);

        Types.Invoice memory inv = invoice.verifyInvoice(invoiceId);
        assertTrue(inv.state == Types.InvoiceState.CANCELLED);
    }

    function test_updateState_issuedToCancelled() public {
        _anchorDefault();

        vm.prank(issuer);
        invoice.updateState(invoiceId, Types.InvoiceState.ISSUED);

        vm.prank(issuer);
        invoice.updateState(invoiceId, Types.InvoiceState.CANCELLED);

        Types.Invoice memory inv = invoice.verifyInvoice(invoiceId);
        assertTrue(inv.state == Types.InvoiceState.CANCELLED);
    }

    // ──────────────────────────────────────────────
    // State Machine: Dispute -> Refund
    // ──────────────────────────────────────────────

    function test_updateState_paidToDisputed_byRecipient() public {
        _anchorDefault();

        vm.prank(issuer);
        invoice.updateState(invoiceId, Types.InvoiceState.ISSUED);

        vm.prank(facilitator);
        invoice.updateState(invoiceId, Types.InvoiceState.PAID);

        // Recipient opens the dispute
        vm.prank(recipient);
        invoice.updateState(invoiceId, Types.InvoiceState.DISPUTED);

        Types.Invoice memory inv = invoice.verifyInvoice(invoiceId);
        assertTrue(inv.state == Types.InvoiceState.DISPUTED);
    }

    function test_updateState_paidToDisputed_byFacilitator() public {
        _anchorDefault();

        vm.prank(issuer);
        invoice.updateState(invoiceId, Types.InvoiceState.ISSUED);

        vm.prank(facilitator);
        invoice.updateState(invoiceId, Types.InvoiceState.PAID);

        // Facilitator can also open a dispute
        vm.prank(facilitator);
        invoice.updateState(invoiceId, Types.InvoiceState.DISPUTED);

        Types.Invoice memory inv = invoice.verifyInvoice(invoiceId);
        assertTrue(inv.state == Types.InvoiceState.DISPUTED);
    }

    function test_updateState_paidToDisputed_revert_unauthorized() public {
        _anchorDefault();

        vm.prank(issuer);
        invoice.updateState(invoiceId, Types.InvoiceState.ISSUED);

        vm.prank(facilitator);
        invoice.updateState(invoiceId, Types.InvoiceState.PAID);

        // Issuer or random address cannot open a dispute
        vm.prank(unauthorized);
        vm.expectRevert(AgentInvoice.NotAuthorized.selector);
        invoice.updateState(invoiceId, Types.InvoiceState.DISPUTED);
    }

    function test_updateState_disputedToRefunded() public {
        _anchorDefault();

        vm.prank(issuer);
        invoice.updateState(invoiceId, Types.InvoiceState.ISSUED);

        vm.prank(facilitator);
        invoice.updateState(invoiceId, Types.InvoiceState.PAID);

        vm.prank(recipient);
        invoice.updateState(invoiceId, Types.InvoiceState.DISPUTED);

        // Only facilitator can authorise a refund
        vm.prank(facilitator);
        invoice.updateState(invoiceId, Types.InvoiceState.REFUNDED);

        Types.Invoice memory inv = invoice.verifyInvoice(invoiceId);
        assertTrue(inv.state == Types.InvoiceState.REFUNDED);
    }

    function test_updateState_disputedToRefunded_revert_unauthorized() public {
        _anchorDefault();

        vm.prank(issuer);
        invoice.updateState(invoiceId, Types.InvoiceState.ISSUED);

        vm.prank(facilitator);
        invoice.updateState(invoiceId, Types.InvoiceState.PAID);

        vm.prank(recipient);
        invoice.updateState(invoiceId, Types.InvoiceState.DISPUTED);

        // Random address cannot authorise refund
        vm.prank(unauthorized);
        vm.expectRevert();
        invoice.updateState(invoiceId, Types.InvoiceState.REFUNDED);
    }

    function test_anchorInvoice_revert_notIssuer() public {
        // unauthorized is neither issuer nor facilitator — should revert
        vm.prank(unauthorized);
        vm.expectRevert(AgentInvoice.NotAuthorized.selector);
        invoice.anchorInvoice(invoiceId, contentHash, issuer, recipient, amount);
    }

    function test_anchorInvoice_byFacilitator() public {
        // Facilitator may anchor on behalf of an issuer (platform use case)
        vm.prank(facilitator);
        invoice.anchorInvoice(invoiceId, contentHash, issuer, recipient, amount);

        Types.Invoice memory inv = invoice.verifyInvoice(invoiceId);
        assertEq(inv.issuer, issuer);
    }

    // ──────────────────────────────────────────────
    // Event Emission
    // ──────────────────────────────────────────────

    function test_updateState_emitsEvent() public {
        _anchorDefault();

        vm.prank(issuer);
        vm.expectEmit(true, true, true, false);
        emit AgentInvoice.InvoiceStateChanged(invoiceId, Types.InvoiceState.DRAFT, Types.InvoiceState.ISSUED);
        invoice.updateState(invoiceId, Types.InvoiceState.ISSUED);
    }

    // ──────────────────────────────────────────────
    // Read Functions
    // ──────────────────────────────────────────────

    function test_verifyInvoice_revert_notFound() public {
        vm.expectRevert(AgentInvoice.InvoiceNotFound.selector);
        invoice.verifyInvoice(keccak256("nonexistent"));
    }

    function test_getInvoicesByIssuer() public {
        _anchorDefault();

        vm.prank(issuer);
        invoice.anchorInvoice(keccak256("inv-2"), contentHash, issuer, recipient, amount);

        bytes32[] memory ids = invoice.getInvoicesByIssuer(issuer);
        assertEq(ids.length, 2);
        assertEq(ids[0], invoiceId);
    }

    function test_getInvoicesByRecipient() public {
        _anchorDefault();

        bytes32[] memory ids = invoice.getInvoicesByRecipient(recipient);
        assertEq(ids.length, 1);
        assertEq(ids[0], invoiceId);
    }

    // ──────────────────────────────────────────────
    // Full Lifecycle
    // ──────────────────────────────────────────────

    function test_fullLifecycle_draftToSettled() public {
        // Create
        _anchorDefault();

        // Issue
        vm.prank(issuer);
        invoice.updateState(invoiceId, Types.InvoiceState.ISSUED);

        // Pay
        vm.prank(facilitator);
        invoice.updateState(invoiceId, Types.InvoiceState.PAID);

        // Settle
        vm.prank(facilitator);
        invoice.updateState(invoiceId, Types.InvoiceState.SETTLED);

        Types.Invoice memory inv = invoice.verifyInvoice(invoiceId);
        assertTrue(inv.state == Types.InvoiceState.SETTLED);
        assertTrue(inv.createdAt > 0);
        assertTrue(inv.issuedAt > 0);
        assertTrue(inv.paidAt > 0);
        assertTrue(inv.settledAt > 0);
    }

    // ══════════════════════════════════════════════
    // Simplified Invoice API
    // ══════════════════════════════════════════════

    bytes32 public simpleInvoiceHash = keccak256("simple-invoice-001");
    address public payer = makeAddr("payer");
    address public payee = makeAddr("payee");

    /// @dev Helper: create a simplified invoice as the payer.
    function _createSimpleInvoice() internal {
        vm.prank(payer);
        invoice.createInvoice(simpleInvoiceHash, payer, payee, 5_000e6, "USDC");
    }

    // ──────────────────────────────────────────────
    // createInvoice()
    // ──────────────────────────────────────────────

    function test_createInvoice_validData() public {
        _createSimpleInvoice();

        Types.InvoiceInfo memory info = invoice.getInvoice(simpleInvoiceHash);
        assertEq(info.invoiceHash, simpleInvoiceHash);
        assertEq(info.payer, payer);
        assertEq(info.payee, payee);
        assertEq(info.amount, 5_000e6);
        assertEq(info.currency, "USDC");
        assertFalse(info.paid);
        assertEq(info.txHash, bytes32(0));
        assertTrue(info.createdAt > 0);
        assertEq(info.paidAt, 0);
    }

    function test_createInvoice_emitsEvent() public {
        vm.prank(payer);
        vm.expectEmit(true, true, true, true);
        emit AgentInvoice.InvoiceCreated(simpleInvoiceHash, payer, payee, 5_000e6, "USDC");
        invoice.createInvoice(simpleInvoiceHash, payer, payee, 5_000e6, "USDC");
    }

    function test_createInvoice_byFacilitator() public {
        vm.prank(facilitator);
        invoice.createInvoice(simpleInvoiceHash, payer, payee, 5_000e6, "USDC");

        Types.InvoiceInfo memory info = invoice.getInvoice(simpleInvoiceHash);
        assertEq(info.payer, payer);
    }

    function test_createInvoice_revert_duplicate() public {
        _createSimpleInvoice();

        vm.prank(payer);
        vm.expectRevert(AgentInvoice.InvoiceAlreadyExists.selector);
        invoice.createInvoice(simpleInvoiceHash, payer, payee, 1000, "USDC");
    }

    function test_createInvoice_revert_zeroAddress() public {
        vm.prank(payer);
        vm.expectRevert(AgentInvoice.ZeroAddress.selector);
        invoice.createInvoice(simpleInvoiceHash, address(0), payee, 1000, "USDC");
    }

    function test_createInvoice_revert_zeroAmount() public {
        vm.prank(payer);
        vm.expectRevert(AgentInvoice.ZeroAmount.selector);
        invoice.createInvoice(simpleInvoiceHash, payer, payee, 0, "USDC");
    }

    function test_createInvoice_revert_emptyHash() public {
        vm.prank(payer);
        vm.expectRevert(AgentInvoice.EmptyContentHash.selector);
        invoice.createInvoice(bytes32(0), payer, payee, 1000, "USDC");
    }

    function test_createInvoice_revert_unauthorized() public {
        vm.prank(unauthorized);
        vm.expectRevert(AgentInvoice.NotAuthorized.selector);
        invoice.createInvoice(simpleInvoiceHash, payer, payee, 1000, "USDC");
    }

    // ──────────────────────────────────────────────
    // markPaid()
    // ──────────────────────────────────────────────

    function test_markPaid_transitionsState() public {
        _createSimpleInvoice();
        bytes32 txHash = keccak256("payment-tx-1");

        vm.prank(payee);
        invoice.markPaid(simpleInvoiceHash, txHash);

        Types.InvoiceInfo memory info = invoice.getInvoice(simpleInvoiceHash);
        assertTrue(info.paid);
        assertEq(info.txHash, txHash);
        assertTrue(info.paidAt > 0);
    }

    function test_markPaid_emitsEvent() public {
        _createSimpleInvoice();
        bytes32 txHash = keccak256("payment-tx-1");

        vm.prank(payee);
        vm.expectEmit(true, false, false, true);
        emit AgentInvoice.InvoicePaid(simpleInvoiceHash, txHash);
        invoice.markPaid(simpleInvoiceHash, txHash);
    }

    function test_markPaid_byFacilitator() public {
        _createSimpleInvoice();
        bytes32 txHash = keccak256("payment-tx-1");

        vm.prank(facilitator);
        invoice.markPaid(simpleInvoiceHash, txHash);

        Types.InvoiceInfo memory info = invoice.getInvoice(simpleInvoiceHash);
        assertTrue(info.paid);
    }

    function test_markPaid_revert_notFound() public {
        vm.prank(payee);
        vm.expectRevert(AgentInvoice.InvoiceNotFound.selector);
        invoice.markPaid(keccak256("nonexistent"), keccak256("tx"));
    }

    function test_markPaid_revert_alreadyPaid() public {
        _createSimpleInvoice();

        vm.prank(payee);
        invoice.markPaid(simpleInvoiceHash, keccak256("tx-1"));

        vm.prank(payee);
        vm.expectRevert(AgentInvoice.InvalidStateTransition.selector);
        invoice.markPaid(simpleInvoiceHash, keccak256("tx-2"));
    }

    function test_markPaid_revert_unauthorized() public {
        _createSimpleInvoice();

        vm.prank(unauthorized);
        vm.expectRevert(AgentInvoice.NotAuthorized.selector);
        invoice.markPaid(simpleInvoiceHash, keccak256("tx"));
    }

    // ──────────────────────────────────────────────
    // cancelInvoice()
    // ──────────────────────────────────────────────

    function test_cancelInvoice() public {
        _createSimpleInvoice();

        vm.prank(payer);
        invoice.cancelInvoice(simpleInvoiceHash);

        // Invoice is deleted, so getInvoice should revert
        vm.expectRevert(AgentInvoice.InvoiceNotFound.selector);
        invoice.getInvoice(simpleInvoiceHash);
    }

    function test_cancelInvoice_emitsEvent() public {
        _createSimpleInvoice();

        vm.prank(payer);
        vm.expectEmit(true, true, false, false);
        emit AgentInvoice.InvoiceCancelled(simpleInvoiceHash, payer);
        invoice.cancelInvoice(simpleInvoiceHash);
    }

    function test_cancelInvoice_byFacilitator() public {
        _createSimpleInvoice();

        vm.prank(facilitator);
        invoice.cancelInvoice(simpleInvoiceHash);

        vm.expectRevert(AgentInvoice.InvoiceNotFound.selector);
        invoice.getInvoice(simpleInvoiceHash);
    }

    function test_cancelInvoice_revert_paidInvoice() public {
        _createSimpleInvoice();

        vm.prank(payee);
        invoice.markPaid(simpleInvoiceHash, keccak256("tx"));

        vm.prank(payer);
        vm.expectRevert(AgentInvoice.InvalidStateTransition.selector);
        invoice.cancelInvoice(simpleInvoiceHash);
    }

    function test_cancelInvoice_revert_notFound() public {
        vm.prank(payer);
        vm.expectRevert(AgentInvoice.InvoiceNotFound.selector);
        invoice.cancelInvoice(keccak256("nonexistent"));
    }

    function test_cancelInvoice_revert_unauthorized() public {
        _createSimpleInvoice();

        vm.prank(unauthorized);
        vm.expectRevert(AgentInvoice.NotAuthorized.selector);
        invoice.cancelInvoice(simpleInvoiceHash);
    }

    // ──────────────────────────────────────────────
    // getInvoice()
    // ──────────────────────────────────────────────

    function test_getInvoice_returnsAllFields() public {
        _createSimpleInvoice();

        vm.prank(payee);
        invoice.markPaid(simpleInvoiceHash, keccak256("tx-paid"));

        Types.InvoiceInfo memory info = invoice.getInvoice(simpleInvoiceHash);
        assertEq(info.invoiceHash, simpleInvoiceHash);
        assertEq(info.payer, payer);
        assertEq(info.payee, payee);
        assertEq(info.amount, 5_000e6);
        assertEq(info.currency, "USDC");
        assertTrue(info.paid);
        assertEq(info.txHash, keccak256("tx-paid"));
        assertTrue(info.createdAt > 0);
        assertTrue(info.paidAt > 0);
    }

    function test_getInvoice_revert_notFound() public {
        vm.expectRevert(AgentInvoice.InvoiceNotFound.selector);
        invoice.getInvoice(keccak256("nonexistent"));
    }
}
