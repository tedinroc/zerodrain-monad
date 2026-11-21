// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Script, console} from "forge-std/Script.sol";
import {ZeroDrainVault} from "../src/ZeroDrainVault.sol";

contract DeployZeroDrain is Script {
    bytes32 public constant DEFAULT_TRUSTED_HASH =
        sha256("zerodrain-monad-staking-ui:v1.0.0:action=withdraw(self):integrity=verified");

    function run() external returns (ZeroDrainVault vault) {
        address sentinel = vm.envAddress("SENTINEL_ADDRESS");
        bytes32 trustedHash = vm.envOr("TRUSTED_FRONTEND_HASH", DEFAULT_TRUSTED_HASH);

        vm.startBroadcast();
        vault = new ZeroDrainVault(sentinel, trustedHash);
        vm.stopBroadcast();

        console.log("ZeroDrainVault deployed at:", address(vault));
        console.log("Admin:", vault.admin());
        console.log("Sentinel:", vault.sentinel());
        console.logBytes32(vault.trustedFrontendHash());
    }
}
