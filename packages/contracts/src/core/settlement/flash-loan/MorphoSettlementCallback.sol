// SPDX-License-Identifier: MIT

pragma solidity 0.8.34;

import {SettlementExecutor} from "../SettlementExecutor.sol";

/**
 * @title MorphoSettlementCallback
 * @notice Morpho Blue flash loan callback that executes structured settlement flows.
 *
 * @dev Callback calldata layout (starting at offset 100, after ABI prefix):
 *   [20: origCaller][1: poolId][2: orderDataLen][orderDataLen: orderData][remaining: executionData]
 *
 *   poolId == 0 → caller must be MORPHO_BLUE
 */
abstract contract MorphoSettlementCallback is SettlementExecutor {
    address private constant MORPHO_BLUE = 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb;

    function onMorphoFlashLoan(uint256, bytes calldata) external {
        _onMorphoSettlementCallback();
    }

    /**
     * @notice Internal handler: validates caller, parses orderData + executionData, runs settlement
     */
    function _onMorphoSettlementCallback() internal {
        address origCaller;
        bytes memory orderData;
        bytes memory executionData;

        assembly {
            // The Morpho callback ABI places the bytes param data starting at calldataload(68)
            // which gives the offset to the bytes content. The actual bytes content starts at
            // offset 100 in calldata (4 selector + 32 uint256 + 32 offset + 32 length).
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

            // After origCaller(20) + poolId(1) = calldata offset 121
            let baseOffset := 121
            let orderLen := and(0xffff, shr(240, calldataload(baseOffset)))

            // Copy orderData into memory as bytes
            let fmp := mload(0x40)
            orderData := fmp
            mstore(fmp, orderLen)
            calldatacopy(add(fmp, 0x20), add(baseOffset, 2), orderLen)
            fmp := add(add(fmp, 0x20), and(add(orderLen, 31), not(31)))

            // Remaining calldata is executionData
            let execStart := add(add(baseOffset, 2), orderLen)
            // calldataload(68) is the ABI-encoded length of the bytes param
            let totalParamsLen := calldataload(68)
            // totalParamsLen includes origCaller(20) + poolId(1) + orderLenField(2) + orderData + execData
            let execLen := sub(totalParamsLen, add(add(23, orderLen), 0))

            executionData := fmp
            mstore(fmp, execLen)
            calldatacopy(add(fmp, 0x20), execStart, execLen)
            mstore(0x40, add(add(fmp, 0x20), and(add(execLen, 31), not(31))))
        }

        _executeSettlement(origCaller, orderData, executionData);
    }
}
