// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @title IERC8004IdentityRegistry
/// @notice Minimal interface for the ERC-8004 Identity Registry.
/// @dev ERC-8004 defines an on-chain identity registry for AI agents.
///      Each agent is represented as an NFT (agentId) with associated metadata.
interface IERC8004IdentityRegistry {
    /// @notice Get the wallet address associated with an agent.
    /// @param agentId The agent token ID.
    /// @return The agent's wallet address.
    function getAgentWallet(uint256 agentId) external view returns (address);

    /// @notice Get the agent ID associated with a wallet address.
    /// @param wallet The wallet address.
    /// @return The agent token ID (0 if not found).
    function getAgentByWallet(address wallet) external view returns (uint256);

    /// @notice Check if an address is the owner of an agent.
    /// @param agentId The agent token ID.
    /// @param account The address to check.
    /// @return True if the account owns the agent.
    function isOwnerOf(uint256 agentId, address account) external view returns (bool);

    /// @notice Check if an address is an approved operator for an agent.
    /// @param agentId The agent token ID.
    /// @param operator The operator address.
    /// @return True if the operator is approved.
    function isApprovedOperator(uint256 agentId, address operator) external view returns (bool);
}

/// @title IERC8004ValidationRegistry
/// @notice Minimal interface for the ERC-8004 Validation Registry.
/// @dev Validators submit validation responses against agent identities.
interface IERC8004ValidationRegistry {
    /// @notice Submit a validation response for an agent.
    /// @param requestHash Unique hash identifying the validation request.
    /// @param response Numeric validation score (0-100).
    /// @param responseURI URI pointing to detailed validation data.
    /// @param responseHash Hash of the full validation response.
    /// @param tag Category tag for the validation (e.g., "kya").
    function validationResponse(
        bytes32 requestHash,
        uint256 response,
        string calldata responseURI,
        bytes32 responseHash,
        string calldata tag
    ) external;
}
