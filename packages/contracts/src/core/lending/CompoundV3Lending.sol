// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.8.34;

import {ERC20Selectors} from "../selectors/ERC20Selectors.sol";
import {Masks} from "../masks/Masks.sol";

// solhint-disable max-line-length

/**
 * @notice Lending base contract that wraps Compound V3 markets.
 * Asset, amount, and receiver are passed as explicit parameters.
 */
abstract contract CompoundV3Lending is ERC20Selectors, Masks {
    /**
     * @notice Withdraws from Compound V3 lending pool
     * @dev Supports both base and collateral token withdrawals
     * @param asset The underlying token address
     * @param amount The amount to withdraw (type(uint112).max = user's full balance)
     * @param receiver The address to receive withdrawn tokens
     * @param callerAddress Address of the caller
     * @param currentOffset Current position in the calldata (lender-specific data)
     * @return Updated calldata offset after processing
     * @custom:calldata-offset-table (lender-specific blob)
     * | Offset | Length (bytes) | Description                     |
     * |--------|----------------|---------------------------------|
     * | 0      | 1              | isBase (0=collateral, 1=base)   |
     * | 1      | 20             | comet                           |
     */
    function _withdrawFromCompoundV3(
        address asset,
        uint256 amount,
        address receiver,
        address callerAddress,
        uint256 currentOffset
    ) internal returns (uint256) {
        assembly {
            let ptr := mload(0x40)

            // read lender-specific data from blob
            let isBase := shr(248, calldataload(currentOffset))
            let cometPool := shr(96, calldataload(add(currentOffset, 1)))
            currentOffset := add(currentOffset, 21)

            if eq(amount, 0xffffffffffffffffffffffffffff) {
                switch isBase
                case 0 {
                    // selector for userCollateral(address,address)
                    mstore(ptr, 0x2b92a07d00000000000000000000000000000000000000000000000000000000)
                    // add caller address as parameter
                    mstore(add(ptr, 0x04), callerAddress)
                    // add underlying address
                    mstore(add(ptr, 0x24), asset)
                    // call to comet
                    if iszero(staticcall(gas(), cometPool, ptr, 0x44, ptr, 0x20)) {
                        returndatacopy(0, 0, returndatasize())
                        revert(0, returndatasize())
                    }
                    // load the retrieved balance (lower 128 bits)
                    amount := and(UINT128_MASK, mload(ptr))
                }
                // comet.balanceOf(...) is lending token balance
                default {
                    // selector for balanceOf(address)
                    mstore(0, ERC20_BALANCE_OF)
                    // add caller address as parameter
                    mstore(0x04, callerAddress)
                    // call to comet
                    if iszero(staticcall(gas(), cometPool, 0x0, 0x24, 0x0, 0x20)) {
                        returndatacopy(0, 0, returndatasize())
                        revert(0, returndatasize())
                    }
                    // load the retrieved balance
                    amount := mload(0x0)
                }
            }

            // selector withdrawFrom(address,address,address,uint256)
            mstore(ptr, 0x2644131800000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 0x04), callerAddress)
            mstore(add(ptr, 0x24), receiver)
            mstore(add(ptr, 0x44), asset)
            mstore(add(ptr, 0x64), amount)
            // call pool
            if iszero(call(gas(), cometPool, 0x0, ptr, 0x84, 0x0, 0x0)) {
                returndatacopy(0x0, 0x0, returndatasize())
                revert(0x0, returndatasize())
            }
        }
        return currentOffset;
    }

    /**
     * @notice Borrows from Compound V3 lending pool
     * @param asset The underlying token address to borrow
     * @param amount The amount to borrow
     * @param receiver The address to receive borrowed tokens
     * @param callerAddress Address of the caller
     * @param currentOffset Current position in the calldata (lender-specific data)
     * @return Updated calldata offset after processing
     * @custom:calldata-offset-table (lender-specific blob)
     * | Offset | Length (bytes) | Description                     |
     * |--------|----------------|---------------------------------|
     * | 0      | 20             | comet                           |
     */
    function _borrowFromCompoundV3(
        address asset,
        uint256 amount,
        address receiver,
        address callerAddress,
        uint256 currentOffset
    ) internal returns (uint256) {
        assembly {
            let ptr := mload(0x40)

            let cometPool := shr(96, calldataload(currentOffset))
            currentOffset := add(currentOffset, 20)

            // selector withdrawFrom(address,address,address,uint256)
            mstore(ptr, 0x2644131800000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 0x04), callerAddress)
            mstore(add(ptr, 0x24), receiver)
            mstore(add(ptr, 0x44), asset)
            mstore(add(ptr, 0x64), amount)
            // call pool
            if iszero(call(gas(), cometPool, 0x0, ptr, 0x84, 0x0, 0x0)) {
                returndatacopy(0x0, 0x0, returndatasize())
                revert(0x0, returndatasize())
            }
        }
        return currentOffset;
    }

    /**
     * @notice Deposits to Compound V3 lending pool
     * @dev Zero amount uses contract balance
     * @param asset The underlying token address to deposit
     * @param amount The amount to deposit (0 = contract balance)
     * @param receiver The address to receive cTokens
     * @param currentOffset Current position in the calldata (lender-specific data)
     * @return Updated calldata offset after processing
     * @custom:calldata-offset-table (lender-specific blob)
     * | Offset | Length (bytes) | Description                     |
     * |--------|----------------|---------------------------------|
     * | 0      | 20             | comet                           |
     */
    function _depositToCompoundV3(
        address asset,
        uint256 amount,
        address receiver,
        uint256 currentOffset
    ) internal returns (uint256) {
        assembly {
            let comet := shr(96, calldataload(currentOffset))
            currentOffset := add(currentOffset, 20)

            // zero is this balance
            if iszero(amount) {
                // selector for balanceOf(address)
                mstore(0, ERC20_BALANCE_OF)
                // add this address as parameter
                mstore(0x04, address())
                // call to token
                if iszero(staticcall(gas(), asset, 0x0, 0x24, 0x0, 0x20)) {
                    returndatacopy(0, 0, returndatasize())
                    revert(0, returndatasize())
                }
                // load the retrieved balance
                amount := mload(0x0)
            }

            let ptr := mload(0x40)

            // selector supplyTo(address,address,uint256)
            mstore(ptr, 0x4232cd6300000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 0x04), receiver)
            mstore(add(ptr, 0x24), asset)
            mstore(add(ptr, 0x44), amount)
            // call pool
            if iszero(call(gas(), comet, 0x0, ptr, 0x64, 0x0, 0x0)) {
                returndatacopy(0x0, 0x0, returndatasize())
                revert(0x0, returndatasize())
            }
        }
        return currentOffset;
    }

    /**
     * @notice Repays debt to Compound V3 lending pool
     * @dev Zero amount uses contract balance. Max amount (0xffffffffffffffffffffffffffff) repays minimum of contract balance and user debt.
     * @param asset The underlying token address to repay
     * @param amount The amount to repay (0 = contract balance, type(uint112).max = safe max)
     * @param receiver The borrower address (on behalf of)
     * @param currentOffset Current position in the calldata (lender-specific data)
     * @return Updated calldata offset after processing
     * @custom:calldata-offset-table (lender-specific blob)
     * | Offset | Length (bytes) | Description                     |
     * |--------|----------------|---------------------------------|
     * | 0      | 20             | comet                           |
     */
    function _repayToCompoundV3(
        address asset,
        uint256 amount,
        address receiver,
        uint256 currentOffset
    ) internal returns (uint256) {
        assembly {
            let comet := shr(96, calldataload(currentOffset))
            currentOffset := add(currentOffset, 20)

            switch amount
            case 0 {
                // selector for balanceOf(address)
                mstore(0, ERC20_BALANCE_OF)
                // add this address as parameter
                mstore(0x04, address())
                // call to token
                if iszero(staticcall(gas(), asset, 0x0, 0x24, 0x0, 0x20)) {
                    returndatacopy(0, 0, returndatasize())
                    revert(0, returndatasize())
                }
                // load the retrieved balance
                amount := mload(0x0)
            }
            // repay maximum safely
            case 0xffffffffffffffffffffffffffff {
                // selector for balanceOf(address)
                mstore(0, ERC20_BALANCE_OF)
                // add this address as parameter
                mstore(0x04, address())
                // call to token
                if iszero(staticcall(gas(), asset, 0x0, 0x24, 0x0, 0x20)) {
                    returndatacopy(0, 0, returndatasize())
                    revert(0, returndatasize())
                }
                // load the retrieved balance
                amount := mload(0x0)

                // selector for borrowBalanceOf(address)
                mstore(0, 0x374c49b400000000000000000000000000000000000000000000000000000000)
                // add receiver as parameter
                mstore(0x04, receiver)
                // call to comet
                if iszero(staticcall(gas(), comet, 0x0, 0x24, 0x0, 0x20)) {
                    returndatacopy(0, 0, returndatasize())
                    revert(0, returndatasize())
                }
                let userBorrowBalance := mload(0x0)

                // amount greater than borrow balance -> use borrow balance
                // otherwise repay less than the borrow balance safely
                if gt(amount, userBorrowBalance) { amount := userBorrowBalance }
            }

            let ptr := mload(0x40)
            // selector supplyTo(address,address,uint256)
            mstore(ptr, 0x4232cd6300000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 0x04), receiver)
            mstore(add(ptr, 0x24), asset)
            mstore(add(ptr, 0x44), amount)
            // call pool
            if iszero(call(gas(), comet, 0x0, ptr, 0x64, 0x0, 0x0)) {
                returndatacopy(0x0, 0x0, returndatasize())
                revert(0x0, returndatasize())
            }
        }

        return currentOffset;
    }
}
