// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Script, console} from "forge-std/Script.sol";
import {ZeroDrainVault} from "../src/ZeroDrainVault.sol";

contract DeployZeroDrain is Script {
    // Exact SHA-256 of served web/public/bundles/vault-action.clean.js
    bytes32 public constant DEFAULT_TRUSTED_HASH =
        0x578f2ffb3fca186b9319a589d4f92909e77689fd2125623965d10f8fc7323207;

    function run() external returns (ZeroDrainVault vault) {
        address sentinel = vm.envAddress("SENTINEL_ADDRESS");
        bytes32 trustedHash = vm.envOr("TRUSTED_FRONTEND_HASH", DEFAULT_TRUSTED_HASH);

        vm.startBroadcast();
        vault = new ZeroDrainVault(sentinel, trustedHash);
        vm.stopBroadcast();

        console.log("ZeroDrainVault v2 deployed at:", address(vault));
        console.log("Admin:", vault.admin());
        console.log("Sentinel:", vault.sentinel());
        console.logBytes32(vault.trustedFrontendHash());
    }
}
