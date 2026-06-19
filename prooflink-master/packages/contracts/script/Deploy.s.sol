// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Script, console2} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {ProofLinkRegistry} from "../src/ProofLinkRegistry.sol";
import {ProofLinkKYA} from "../src/ProofLinkKYA.sol";
import {AgentInvoice} from "../src/AgentInvoice.sol";
import {ProofLinkFacilitator} from "../src/ProofLinkFacilitator.sol";

/// @title Deploy
/// @notice Deployment script for ProofLink contracts on Base Sepolia.
/// @dev Run with: forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify
contract Deploy is Script {
    // ── Base Sepolia EAS addresses ──
    address constant EAS_ADDRESS = 0x4200000000000000000000000000000000000021;
    address constant SCHEMA_REGISTRY_ADDRESS = 0x4200000000000000000000000000000000000020;

    // ── Placeholder ERC-8004 addresses (replace with actual deployments) ──
    address constant IDENTITY_REGISTRY = address(0); // Set before mainnet deploy
    address constant VALIDATION_REGISTRY = address(0); // Set before mainnet deploy

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console2.log("Deployer:", deployer);
        console2.log("Chain ID:", block.chainid);

        vm.startBroadcast(deployerPrivateKey);

        // ── 1. Deploy ProofLinkRegistry ──
        ProofLinkRegistry registryImpl = new ProofLinkRegistry();
        bytes memory registryInit = abi.encodeCall(
            ProofLinkRegistry.initialize, (EAS_ADDRESS, SCHEMA_REGISTRY_ADDRESS, deployer)
        );
        ERC1967Proxy registryProxy = new ERC1967Proxy(address(registryImpl), registryInit);
        ProofLinkRegistry registry = ProofLinkRegistry(address(registryProxy));
        console2.log("ProofLinkRegistry proxy:", address(registryProxy));
        console2.log("ProofLinkRegistry impl:", address(registryImpl));

        // Register EAS schema
        bytes32 schemaUID = registry.registerSchema();
        console2.log("EAS Schema UID:");
        console2.logBytes32(schemaUID);

        // ── 2. Deploy ProofLinkKYA ──
        // Use deployer as placeholder identity registry if actual one is not yet deployed
        address identityRegistryAddr = IDENTITY_REGISTRY == address(0) ? deployer : IDENTITY_REGISTRY;
        address validationRegistryAddr = VALIDATION_REGISTRY;

        ProofLinkKYA kyaImpl = new ProofLinkKYA();
        bytes memory kyaInit = abi.encodeCall(
            ProofLinkKYA.initialize, (identityRegistryAddr, validationRegistryAddr, deployer)
        );
        ERC1967Proxy kyaProxy = new ERC1967Proxy(address(kyaImpl), kyaInit);
        ProofLinkKYA kyaContract = ProofLinkKYA(address(kyaProxy));
        console2.log("ProofLinkKYA proxy:", address(kyaProxy));
        console2.log("ProofLinkKYA impl:", address(kyaImpl));

        // ── 3. Deploy AgentInvoice ──
        AgentInvoice invoiceImpl = new AgentInvoice();
        bytes memory invoiceInit = abi.encodeCall(AgentInvoice.initialize, (deployer));
        ERC1967Proxy invoiceProxy = new ERC1967Proxy(address(invoiceImpl), invoiceInit);
        console2.log("AgentInvoice proxy:", address(invoiceProxy));
        console2.log("AgentInvoice impl:", address(invoiceImpl));

        // ── 4. Deploy ProofLinkFacilitator ──
        ProofLinkFacilitator facImpl = new ProofLinkFacilitator();
        bytes memory facInit = abi.encodeCall(
            ProofLinkFacilitator.initialize, (address(registryProxy), address(kyaProxy), deployer)
        );
        ERC1967Proxy facProxy = new ERC1967Proxy(address(facImpl), facInit);
        ProofLinkFacilitator facilitator = ProofLinkFacilitator(address(facProxy));
        console2.log("ProofLinkFacilitator proxy:", address(facProxy));
        console2.log("ProofLinkFacilitator impl:", address(facImpl));

        // ── 5. Configure cross-contract roles ──
        // Grant facilitator the ATTESTER_ROLE on ProofLinkRegistry
        registry.grantRole(registry.ATTESTER_ROLE(), address(facProxy));

        // Grant facilitator the FACILITATOR_ROLE on AgentInvoice
        AgentInvoice(address(invoiceProxy)).grantRole(
            AgentInvoice(address(invoiceProxy)).FACILITATOR_ROLE(), address(facProxy)
        );

        console2.log("");
        console2.log("=== Deployment Complete ===");
        console2.log("ProofLinkRegistry:", address(registryProxy));
        console2.log("ProofLinkKYA:", address(kyaProxy));
        console2.log("AgentInvoice:", address(invoiceProxy));
        console2.log("ProofLinkFacilitator:", address(facProxy));

        vm.stopBroadcast();
    }
}
