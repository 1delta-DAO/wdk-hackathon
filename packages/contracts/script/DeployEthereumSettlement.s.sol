// SPDX-License-Identifier: MIT

pragma solidity 0.8.34;

import {Script, console} from "forge-std/Script.sol";
import {Settlement} from "../src/core/settlement/ethereum/Settlement.sol";
import {AaveOracleAdapter} from "../src/core/settlement/oracle/AaveOracleAdapter.sol";

contract DeployEthereumSettlement is Script {
    // Ethereum mainnet
    address constant AAVE_ORACLE = 0x54586bE62E3c3580375aE3723C145253060Ca0C2;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerKey);

        Settlement settlement = new Settlement();
        AaveOracleAdapter oracle = new AaveOracleAdapter(AAVE_ORACLE);

        vm.stopBroadcast();

        console.log("=== Ethereum Deployment ===");
        console.log("Settlement deployed at:", address(settlement));
        console.log("Forwarder deployed at: ", address(settlement.forwarder()));
        console.log("AaveOracle adapter at: ", address(oracle));
    }
}
