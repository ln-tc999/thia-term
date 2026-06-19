// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test, console2} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {ProofLinkRegistry} from "../src/ProofLinkRegistry.sol";
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

/// @dev Mock EAS contract for testing.
contract MockEAS is IEAS {
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
        bytes32[] memory uids = new bytes32[](0);
        return uids;
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

/// @dev Mock SchemaRegistry for testing.
contract MockSchemaRegistry is ISchemaRegistry {
    uint256 private _counter;

    function register(string calldata, address, bool) external returns (bytes32) {
        _counter++;
        return keccak256(abi.encodePacked("schema", _counter));
    }
}

contract ProofLinkRegistryTest is Test {
    ProofLinkRegistry public registry;
    MockEAS public mockEAS;
    MockSchemaRegistry public mockSchemaRegistry;

    address public admin = makeAddr("admin");
    address public attester = makeAddr("attester");
    address public payer = makeAddr("payer");
    address public payee = makeAddr("payee");
    address public unauthorized = makeAddr("unauthorized");
    address public token = makeAddr("token");

    function setUp() public {
        mockEAS = new MockEAS();
        mockSchemaRegistry = new MockSchemaRegistry();

        ProofLinkRegistry impl = new ProofLinkRegistry();
        bytes memory initData =
            abi.encodeCall(ProofLinkRegistry.initialize, (address(mockEAS), address(mockSchemaRegistry), admin));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        registry = ProofLinkRegistry(address(proxy));

        // Grant attester role
        bytes32 attesterRole = registry.ATTESTER_ROLE();
        vm.prank(admin);
        registry.grantRole(attesterRole, attester);
    }

    // ──────────────────────────────────────────────
    // Initialization
    // ──────────────────────────────────────────────

    function test_initialize() public view {
        assertEq(address(registry.eas()), address(mockEAS));
        assertEq(address(registry.schemaRegistry()), address(mockSchemaRegistry));
        assertEq(registry.riskThreshold(), 50);
        assertTrue(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(registry.hasRole(registry.ATTESTER_ROLE(), admin));
        assertTrue(registry.hasRole(registry.ATTESTER_ROLE(), attester));
    }

    function test_initialize_revert_zeroAddress() public {
        ProofLinkRegistry impl = new ProofLinkRegistry();
        vm.expectRevert(ProofLinkRegistry.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(ProofLinkRegistry.initialize, (address(0), address(mockSchemaRegistry), admin))
        );
    }

    // ──────────────────────────────────────────────
    // Schema Registration
    // ──────────────────────────────────────────────

    function test_registerSchema() public {
        vm.prank(admin);
        bytes32 uid = registry.registerSchema();
        assertTrue(uid != bytes32(0));
        assertEq(registry.schemaUID(), uid);
    }

    function test_registerSchema_revert_alreadyRegistered() public {
        vm.prank(admin);
        registry.registerSchema();

        vm.prank(admin);
        vm.expectRevert(ProofLinkRegistry.SchemaAlreadyRegistered.selector);
        registry.registerSchema();
    }

    function test_registerSchema_revert_unauthorized() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        registry.registerSchema();
    }

    // ──────────────────────────────────────────────
    // Receipt Anchoring
    // ──────────────────────────────────────────────

    function _registerSchemaAndAnchor() internal returns (bytes32 receiptId, bytes32 easUID) {
        vm.prank(admin);
        registry.registerSchema();

        receiptId = keccak256("receipt1");
        bytes32 txHash = keccak256("tx1");

        vm.prank(attester);
        easUID = registry.anchorReceipt(
            receiptId,
            txHash,
            8453, // Base chain ID
            payer,
            payee,
            1_000_000_000, // 1000 USDC
            token,
            keccak256("ipfs-hash"),
            25, // risk score
            0x000F, // all 4 lists screened, no matches
            true // travel rule compliant
        );
    }

    function test_anchorReceipt() public {
        (bytes32 receiptId, bytes32 easUID) = _registerSchemaAndAnchor();

        assertTrue(easUID != bytes32(0));
        assertEq(registry.receiptToEAS(receiptId), easUID);
        assertEq(registry.txHashToReceipt(keccak256("tx1")), receiptId);
    }

    function test_anchorReceipt_emitsEvent() public {
        vm.prank(admin);
        registry.registerSchema();

        bytes32 receiptId = keccak256("receipt1");

        vm.prank(attester);
        vm.expectEmit(true, true, true, false);
        emit ProofLinkRegistry.ReceiptAnchored(receiptId, payer, payee, bytes32(0));
        registry.anchorReceipt(
            receiptId, keccak256("tx1"), 8453, payer, payee, 1_000_000_000, token, keccak256("ipfs"), 25, 0x000F, true
        );
    }

    function test_anchorReceipt_revert_duplicate() public {
        _registerSchemaAndAnchor();

        vm.prank(attester);
        vm.expectRevert(ProofLinkRegistry.ReceiptAlreadyExists.selector);
        registry.anchorReceipt(
            keccak256("receipt1"), keccak256("tx2"), 8453, payer, payee, 500, token, keccak256("ipfs2"), 10, 0, true
        );
    }

    function test_anchorReceipt_revert_noSchema() public {
        vm.prank(attester);
        vm.expectRevert(ProofLinkRegistry.SchemaNotRegistered.selector);
        registry.anchorReceipt(
            keccak256("receipt1"), keccak256("tx1"), 8453, payer, payee, 1000, token, keccak256("ipfs"), 25, 0, true
        );
    }

    function test_anchorReceipt_revert_invalidRiskScore() public {
        vm.prank(admin);
        registry.registerSchema();

        vm.prank(attester);
        vm.expectRevert(ProofLinkRegistry.InvalidRiskScore.selector);
        registry.anchorReceipt(
            keccak256("receipt1"), keccak256("tx1"), 8453, payer, payee, 1000, token, keccak256("ipfs"), 101, 0, true
        );
    }

    function test_anchorReceipt_revert_unauthorized() public {
        vm.prank(admin);
        registry.registerSchema();

        vm.prank(unauthorized);
        vm.expectRevert();
        registry.anchorReceipt(
            keccak256("receipt1"), keccak256("tx1"), 8453, payer, payee, 1000, token, keccak256("ipfs"), 25, 0, true
        );
    }

    // ──────────────────────────────────────────────
    // Verification
    // ──────────────────────────────────────────────

    function test_verifyReceipt() public {
        (bytes32 receiptId,) = _registerSchemaAndAnchor();

        (Types.ProofLinkReceipt memory receipt, bool isRevoked) = registry.verifyReceipt(receiptId);
        assertFalse(isRevoked);
        assertEq(receipt.receiptId, receiptId);
        assertEq(receipt.payer, payer);
        assertEq(receipt.payee, payee);
        assertEq(receipt.amount, 1_000_000_000);
        assertEq(receipt.riskScore, 25);
        assertEq(receipt.sanctionsFlags, 0x000F);
        assertTrue(receipt.travelRuleCompliant);
        assertEq(receipt.chainId, 8453);
    }

    function test_verifyReceipt_revert_notFound() public {
        vm.expectRevert(ProofLinkRegistry.ReceiptNotFound.selector);
        registry.verifyReceipt(keccak256("nonexistent"));
    }

    function test_getReceiptByTxHash() public {
        _registerSchemaAndAnchor();

        (Types.ProofLinkReceipt memory receipt,) = registry.getReceiptByTxHash(keccak256("tx1"));
        assertEq(receipt.payer, payer);
    }

    function test_isPaymentCompliant() public {
        _registerSchemaAndAnchor();
        assertTrue(registry.isPaymentCompliant(keccak256("tx1")));
    }

    function test_isPaymentCompliant_false_notFound() public view {
        assertFalse(registry.isPaymentCompliant(keccak256("nonexistent")));
    }

    function test_isPaymentCompliant_false_revoked() public {
        (bytes32 receiptId,) = _registerSchemaAndAnchor();

        vm.prank(admin);
        registry.revokeReceipt(receiptId, "fraud detected");

        assertFalse(registry.isPaymentCompliant(keccak256("tx1")));
    }

    // ──────────────────────────────────────────────
    // Revocation
    // ──────────────────────────────────────────────

    function test_revokeReceipt() public {
        (bytes32 receiptId,) = _registerSchemaAndAnchor();

        vm.prank(admin);
        registry.revokeReceipt(receiptId, "fraud detected");

        assertTrue(registry.revoked(receiptId));
    }

    function test_revokeReceipt_revert_notFound() public {
        vm.prank(admin);
        vm.expectRevert(ProofLinkRegistry.ReceiptNotFound.selector);
        registry.revokeReceipt(keccak256("nonexistent"), "reason");
    }

    function test_revokeReceipt_revert_alreadyRevoked() public {
        (bytes32 receiptId,) = _registerSchemaAndAnchor();

        vm.prank(admin);
        registry.revokeReceipt(receiptId, "first");

        vm.prank(admin);
        vm.expectRevert(ProofLinkRegistry.ReceiptAlreadyRevoked.selector);
        registry.revokeReceipt(receiptId, "second");
    }

    // ──────────────────────────────────────────────
    // Admin
    // ──────────────────────────────────────────────

    function test_verifyReceipt_showsRevokedFlag() public {
        (bytes32 receiptId,) = _registerSchemaAndAnchor();

        vm.prank(admin);
        registry.revokeReceipt(receiptId, "fraud");

        (, bool isRevoked) = registry.verifyReceipt(receiptId);
        assertTrue(isRevoked);
    }

    // ──────────────────────────────────────────────
    // IPFS Hash Update
    // ──────────────────────────────────────────────

    function test_updateIpfsHash() public {
        (bytes32 receiptId,) = _registerSchemaAndAnchor();
        bytes32 newHash = keccak256("new-ipfs-hash");

        vm.prank(attester);
        registry.updateIpfsHash(receiptId, newHash);

        (Types.ProofLinkReceipt memory receipt,) = registry.verifyReceipt(receiptId);
        assertEq(receipt.ipfsContentHash, newHash);
    }

    function test_updateIpfsHash_revert_emptyHash() public {
        (bytes32 receiptId,) = _registerSchemaAndAnchor();

        vm.prank(attester);
        vm.expectRevert(ProofLinkRegistry.InvalidIpfsHash.selector);
        registry.updateIpfsHash(receiptId, bytes32(0));
    }

    function test_updateIpfsHash_revert_notFound() public {
        vm.prank(attester);
        vm.expectRevert(ProofLinkRegistry.ReceiptNotFound.selector);
        registry.updateIpfsHash(keccak256("nonexistent"), keccak256("hash"));
    }

    function test_updateIpfsHash_revert_revoked() public {
        (bytes32 receiptId,) = _registerSchemaAndAnchor();

        vm.prank(admin);
        registry.revokeReceipt(receiptId, "fraud");

        vm.prank(attester);
        vm.expectRevert(ProofLinkRegistry.ReceiptAlreadyRevoked.selector);
        registry.updateIpfsHash(receiptId, keccak256("new-hash"));
    }

    function test_updateIpfsHash_revert_unauthorized() public {
        (bytes32 receiptId,) = _registerSchemaAndAnchor();

        vm.prank(unauthorized);
        vm.expectRevert();
        registry.updateIpfsHash(receiptId, keccak256("new-hash"));
    }

    // ──────────────────────────────────────────────
    // Admin
    // ──────────────────────────────────────────────

    function test_setRiskThreshold() public {
        vm.prank(admin);
        registry.setRiskThreshold(75);
        assertEq(registry.riskThreshold(), 75);
    }

    function test_setRiskThreshold_revert_tooHigh() public {
        vm.prank(admin);
        vm.expectRevert(ProofLinkRegistry.InvalidRiskThreshold.selector);
        registry.setRiskThreshold(101);
    }

    function test_setRiskThreshold_emitsEvent() public {
        vm.prank(admin);
        vm.expectEmit(false, false, false, true);
        emit ProofLinkRegistry.RiskThresholdUpdated(50, 75);
        registry.setRiskThreshold(75);
    }

    function test_setRiskThreshold_revert_unauthorized() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        registry.setRiskThreshold(75);
    }

    // ──────────────────────────────────────────────
    // Simplified API: attest()
    // ──────────────────────────────────────────────

    function _attestDefault() internal returns (bytes32 receiptHash) {
        receiptHash = keccak256("simple-receipt-1");
        vm.prank(attester);
        registry.attest(receiptHash, payer, payee, 1_000_000_000, "base", 0);
    }

    function test_attest_validData() public {
        bytes32 receiptHash = _attestDefault();

        (bool valid, uint256 timestamp, uint8 status) = registry.verify(receiptHash);
        assertTrue(valid);
        assertEq(timestamp, block.timestamp);
        assertEq(status, 0); // APPROVED
    }

    function test_attest_revert_withoutAttesterRole() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        registry.attest(keccak256("receipt"), payer, payee, 1000, "base", 0);
    }

    function test_attest_emitsComplianceAttestedEvent() public {
        bytes32 receiptHash = keccak256("event-receipt");

        vm.prank(attester);
        vm.expectEmit(true, true, true, true);
        emit ProofLinkRegistry.ComplianceAttested(receiptHash, payer, payee, 1_000_000_000, "base", 0);
        registry.attest(receiptHash, payer, payee, 1_000_000_000, "base", 0);
    }

    function test_attest_statusApproved() public {
        bytes32 receiptHash = keccak256("approved");
        vm.prank(attester);
        registry.attest(receiptHash, payer, payee, 1000, "base", 0);

        (, , uint8 status) = registry.verify(receiptHash);
        assertEq(status, 0);
    }

    function test_attest_statusRejected() public {
        bytes32 receiptHash = keccak256("rejected");
        vm.prank(attester);
        registry.attest(receiptHash, payer, payee, 1000, "base", 1);

        (, , uint8 status) = registry.verify(receiptHash);
        assertEq(status, 1);
    }

    function test_attest_statusEscalated() public {
        bytes32 receiptHash = keccak256("escalated");
        vm.prank(attester);
        registry.attest(receiptHash, payer, payee, 1000, "base", 2);

        (, , uint8 status) = registry.verify(receiptHash);
        assertEq(status, 2);
    }

    function test_attest_revert_invalidStatus() public {
        vm.prank(attester);
        vm.expectRevert(ProofLinkRegistry.InvalidStatus.selector);
        registry.attest(keccak256("bad"), payer, payee, 1000, "base", 3);
    }

    function test_attest_revert_zeroReceiptHash() public {
        vm.prank(attester);
        vm.expectRevert(ProofLinkRegistry.ReceiptNotFound.selector);
        registry.attest(bytes32(0), payer, payee, 1000, "base", 0);
    }

    function test_attest_revert_zeroSender() public {
        vm.prank(attester);
        vm.expectRevert(ProofLinkRegistry.ZeroAddress.selector);
        registry.attest(keccak256("r"), address(0), payee, 1000, "base", 0);
    }

    function test_attest_revert_zeroReceiver() public {
        vm.prank(attester);
        vm.expectRevert(ProofLinkRegistry.ZeroAddress.selector);
        registry.attest(keccak256("r"), payer, address(0), 1000, "base", 0);
    }

    function test_attest_revert_duplicate() public {
        bytes32 receiptHash = _attestDefault();

        vm.prank(attester);
        vm.expectRevert(ProofLinkRegistry.ReceiptAlreadyExists.selector);
        registry.attest(receiptHash, payer, payee, 2000, "ethereum", 1);
    }

    function test_attest_multipleForSameAddresses() public {
        bytes32 hash1 = keccak256("multi-1");
        bytes32 hash2 = keccak256("multi-2");
        bytes32 hash3 = keccak256("multi-3");

        vm.startPrank(attester);
        registry.attest(hash1, payer, payee, 1000, "base", 0);
        registry.attest(hash2, payer, payee, 2000, "ethereum", 1);
        registry.attest(hash3, payer, payee, 3000, "base", 2);
        vm.stopPrank();

        (bool v1, , uint8 s1) = registry.verify(hash1);
        (bool v2, , uint8 s2) = registry.verify(hash2);
        (bool v3, , uint8 s3) = registry.verify(hash3);

        assertTrue(v1);
        assertTrue(v2);
        assertTrue(v3);
        assertEq(s1, 0);
        assertEq(s2, 1);
        assertEq(s3, 2);
    }

    // ──────────────────────────────────────────────
    // Simplified API: verify()
    // ──────────────────────────────────────────────

    function test_verify_returnsCorrectData() public {
        bytes32 receiptHash = _attestDefault();

        (bool valid, uint256 timestamp, uint8 status) = registry.verify(receiptHash);
        assertTrue(valid);
        assertEq(timestamp, block.timestamp);
        assertEq(status, 0);
    }

    function test_verify_nonexistent() public view {
        (bool valid, uint256 timestamp, uint8 status) = registry.verify(keccak256("nope"));
        assertFalse(valid);
        assertEq(timestamp, 0);
        assertEq(status, 0);
    }

    function test_verify_revokedReturnsFalse() public {
        bytes32 receiptHash = _attestDefault();

        vm.prank(admin);
        registry.revoke(receiptHash);

        (bool valid, , ) = registry.verify(receiptHash);
        assertFalse(valid);
    }

    // ──────────────────────────────────────────────
    // Simplified API: revoke()
    // ──────────────────────────────────────────────

    function test_revoke_byAdmin() public {
        bytes32 receiptHash = _attestDefault();

        vm.prank(admin);
        registry.revoke(receiptHash);

        (bool valid, , ) = registry.verify(receiptHash);
        assertFalse(valid);
    }

    function test_revoke_emitsEvent() public {
        bytes32 receiptHash = _attestDefault();

        vm.prank(admin);
        vm.expectEmit(true, true, false, false);
        emit ProofLinkRegistry.AttestationRevoked(receiptHash, admin);
        registry.revoke(receiptHash);
    }

    function test_revoke_revert_withoutAdminRole() public {
        bytes32 receiptHash = _attestDefault();

        vm.prank(unauthorized);
        vm.expectRevert();
        registry.revoke(receiptHash);
    }

    function test_revoke_revert_attesterCannotRevoke() public {
        bytes32 receiptHash = _attestDefault();

        vm.prank(attester);
        vm.expectRevert();
        registry.revoke(receiptHash);
    }

    function test_revoke_revert_notFound() public {
        vm.prank(admin);
        vm.expectRevert(ProofLinkRegistry.ReceiptNotFound.selector);
        registry.revoke(keccak256("nonexistent"));
    }

    function test_revoke_revert_alreadyRevoked() public {
        bytes32 receiptHash = _attestDefault();

        vm.prank(admin);
        registry.revoke(receiptHash);

        vm.prank(admin);
        vm.expectRevert(ProofLinkRegistry.ReceiptAlreadyRevoked.selector);
        registry.revoke(receiptHash);
    }
}
