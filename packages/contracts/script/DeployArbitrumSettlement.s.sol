// SPDX-License-Identifier: MIT

pragma solidity 0.8.34;

import {Script, console} from "forge-std/Script.sol";
import {Settlement} from "../src/core/settlement/arbitrum/Settlement.sol";
import {AaveOracleAdapter} from "../src/core/settlement/oracle/AaveOracleAdapter.sol";

contract DeployArbitrumSettlement is Script {
    // Arbitrum mainnet
    address constant AAVE_ORACLE = 0xb56c2F0B653B2e0b10C9b928C8580Ac5Df02C7C7;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerKey);

        Settlement settlement = new Settlement();
        AaveOracleAdapter oracle = new AaveOracleAdapter(AAVE_ORACLE);

        vm.stopBroadcast();

        console.log("=== Arbitrum Deployment ===");
        console.log("Settlement deployed at:", address(settlement));
        console.log("Forwarder deployed at: ", address(settlement.forwarder()));
        console.log("AaveOracle adapter at: ", address(oracle));
    }
}
