// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @title IEAS
/// @notice Minimal interface for the Ethereum Attestation Service contract.
/// @dev Full spec: https://github.com/ethereum-attestation-service/eas-contracts

/// @notice A single attestation request data payload.
struct AttestationRequestData {
    address recipient;
    uint64 expirationTime;
    bool revocable;
    bytes32 refUID;
    bytes data;
    uint256 value;
}

/// @notice Top-level attestation request binding schema to data.
struct AttestationRequest {
    bytes32 schema;
    AttestationRequestData data;
}

/// @notice Batch attestation request for a single schema.
struct MultiAttestationRequest {
    bytes32 schema;
    AttestationRequestData[] data;
}

/// @notice A single revocation request data payload.
struct RevocationRequestData {
    bytes32 uid;
    uint256 value;
}

/// @notice Top-level revocation request binding schema to data.
struct RevocationRequest {
    bytes32 schema;
    RevocationRequestData data;
}

/// @notice On-chain attestation record returned by EAS.
struct Attestation {
    bytes32 uid;
    bytes32 schema;
    uint64 time;
    uint64 expirationTime;
    uint64 revocationTime;
    bytes32 refUID;
    address attester;
    address recipient;
    bool revocable;
    bytes data;
}

interface IEAS {
    /// @notice Create a single on-chain attestation.
    /// @param request The attestation request.
    /// @return The UID of the new attestation.
    function attest(AttestationRequest calldata request) external payable returns (bytes32);

    /// @notice Create multiple attestations for one or more schemas.
    /// @param multiRequests Array of multi-attestation requests.
    /// @return Array of attestation UIDs.
    function multiAttest(MultiAttestationRequest[] calldata multiRequests)
        external
        payable
        returns (bytes32[] memory);

    /// @notice Revoke an existing attestation.
    /// @param request The revocation request.
    function revoke(RevocationRequest calldata request) external payable;

    /// @notice Retrieve an attestation by UID.
    /// @param uid The attestation UID.
    /// @return The attestation record.
    function getAttestation(bytes32 uid) external view returns (Attestation memory);

    /// @notice Check if an attestation is valid (exists and not revoked).
    /// @param uid The attestation UID.
    /// @return True if the attestation is valid.
    function isAttestationValid(bytes32 uid) external view returns (bool);
}

/// @notice Minimal interface for the EAS SchemaRegistry.
interface ISchemaRegistry {
    /// @notice Register a new schema.
    /// @param schema The schema string (ABI types).
    /// @param resolver Optional resolver contract address.
    /// @param revocable Whether attestations using this schema are revocable.
    /// @return The UID of the registered schema.
    function register(string calldata schema, address resolver, bool revocable)
        external
        returns (bytes32);
}
