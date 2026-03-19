// SPDX-License-Identifier: MIT

pragma solidity 0.8.34;

import {Script, console} from "forge-std/Script.sol";
import {Settlement} from "../src/core/settlement/arbitrum/Settlement.sol";

contract DeployArbitrumSettlement is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerKey);

        Settlement settlement = new Settlement();

        vm.stopBroadcast();

        console.log("Settlement deployed at:", address(settlement));
        console.log("Forwarder deployed at:", address(settlement.forwarder()));
    }
}
