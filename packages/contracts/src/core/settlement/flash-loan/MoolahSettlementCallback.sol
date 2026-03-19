// SPDX-License-Identifier: MIT

pragma solidity 0.8.34;

import {SettlementExecutor} from "../SettlementExecutor.sol";

/**
 * @title MoolahSettlementCallback (Base)
 * @notice Abstract base for Moolah (Lista DAO) settlement callbacks.
 *
 * @dev Callback calldata layout (starting at offset 100, after ABI prefix):
 *   [20: origCaller][1: poolId][8: maxFeeBps]
 *   [2: orderDataLen][orderDataLen: orderData]
 *   [2: fillerCalldataLen][fillerCalldataLen: fillerCalldata]
 *   [remaining: executionData]
 */
abstract contract MoolahSettlementCallback is SettlementExecutor {
    function onMoolahFlashLoan(uint256, bytes calldata) external {
        _onMoolahSettlementCallback();
    }

    /**
     * @notice Returns the trusted Moolah pool address for caller validation.
     * @dev Override per-chain to return the chain-specific address.
     */
    function _moolahPool() internal pure virtual returns (address);

    function _onMoolahSettlementCallback() internal {
        address origCaller;
        uint256 maxFeeBps;
        bytes memory orderData;
        bytes memory fillerCalldata;
        bytes memory executionData;

        address pool = _moolahPool();
        assembly {
            let firstWord := calldataload(100)

            switch and(0xff, shr(88, firstWord))
            case 0 {
                if xor(caller(), pool) {
                    mstore(0, INVALID_CALLER)
                    revert(0, 0x4)
                }
            }
            default {
                mstore(0, INVALID_FLASH_LOAN)
                revert(0, 0x4)
            }

            origCaller := shr(96, firstWord)
            maxFeeBps := shr(192, calldataload(121))

            let baseOffset := 129
            let orderLen := and(0xffff, shr(240, calldataload(baseOffset)))

            let fmp := mload(0x40)
            orderData := fmp
            mstore(fmp, orderLen)
            calldatacopy(add(fmp, 0x20), add(baseOffset, 2), orderLen)
            fmp := add(add(fmp, 0x20), and(add(orderLen, 31), not(31)))

            let fillerStart := add(add(baseOffset, 2), orderLen)
            let fillerLen := and(0xffff, shr(240, calldataload(fillerStart)))

            fillerCalldata := fmp
            mstore(fmp, fillerLen)
            calldatacopy(add(fmp, 0x20), add(fillerStart, 2), fillerLen)
            fmp := add(add(fmp, 0x20), and(add(fillerLen, 31), not(31)))

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
