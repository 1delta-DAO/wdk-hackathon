// SPDX-License-Identifier: MIT

pragma solidity 0.8.34;

import {Masks} from "../../masks/Masks.sol";
import {DeltaErrors} from "../../errors/Errors.sol";

/**
 * @title All Moolah flash callbacks
 */
contract MoolahFlashLoanCallback is Masks, DeltaErrors {
    /// @dev Constant Moolah address
    address private constant LISTA_DAO = 0xf820fB4680712CD7263a0D3D024D5b5aEA82Fd70;

    /**
     * Moolah callbacks
     */

    /**
     * @notice Handles Moolah flash loan callback
     */
    function onMoolahFlashLoan(uint256, bytes calldata) external {
        _onMoolahCallback();
    }

    /**
     * @notice Internal callback handler for all Moolah operations
     * @dev Moolah flash loans are callbacks to msg.sender.
     * Since it is universal batching and the same validation for all Moolah callbacks, we can use the same logic everywhere
     * @custom:calldata-offset-table
     * | Offset | Length (bytes) | Description                  |
     * |--------|----------------|------------------------------|
     * | 0      | 20             | origCaller                   |
     * | 20     | 1              | poolId                       |
     * | 21     | Variable       | composeOperations            |
     */
    function _onMoolahCallback() internal {
        address origCaller;
        uint256 calldataLength;
        assembly {
            // validate caller
            // - extract id from params
            let firstWord := calldataload(100)

            switch and(UINT8_MASK, shr(88, firstWord))
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
            // Slice the original caller off the beginning of the calldata
            // From here on we have validated that the origCaller
            // was attached in the deltaCompose function
            // Otherwise, this would be a vulnerability
            origCaller := shr(96, firstWord)
            // shift / slice params
            calldataLength := sub(calldataload(68), 21)
        }
        // within the flash loan, any compose operation
        // can be executed
        _settleInternal(
            origCaller,
            121, // offset is constant (100 native + 21)
            calldataLength
        );
    }

    /**
     * @notice Internal function to execute compose operations
     * @dev Override point for flash loan callbacks to execute compose operations
     * @param callerAddress Address of the original caller
     * @param offset Current calldata offset
     * @param length Length of remaining calldata
     */
    function _settleInternal(address callerAddress, uint256 offset, uint256 length) internal virtual {}
}
