// SPDX-License-Identifier: MIT

pragma solidity 0.8.34;

import {SettlementExecutor} from "../SettlementExecutor.sol";

/**
 * @title MorphoSettlementCallback
 * @notice Morpho Blue flash loan callback that executes structured settlement flows.
 *
 * @dev Callback calldata layout (starting at offset 100, after ABI prefix):
 *   [20: origCaller][1: poolId][8: maxFeeBps]
 *   [2: orderDataLen][orderDataLen: orderData]
 *   [2: fillerCalldataLen][fillerCalldataLen: fillerCalldata]
 *   [remaining: executionData]
 *
 *   poolId == 0 → caller must be MORPHO_BLUE
 */
abstract contract MorphoSettlementCallback is SettlementExecutor {
    address private constant MORPHO_BLUE = 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb;

    function onMorphoFlashLoan(uint256, bytes calldata) external {
        _onMorphoSettlementCallback();
    }

    /**
     * @notice Internal handler: validates caller, parses origCaller + maxFee + orderData + fillerCalldata + executionData
     */
    function _onMorphoSettlementCallback() internal {
        address origCaller;
        uint256 maxFeeBps;
        bytes memory orderData;
        bytes memory fillerCalldata;
        bytes memory executionData;

        assembly {
            let firstWord := calldataload(100)

            // poolId is at byte 20 of the first word (bits 95..88)
            switch and(0xff, shr(88, firstWord))
            case 0 {
                if xor(caller(), MORPHO_BLUE) {
                    mstore(0, INVALID_CALLER)
                    revert(0, 0x4)
                }
            }
            default {
                mstore(0, INVALID_FLASH_LOAN)
                revert(0, 0x4)
            }

            // origCaller is upper 20 bytes of firstWord
            origCaller := shr(96, firstWord)

            // maxFeeBps is 8 bytes (uint64) starting at offset 100 + 20 + 1 = 121
            maxFeeBps := shr(192, calldataload(121))

            // After origCaller(20) + poolId(1) + maxFeeBps(8) = calldata offset 129
            let baseOffset := 129
            let orderLen := and(0xffff, shr(240, calldataload(baseOffset)))

            // Copy orderData into memory
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

        _executeSettlement(origCaller, maxFeeBps, orderData, executionData, fillerCalldata);
    }
}
