// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test, console2} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {ProofLinkKYA} from "../src/ProofLinkKYA.sol";
import {Types} from "../src/libraries/Types.sol";
import {IERC8004IdentityRegistry, IERC8004ValidationRegistry} from "../src/interfaces/IERC8004.sol";

/// @dev Mock ERC-8004 Identity Registry for testing.
contract MockIdentityRegistry is IERC8004IdentityRegistry {
    mapping(uint256 => address) private _wallets;
    mapping(address => uint256) private _agents;

    function setAgent(uint256 agentId, address wallet) external {
        _wallets[agentId] = wallet;
        _agents[wallet] = agentId;
    }

    function getAgentWallet(uint256 agentId) external view returns (address) {
        return _wallets[agentId];
    }

    function getAgentByWallet(address wallet) external view returns (uint256) {
        return _agents[wallet];
    }

    function isOwnerOf(uint256, address) external pure returns (bool) {
        return true;
    }

    function isApprovedOperator(uint256, address) external pure returns (bool) {
        return true;
    }
}

/// @dev Mock ERC-8004 Validation Registry for testing.
contract MockValidationRegistry is IERC8004ValidationRegistry {
    bytes32 public lastRequestHash;
    uint256 public lastResponse;
    string public lastTag;

    function validationResponse(
        bytes32 requestHash,
        uint256 response,
        string calldata,
        bytes32,
        string calldata tag
    ) external {
        lastRequestHash = requestHash;
        lastResponse = response;
        lastTag = tag;
    }
}

contract ProofLinkKYATest is Test {
    ProofLinkKYA public kya;
    MockIdentityRegistry public identityRegistry;
    MockValidationRegistry public validationRegistry;

    address public admin = makeAddr("admin");
    address public verifier = makeAddr("verifier");
    address public agentWallet = makeAddr("agent");
    address public unauthorized = makeAddr("unauthorized");

    bytes32 public credentialHash = keccak256("credential-v1");
    uint64 public validUntil;

    function setUp() public {
        identityRegistry = new MockIdentityRegistry();
        validationRegistry = new MockValidationRegistry();

        ProofLinkKYA impl = new ProofLinkKYA();
        bytes memory initData = abi.encodeCall(
            ProofLinkKYA.initialize, (address(identityRegistry), address(validationRegistry), admin)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        kya = ProofLinkKYA(address(proxy));

        // Grant verifier role
        bytes32 verifierRole = kya.VERIFIER_ROLE();
        vm.prank(admin);
        kya.grantRole(verifierRole, verifier);

        // Set valid expiry (1 year from now)
        validUntil = uint64(block.timestamp + 365 days);

        // Register agent
        identityRegistry.setAgent(1, agentWallet);
    }

    // ──────────────────────────────────────────────
    // Initialization
    // ──────────────────────────────────────────────

    function test_initialize() public view {
        assertEq(address(kya.identityRegistry()), address(identityRegistry));
        assertEq(address(kya.validationRegistry()), address(validationRegistry));
        assertTrue(kya.hasRole(kya.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(kya.hasRole(kya.VERIFIER_ROLE(), verifier));
    }

    // ──────────────────────────────────────────────
    // Issuance
    // ──────────────────────────────────────────────

    function test_issueKYA() public {
        vm.prank(verifier);
        kya.issueKYA(agentWallet, credentialHash, validUntil);

        (bool isValid, bytes32 hash, uint64 expiry) = kya.verifyKYA(agentWallet);
        assertTrue(isValid);
        assertEq(hash, credentialHash);
        assertEq(expiry, validUntil);
    }

    function test_issueKYA_emitsEvent() public {
        vm.prank(verifier);
        vm.expectEmit(true, true, false, true);
        emit ProofLinkKYA.KYAIssued(agentWallet, credentialHash, validUntil, uint40(block.timestamp));
        kya.issueKYA(agentWallet, credentialHash, validUntil);
    }

    function test_issueKYA_writesValidationResponse() public {
        vm.prank(verifier);
        kya.issueKYA(agentWallet, credentialHash, validUntil);

        assertEq(validationRegistry.lastResponse(), 75);
        assertEq(validationRegistry.lastTag(), "kya");
    }

    function test_issueKYA_revert_duplicate() public {
        vm.prank(verifier);
        kya.issueKYA(agentWallet, credentialHash, validUntil);

        vm.prank(verifier);
        vm.expectRevert(ProofLinkKYA.CredentialAlreadyExists.selector);
        kya.issueKYA(agentWallet, keccak256("new-cred"), validUntil);
    }

    function test_issueKYA_revert_zeroAddress() public {
        vm.prank(verifier);
        vm.expectRevert(ProofLinkKYA.ZeroAddress.selector);
        kya.issueKYA(address(0), credentialHash, validUntil);
    }

    function test_issueKYA_revert_emptyHash() public {
        vm.prank(verifier);
        vm.expectRevert(ProofLinkKYA.EmptyCredentialHash.selector);
        kya.issueKYA(agentWallet, bytes32(0), validUntil);
    }

    function test_issueKYA_revert_pastExpiry() public {
        vm.prank(verifier);
        vm.expectRevert(ProofLinkKYA.InvalidExpiry.selector);
        kya.issueKYA(agentWallet, credentialHash, uint64(block.timestamp - 1));
    }

    function test_issueKYA_revert_unauthorized() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        kya.issueKYA(agentWallet, credentialHash, validUntil);
    }

    function test_issueKYA_afterRevocation() public {
        vm.prank(verifier);
        kya.issueKYA(agentWallet, credentialHash, validUntil);

        vm.prank(verifier);
        kya.revokeKYA(agentWallet);

        // Should be able to re-issue after revocation
        vm.prank(verifier);
        kya.issueKYA(agentWallet, keccak256("new-cred"), validUntil);

        (bool isValid,,) = kya.verifyKYA(agentWallet);
        assertTrue(isValid);
    }

    // ──────────────────────────────────────────────
    // Revocation
    // ──────────────────────────────────────────────

    function test_revokeKYA() public {
        vm.prank(verifier);
        kya.issueKYA(agentWallet, credentialHash, validUntil);

        vm.prank(verifier);
        kya.revokeKYA(agentWallet);

        (bool isValid,,) = kya.verifyKYA(agentWallet);
        assertFalse(isValid);
    }

    function test_revokeKYA_emitsEvent() public {
        vm.prank(verifier);
        kya.issueKYA(agentWallet, credentialHash, validUntil);

        vm.prank(verifier);
        vm.expectEmit(true, true, false, false);
        emit ProofLinkKYA.KYARevoked(agentWallet, verifier);
        kya.revokeKYA(agentWallet);
    }

    function test_revokeKYA_revert_notFound() public {
        vm.prank(verifier);
        vm.expectRevert(ProofLinkKYA.CredentialNotFound.selector);
        kya.revokeKYA(agentWallet);
    }

    function test_revokeKYA_revert_alreadyRevoked() public {
        vm.prank(verifier);
        kya.issueKYA(agentWallet, credentialHash, validUntil);

        vm.prank(verifier);
        kya.revokeKYA(agentWallet);

        vm.prank(verifier);
        vm.expectRevert(ProofLinkKYA.CredentialAlreadyRevoked.selector);
        kya.revokeKYA(agentWallet);
    }

    // ──────────────────────────────────────────────
    // Suspension / Reinstatement
    // ──────────────────────────────────────────────

    function test_suspendKYA() public {
        vm.prank(verifier);
        kya.issueKYA(agentWallet, credentialHash, validUntil);

        vm.prank(verifier);
        kya.suspendKYA(agentWallet);

        (bool isValid,,) = kya.verifyKYA(agentWallet);
        assertFalse(isValid);
    }

    function test_reinstateKYA() public {
        vm.prank(verifier);
        kya.issueKYA(agentWallet, credentialHash, validUntil);

        vm.prank(verifier);
        kya.suspendKYA(agentWallet);

        vm.prank(verifier);
        kya.reinstateKYA(agentWallet);

        (bool isValid,,) = kya.verifyKYA(agentWallet);
        assertTrue(isValid);
    }

    function test_reinstateKYA_revert_notSuspended() public {
        vm.prank(verifier);
        kya.issueKYA(agentWallet, credentialHash, validUntil);

        vm.prank(verifier);
        vm.expectRevert(ProofLinkKYA.CredentialNotSuspended.selector);
        kya.reinstateKYA(agentWallet);
    }

    // ──────────────────────────────────────────────
    // Verification
    // ──────────────────────────────────────────────

    function test_verifyKYA_expired() public {
        vm.prank(verifier);
        kya.issueKYA(agentWallet, credentialHash, validUntil);

        // Warp past expiry
        vm.warp(validUntil + 1);

        (bool isValid,,) = kya.verifyKYA(agentWallet);
        assertFalse(isValid);
    }

    function test_verifyKYA_nonexistent() public {
        address nobody = makeAddr("nobody");
        (bool isValid, bytes32 hash, uint64 expiry) = kya.verifyKYA(nobody);
        assertFalse(isValid);
        assertEq(hash, bytes32(0));
        assertEq(expiry, 0);
    }

    function test_getCredential() public {
        vm.prank(verifier);
        kya.issueKYA(agentWallet, credentialHash, validUntil);

        Types.KYACredential memory cred = kya.getCredential(agentWallet);
        assertEq(cred.agentWallet, agentWallet);
        assertEq(cred.credentialHash, credentialHash);
        assertEq(cred.validUntil, validUntil);
        assertTrue(cred.status == Types.CredentialStatus.ACTIVE);
    }

    function test_getCredential_revert_notFound() public {
        vm.expectRevert(ProofLinkKYA.CredentialNotFound.selector);
        kya.getCredential(makeAddr("nobody"));
    }

    // ──────────────────────────────────────────────
    // Agent Registry: registerAgent()
    // ──────────────────────────────────────────────

    function test_registerAgent_validData() public {
        vm.prank(verifier);
        kya.registerAgent("did:prooflink:agent-001", agentWallet, 0, 10_000e6);

        Types.AgentInfo memory info = kya.getAgent(agentWallet);
        assertEq(info.wallet, agentWallet);
        assertEq(info.did, "did:prooflink:agent-001");
        assertTrue(info.agentType == Types.AgentType.AUTONOMOUS);
        assertEq(info.maxTxValue, 10_000e6);
        assertEq(info.dailyLimit, 0);
        assertTrue(info.verified);
        assertTrue(info.registeredAt > 0);
    }

    function test_registerAgent_emitsEvent() public {
        vm.prank(verifier);
        vm.expectEmit(true, false, false, true);
        emit ProofLinkKYA.AgentRegistered(agentWallet, "did:prooflink:agent-001", 0, 10_000e6, uint40(block.timestamp));
        kya.registerAgent("did:prooflink:agent-001", agentWallet, 0, 10_000e6);
    }

    function test_registerAgent_incrementsCount() public {
        assertEq(kya.agentCount(), 0);

        vm.prank(verifier);
        kya.registerAgent("did:prooflink:agent-001", agentWallet, 0, 10_000e6);
        assertEq(kya.agentCount(), 1);

        address wallet2 = makeAddr("agent2");
        vm.prank(verifier);
        kya.registerAgent("did:prooflink:agent-002", wallet2, 1, 5_000e6);
        assertEq(kya.agentCount(), 2);
    }

    function test_registerAgent_revert_duplicateWallet() public {
        vm.prank(verifier);
        kya.registerAgent("did:prooflink:agent-001", agentWallet, 0, 10_000e6);

        vm.prank(verifier);
        vm.expectRevert(ProofLinkKYA.AgentAlreadyRegistered.selector);
        kya.registerAgent("did:prooflink:agent-002", agentWallet, 1, 5_000e6);
    }

    function test_registerAgent_revert_zeroAddress() public {
        vm.prank(verifier);
        vm.expectRevert(ProofLinkKYA.ZeroAddress.selector);
        kya.registerAgent("did:prooflink:agent-001", address(0), 0, 10_000e6);
    }

    function test_registerAgent_revert_emptyDID() public {
        vm.prank(verifier);
        vm.expectRevert(ProofLinkKYA.EmptyDID.selector);
        kya.registerAgent("", agentWallet, 0, 10_000e6);
    }

    function test_registerAgent_revert_invalidAgentType() public {
        vm.prank(verifier);
        vm.expectRevert(ProofLinkKYA.InvalidAgentType.selector);
        kya.registerAgent("did:prooflink:agent-001", agentWallet, 3, 10_000e6);
    }

    function test_registerAgent_revert_unauthorized() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        kya.registerAgent("did:prooflink:agent-001", agentWallet, 0, 10_000e6);
    }

    function test_registerAgent_allTypes() public {
        address w0 = makeAddr("auto");
        address w1 = makeAddr("semi");
        address w2 = makeAddr("human");

        vm.startPrank(verifier);
        kya.registerAgent("did:0", w0, 0, 1000);
        kya.registerAgent("did:1", w1, 1, 2000);
        kya.registerAgent("did:2", w2, 2, 3000);
        vm.stopPrank();

        assertTrue(kya.getAgent(w0).agentType == Types.AgentType.AUTONOMOUS);
        assertTrue(kya.getAgent(w1).agentType == Types.AgentType.SEMI_AUTONOMOUS);
        assertTrue(kya.getAgent(w2).agentType == Types.AgentType.HUMAN_SUPERVISED);
    }

    // ──────────────────────────────────────────────
    // Agent Registry: getAgent()
    // ──────────────────────────────────────────────

    function test_getAgent_returnsCorrectInfo() public {
        vm.prank(verifier);
        kya.registerAgent("did:prooflink:agent-001", agentWallet, 1, 50_000e6);

        Types.AgentInfo memory info = kya.getAgent(agentWallet);
        assertEq(info.wallet, agentWallet);
        assertEq(info.did, "did:prooflink:agent-001");
        assertTrue(info.agentType == Types.AgentType.SEMI_AUTONOMOUS);
        assertEq(info.maxTxValue, 50_000e6);
    }

    function test_getAgent_revert_notFound() public {
        vm.expectRevert(ProofLinkKYA.AgentNotFound.selector);
        kya.getAgent(makeAddr("nobody"));
    }

    // ──────────────────────────────────────────────
    // Agent Registry: updateDelegationScope()
    // ──────────────────────────────────────────────

    function test_updateDelegationScope() public {
        vm.prank(verifier);
        kya.registerAgent("did:prooflink:agent-001", agentWallet, 0, 10_000e6);

        vm.prank(verifier);
        kya.updateDelegationScope(agentWallet, 50_000e6, 100_000e6);

        Types.AgentInfo memory info = kya.getAgent(agentWallet);
        assertEq(info.maxTxValue, 50_000e6);
        assertEq(info.dailyLimit, 100_000e6);
    }

    function test_updateDelegationScope_emitsEvent() public {
        vm.prank(verifier);
        kya.registerAgent("did:prooflink:agent-001", agentWallet, 0, 10_000e6);

        vm.prank(verifier);
        vm.expectEmit(true, false, false, true);
        emit ProofLinkKYA.AgentUpdated(agentWallet, 50_000e6, 100_000e6, uint40(block.timestamp));
        kya.updateDelegationScope(agentWallet, 50_000e6, 100_000e6);
    }

    function test_updateDelegationScope_revert_notFound() public {
        vm.prank(verifier);
        vm.expectRevert(ProofLinkKYA.AgentNotFound.selector);
        kya.updateDelegationScope(makeAddr("nobody"), 1000, 2000);
    }

    function test_updateDelegationScope_revert_unauthorized() public {
        vm.prank(verifier);
        kya.registerAgent("did:prooflink:agent-001", agentWallet, 0, 10_000e6);

        vm.prank(unauthorized);
        vm.expectRevert();
        kya.updateDelegationScope(agentWallet, 50_000e6, 100_000e6);
    }

    // ──────────────────────────────────────────────
    // Agent Registry: isVerified()
    // ──────────────────────────────────────────────

    function test_isVerified_registeredAgent() public {
        vm.prank(verifier);
        kya.registerAgent("did:prooflink:agent-001", agentWallet, 0, 10_000e6);

        assertTrue(kya.isVerified(agentWallet));
    }

    function test_isVerified_unregisteredAgent() public {
        assertFalse(kya.isVerified(makeAddr("nobody")));
    }

    function test_isVerified_afterDeactivation() public {
        vm.prank(verifier);
        kya.registerAgent("did:prooflink:agent-001", agentWallet, 0, 10_000e6);

        vm.prank(verifier);
        kya.deactivateAgent(agentWallet);

        assertFalse(kya.isVerified(agentWallet));
    }

    // ──────────────────────────────────────────────
    // Agent Registry: deactivateAgent()
    // ──────────────────────────────────────────────

    function test_deactivateAgent() public {
        vm.prank(verifier);
        kya.registerAgent("did:prooflink:agent-001", agentWallet, 0, 10_000e6);

        vm.prank(verifier);
        kya.deactivateAgent(agentWallet);

        Types.AgentInfo memory info = kya.getAgent(agentWallet);
        assertFalse(info.verified);
    }

    function test_deactivateAgent_emitsEvent() public {
        vm.prank(verifier);
        kya.registerAgent("did:prooflink:agent-001", agentWallet, 0, 10_000e6);

        vm.prank(verifier);
        vm.expectEmit(true, true, false, false);
        emit ProofLinkKYA.AgentDeactivated(agentWallet, verifier);
        kya.deactivateAgent(agentWallet);
    }

    function test_deactivateAgent_revert_notFound() public {
        vm.prank(verifier);
        vm.expectRevert(ProofLinkKYA.AgentNotFound.selector);
        kya.deactivateAgent(makeAddr("nobody"));
    }

    function test_deactivateAgent_revert_unauthorized() public {
        vm.prank(verifier);
        kya.registerAgent("did:prooflink:agent-001", agentWallet, 0, 10_000e6);

        vm.prank(unauthorized);
        vm.expectRevert();
        kya.deactivateAgent(agentWallet);
    }

    // ──────────────────────────────────────────────
    // Suspension events
    // ──────────────────────────────────────────────

    function test_suspendKYA_emitsEvent() public {
        vm.prank(verifier);
        kya.issueKYA(agentWallet, credentialHash, validUntil);

        vm.prank(verifier);
        vm.expectEmit(true, true, false, false);
        emit ProofLinkKYA.KYASuspended(agentWallet, verifier);
        kya.suspendKYA(agentWallet);
    }

    function test_reinstateKYA_emitsEvent() public {
        vm.prank(verifier);
        kya.issueKYA(agentWallet, credentialHash, validUntil);

        vm.prank(verifier);
        kya.suspendKYA(agentWallet);

        vm.prank(verifier);
        vm.expectEmit(true, true, false, false);
        emit ProofLinkKYA.KYAReinstated(agentWallet, verifier);
        kya.reinstateKYA(agentWallet);
    }

    function test_suspendKYA_revert_notActive() public {
        vm.prank(verifier);
        kya.issueKYA(agentWallet, credentialHash, validUntil);

        vm.prank(verifier);
        kya.suspendKYA(agentWallet);

        // Already suspended, cannot suspend again
        vm.prank(verifier);
        vm.expectRevert(ProofLinkKYA.CredentialNotActive.selector);
        kya.suspendKYA(agentWallet);
    }

    function test_suspendKYA_revert_unauthorized() public {
        vm.prank(verifier);
        kya.issueKYA(agentWallet, credentialHash, validUntil);

        vm.prank(unauthorized);
        vm.expectRevert();
        kya.suspendKYA(agentWallet);
    }

    // ──────────────────────────────────────────────
    // Admin: setRegistries
    // ──────────────────────────────────────────────

    function test_setRegistries() public {
        address newIdReg = makeAddr("newIdReg");
        address newValReg = makeAddr("newValReg");

        vm.prank(admin);
        kya.setRegistries(newIdReg, newValReg);

        assertEq(address(kya.identityRegistry()), newIdReg);
        assertEq(address(kya.validationRegistry()), newValReg);
    }

    function test_setRegistries_revert_unauthorized() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        kya.setRegistries(makeAddr("a"), makeAddr("b"));
    }

    function test_setRegistries_revert_zeroIdentityRegistry() public {
        vm.prank(admin);
        vm.expectRevert(ProofLinkKYA.ZeroAddress.selector);
        kya.setRegistries(address(0), makeAddr("b"));
    }

    // ──────────────────────────────────────────────
    // Admin: setDefaultValidationScore
    // ──────────────────────────────────────────────

    function test_defaultValidationScore_initialValue() public view {
        assertEq(kya.defaultValidationScore(), 75);
    }

    function test_setDefaultValidationScore() public {
        vm.prank(admin);
        kya.setDefaultValidationScore(90);
        assertEq(kya.defaultValidationScore(), 90);
    }

    function test_setDefaultValidationScore_emitsEvent() public {
        vm.prank(admin);
        vm.expectEmit(false, false, false, true);
        emit ProofLinkKYA.DefaultValidationScoreUpdated(75, 90);
        kya.setDefaultValidationScore(90);
    }

    function test_setDefaultValidationScore_revert_tooHigh() public {
        vm.prank(admin);
        vm.expectRevert(ProofLinkKYA.InvalidValidationScore.selector);
        kya.setDefaultValidationScore(101);
    }

    function test_setDefaultValidationScore_revert_unauthorized() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        kya.setDefaultValidationScore(90);
    }

    function test_issueKYA_usesCustomValidationScore() public {
        vm.prank(admin);
        kya.setDefaultValidationScore(90);

        vm.prank(verifier);
        kya.issueKYA(agentWallet, credentialHash, validUntil);

        assertEq(validationRegistry.lastResponse(), 90);
    }
}
