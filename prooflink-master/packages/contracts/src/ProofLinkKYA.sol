// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import {IERC8004IdentityRegistry, IERC8004ValidationRegistry} from "./interfaces/IERC8004.sol";
import {Types} from "./libraries/Types.sol";

/// @title ProofLinkKYA
/// @author ProofLink
/// @notice KYA (Know Your Agent) credential management contract.
///         Issues, verifies, and revokes KYA credentials for AI agents.
/// @dev Integrates with ERC-8004 Identity Registry via its validation interface.
///      Uses UUPS proxy pattern for upgradeability.
contract ProofLinkKYA is Initializable, AccessControlUpgradeable, UUPSUpgradeable {
    // ──────────────────────────────────────────────
    // Roles
    // ──────────────────────────────────────────────

    /// @notice Role for addresses authorized to issue/revoke KYA credentials.
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");

    // ──────────────────────────────────────────────
    // State
    // ──────────────────────────────────────────────

    /// @notice Default ERC-8004 Identity Registry.
    IERC8004IdentityRegistry public identityRegistry;

    /// @notice Default ERC-8004 Validation Registry.
    IERC8004ValidationRegistry public validationRegistry;

    /// @dev agentWallet => KYA credential
    mapping(address => Types.KYACredential) internal _credentials;

    /// @dev agentWallet => Agent identity info
    mapping(address => Types.AgentInfo) internal _agents;

    /// @dev Total registered agents counter.
    uint256 public agentCount;

    /// @notice Default validation score for ERC-8004 validation responses (0-100).
    uint8 public defaultValidationScore;

    // ──────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────

    /// @notice Emitted when a new KYA credential is issued.
    event KYAIssued(
        address indexed agentWallet, bytes32 indexed credentialHash, uint64 validUntil, uint40 issuedAt
    );

    /// @notice Emitted when a KYA credential is revoked.
    event KYARevoked(address indexed agentWallet, address indexed revokedBy);

    /// @notice Emitted when a KYA credential is suspended.
    event KYASuspended(address indexed agentWallet, address indexed suspendedBy);

    /// @notice Emitted when a KYA credential is reinstated.
    event KYAReinstated(address indexed agentWallet, address indexed reinstatedBy);

    /// @notice Emitted when a new agent is registered.
    event AgentRegistered(
        address indexed wallet, string did, uint8 agentType, uint256 maxTxValue, uint40 registeredAt
    );

    /// @notice Emitted when an agent's delegation scope is updated.
    event AgentUpdated(address indexed wallet, uint256 maxTxValue, uint256 dailyLimit, uint40 updatedAt);

    /// @notice Emitted when the default validation score is updated.
    event DefaultValidationScoreUpdated(uint8 oldScore, uint8 newScore);

    /// @notice Emitted when an agent is deactivated.
    event AgentDeactivated(address indexed wallet, address indexed deactivatedBy);

    /// @notice Emitted when registry addresses are updated.
    event RegistriesUpdated(address identityRegistry, address validationRegistry);

    // ──────────────────────────────────────────────
    // Errors
    // ──────────────────────────────────────────────

    /// @notice Zero address provided.
    error ZeroAddress();

    /// @notice Credential already exists for this agent wallet.
    error CredentialAlreadyExists();

    /// @notice No credential found for this agent wallet.
    error CredentialNotFound();

    /// @notice Credential has already been revoked.
    error CredentialAlreadyRevoked();

    /// @notice Credential is not in ACTIVE status.
    error CredentialNotActive();

    /// @notice Credential is not in SUSPENDED status (cannot reinstate).
    error CredentialNotSuspended();

    /// @notice Expiry timestamp is in the past.
    error InvalidExpiry();

    /// @notice Empty credential hash.
    error EmptyCredentialHash();

    /// @notice Agent already registered at this wallet address.
    error AgentAlreadyRegistered();

    /// @notice Agent not found at this wallet address.
    error AgentNotFound();

    /// @notice Empty DID string.
    error EmptyDID();

    /// @notice Invalid agent type (must be 0-2).
    error InvalidAgentType();

    /// @notice Invalid validation score (must be 0-100).
    error InvalidValidationScore();

    // ──────────────────────────────────────────────
    // Initializer
    // ──────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initialize the ProofLinkKYA contract.
    /// @param identityRegistry_ ERC-8004 Identity Registry address.
    /// @param validationRegistry_ ERC-8004 Validation Registry address.
    /// @param admin Initial admin address.
    function initialize(address identityRegistry_, address validationRegistry_, address admin) external initializer {
        if (identityRegistry_ == address(0) || admin == address(0)) {
            revert ZeroAddress();
        }

        __AccessControl_init();
        // UUPSUpgradeable does not require init in OZ v5

        identityRegistry = IERC8004IdentityRegistry(identityRegistry_);
        if (validationRegistry_ != address(0)) {
            validationRegistry = IERC8004ValidationRegistry(validationRegistry_);
        }

        defaultValidationScore = 75;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(VERIFIER_ROLE, admin);
    }

    // ──────────────────────────────────────────────
    // Write Functions
    // ──────────────────────────────────────────────

    /// @notice Issue a KYA credential to an agent wallet.
    /// @param agentWallet The agent's wallet address.
    /// @param credentialHash Hash of the full W3C Verifiable Credential (IPFS CID).
    /// @param validUntil Credential expiry timestamp.
    function issueKYA(address agentWallet, bytes32 credentialHash, uint64 validUntil)
        external
        onlyRole(VERIFIER_ROLE)
    {
        if (agentWallet == address(0)) revert ZeroAddress();
        if (credentialHash == bytes32(0)) revert EmptyCredentialHash();
        if (validUntil <= block.timestamp) revert InvalidExpiry();

        Types.KYACredential storage existing = _credentials[agentWallet];
        if (
            existing.agentWallet != address(0) && existing.status != Types.CredentialStatus.REVOKED
                && existing.status != Types.CredentialStatus.EXPIRED
        ) {
            revert CredentialAlreadyExists();
        }

        uint40 now_ = uint40(block.timestamp);

        _credentials[agentWallet] = Types.KYACredential({
            agentWallet: agentWallet,
            credentialHash: credentialHash,
            validUntil: validUntil,
            status: Types.CredentialStatus.ACTIVE,
            issuedAt: now_
        });

        // Write validation response to ERC-8004 if registry is set
        if (address(validationRegistry) != address(0)) {
            bytes32 requestHash = keccak256(abi.encodePacked(agentWallet, "prooflink-kya"));
            validationRegistry.validationResponse(
                requestHash,
                defaultValidationScore,
                "", // URI omitted — callers should use credentialHash directly
                credentialHash,
                "kya"
            );
        }

        emit KYAIssued(agentWallet, credentialHash, validUntil, now_);
    }

    /// @notice Revoke a KYA credential permanently.
    /// @param agentWallet The agent's wallet address.
    function revokeKYA(address agentWallet) external onlyRole(VERIFIER_ROLE) {
        Types.KYACredential storage cred = _credentials[agentWallet];
        if (cred.agentWallet == address(0)) revert CredentialNotFound();
        if (cred.status == Types.CredentialStatus.REVOKED) revert CredentialAlreadyRevoked();

        cred.status = Types.CredentialStatus.REVOKED;

        emit KYARevoked(agentWallet, msg.sender);
    }

    /// @notice Suspend a KYA credential (reversible).
    /// @param agentWallet The agent's wallet address.
    function suspendKYA(address agentWallet) external onlyRole(VERIFIER_ROLE) {
        Types.KYACredential storage cred = _credentials[agentWallet];
        if (cred.agentWallet == address(0)) revert CredentialNotFound();
        if (cred.status != Types.CredentialStatus.ACTIVE) revert CredentialNotActive();

        cred.status = Types.CredentialStatus.SUSPENDED;

        emit KYASuspended(agentWallet, msg.sender);
    }

    /// @notice Reinstate a previously suspended KYA credential.
    /// @param agentWallet The agent's wallet address.
    function reinstateKYA(address agentWallet) external onlyRole(VERIFIER_ROLE) {
        Types.KYACredential storage cred = _credentials[agentWallet];
        if (cred.agentWallet == address(0)) revert CredentialNotFound();
        if (cred.status != Types.CredentialStatus.SUSPENDED) revert CredentialNotSuspended();

        cred.status = Types.CredentialStatus.ACTIVE;

        emit KYAReinstated(agentWallet, msg.sender);
    }

    // ──────────────────────────────────────────────
    // Read Functions
    // ──────────────────────────────────────────────

    /// @notice Verify a KYA credential for an agent wallet.
    /// @param agentWallet The agent's wallet address.
    /// @return isValid True if credential is ACTIVE and not expired.
    /// @return credentialHash The credential hash (IPFS CID).
    /// @return validUntil The credential expiry timestamp.
    function verifyKYA(address agentWallet)
        external
        view
        returns (bool isValid, bytes32 credentialHash, uint64 validUntil)
    {
        Types.KYACredential storage cred = _credentials[agentWallet];
        if (cred.agentWallet == address(0)) {
            return (false, bytes32(0), 0);
        }

        credentialHash = cred.credentialHash;
        validUntil = cred.validUntil;

        isValid = cred.status == Types.CredentialStatus.ACTIVE && block.timestamp <= cred.validUntil;
    }

    /// @notice Get the full KYA credential for an agent wallet.
    /// @param agentWallet The agent's wallet address.
    /// @return credential The full KYA credential data.
    function getCredential(address agentWallet) external view returns (Types.KYACredential memory credential) {
        credential = _credentials[agentWallet];
        if (credential.agentWallet == address(0)) revert CredentialNotFound();
    }

    // ──────────────────────────────────────────────
    // Agent Identity Registry
    // ──────────────────────────────────────────────

    /// @notice Register a new agent identity (ERC-8004 inspired).
    /// @param did Decentralized Identifier for the agent.
    /// @param wallet The agent's wallet address.
    /// @param agentType Agent type: 0=AUTONOMOUS, 1=SEMI_AUTONOMOUS, 2=HUMAN_SUPERVISED.
    /// @param maxTxValue Maximum transaction value in base units.
    function registerAgent(string calldata did, address wallet, uint8 agentType, uint256 maxTxValue)
        external
        onlyRole(VERIFIER_ROLE)
    {
        if (wallet == address(0)) revert ZeroAddress();
        if (bytes(did).length == 0) revert EmptyDID();
        if (agentType > 2) revert InvalidAgentType();
        if (_agents[wallet].registeredAt != 0) revert AgentAlreadyRegistered();

        uint40 now_ = uint40(block.timestamp);

        _agents[wallet] = Types.AgentInfo({
            did: did,
            wallet: wallet,
            agentType: Types.AgentType(agentType),
            maxTxValue: maxTxValue,
            dailyLimit: 0,
            verified: true,
            registeredAt: now_,
            updatedAt: now_
        });

        agentCount++;

        emit AgentRegistered(wallet, did, agentType, maxTxValue, now_);
    }

    /// @notice Get agent identity info by wallet address.
    /// @param wallet The agent's wallet address.
    /// @return info The agent identity info.
    function getAgent(address wallet) external view returns (Types.AgentInfo memory info) {
        info = _agents[wallet];
        if (info.registeredAt == 0) revert AgentNotFound();
    }

    /// @notice Update an agent's delegation scope (transaction and daily limits).
    /// @param wallet The agent's wallet address.
    /// @param maxTxValue New maximum transaction value.
    /// @param dailyLimit New daily spending limit (0 = unlimited).
    function updateDelegationScope(address wallet, uint256 maxTxValue, uint256 dailyLimit)
        external
        onlyRole(VERIFIER_ROLE)
    {
        Types.AgentInfo storage agent = _agents[wallet];
        if (agent.registeredAt == 0) revert AgentNotFound();

        agent.maxTxValue = maxTxValue;
        agent.dailyLimit = dailyLimit;
        agent.updatedAt = uint40(block.timestamp);

        emit AgentUpdated(wallet, maxTxValue, dailyLimit, agent.updatedAt);
    }

    /// @notice Check if an agent is verified and active.
    /// @param wallet The agent's wallet address.
    /// @return True if the agent is registered and verified.
    function isVerified(address wallet) external view returns (bool) {
        Types.AgentInfo storage agent = _agents[wallet];
        return agent.registeredAt != 0 && agent.verified;
    }

    /// @notice Deactivate an agent (set verified = false).
    /// @param wallet The agent's wallet address.
    function deactivateAgent(address wallet) external onlyRole(VERIFIER_ROLE) {
        Types.AgentInfo storage agent = _agents[wallet];
        if (agent.registeredAt == 0) revert AgentNotFound();

        agent.verified = false;
        agent.updatedAt = uint40(block.timestamp);

        emit AgentDeactivated(wallet, msg.sender);
    }

    // ──────────────────────────────────────────────
    // Admin
    // ──────────────────────────────────────────────

    /// @notice Update the ERC-8004 registry addresses.
    /// @param identityRegistry_ New identity registry address.
    /// @param validationRegistry_ New validation registry address.
    function setRegistries(address identityRegistry_, address validationRegistry_)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (identityRegistry_ == address(0)) revert ZeroAddress();
        identityRegistry = IERC8004IdentityRegistry(identityRegistry_);
        if (validationRegistry_ != address(0)) {
            validationRegistry = IERC8004ValidationRegistry(validationRegistry_);
        }
        emit RegistriesUpdated(identityRegistry_, validationRegistry_);
    }

    /// @notice Set the default validation score for ERC-8004 validation responses.
    /// @param score New validation score (0-100).
    function setDefaultValidationScore(uint8 score) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (score > 100) revert InvalidValidationScore();
        uint8 old = defaultValidationScore;
        defaultValidationScore = score;
        emit DefaultValidationScoreUpdated(old, score);
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
