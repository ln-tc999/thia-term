// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test, console2} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {ProofLinkFacilitator} from "../src/ProofLinkFacilitator.sol";
import {ProofLinkRegistry} from "../src/ProofLinkRegistry.sol";
import {ProofLinkKYA} from "../src/ProofLinkKYA.sol";
import {AgentInvoice} from "../src/AgentInvoice.sol";
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

// ──────────────────────────────────────────────
// Mocks (scoped to this test file)
// ──────────────────────────────────────────────

contract AuditMockEAS is IEAS {
    uint256 private _counter;
    mapping(bytes32 => Attestation) private _attestations;

    function attest(AttestationRequest calldata request) external payable returns (bytes32) {
        _counter++;
        bytes32 uid = keccak256(abi.encodePacked(_counter, request.data.recipient));
        _attestations[uid] = Attestation({
            uid: uid,
            schema: request.schema,
            time: uint64(block.timestamp),
            expirationTime: request.data.expirationTime,
            revocationTime: 0,
            refUID: request.data.refUID,
            attester: msg.sender,
            recipient: request.data.recipient,
            revocable: request.data.revocable,
            data: request.data.data
        });
        return uid;
    }

    function multiAttest(MultiAttestationRequest[] calldata) external payable returns (bytes32[] memory) {
        return new bytes32[](0);
    }

    function revoke(RevocationRequest calldata request) external payable {
        _attestations[request.data.uid].revocationTime = uint64(block.timestamp);
    }

    function getAttestation(bytes32 uid) external view returns (Attestation memory) {
        return _attestations[uid];
    }

    function isAttestationValid(bytes32 uid) external view returns (bool) {
        return _attestations[uid].uid != bytes32(0) && _attestations[uid].revocationTime == 0;
    }
}

contract AuditMockSchemaRegistry is ISchemaRegistry {
    uint256 private _counter;

    function register(string calldata, address, bool) external returns (bytes32) {
        _counter++;
        return keccak256(abi.encodePacked("schema", _counter));
    }
}

contract AuditMockIdentityRegistry is IERC8004IdentityRegistry {
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

contract AuditMockValidationRegistry is IERC8004ValidationRegistry {
    function validationResponse(bytes32, uint256, string calldata, bytes32, string calldata) external {}
}

// ──────────────────────────────────────────────
// Audit Findings Test Suite
// ──────────────────────────────────────────────

contract AuditFindingsTest is Test {
    ProofLinkFacilitator public facilitator;
    ProofLinkRegistry public registry;
    ProofLinkKYA public kya;
    AgentInvoice public invoice;
    AuditMockEAS public mockEAS;
    AuditMockSchemaRegistry public mockSchemaRegistry;
    AuditMockIdentityRegistry public mockIdentityRegistry;
    AuditMockValidationRegistry public mockValidationRegistry;

    // Implementation addresses (for upgrade tests)
    ProofLinkFacilitator public facilitatorImpl;
    ProofLinkRegistry public registryImpl;
    ProofLinkKYA public kyaImpl;
    AgentInvoice public invoiceImpl;

    // Proxy addresses (raw)
    ERC1967Proxy public facilitatorProxy;
    ERC1967Proxy public registryProxy;
    ERC1967Proxy public kyaProxy;
    ERC1967Proxy public invoiceProxy;

    address public admin = makeAddr("admin");
    address public settler = makeAddr("settler");
    address public payer = makeAddr("payer");
    address public payee = makeAddr("payee");
    address public token = makeAddr("token");
    address public attester = makeAddr("attester");

    function setUp() public {
        mockEAS = new AuditMockEAS();
        mockSchemaRegistry = new AuditMockSchemaRegistry();
        mockIdentityRegistry = new AuditMockIdentityRegistry();
        mockValidationRegistry = new AuditMockValidationRegistry();

        // Deploy ProofLinkRegistry via proxy
        registryImpl = new ProofLinkRegistry();
        bytes memory registryInit =
            abi.encodeCall(ProofLinkRegistry.initialize, (address(mockEAS), address(mockSchemaRegistry), admin));
        registryProxy = new ERC1967Proxy(address(registryImpl), registryInit);
        registry = ProofLinkRegistry(address(registryProxy));

        // Register schema
        vm.prank(admin);
        registry.registerSchema();

        // Grant attester role
        bytes32 attesterRole = registry.ATTESTER_ROLE();
        vm.prank(admin);
        registry.grantRole(attesterRole, attester);

        // Deploy ProofLinkKYA via proxy
        kyaImpl = new ProofLinkKYA();
        bytes memory kyaInit = abi.encodeCall(
            ProofLinkKYA.initialize, (address(mockIdentityRegistry), address(mockValidationRegistry), admin)
        );
        kyaProxy = new ERC1967Proxy(address(kyaImpl), kyaInit);
        kya = ProofLinkKYA(address(kyaProxy));

        // Grant KYA verifier role
        bytes32 verifierRole = kya.VERIFIER_ROLE();
        vm.prank(admin);
        kya.grantRole(verifierRole, admin);

        // Deploy ProofLinkFacilitator via proxy
        facilitatorImpl = new ProofLinkFacilitator();
        bytes memory facInit =
            abi.encodeCall(ProofLinkFacilitator.initialize, (address(registry), address(kya), admin));
        facilitatorProxy = new ERC1967Proxy(address(facilitatorImpl), facInit);
        facilitator = ProofLinkFacilitator(address(facilitatorProxy));

        // Grant roles on facilitator
        vm.startPrank(admin);
        facilitator.grantRole(facilitator.SETTLER_ROLE(), settler);
        registry.grantRole(registry.ATTESTER_ROLE(), address(facilitator));
        vm.stopPrank();

        // Deploy AgentInvoice via proxy
        invoiceImpl = new AgentInvoice();
        bytes memory invoiceInit = abi.encodeCall(AgentInvoice.initialize, (admin));
        invoiceProxy = new ERC1967Proxy(address(invoiceImpl), invoiceInit);
        invoice = AgentInvoice(address(invoiceProxy));
    }

    // ══════════════════════════════════════════════
    // 1. Double-initialization tests
    // ══════════════════════════════════════════════

    function test_doubleInit_registry_reverts() public {
        vm.expectRevert();
        registry.initialize(address(mockEAS), address(mockSchemaRegistry), admin);
    }

    function test_doubleInit_facilitator_reverts() public {
        vm.expectRevert();
        facilitator.initialize(address(registry), address(kya), admin);
    }

    function test_doubleInit_kya_reverts() public {
        vm.expectRevert();
        kya.initialize(address(mockIdentityRegistry), address(mockValidationRegistry), admin);
    }

    function test_doubleInit_invoice_reverts() public {
        vm.expectRevert();
        invoice.initialize(admin);
    }

    // Also verify the implementation contracts themselves cannot be initialized
    function test_doubleInit_registryImpl_reverts() public {
        vm.expectRevert();
        registryImpl.initialize(address(mockEAS), address(mockSchemaRegistry), admin);
    }

    function test_doubleInit_facilitatorImpl_reverts() public {
        vm.expectRevert();
        facilitatorImpl.initialize(address(registry), address(kya), admin);
    }

    function test_doubleInit_kyaImpl_reverts() public {
        vm.expectRevert();
        kyaImpl.initialize(address(mockIdentityRegistry), address(mockValidationRegistry), admin);
    }

    function test_doubleInit_invoiceImpl_reverts() public {
        vm.expectRevert();
        invoiceImpl.initialize(admin);
    }

    // ══════════════════════════════════════════════
    // 2. txHash collision test
    // ══════════════════════════════════════════════

    /// @dev Tests that anchoring two receipts with the same paymentTxHash reverts on the second call.
    ///      Depends on the DuplicateReceipt guard in ProofLinkRegistry.anchorReceipt().
    function test_anchorReceipt_revert_duplicateTxHash() public {
        bytes32 receiptId1 = keccak256("receipt-txhash-1");
        bytes32 receiptId2 = keccak256("receipt-txhash-2");
        bytes32 sharedTxHash = keccak256("shared-tx-hash");

        // First anchor should succeed
        vm.prank(attester);
        registry.anchorReceipt(
            receiptId1, sharedTxHash, 8453, payer, payee, 1_000_000_000, token, keccak256("ipfs1"), 25, 0x000F, true
        );

        // Second anchor with same txHash but different receiptId should revert
        vm.prank(attester);
        vm.expectRevert(ProofLinkRegistry.DuplicateReceipt.selector);
        registry.anchorReceipt(
            receiptId2, sharedTxHash, 8453, payer, payee, 500_000_000, token, keccak256("ipfs2"), 10, 0x000F, true
        );
    }

    // ══════════════════════════════════════════════
    // 3. Sanctions bitmask tests
    // ══════════════════════════════════════════════

    /// @dev Sanctions flags layout:
    ///   bits 0-3 (0x000F): screening list indicators (which lists were checked)
    ///   bits 8-11 (0x0F00): match indicators (sanctions hit on which list)
    ///   A payment is non-compliant if any match bit (8-11) is set.

    function test_isPaymentCompliant_sanctionsMatch_returnsFalse() public {
        // Anchor a receipt with OFAC match bit set (bit 8 = 0x0100)
        bytes32 receiptId = keccak256("sanctions-match");
        bytes32 txHash = keccak256("sanctions-match-tx");
        uint16 flagsWithMatch = 0x010F; // bits 0-3 set (screened all) + bit 8 set (OFAC match)

        vm.prank(attester);
        registry.anchorReceipt(receiptId, txHash, 8453, payer, payee, 1_000_000_000, token, keccak256("ipfs"), 25, flagsWithMatch, true);

        assertFalse(registry.isPaymentCompliant(txHash), "Should be non-compliant when sanctions match bits are set");
    }

    function test_isPaymentCompliant_allMatchBits_returnsFalse() public {
        // All match bits set (0x0F00)
        bytes32 receiptId = keccak256("all-sanctions-match");
        bytes32 txHash = keccak256("all-sanctions-match-tx");
        uint16 flagsAllMatches = 0x0F0F; // all screening bits + all match bits

        vm.prank(attester);
        registry.anchorReceipt(receiptId, txHash, 8453, payer, payee, 1_000_000_000, token, keccak256("ipfs"), 25, flagsAllMatches, true);

        assertFalse(registry.isPaymentCompliant(txHash), "Should be non-compliant when all match bits are set");
    }

    function test_isPaymentCompliant_screeningBitsOnly_returnsTrue() public {
        // Only screening bits set (bits 0-3), no match bits
        bytes32 receiptId = keccak256("screening-only");
        bytes32 txHash = keccak256("screening-only-tx");
        uint16 flagsScreenOnly = 0x000F; // all 4 lists checked, no matches

        vm.prank(attester);
        registry.anchorReceipt(receiptId, txHash, 8453, payer, payee, 1_000_000_000, token, keccak256("ipfs"), 25, flagsScreenOnly, true);

        assertTrue(registry.isPaymentCompliant(txHash), "Should be compliant when only screening bits are set (no matches)");
    }

    function test_isPaymentCompliant_noFlagsAtAll_returnsTrue() public {
        // Zero flags = no screening done, no matches
        bytes32 receiptId = keccak256("no-flags");
        bytes32 txHash = keccak256("no-flags-tx");
        uint16 flagsNone = 0x0000;

        vm.prank(attester);
        registry.anchorReceipt(receiptId, txHash, 8453, payer, payee, 1_000_000_000, token, keccak256("ipfs"), 25, flagsNone, true);

        assertTrue(registry.isPaymentCompliant(txHash), "Should be compliant with zero flags");
    }

    function test_verify_sanctionsHit_individualBits() public {
        // Test each individual match bit through the facilitator verify function
        Types.PaymentPayload memory payload = _makePayload(1);
        Types.ComplianceAttestation memory compliance = _makeCompliance(keccak256("r"));

        // Bit 8 (OFAC match): 0x0100
        compliance.sanctionsFlags = 0x0100;
        (bool c1,) = facilitator.verify(payload, compliance);
        assertFalse(c1, "Bit 8 (OFAC match) should trigger SANCTIONS_HIT");

        // Bit 9 (EU match): 0x0200
        compliance.sanctionsFlags = 0x0200;
        (bool c2,) = facilitator.verify(payload, compliance);
        assertFalse(c2, "Bit 9 (EU match) should trigger SANCTIONS_HIT");

        // Bit 10 (UN match): 0x0400
        compliance.sanctionsFlags = 0x0400;
        (bool c3,) = facilitator.verify(payload, compliance);
        assertFalse(c3, "Bit 10 (UN match) should trigger SANCTIONS_HIT");

        // Bit 11 (HMT match): 0x0800
        compliance.sanctionsFlags = 0x0800;
        (bool c4,) = facilitator.verify(payload, compliance);
        assertFalse(c4, "Bit 11 (HMT match) should trigger SANCTIONS_HIT");
    }

    function test_verify_screeningBitsOnly_compliant() public {
        Types.PaymentPayload memory payload = _makePayload(1);
        Types.ComplianceAttestation memory compliance = _makeCompliance(keccak256("r"));

        // Only screening bits 0-3 set
        compliance.sanctionsFlags = 0x000F;
        (bool isCompliant, string memory reason) = facilitator.verify(payload, compliance);
        assertTrue(isCompliant, "Screening bits only should be compliant");
        assertEq(bytes(reason).length, 0);
    }

    // ══════════════════════════════════════════════
    // 4. Spending limit day boundary test
    // ══════════════════════════════════════════════

    function test_spendingLimit_resetsAfterDayBoundary() public {
        vm.prank(admin);
        facilitator.setSpendingLimit(payer, 1_000_000_000); // 1000 USDC daily limit

        // Warp to a known timestamp (start of a day)
        uint256 dayStart = 1000 days;
        vm.warp(dayStart);

        // First settlement: 900 USDC (under limit)
        Types.PaymentPayload memory payload1 = _makePayload(1);
        payload1.amount = 900_000_000;
        Types.ComplianceAttestation memory compliance1 = _makeCompliance(keccak256("receipt-day-1"));

        vm.prank(settler);
        facilitator.settle(payload1, compliance1);

        // Verify remaining limit
        uint128 remaining = facilitator.getRemainingDailyLimit(payer);
        assertEq(remaining, 100_000_000, "Should have 100 USDC remaining");

        // Second settlement same day: 200 USDC (exceeds limit)
        Types.PaymentPayload memory payload2 = _makePayload(2);
        payload2.amount = 200_000_000;
        Types.ComplianceAttestation memory compliance2 = _makeCompliance(keccak256("receipt-day-2"));

        vm.prank(settler);
        vm.expectRevert(ProofLinkFacilitator.SpendingLimitExceeded.selector);
        facilitator.settle(payload2, compliance2);

        // Warp past day boundary (advance 1 full day)
        vm.warp(dayStart + 1 days);

        // After day boundary, the daily limit should reset
        uint128 remainingNextDay = facilitator.getRemainingDailyLimit(payer);
        assertEq(remainingNextDay, 1_000_000_000, "Daily limit should fully reset after day boundary");

        // Now 200 USDC should succeed
        Types.PaymentPayload memory payload3 = _makePayload(3);
        payload3.amount = 200_000_000;
        payload3.deadline = block.timestamp + 1 hours;
        Types.ComplianceAttestation memory compliance3 = _makeCompliance(keccak256("receipt-day-3"));

        vm.prank(settler);
        bytes32 sid = facilitator.settle(payload3, compliance3);
        assertTrue(sid != bytes32(0), "Settlement should succeed after day boundary reset");
    }

    function test_spendingLimit_dayBoundary_facilitate() public {
        // Also test via the simplified facilitate() API
        bytes32 receiptHash1 = keccak256("fac-day-1");
        bytes32 receiptHash2 = keccak256("fac-day-2");

        vm.startPrank(attester);
        registry.attest(receiptHash1, payer, payee, 900_000_000, "base", 0);
        registry.attest(receiptHash2, payer, payee, 900_000_000, "base", 0);
        vm.stopPrank();

        vm.prank(admin);
        facilitator.setSpendingLimit(payer, 1_000_000_000); // 1000 USDC

        uint256 dayStart = 2000 days;
        vm.warp(dayStart);

        // First: 900 USDC
        vm.prank(settler);
        facilitator.facilitate(payer, payee, 900_000_000, receiptHash1);

        // Warp past day boundary
        vm.warp(dayStart + 1 days);

        // Should succeed after reset
        vm.prank(settler);
        bool success = facilitator.facilitate(payer, payee, 900_000_000, receiptHash2);
        assertTrue(success, "facilitate should succeed after day boundary reset");
    }

    // ══════════════════════════════════════════════
    // 5. Fuzz tests
    // ══════════════════════════════════════════════

    /// @dev Fuzz: risk score validation. riskScore > 100 must be rejected by anchorReceipt,
    ///      riskScore <= 100 must be accepted.
    function testFuzz_riskScoreValidation(uint8 riskScore) public {
        bytes32 receiptId = keccak256(abi.encodePacked("fuzz-risk", riskScore));
        bytes32 txHash = keccak256(abi.encodePacked("fuzz-risk-tx", riskScore));

        if (riskScore > 100) {
            vm.prank(attester);
            vm.expectRevert(ProofLinkRegistry.InvalidRiskScore.selector);
            registry.anchorReceipt(receiptId, txHash, 8453, payer, payee, 1_000_000_000, token, keccak256("ipfs"), riskScore, 0x000F, true);
        } else {
            vm.prank(attester);
            bytes32 easUID = registry.anchorReceipt(
                receiptId, txHash, 8453, payer, payee, 1_000_000_000, token, keccak256("ipfs"), riskScore, 0x000F, true
            );
            assertTrue(easUID != bytes32(0), "Valid risk score should produce EAS UID");
        }
    }

    /// @dev Fuzz: spending limits. If amount > limit (and limit > 0), verify should fail.
    ///      If amount <= limit or limit == 0, verify should pass (assuming other checks pass).
    function testFuzz_amountSpendingLimit(uint128 amount, uint128 limit) public {
        // Bound to avoid zero-amount revert and unrealistic values
        amount = uint128(bound(amount, 1, type(uint128).max / 2));
        // limit of 0 means unlimited

        vm.prank(admin);
        facilitator.setSpendingLimit(payer, limit);

        Types.PaymentPayload memory payload = _makePayload(1);
        payload.amount = amount;
        Types.ComplianceAttestation memory compliance = _makeCompliance(keccak256("fuzz-spend"));
        // Ensure other checks pass: low risk, no sanctions, no KYA required
        compliance.riskScore = 0;
        compliance.sanctionsFlags = 0;
        compliance.kyaVerified = false;

        (bool isCompliant, string memory reason) = facilitator.verify(payload, compliance);

        if (limit == 0) {
            // Unlimited: should always pass
            assertTrue(isCompliant, "Unlimited spending should always be compliant");
            assertEq(bytes(reason).length, 0);
        } else if (amount > limit) {
            // Over limit: should fail
            assertFalse(isCompliant, "Amount exceeding limit should be non-compliant");
            assertEq(reason, "SPENDING_LIMIT_EXCEEDED");
        } else {
            // Under or equal to limit: should pass
            assertTrue(isCompliant, "Amount within limit should be compliant");
            assertEq(bytes(reason).length, 0);
        }
    }

    // ══════════════════════════════════════════════
    // 6. Upgrade test: deploy v1, write state, upgrade to v2, verify state preserved
    // ══════════════════════════════════════════════

    function test_upgrade_registryPreservesState() public {
        // Step 1: Write state to v1 proxy
        bytes32 receiptId = keccak256("upgrade-receipt");
        bytes32 txHash = keccak256("upgrade-tx");

        vm.prank(attester);
        bytes32 easUID = registry.anchorReceipt(
            receiptId, txHash, 8453, payer, payee, 1_000_000_000, token, keccak256("ipfs-upgrade"), 25, 0x000F, true
        );

        // Verify state exists before upgrade
        (Types.ProofLinkReceipt memory receiptBefore, bool revokedBefore) = registry.verifyReceipt(receiptId);
        assertEq(receiptBefore.payer, payer);
        assertEq(receiptBefore.amount, 1_000_000_000);
        assertFalse(revokedBefore);

        // Step 2: Deploy new implementation and upgrade
        ProofLinkRegistry newImpl = new ProofLinkRegistry();
        vm.prank(admin);
        registry.upgradeToAndCall(address(newImpl), "");

        // Step 3: Verify state is preserved after upgrade
        (Types.ProofLinkReceipt memory receiptAfter, bool revokedAfter) = registry.verifyReceipt(receiptId);
        assertEq(receiptAfter.payer, payer);
        assertEq(receiptAfter.payee, payee);
        assertEq(receiptAfter.amount, 1_000_000_000);
        assertEq(receiptAfter.riskScore, 25);
        assertEq(receiptAfter.receiptId, receiptId);
        assertEq(receiptAfter.easAttestationUID, easUID);
        assertFalse(revokedAfter);

        // Verify EAS mapping preserved
        assertEq(registry.receiptToEAS(receiptId), easUID);
        assertEq(registry.txHashToReceipt(txHash), receiptId);

        // Verify can still write new data after upgrade
        bytes32 receiptId2 = keccak256("post-upgrade-receipt");
        bytes32 txHash2 = keccak256("post-upgrade-tx");

        vm.prank(attester);
        bytes32 easUID2 = registry.anchorReceipt(
            receiptId2, txHash2, 8453, payer, payee, 500_000_000, token, keccak256("ipfs2"), 10, 0, true
        );
        assertTrue(easUID2 != bytes32(0));
    }

    function test_upgrade_facilitatorPreservesState() public {
        // Step 1: Write state — set spending limit and perform settlement
        vm.prank(admin);
        facilitator.setSpendingLimit(payer, 5_000_000_000);

        Types.PaymentPayload memory payload = _makePayload(1);
        Types.ComplianceAttestation memory compliance = _makeCompliance(keccak256("upgrade-fac-receipt"));

        vm.prank(settler);
        bytes32 settlementId = facilitator.settle(payload, compliance);

        // Verify state before upgrade
        assertTrue(facilitator.isNonceUsed(1));
        assertEq(facilitator.spendingLimits(payer), 5_000_000_000);
        Types.SettlementRecord memory recordBefore = facilitator.getSettlement(settlementId);
        assertEq(recordBefore.payer, payer);

        // Step 2: Deploy new implementation and upgrade
        ProofLinkFacilitator newImpl = new ProofLinkFacilitator();
        vm.prank(admin);
        facilitator.upgradeToAndCall(address(newImpl), "");

        // Step 3: Verify state preserved
        assertTrue(facilitator.isNonceUsed(1));
        assertEq(facilitator.spendingLimits(payer), 5_000_000_000);
        Types.SettlementRecord memory recordAfter = facilitator.getSettlement(settlementId);
        assertEq(recordAfter.payer, payer);
        assertEq(recordAfter.amount, 1_000_000_000);
    }

    function test_upgrade_kyaPreservesState() public {
        // Step 1: Issue KYA credential
        vm.prank(admin);
        kya.issueKYA(payer, keccak256("kya-cred"), uint64(block.timestamp + 365 days));

        // Verify before upgrade
        (bool validBefore,,) = kya.verifyKYA(payer);
        assertTrue(validBefore);

        // Step 2: Upgrade
        ProofLinkKYA newImpl = new ProofLinkKYA();
        vm.prank(admin);
        kya.upgradeToAndCall(address(newImpl), "");

        // Step 3: Verify state preserved
        (bool validAfter, bytes32 hash, uint64 expiry) = kya.verifyKYA(payer);
        assertTrue(validAfter);
        assertEq(hash, keccak256("kya-cred"));
        assertTrue(expiry > block.timestamp);
    }

    function test_upgrade_invoicePreservesState() public {
        // Step 1: Anchor invoice
        vm.prank(payer);
        invoice.createInvoice(keccak256("inv-upgrade"), payer, payee, 5_000e6, "USDC");

        // Verify before upgrade
        Types.InvoiceInfo memory infoBefore = invoice.getInvoice(keccak256("inv-upgrade"));
        assertEq(infoBefore.payer, payer);

        // Step 2: Upgrade
        AgentInvoice newImpl = new AgentInvoice();
        vm.prank(admin);
        invoice.upgradeToAndCall(address(newImpl), "");

        // Step 3: Verify state preserved
        Types.InvoiceInfo memory infoAfter = invoice.getInvoice(keccak256("inv-upgrade"));
        assertEq(infoAfter.payer, payer);
        assertEq(infoAfter.payee, payee);
        assertEq(infoAfter.amount, 5_000e6);
        assertEq(infoAfter.currency, "USDC");
        assertFalse(infoAfter.paid);
    }

    function test_upgrade_revert_unauthorized() public {
        address unauthorized = makeAddr("unauthorized");
        ProofLinkRegistry newImpl = new ProofLinkRegistry();

        vm.prank(unauthorized);
        vm.expectRevert();
        registry.upgradeToAndCall(address(newImpl), "");
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
}
