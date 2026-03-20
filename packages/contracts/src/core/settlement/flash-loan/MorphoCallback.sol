// SPDX-License-Identifier: MIT

pragma solidity 0.8.34;

import {Masks} from "../../masks/Masks.sol";
import {DeltaErrors} from "../../errors/Errors.sol";

/**
 * @title All Morpho Blue flash callbacks
 */
abstract contract MorphoFlashLoanCallback is Masks, DeltaErrors {
    function onMorphoFlashLoan(uint256, bytes calldata) external {
        _onMorphoCallback();
    }

    /**
     * @notice Returns the trusted Morpho pool address. Override per chain.
     */
    function _morphoPool() internal pure virtual returns (address);

    function _onMorphoCallback() internal {
        address orderSigner;
        uint256 calldataLength;
        address pool = _morphoPool();
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
            orderSigner := shr(96, firstWord)
            calldataLength := sub(calldataload(68), 21)
        }
        _settleInternal(
            orderSigner,
            121,
            calldataLength
        );
    }

    function _settleInternal(address orderSigner, uint256 offset, uint256 length) internal virtual {}
}
