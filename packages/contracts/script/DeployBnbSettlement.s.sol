// SPDX-License-Identifier: MIT

pragma solidity 0.8.34;

import {Script, console} from "forge-std/Script.sol";
import {Settlement} from "../src/core/settlement/bnb/Settlement.sol";
import {AaveOracleAdapter} from "../src/core/settlement/oracle/AaveOracleAdapter.sol";

contract DeployBnbSettlement is Script {
    // BNB mainnet (Aave V3 on BNB)
    address constant AAVE_ORACLE = 0x39bc1bfDa2130d6Bb6DBEfd366939b4c7aa7C697;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerKey);

        Settlement settlement = new Settlement();
        AaveOracleAdapter oracle = new AaveOracleAdapter(AAVE_ORACLE);

        vm.stopBroadcast();

        console.log("=== BNB Deployment ===");
        console.log("Settlement deployed at:", address(settlement));
        console.log("Forwarder deployed at: ", address(settlement.forwarder()));
        console.log("AaveOracle adapter at: ", address(oracle));
    }
}
