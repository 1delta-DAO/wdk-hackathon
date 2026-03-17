// SPDX-License-Identifier: MIT

pragma solidity 0.8.34;

import {SettlementExecutor} from "../SettlementExecutor.sol";

/**
 * @title MoolahSettlementCallback
 * @notice Moolah (Lista DAO) flash loan callback that executes structured settlement flows.
 *
 * @dev Callback calldata layout (starting at offset 100, after ABI prefix):
 *   [20: origCaller][1: poolId]
 *   [2: orderDataLen][orderDataLen: orderData]
 *   [2: fillerCalldataLen][fillerCalldataLen: fillerCalldata]
 *   [remaining: executionData]
 *
 *   poolId == 0 → caller must be LISTA_DAO
 */
abstract contract MoolahSettlementCallback is SettlementExecutor {
    address private constant LISTA_DAO = 0xf820fB4680712CD7263a0D3D024D5b5aEA82Fd70;

    function onMoolahFlashLoan(uint256, bytes calldata) external {
        _onMoolahSettlementCallback();
    }

    /**
     * @notice Internal handler: validates caller, parses orderData + fillerCalldata + executionData
     */
    function _onMoolahSettlementCallback() internal {
        address origCaller;
        bytes memory orderData;
        bytes memory fillerCalldata;
        bytes memory executionData;

        assembly {
            let firstWord := calldataload(100)

            switch and(0xff, shr(88, firstWord))
            case 0 {
                if xor(caller(), LISTA_DAO) {
                    mstore(0, INVALID_CALLER)
                    revert(0, 0x4)
                }
            }
            default {
                mstore(0, INVALID_FLASH_LOAN)
                revert(0, 0x4)
            }

            origCaller := shr(96, firstWord)

            let baseOffset := 121
            let orderLen := and(0xffff, shr(240, calldataload(baseOffset)))

            // Copy orderData
            let fmp := mload(0x40)
            orderData := fmp
            mstore(fmp, orderLen)
            calldatacopy(add(fmp, 0x20), add(baseOffset, 2), orderLen)
            fmp := add(add(fmp, 0x20), and(add(orderLen, 31), not(31)))

            // Parse fillerCalldata
            let fillerStart := add(add(baseOffset, 2), orderLen)
            let fillerLen := and(0xffff, shr(240, calldataload(fillerStart)))

            fillerCalldata := fmp
            mstore(fmp, fillerLen)
            calldatacopy(add(fmp, 0x20), add(fillerStart, 2), fillerLen)
            fmp := add(add(fmp, 0x20), and(add(fillerLen, 31), not(31)))

            // Remaining calldata is executionData
            let execStart := add(add(fillerStart, 2), fillerLen)
            let totalParamsLen := calldataload(68)
            let execLen := sub(totalParamsLen, sub(execStart, 100))

            executionData := fmp
            mstore(fmp, execLen)
            calldatacopy(add(fmp, 0x20), execStart, execLen)
            mstore(0x40, add(add(fmp, 0x20), and(add(execLen, 31), not(31))))
        }

        _executeSettlement(origCaller, orderData, executionData, fillerCalldata);
    }
}
