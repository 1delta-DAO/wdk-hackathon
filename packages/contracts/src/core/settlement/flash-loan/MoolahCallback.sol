// SPDX-License-Identifier: MIT

pragma solidity 0.8.34;

import {Masks} from "../../masks/Masks.sol";
import {DeltaErrors} from "../../errors/Errors.sol";

/**
 * @title All Moolah flash callbacks
 */
abstract contract MoolahFlashLoanCallback is Masks, DeltaErrors {
    function onMoolahFlashLoan(uint256, bytes calldata) external {
        _onMoolahCallback();
    }

    /**
     * @notice Returns the trusted Moolah pool address. Override per chain.
     */
    function _moolahPool() internal pure virtual returns (address);

    function _onMoolahCallback() internal {
        address origCaller;
        uint256 calldataLength;
        address pool = _moolahPool();
        assembly {
            let firstWord := calldataload(100)

            switch and(UINT8_MASK, shr(88, firstWord))
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
            calldataLength := sub(calldataload(68), 21)
        }
        _settleInternal(
            origCaller,
            121,
            calldataLength
        );
    }

    function _settleInternal(address callerAddress, uint256 offset, uint256 length) internal virtual {}
}
