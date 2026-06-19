// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Types} from "../libraries/Types.sol";

/// @title IProofLinkKYA
/// @notice Interface for the ProofLink KYA (Know Your Agent) credential and identity registry.
interface IProofLinkKYA {
    // ──────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────

    event KYAIssued(address indexed agentWallet, bytes32 indexed credentialHash, uint64 validUntil, uint40 issuedAt);

    event KYARevoked(address indexed agentWallet, address indexed revokedBy);

    event KYASuspended(address indexed agentWallet, address indexed suspendedBy);

    event KYAReinstated(address indexed agentWallet, address indexed reinstatedBy);

    event AgentRegistered(
        address indexed wallet, string did, uint8 agentType, uint256 maxTxValue, uint40 registeredAt
    );

    event AgentUpdated(address indexed wallet, uint256 maxTxValue, uint256 dailyLimit, uint40 updatedAt);

    event AgentDeactivated(address indexed wallet, address indexed deactivatedBy);

    // ──────────────────────────────────────────────
    // KYA Credential Management
    // ──────────────────────────────────────────────

    function issueKYA(address agentWallet, bytes32 credentialHash, uint64 validUntil) external;

    function revokeKYA(address agentWallet) external;

    function suspendKYA(address agentWallet) external;

    function reinstateKYA(address agentWallet) external;

    function verifyKYA(address agentWallet)
        external
        view
        returns (bool isValid, bytes32 credentialHash, uint64 validUntil);

    function getCredential(address agentWallet) external view returns (Types.KYACredential memory credential);

    // ──────────────────────────────────────────────
    // Agent Identity Registry
    // ──────────────────────────────────────────────

    function registerAgent(string calldata did, address wallet, uint8 agentType, uint256 maxTxValue) external;

    function getAgent(address wallet) external view returns (Types.AgentInfo memory info);

    function updateDelegationScope(address wallet, uint256 maxTxValue, uint256 dailyLimit) external;

    function isVerified(address wallet) external view returns (bool);

    function deactivateAgent(address wallet) external;

    function agentCount() external view returns (uint256);
}
