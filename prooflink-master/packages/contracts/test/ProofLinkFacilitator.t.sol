// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test, console2} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {ProofLinkFacilitator} from "../src/ProofLinkFacilitator.sol";
import {ProofLinkRegistry} from "../src/ProofLinkRegistry.sol";
import {ProofLinkKYA} from "../src/ProofLinkKYA.sol";
import {Types} from "../src/libraries/Types.sol";
import {
    IEAS,
    AttestationRequest,
    AttestationRequestData,
    MultiAttestationRequest,
    RevocationRequest,
    RevocationRequestData,
    Attestation,
    ISchemaRegistry
} from "../src/interfaces/IEAS.sol";
import {IERC8004IdentityRegistry, IERC8004ValidationRegistry} from "../src/interfaces/IERC8004.sol";

/// @dev Mock EAS for facilitator tests.
contract MockEAS2 is IEAS {
    uint256 private _counter;

    function attest(AttestationRequest calldata) external payable returns (bytes32) {
        _counter++;
        return keccak256(abi.encodePacked(_counter));
    }

    function multiAttest(MultiAttestationRequest[] calldata) external payable returns (bytes32[] memory) {
        return new bytes32[](0);
    }

    function revoke(RevocationRequest calldata) external payable {}

    function getAttestation(bytes32) external pure returns (Attestation memory) {
        return Attestation({
            uid: bytes32(0),
            schema: bytes32(0),
            time: 0,
            expirationTime: 0,
            revocationTime: 0,
            refUID: bytes32(0),
            attester: address(0),
            recipient: address(0),
            revocable: false,
            data: ""
        });
    }

    function isAttestationValid(bytes32) external pure returns (bool) {
        return false;
    }
}

contract MockSchemaRegistry2 is ISchemaRegistry {
    function register(string calldata, address, bool) external pure returns (bytes32) {
        return keccak256("schema");
    }
}

contract MockIdentityRegistry2 is IERC8004IdentityRegistry {
    function getAgentWallet(uint256) external pure returns (address) {
        return address(0);
    }

    function getAgentByWallet(address) external pure returns (uint256) {
        return 0;
    }

    function isOwnerOf(uint256, address) external pure returns (bool) {
        return true;
    }

    function isApprovedOperator(uint256, address) external pure returns (bool) {
        return true;
    }
}

contract MockValidationRegistry2 is IERC8004ValidationRegistry {
    function validationResponse(bytes32, uint256, string calldata, bytes32, string calldata) external {}
}

contract ProofLinkFacilitatorTest is Test {
    ProofLinkFacilitator public facilitator;
    ProofLinkRegistry public registry;
    ProofLinkKYA public kya;
    MockEAS2 public mockEAS;

    address public admin = makeAddr("admin");
    address public settler = makeAddr("settler");
    address public payer = makeAddr("payer");
    address public payee = makeAddr("payee");
    address public token = makeAddr("token");
    address public unauthorized = makeAddr("unauthorized");

    function setUp() public {
        mockEAS = new MockEAS2();
        MockSchemaRegistry2 mockSchemaRegistry = new MockSchemaRegistry2();
        MockIdentityRegistry2 mockIdentityRegistry = new MockIdentityRegistry2();
        MockValidationRegistry2 mockValidationRegistry = new MockValidationRegistry2();

        // Deploy ProofLinkRegistry via proxy
        ProofLinkRegistry registryImpl = new ProofLinkRegistry();
        bytes memory registryInit =
            abi.encodeCall(ProofLinkRegistry.initialize, (address(mockEAS), address(mockSchemaRegistry), admin));
        ERC1967Proxy registryProxy = new ERC1967Proxy(address(registryImpl), registryInit);
        registry = ProofLinkRegistry(address(registryProxy));

        // Register schema
        vm.prank(admin);
        registry.registerSchema();

        // Deploy ProofLinkKYA via proxy
        ProofLinkKYA kyaImpl = new ProofLinkKYA();
        bytes memory kyaInit = abi.encodeCall(
            ProofLinkKYA.initialize, (address(mockIdentityRegistry), address(mockValidationRegistry), admin)
        );
        ERC1967Proxy kyaProxy = new ERC1967Proxy(address(kyaImpl), kyaInit);
        kya = ProofLinkKYA(address(kyaProxy));

        // Deploy ProofLinkFacilitator via proxy
        ProofLinkFacilitator facImpl = new ProofLinkFacilitator();
        bytes memory facInit =
            abi.encodeCall(ProofLinkFacilitator.initialize, (address(registry), address(kya), admin));
        ERC1967Proxy facProxy = new ERC1967Proxy(address(facImpl), facInit);
        facilitator = ProofLinkFacilitator(address(facProxy));

        // Grant roles
        vm.startPrank(admin);
        facilitator.grantRole(facilitator.SETTLER_ROLE(), settler);
        // Grant facilitator the ATTESTER_ROLE on registry so it can anchor receipts
        registry.grantRole(registry.ATTESTER_ROLE(), address(facilitator));
        // Grant KYA verifier role
        kya.grantRole(kya.VERIFIER_ROLE(), admin);
        vm.stopPrank();
    }

    // ──────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────

    function _makePayload(uint256 nonce) internal view returns (Types.PaymentPayload memory) {
        return Types.PaymentPayload({
            payer: payer,
            payee: payee,
            amount: 1_000_000_000, // 1000 USDC
            token: token,
            paymentHash: keccak256(abi.encodePacked("payment", nonce)),
            chainId: 8453,
            nonce: nonce,
            deadline: block.timestamp + 1 hours
        });
    }

    function _makeCompliance(bytes32 receiptId) internal pure returns (Types.ComplianceAttestation memory) {
        return Types.ComplianceAttestation({
            proofLinkReceiptId: receiptId,
            riskScore: 25,
            sanctionsFlags: 0x000F, // All screened, no matches
            travelRuleCompliant: true,
            kyaVerified: false
        });
    }

    // ──────────────────────────────────────────────
    // Initialization
    // ──────────────────────────────────────────────

    function test_initialize() public view {
        assertEq(address(facilitator.proofLinkRegistry()), address(registry));
        assertEq(address(facilitator.kyaContract()), address(kya));
        assertEq(facilitator.riskThreshold(), 50);
        assertTrue(facilitator.failClosed());
        assertTrue(facilitator.hasRole(facilitator.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(facilitator.hasRole(facilitator.SETTLER_ROLE(), settler));
    }

    // ──────────────────────────────────────────────
    // Verify
    // ──────────────────────────────────────────────

    function test_verify_compliant() public view {
        Types.PaymentPayload memory payload = _makePayload(1);
        Types.ComplianceAttestation memory compliance = _makeCompliance(keccak256("receipt-1"));

        (bool isCompliant, string memory reason) = facilitator.verify(payload, compliance);
        assertTrue(isCompliant);
        assertEq(bytes(reason).length, 0);
    }

    function test_verify_sanctionsHit() public view {
        Types.PaymentPayload memory payload = _makePayload(1);
        Types.ComplianceAttestation memory compliance = _makeCompliance(keccak256("receipt-1"));
        compliance.sanctionsFlags = 0x010F; // OFAC match

        (bool isCompliant, string memory reason) = facilitator.verify(payload, compliance);
        assertFalse(isCompliant);
        assertEq(reason, "SANCTIONS_HIT");
    }

    function test_verify_riskTooHigh() public view {
        Types.PaymentPayload memory payload = _makePayload(1);
        Types.ComplianceAttestation memory compliance = _makeCompliance(keccak256("receipt-1"));
        compliance.riskScore = 75;

        (bool isCompliant, string memory reason) = facilitator.verify(payload, compliance);
        assertFalse(isCompliant);
        assertEq(reason, "RISK_TOO_HIGH");
    }

    function test_verify_kyaInvalid() public view {
        Types.PaymentPayload memory payload = _makePayload(1);
        Types.ComplianceAttestation memory compliance = _makeCompliance(keccak256("receipt-1"));
        compliance.kyaVerified = true; // Requires KYA but payer has none

        (bool isCompliant, string memory reason) = facilitator.verify(payload, compliance);
        assertFalse(isCompliant);
        assertEq(reason, "KYA_INVALID");
    }

    function test_verify_spendingLimitExceeded() public {
        vm.prank(admin);
        facilitator.setSpendingLimit(payer, 500_000_000); // 500 USDC limit

        Types.PaymentPayload memory payload = _makePayload(1);
        payload.amount = 600_000_000; // 600 USDC
        Types.ComplianceAttestation memory compliance = _makeCompliance(keccak256("receipt-1"));

        (bool isCompliant, string memory reason) = facilitator.verify(payload, compliance);
        assertFalse(isCompliant);
        assertEq(reason, "SPENDING_LIMIT_EXCEEDED");
    }

    // ──────────────────────────────────────────────
    // Settle
    // ──────────────────────────────────────────────

    function test_settle() public {
        Types.PaymentPayload memory payload = _makePayload(1);
        Types.ComplianceAttestation memory compliance = _makeCompliance(keccak256("receipt-1"));

        vm.prank(settler);
        bytes32 settlementId = facilitator.settle(payload, compliance);

        assertTrue(settlementId != bytes32(0));

        Types.SettlementRecord memory record = facilitator.getSettlement(settlementId);
        assertEq(record.payer, payer);
        assertEq(record.payee, payee);
        assertEq(record.amount, 1_000_000_000);
    }

    function test_settle_emitsEvent() public {
        Types.PaymentPayload memory payload = _makePayload(1);
        Types.ComplianceAttestation memory compliance = _makeCompliance(keccak256("receipt-1"));

        vm.prank(settler);
        vm.expectEmit(false, true, true, false);
        emit ProofLinkFacilitator.PaymentSettled(bytes32(0), payer, payee, token, 1_000_000_000, keccak256("receipt-1"));
        facilitator.settle(payload, compliance);
    }

    function test_settle_revert_nonceReuse() public {
        Types.PaymentPayload memory payload = _makePayload(1);
        Types.ComplianceAttestation memory compliance = _makeCompliance(keccak256("receipt-1"));

        vm.prank(settler);
        facilitator.settle(payload, compliance);

        // Different receipt but same nonce
        Types.ComplianceAttestation memory compliance2 = _makeCompliance(keccak256("receipt-2"));
        payload.paymentHash = keccak256("payment2");

        vm.prank(settler);
        vm.expectRevert(ProofLinkFacilitator.NonceAlreadyUsed.selector);
        facilitator.settle(payload, compliance2);
    }

    function test_settle_revert_deadlineExpired() public {
        vm.warp(1000); // Ensure block.timestamp > 1 so deadline can be in the past
        Types.PaymentPayload memory payload = _makePayload(1);
        payload.deadline = block.timestamp - 1;
        Types.ComplianceAttestation memory compliance = _makeCompliance(keccak256("receipt-1"));

        vm.prank(settler);
        vm.expectRevert(ProofLinkFacilitator.DeadlineExpired.selector);
        facilitator.settle(payload, compliance);
    }

    function test_settle_revert_sanctionsHit() public {
        Types.PaymentPayload memory payload = _makePayload(1);
        Types.ComplianceAttestation memory compliance = _makeCompliance(keccak256("receipt-1"));
        compliance.sanctionsFlags = 0x010F; // OFAC match

        vm.prank(settler);
        vm.expectRevert(ProofLinkFacilitator.SanctionsHit.selector);
        facilitator.settle(payload, compliance);
    }

    function test_settle_revert_riskTooHigh() public {
        Types.PaymentPayload memory payload = _makePayload(1);
        Types.ComplianceAttestation memory compliance = _makeCompliance(keccak256("receipt-1"));
        compliance.riskScore = 75;

        vm.prank(settler);
        vm.expectRevert(ProofLinkFacilitator.RiskScoreTooHigh.selector);
        facilitator.settle(payload, compliance);
    }

    function test_settle_revert_unauthorized() public {
        Types.PaymentPayload memory payload = _makePayload(1);
        Types.ComplianceAttestation memory compliance = _makeCompliance(keccak256("receipt-1"));

        vm.prank(unauthorized);
        vm.expectRevert();
        facilitator.settle(payload, compliance);
    }

    function test_settle_revert_zeroAmount() public {
        Types.PaymentPayload memory payload = _makePayload(1);
        payload.amount = 0;
        Types.ComplianceAttestation memory compliance = _makeCompliance(keccak256("receipt-1"));

        vm.prank(settler);
        vm.expectRevert(ProofLinkFacilitator.ZeroAmount.selector);
        facilitator.settle(payload, compliance);
    }

    function test_settle_revert_whenPaused() public {
        vm.prank(admin);
        facilitator.pause();

        Types.PaymentPayload memory payload = _makePayload(1);
        Types.ComplianceAttestation memory compliance = _makeCompliance(keccak256("receipt-1"));

        vm.prank(settler);
        vm.expectRevert();
        facilitator.settle(payload, compliance);
    }

    // ──────────────────────────────────────────────
    // Fail-Open Mode
    // ──────────────────────────────────────────────

    function test_settle_failOpen_sanctionsHit() public {
        vm.prank(admin);
        facilitator.setFailMode(false); // fail-open

        Types.PaymentPayload memory payload = _makePayload(1);
        Types.ComplianceAttestation memory compliance = _makeCompliance(keccak256("receipt-1"));
        compliance.sanctionsFlags = 0x010F; // OFAC match

        vm.prank(settler);
        // Should emit event but not revert
        vm.expectEmit(true, true, false, false);
        emit ProofLinkFacilitator.ComplianceCheckFailed(payer, payee, 1_000_000_000, "SANCTIONS_HIT");
        facilitator.settle(payload, compliance);
    }

    // ──────────────────────────────────────────────
    // Spending Limits
    // ──────────────────────────────────────────────

    function test_spendingLimit_enforce() public {
        vm.prank(admin);
        facilitator.setSpendingLimit(payer, 500_000_000); // 500 USDC

        Types.PaymentPayload memory payload = _makePayload(1);
        payload.amount = 600_000_000; // 600 USDC > 500 limit
        Types.ComplianceAttestation memory compliance = _makeCompliance(keccak256("receipt-1"));

        vm.prank(settler);
        vm.expectRevert(ProofLinkFacilitator.SpendingLimitExceeded.selector);
        facilitator.settle(payload, compliance);
    }

    function test_spendingLimit_accumulates() public {
        vm.prank(admin);
        facilitator.setSpendingLimit(payer, 1_500_000_000); // 1500 USDC

        // First settlement: 1000 USDC
        Types.PaymentPayload memory payload1 = _makePayload(1);
        Types.ComplianceAttestation memory compliance1 = _makeCompliance(keccak256("receipt-1"));

        vm.prank(settler);
        facilitator.settle(payload1, compliance1);

        // Second settlement: 1000 USDC (total 2000 > 1500 limit)
        Types.PaymentPayload memory payload2 = _makePayload(2);
        Types.ComplianceAttestation memory compliance2 = _makeCompliance(keccak256("receipt-2"));

        vm.prank(settler);
        vm.expectRevert(ProofLinkFacilitator.SpendingLimitExceeded.selector);
        facilitator.settle(payload2, compliance2);
    }

    function test_getRemainingDailyLimit() public {
        vm.prank(admin);
        facilitator.setSpendingLimit(payer, 2_000_000_000); // 2000 USDC

        // Settle 1000 USDC
        Types.PaymentPayload memory payload = _makePayload(1);
        Types.ComplianceAttestation memory compliance = _makeCompliance(keccak256("receipt-1"));

        vm.prank(settler);
        facilitator.settle(payload, compliance);

        uint128 remaining = facilitator.getRemainingDailyLimit(payer);
        assertEq(remaining, 1_000_000_000); // 1000 USDC remaining
    }

    function test_getRemainingDailyLimit_unlimited() public view {
        uint128 remaining = facilitator.getRemainingDailyLimit(payer);
        assertEq(remaining, type(uint128).max);
    }

    // ──────────────────────────────────────────────
    // KYA Verification in Settle
    // ──────────────────────────────────────────────

    function test_settle_withKYAVerification() public {
        // Issue KYA credential for payer
        vm.prank(admin);
        kya.issueKYA(payer, keccak256("cred"), uint64(block.timestamp + 365 days));

        Types.PaymentPayload memory payload = _makePayload(1);
        Types.ComplianceAttestation memory compliance = _makeCompliance(keccak256("receipt-1"));
        compliance.kyaVerified = true;

        vm.prank(settler);
        bytes32 sid = facilitator.settle(payload, compliance);
        assertTrue(sid != bytes32(0));
    }

    function test_settle_revert_kyaFailed() public {
        // No KYA credential issued for payer
        Types.PaymentPayload memory payload = _makePayload(1);
        Types.ComplianceAttestation memory compliance = _makeCompliance(keccak256("receipt-1"));
        compliance.kyaVerified = true;

        vm.prank(settler);
        vm.expectRevert(ProofLinkFacilitator.KYAVerificationFailed.selector);
        facilitator.settle(payload, compliance);
    }

    // ──────────────────────────────────────────────
    // Admin
    // ──────────────────────────────────────────────

    function test_pause_unpause() public {
        vm.prank(admin);
        facilitator.pause();
        assertTrue(facilitator.paused());

        vm.prank(admin);
        facilitator.unpause();
        assertFalse(facilitator.paused());
    }

    function test_setRiskThreshold() public {
        vm.prank(admin);
        facilitator.setRiskThreshold(75);
        assertEq(facilitator.riskThreshold(), 75);
    }

    function test_setRiskThreshold_revert_tooHigh() public {
        vm.prank(admin);
        vm.expectRevert(ProofLinkFacilitator.InvalidRiskThreshold.selector);
        facilitator.setRiskThreshold(101);
    }

    function test_isNonceUsed() public {
        assertFalse(facilitator.isNonceUsed(1));

        Types.PaymentPayload memory payload = _makePayload(1);
        Types.ComplianceAttestation memory compliance = _makeCompliance(keccak256("receipt-1"));

        vm.prank(settler);
        facilitator.settle(payload, compliance);

        assertTrue(facilitator.isNonceUsed(1));
    }

    function test_getSettlement_revert_notFound() public {
        vm.expectRevert(ProofLinkFacilitator.SettlementNotFound.selector);
        facilitator.getSettlement(keccak256("nonexistent"));
    }

    // ══════════════════════════════════════════════
    // Simplified Facilitation API: facilitate()
    // ══════════════════════════════════════════════

    /// @dev Helper: create a valid simple attestation in the registry.
    function _attestInRegistry(bytes32 receiptHash) internal {
        // admin already has ATTESTER_ROLE from setUp (granted during initialize)
        vm.prank(admin);
        registry.attest(receiptHash, payer, payee, 1_000_000_000, "base", 0);
    }

    function test_facilitate_withValidAttestation() public {
        bytes32 receiptHash = keccak256("facilitated-receipt");
        _attestInRegistry(receiptHash);

        vm.prank(settler);
        bool success = facilitator.facilitate(payer, payee, 1_000_000_000, receiptHash);
        assertTrue(success);
    }

    function test_facilitate_emitsPaymentFacilitated() public {
        bytes32 receiptHash = keccak256("facilitated-receipt");
        _attestInRegistry(receiptHash);

        vm.prank(settler);
        vm.expectEmit(true, true, false, true);
        emit ProofLinkFacilitator.PaymentFacilitated(payer, payee, 1_000_000_000, receiptHash);
        facilitator.facilitate(payer, payee, 1_000_000_000, receiptHash);
    }

    function test_facilitate_revert_withoutValidAttestation() public {
        bytes32 receiptHash = keccak256("nonexistent-receipt");

        vm.prank(settler);
        vm.expectRevert(ProofLinkFacilitator.SanctionsHit.selector);
        facilitator.facilitate(payer, payee, 1_000_000_000, receiptHash);
    }

    function test_facilitate_revert_forRevokedAttestation() public {
        bytes32 receiptHash = keccak256("revoked-receipt");
        _attestInRegistry(receiptHash);

        // Revoke the attestation
        vm.prank(admin);
        registry.revoke(receiptHash);

        vm.prank(settler);
        vm.expectRevert(ProofLinkFacilitator.SanctionsHit.selector);
        facilitator.facilitate(payer, payee, 1_000_000_000, receiptHash);
    }

    function test_facilitate_revert_rejectedStatus() public {
        bytes32 receiptHash = keccak256("rejected-receipt");

        // Attest with REJECTED status (1) — admin already has ATTESTER_ROLE
        vm.prank(admin);
        registry.attest(receiptHash, payer, payee, 1_000_000_000, "base", 1);

        vm.prank(settler);
        vm.expectRevert(ProofLinkFacilitator.SanctionsHit.selector);
        facilitator.facilitate(payer, payee, 1_000_000_000, receiptHash);
    }

    function test_facilitate_revert_zeroAddress() public {
        bytes32 receiptHash = keccak256("receipt");
        _attestInRegistry(receiptHash);

        vm.prank(settler);
        vm.expectRevert(ProofLinkFacilitator.ZeroAddress.selector);
        facilitator.facilitate(address(0), payee, 1_000_000_000, receiptHash);
    }

    function test_facilitate_revert_zeroAmount() public {
        bytes32 receiptHash = keccak256("receipt");
        _attestInRegistry(receiptHash);

        vm.prank(settler);
        vm.expectRevert(ProofLinkFacilitator.ZeroAmount.selector);
        facilitator.facilitate(payer, payee, 0, receiptHash);
    }

    function test_facilitate_revert_unauthorized() public {
        bytes32 receiptHash = keccak256("receipt");
        _attestInRegistry(receiptHash);

        vm.prank(unauthorized);
        vm.expectRevert();
        facilitator.facilitate(payer, payee, 1_000_000_000, receiptHash);
    }

    function test_facilitate_revert_whenPaused() public {
        bytes32 receiptHash = keccak256("receipt");
        _attestInRegistry(receiptHash);

        vm.prank(admin);
        facilitator.pause();

        vm.prank(settler);
        vm.expectRevert();
        facilitator.facilitate(payer, payee, 1_000_000_000, receiptHash);
    }

    function test_facilitate_failOpen_invalidAttestation() public {
        vm.prank(admin);
        facilitator.setFailMode(false); // fail-open

        bytes32 receiptHash = keccak256("no-attestation");

        vm.prank(settler);
        vm.expectEmit(true, true, false, true);
        emit ProofLinkFacilitator.PaymentBlocked(payer, payee, 1_000_000_000, "ATTESTATION_INVALID");
        bool success = facilitator.facilitate(payer, payee, 1_000_000_000, receiptHash);
        assertFalse(success);
    }

    function test_facilitate_spendingLimitEnforced() public {
        bytes32 receiptHash = keccak256("spending-receipt");
        _attestInRegistry(receiptHash);

        vm.prank(admin);
        facilitator.setSpendingLimit(payer, 500_000_000); // 500 USDC

        vm.prank(settler);
        vm.expectRevert(ProofLinkFacilitator.SpendingLimitExceeded.selector);
        facilitator.facilitate(payer, payee, 600_000_000, receiptHash);
    }

    function test_facilitate_revert_amountExceedsUint128Max() public {
        bytes32 receiptHash = keccak256("overflow-receipt");
        _attestInRegistry(receiptHash);

        vm.prank(admin);
        facilitator.setSpendingLimit(payer, type(uint128).max);

        // Amount exceeds uint128 max
        uint256 hugeAmount = uint256(type(uint128).max) + 1;

        vm.prank(settler);
        vm.expectRevert(ProofLinkFacilitator.AmountExceedsUint128Max.selector);
        facilitator.facilitate(payer, payee, hugeAmount, receiptHash);
    }

    function test_facilitate_spendingLimitAccumulates() public {
        bytes32 receiptHash1 = keccak256("spending-receipt-1");
        bytes32 receiptHash2 = keccak256("spending-receipt-2");
        _attestInRegistry(receiptHash1);
        _attestInRegistry(receiptHash2);

        vm.prank(admin);
        facilitator.setSpendingLimit(payer, 1_500_000_000); // 1500 USDC

        // First: 1000 USDC
        vm.prank(settler);
        facilitator.facilitate(payer, payee, 1_000_000_000, receiptHash1);

        // Second: 600 USDC (total 1600 > 1500)
        vm.prank(settler);
        vm.expectRevert(ProofLinkFacilitator.SpendingLimitExceeded.selector);
        facilitator.facilitate(payer, payee, 600_000_000, receiptHash2);
    }

    // ──────────────────────────────────────────────
    // Integration: facilitate() with ProofLinkRegistry
    // ──────────────────────────────────────────────

    function test_facilitate_integration_fullFlow() public {
        // 1. Create attestation in registry
        bytes32 receiptHash = keccak256("integration-receipt");
        _attestInRegistry(receiptHash);

        // 2. Verify attestation exists
        (bool valid, , uint8 status) = registry.verify(receiptHash);
        assertTrue(valid);
        assertEq(status, 0);

        // 3. Facilitate payment
        vm.prank(settler);
        bool success = facilitator.facilitate(payer, payee, 1_000_000_000, receiptHash);
        assertTrue(success);
    }

    function test_facilitate_integration_revokeBlocksPayment() public {
        // 1. Create attestation
        bytes32 receiptHash = keccak256("revoke-flow");
        _attestInRegistry(receiptHash);

        // 2. Facilitate first payment succeeds
        vm.prank(settler);
        bool success1 = facilitator.facilitate(payer, payee, 500_000_000, receiptHash);
        assertTrue(success1);

        // 3. Revoke the attestation
        vm.prank(admin);
        registry.revoke(receiptHash);

        // 4. Subsequent facilitation fails
        vm.prank(settler);
        vm.expectRevert(ProofLinkFacilitator.SanctionsHit.selector);
        facilitator.facilitate(payer, payee, 500_000_000, receiptHash);
    }

    // ──────────────────────────────────────────────
    // Admin: setContractAddresses
    // ──────────────────────────────────────────────

    function test_setContractAddresses() public {
        address newRegistry = makeAddr("newRegistry");
        address newKya = makeAddr("newKya");

        vm.prank(admin);
        facilitator.setContractAddresses(newRegistry, newKya);

        assertEq(address(facilitator.proofLinkRegistry()), newRegistry);
        assertEq(address(facilitator.kyaContract()), newKya);
    }

    function test_setContractAddresses_revert_zeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(ProofLinkFacilitator.ZeroAddress.selector);
        facilitator.setContractAddresses(address(0), makeAddr("kya"));
    }

    function test_setFailMode() public {
        vm.prank(admin);
        facilitator.setFailMode(false);
        assertFalse(facilitator.failClosed());

        vm.prank(admin);
        facilitator.setFailMode(true);
        assertTrue(facilitator.failClosed());
    }

    function test_setFailMode_emitsEvent() public {
        vm.prank(admin);
        vm.expectEmit(false, false, false, true);
        emit ProofLinkFacilitator.FailModeChanged(false);
        facilitator.setFailMode(false);
    }

    function test_setSpendingLimit_emitsEvent() public {
        vm.prank(admin);
        vm.expectEmit(true, false, false, true);
        emit ProofLinkFacilitator.SpendingLimitSet(payer, 1_000_000_000);
        facilitator.setSpendingLimit(payer, 1_000_000_000);
    }

    function test_pause_revert_unauthorized() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        facilitator.pause();
    }

    function test_unpause_revert_unauthorized() public {
        vm.prank(admin);
        facilitator.pause();

        vm.prank(unauthorized);
        vm.expectRevert();
        facilitator.unpause();
    }
}
