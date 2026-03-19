// SPDX-License-Identifier: MIT

pragma solidity 0.8.34;

import {Script, console} from "forge-std/Script.sol";
import {Settlement} from "../src/core/settlement/base/Settlement.sol";
import {AaveOracleAdapter} from "../src/core/settlement/oracle/AaveOracleAdapter.sol";

contract DeployBaseSettlement is Script {
    // Base mainnet
    address constant AAVE_ORACLE = 0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerKey);

        Settlement settlement = new Settlement();
        AaveOracleAdapter oracle = new AaveOracleAdapter(AAVE_ORACLE);

        vm.stopBroadcast();

        console.log("=== Base Deployment ===");
        console.log("Settlement deployed at:", address(settlement));
        console.log("Forwarder deployed at: ", address(settlement.forwarder()));
        console.log("AaveOracle adapter at: ", address(oracle));
    }
}
