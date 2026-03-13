// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.8.34;

import {ERC20Selectors} from "../selectors/ERC20Selectors.sol";
import {Masks} from "../masks/Masks.sol";

// solhint-disable max-line-length

/**
 * @notice Lending base contract that wraps multiple Aave lender types (V2, V3, non-ir mode based).
 * Asset, amount, and receiver are passed as explicit parameters.
 */
abstract contract AaveLending is ERC20Selectors, Masks {
    /**
     * @notice Withdraws from Aave lending pool
     * @dev Transfers collateral tokens from caller and withdraws underlying
     * @param asset The underlying token address
     * @param amount The amount to withdraw (type(uint112).max = user's full aToken balance)
     * @param receiver The address to receive withdrawn tokens
     * @param callerAddress Address of the caller
     * @param currentOffset Current position in the calldata (lender-specific data)
     * @return Updated calldata offset after processing
     * @custom:calldata-offset-table (lender-specific blob)
     * | Offset | Length (bytes) | Description                     |
     * |--------|----------------|---------------------------------|
     * | 0      | 20             | aToken                          |
     * | 20     | 20             | pool                            |
     */
    function _withdrawFromAave(
        address asset,
        uint256 amount,
        address receiver,
        address callerAddress,
        uint256 currentOffset
    ) internal returns (uint256) {
        assembly {
            let ptr := mload(0x40)

            // read lender-specific data from blob
            let collateralToken := shr(96, calldataload(currentOffset))
            let pool := shr(96, calldataload(add(currentOffset, 20)))
            currentOffset := add(currentOffset, 40)

            // apply max if needed
            switch amount
            case 0xffffffffffffffffffffffffffff {
                // selector for balanceOf(address)
                mstore(0, ERC20_BALANCE_OF)
                // add caller address as parameter
                mstore(0x04, callerAddress)
                // call to collateral token
                if iszero(staticcall(gas(), collateralToken, 0x0, 0x24, 0x0, 0x20)) {
                    returndatacopy(0, 0, returndatasize())
                    revert(0, returndatasize())
                }
                // load the retrieved balance
                amount := mload(0x0)
            }

            /**
             * PREPARE TRANSFER_FROM USER
             */

            // selector for transferFrom(address,address,uint256)
            mstore(ptr, ERC20_TRANSFER_FROM)
            mstore(add(ptr, 0x04), callerAddress)
            mstore(add(ptr, 0x24), address())
            mstore(add(ptr, 0x44), amount)

            let success := call(gas(), collateralToken, 0x0, ptr, 0x64, 0x0, 0x20)

            let rdsize := returndatasize()

            success := and(
                success, // call itself succeeded
                or(
                    iszero(rdsize), // no return data, or
                    and(
                        gt(rdsize, 31), // at least 32 bytes
                        eq(mload(0x0), 1) // starts with uint256(1)
                    )
                )
            )

            if iszero(success) {
                returndatacopy(0x0, 0x0, rdsize)
                revert(0x0, rdsize)
            }

            // selector withdraw(address,uint256,address)
            mstore(ptr, 0x69328dec00000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 0x04), asset)
            mstore(add(ptr, 0x24), amount)
            mstore(add(ptr, 0x44), receiver)

            // call pool
            if iszero(call(gas(), pool, 0x0, ptr, 0x64, 0x0, 0x0)) {
                returndatacopy(0x0, 0x0, returndatasize())
                revert(0x0, returndatasize())
            }
        }
        return currentOffset;
    }

    /**
     * @notice Borrows from Aave lending pool
     * @dev Supports both IR mode and non-IR mode borrowing
     * @param asset The underlying token address to borrow
     * @param amount The amount to borrow
     * @param receiver The address to receive borrowed tokens
     * @param callerAddress Address of the caller
     * @param currentOffset Current position in the calldata (lender-specific data)
     * @return Updated calldata offset after processing
     * @custom:calldata-offset-table (lender-specific blob)
     * | Offset | Length (bytes) | Description                     |
     * |--------|----------------|---------------------------------|
     * | 0      | 1              | mode (0=no IR, other=IR mode)   |
     * | 1      | 20             | pool                            |
     */
    function _borrowFromAave(
        address asset,
        uint256 amount,
        address receiver,
        address callerAddress,
        uint256 currentOffset
    ) internal returns (uint256) {
        assembly {
            // read lender-specific data from blob
            let modeAndPool := calldataload(currentOffset)
            let mode := shr(248, modeAndPool)
            let pool := shr(96, calldataload(add(currentOffset, 1)))
            currentOffset := add(currentOffset, 21)

            let ptr := mload(0x40)
            switch mode
            case 0 {
                // borrowing with no irMode (special aave forks)
                // selector borrow(address,uint256,uint16,address)
                mstore(ptr, 0x1d5d723700000000000000000000000000000000000000000000000000000000)
                mstore(add(ptr, 0x04), asset)
                mstore(add(ptr, 0x24), amount)
                mstore(add(ptr, 0x44), 0x0)
                mstore(add(ptr, 0x64), callerAddress)
                // call pool
                if iszero(call(gas(), pool, 0x0, ptr, 0x84, 0x0, 0x0)) {
                    returndatacopy(0x0, 0x0, returndatasize())
                    revert(0x0, returndatasize())
                }
            }
            default {
                // selector borrow(address,uint256,uint256,uint16,address)
                mstore(ptr, 0xa415bcad00000000000000000000000000000000000000000000000000000000)
                mstore(add(ptr, 0x04), asset)
                mstore(add(ptr, 0x24), amount)
                mstore(add(ptr, 0x44), mode)
                mstore(add(ptr, 0x64), 0x0)
                mstore(add(ptr, 0x84), callerAddress)
                // call pool
                if iszero(call(gas(), pool, 0x0, ptr, 0xA4, 0x0, 0x0)) {
                    returndatacopy(0x0, 0x0, returndatasize())
                    revert(0x0, returndatasize())
                }
            }

            //  transfer underlying if needed
            if xor(receiver, address()) {
                // selector for transfer(address,uint256)
                mstore(ptr, ERC20_TRANSFER)
                mstore(add(ptr, 0x04), receiver)
                mstore(add(ptr, 0x24), amount)

                let success := call(gas(), asset, 0, ptr, 0x44, ptr, 32)

                let rdsize := returndatasize()

                success := and(
                    success, // call itself succeeded
                    or(
                        iszero(rdsize), // no return data, or
                        and(
                            gt(rdsize, 31), // at least 32 bytes
                            eq(mload(ptr), 1) // starts with uint256(1)
                        )
                    )
                )

                if iszero(success) {
                    returndatacopy(0, 0, rdsize)
                    revert(0, rdsize)
                }
            }
        }
        return currentOffset;
    }

    /**
     * @notice Deposits to Aave V3 lending pool
     * @dev Zero amount uses contract balance
     * @param asset The underlying token address to deposit
     * @param amount The amount to deposit (0 = contract balance)
     * @param receiver The address to receive aTokens
     * @param currentOffset Current position in the calldata (lender-specific data)
     * @return Updated calldata offset after processing
     * @custom:calldata-offset-table (lender-specific blob)
     * | Offset | Length (bytes) | Description                     |
     * |--------|----------------|---------------------------------|
     * | 0      | 20             | pool                            |
     */
    function _depositToAaveV3(
        address asset,
        uint256 amount,
        address receiver,
        uint256 currentOffset
    ) internal returns (uint256) {
        assembly {
            let pool := shr(96, calldataload(currentOffset))
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

            // selector supply(address,uint256,address,uint16)
            mstore(ptr, 0x617ba03700000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 0x04), asset)
            mstore(add(ptr, 0x24), amount)
            mstore(add(ptr, 0x44), receiver)
            mstore(add(ptr, 0x64), 0x0)
            // call pool
            if iszero(call(gas(), pool, 0x0, ptr, 0x84, 0x0, 0x0)) {
                returndatacopy(0x0, 0x0, returndatasize())
                revert(0x0, returndatasize())
            }
        }
        return currentOffset;
    }

    /**
     * @notice Deposits to Aave V2 lending pool
     * @dev Zero amount uses contract balance
     * @param asset The underlying token address to deposit
     * @param amount The amount to deposit (0 = contract balance)
     * @param receiver The address to receive aTokens
     * @param currentOffset Current position in the calldata (lender-specific data)
     * @return Updated calldata offset after processing
     * @custom:calldata-offset-table (lender-specific blob)
     * | Offset | Length (bytes) | Description                     |
     * |--------|----------------|---------------------------------|
     * | 0      | 20             | pool                            |
     */
    function _depositToAaveV2(
        address asset,
        uint256 amount,
        address receiver,
        uint256 currentOffset
    ) internal returns (uint256) {
        assembly {
            let pool := shr(96, calldataload(currentOffset))
            currentOffset := add(currentOffset, 20)

            // zero is this balance
            if iszero(amount) {
                // selector for balanceOf(address)
                mstore(0, ERC20_BALANCE_OF)
                // add this address as parameter
                mstore(0x04, address())
                // call to token
                if iszero(
                    staticcall(
                        gas(),
                        asset, // token
                        0x0,
                        0x24,
                        0x0,
                        0x20
                    )
                ) {
                    returndatacopy(0, 0, returndatasize())
                    revert(0, returndatasize())
                }
                // load the retrieved balance
                amount := mload(0x0)
            }

            let ptr := mload(0x40)
            // selector deposit(address,uint256,address,uint16)
            mstore(ptr, 0xe8eda9df00000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 0x04), asset)
            mstore(add(ptr, 0x24), amount)
            mstore(add(ptr, 0x44), receiver)
            mstore(add(ptr, 0x64), 0x0)
            // call pool
            if iszero(call(gas(), pool, 0x0, ptr, 0x84, 0x0, 0x0)) {
                returndatacopy(0x0, 0x0, returndatasize())
                revert(0x0, returndatasize())
            }
        }
        return currentOffset;
    }

    /**
     * @notice Repays debt to Aave lending pool
     * @dev Supports both IR mode and non-IR mode. Zero amount uses contract balance.
     * Max amount (0xffffffffffffffffffffffffffff) repays minimum of contract balance and user debt.
     * @param asset The underlying token address to repay
     * @param amount The amount to repay (0 = contract balance, type(uint112).max = safe max)
     * @param receiver The borrower address (on behalf of)
     * @param currentOffset Current position in the calldata (lender-specific data)
     * @return Updated calldata offset after processing
     * @custom:calldata-offset-table (lender-specific blob)
     * | Offset | Length (bytes) | Description                     |
     * |--------|----------------|---------------------------------|
     * | 0      | 1              | mode (0=no IR, other=IR mode)   |
     * | 1      | 20             | debtToken                       |
     * | 21     | 20             | pool                            |
     */
    function _repayToAave(
        address asset,
        uint256 amount,
        address receiver,
        uint256 currentOffset
    ) internal returns (uint256) {
        assembly {
            // read lender-specific data from blob
            let mode := shr(248, calldataload(currentOffset))
            let debtToken := shr(96, calldataload(add(currentOffset, 1)))
            let pool := shr(96, calldataload(add(currentOffset, 21)))
            currentOffset := add(currentOffset, 41)

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
            // safe repay maximum: fetch contract balance and user debt and take minimum
            case 0xffffffffffffffffffffffffffff {
                // selector for balanceOf(address)
                mstore(0, ERC20_BALANCE_OF)

                // add this address as parameter
                mstore(0x04, address())
                // call to token
                if iszero(staticcall(gas(), asset, 0x0, 0x24, 0x4, 0x20)) {
                    returndatacopy(0, 0, returndatasize())
                    revert(0, returndatasize())
                }
                // load the retrieved balance
                amount := mload(0x4)

                // add caller address as parameter
                mstore(0x04, receiver)
                // call to debt token
                if iszero(staticcall(gas(), debtToken, 0x0, 0x24, 0x0, 0x20)) {
                    returndatacopy(0, 0, returndatasize())
                    revert(0, returndatasize())
                }
                // load the retrieved balance
                let borrowBalance := mload(0x0)
                // if borrow balance is less than the amount, select borrow balance
                if lt(borrowBalance, amount) { amount := borrowBalance }
            }

            let ptr := mload(0x40)

            // some Aaves dropped the IR mode, mode=0 is using their selector
            switch mode
            case 0 {
                // selector repay(address,uint256,address)
                mstore(ptr, 0x5ceae9c400000000000000000000000000000000000000000000000000000000)
                mstore(add(ptr, 0x04), asset)
                mstore(add(ptr, 0x24), amount)
                mstore(add(ptr, 0x44), receiver)
                // call pool
                if iszero(call(gas(), pool, 0x0, ptr, 0x64, 0x0, 0x0)) {
                    returndatacopy(0x0, 0x0, returndatasize())
                    revert(0x0, returndatasize())
                }
            }
            default {
                // selector repay(address,uint256,uint256,address)
                mstore(ptr, 0x573ade8100000000000000000000000000000000000000000000000000000000)
                mstore(add(ptr, 0x04), asset)
                mstore(add(ptr, 0x24), amount)
                mstore(add(ptr, 0x44), mode)
                mstore(add(ptr, 0x64), receiver)
                // call pool
                if iszero(call(gas(), pool, 0x0, ptr, 0x84, 0x0, 0x0)) {
                    returndatacopy(0x0, 0x0, returndatasize())
                    revert(0x0, returndatasize())
                }
            }
        }

        return currentOffset;
    }
}
