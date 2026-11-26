// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {DataRoomRegistry} from "../src/DataRoomRegistry.sol";

/// @title DeployDiana
/// @notice 1-command deployment script for QoreDataRoom on QoreChain Diana EVM (chainId 9800).
/// @dev Reads `PRIVATE_KEY` strictly at runtime from the environment (never hardcoded).
///      Remember to open a scoped EVM Window on QoreChain before broadcasting!
///
///      Example:
///      PRIVATE_KEY=0x... forge script script/DeployDiana.s.sol:DeployDiana \
///        --rpc-url https://evm-testnet.qore.host --broadcast --legacy
contract DeployDiana is Script {
    uint256 internal constant DIANA_EVM_CHAIN_ID = 9800;

    function run() external returns (DataRoomRegistry registry) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console2.log("=== QoreDataRoom Diana Deployment ===");
        console2.log("Chain ID :", block.chainid);
        console2.log("Deployer :", deployer);
        if (block.chainid != DIANA_EVM_CHAIN_ID) {
            console2.log("NOTE: Deploying on non-Diana chainId; expected 9800 for Diana testnet.");
        }

        vm.startBroadcast(deployerPrivateKey);
        registry = new DataRoomRegistry();
        vm.stopBroadcast();

        console2.log("DataRoomRegistry deployed at:", address(registry));
    }
}
