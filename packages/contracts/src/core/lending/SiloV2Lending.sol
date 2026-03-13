// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.8.34;

import {ERC20Selectors} from "../selectors/ERC20Selectors.sol";
import {Masks} from "../masks/Masks.sol";

// solhint-disable max-line-length

/**
 * @notice Lending base contract that wraps Silos (v2).
 * Asset, amount, and receiver are passed as explicit parameters.
 */
abstract contract SiloV2Lending is ERC20Selectors, Masks {
    bytes32 private constant WITHDRAW = 0xb460af9400000000000000000000000000000000000000000000000000000000;
    bytes32 private constant WITHDRAW_WITH_COLLATERAL_TYPE = 0xb8337c2a00000000000000000000000000000000000000000000000000000000;

    bytes32 private constant REDEEM = 0xba08765200000000000000000000000000000000000000000000000000000000;
    bytes32 private constant REDEEM_WITH_COLLATERAL_TYPE = 0xda53766000000000000000000000000000000000000000000000000000000000;

    /**
     * @notice Withdraws from Silo V2 lending pool
     * @param amount The amount to withdraw (type(uint112).max = user's full silo balance)
     * @param receiver The address to receive withdrawn tokens
     * @param callerAddress Address of the caller
     * @param currentOffset Current position in the calldata (lender-specific data)
     * @return Updated calldata offset after processing
     * @custom:calldata-offset-table (lender-specific blob)
     * | Offset | Length (bytes) | Description                     |
     * |--------|----------------|---------------------------------|
     * | 0      | 1              | cType (0=protected, 1=collateral) |
     * | 1      | 20             | silo                            |
     */
    function _withdrawFromSiloV2(
        address, /* asset */
        uint256 amount,
        address receiver,
        address callerAddress,
        uint256 currentOffset
    ) internal returns (uint256) {
        assembly {
            let ptr := mload(0x40)

            // read lender-specific data from blob
            let cType := shr(248, calldataload(currentOffset))
            let silo := shr(96, calldataload(add(currentOffset, 1)))
            currentOffset := add(currentOffset, 21)

            // store common parameters
            mstore(add(ptr, 0x24), receiver)
            mstore(add(ptr, 0x44), callerAddress)

            // apply max if needed
            // use shares if maximum toggled
            switch amount
            case 0xffffffffffffffffffffffffffff {
                // selector for balanceOf(address)
                mstore(0, ERC20_BALANCE_OF)
                // add caller address as parameter
                mstore(0x04, callerAddress)
                // call to collateral token
                if iszero(staticcall(gas(), silo, 0x0, 0x24, 0x0, 0x20)) {
                    returndatacopy(0, 0, returndatasize())
                    revert(0, returndatasize())
                }
                // load the retrieved balance
                amount := mload(0x0)

                switch cType
                // 1 is the default non-protected collateral
                case 1 {
                    // selector redeem(uint256,address,address)
                    mstore(ptr, REDEEM)
                    mstore(add(ptr, 0x4), amount)
                    // common parameters here
                    // call silo
                    if iszero(call(gas(), silo, 0x0, ptr, 0x64, 0x0, 0x0)) {
                        returndatacopy(0x0, 0x0, returndatasize())
                        revert(0x0, returndatasize())
                    }
                }
                // others are id'ed by their enum
                default {
                    // selector redeem(uint256,address,address,uint256)
                    mstore(ptr, REDEEM_WITH_COLLATERAL_TYPE)
                    mstore(add(ptr, 0x4), amount)
                    // common parameters here
                    mstore(add(ptr, 0x64), cType)
                    // call silo
                    if iszero(call(gas(), silo, 0x0, ptr, 0x84, 0x0, 0x0)) {
                        returndatacopy(0x0, 0x0, returndatasize())
                        revert(0x0, returndatasize())
                    }
                }
            }
            default {
                switch cType
                // 1 is the default non-protected collateral
                case 1 {
                    // selector withdraw(uint256,address,address)
                    mstore(ptr, WITHDRAW)
                    mstore(add(ptr, 0x4), amount)
                    // common parameters here
                    // call silo
                    if iszero(call(gas(), silo, 0x0, ptr, 0x64, 0x0, 0x0)) {
                        returndatacopy(0x0, 0x0, returndatasize())
                        revert(0x0, returndatasize())
                    }
                }
                // others are id'ed by their enum
                default {
                    // selector withdraw(uint256,address,address,uint256)
                    mstore(ptr, WITHDRAW_WITH_COLLATERAL_TYPE)
                    mstore(add(ptr, 0x4), amount)
                    // common parameters here
                    mstore(add(ptr, 0x64), cType)
                    // call silo
                    if iszero(call(gas(), silo, 0x0, ptr, 0x84, 0x0, 0x0)) {
                        returndatacopy(0x0, 0x0, returndatasize())
                        revert(0x0, returndatasize())
                    }
                }
            }
        }
        return currentOffset;
    }

    bytes32 private constant BORROW = 0xd516418400000000000000000000000000000000000000000000000000000000;
    bytes32 private constant BORROW_SHARES = 0x889576f700000000000000000000000000000000000000000000000000000000;

    /**
     * @notice Borrows from Silo V2 lending pool
     * @dev Supports borrowing by assets or shares
     * @param amount The amount to borrow
     * @param receiver The address to receive borrowed tokens
     * @param callerAddress Address of the caller
     * @param currentOffset Current position in the calldata (lender-specific data)
     * @return Updated calldata offset after processing
     * @custom:calldata-offset-table (lender-specific blob)
     * | Offset | Length (bytes) | Description                     |
     * |--------|----------------|---------------------------------|
     * | 0      | 1              | mode (0=by assets, 1=by shares) |
     * | 1      | 20             | silo                            |
     */
    function _borrowFromSiloV2(
        address, /* asset */
        uint256 amount,
        address receiver,
        address callerAddress,
        uint256 currentOffset
    ) internal returns (uint256) {
        assembly {
            // read lender-specific data from blob
            let mode := shr(248, calldataload(currentOffset))
            let silo := shr(96, calldataload(add(currentOffset, 1)))
            currentOffset := add(currentOffset, 21)

            let ptr := mload(0x40)

            // switch-case over borrow mode
            switch mode
            // by assets
            case 0 {
                // selector borrow(uint256,address,address)
                mstore(ptr, BORROW)
            }
            // by shares
            default {
                // selector borrowShares(uint256,address,address)
                mstore(ptr, BORROW_SHARES)
            }
            // the rest is the same for both cases
            mstore(add(ptr, 0x4), amount)
            mstore(add(ptr, 0x24), receiver)
            mstore(add(ptr, 0x44), callerAddress)

            // call silo
            if iszero(call(gas(), silo, 0x0, ptr, 0x64, 0x0, 0x0)) {
                returndatacopy(0x0, 0x0, returndatasize())
                revert(0x0, returndatasize())
            }
        }
        return currentOffset;
    }

    bytes32 private constant DEPOSIT = 0x6e553f6500000000000000000000000000000000000000000000000000000000;
    bytes32 private constant DEPOSIT_WITH_COLLATERAL_TYPE = 0xb7ec8d4b00000000000000000000000000000000000000000000000000000000;

    /**
     * @notice Deposits to Silo V2 lending pool
     * @dev Zero amount uses contract balance
     * @param asset The underlying token address
     * @param amount The amount to deposit (0 = contract balance)
     * @param receiver The address to receive silo shares
     * @param currentOffset Current position in the calldata (lender-specific data)
     * @return Updated calldata offset after processing
     * @custom:calldata-offset-table (lender-specific blob)
     * | Offset | Length (bytes) | Description                     |
     * |--------|----------------|---------------------------------|
     * | 0      | 1              | cType (0=protected, 1=collateral) |
     * | 1      | 20             | silo                            |
     */
    function _depositToSiloV2(
        address asset,
        uint256 amount,
        address receiver,
        uint256 currentOffset
    ) internal returns (uint256) {
        assembly {
            // read lender-specific data from blob
            let cType := shr(248, calldataload(currentOffset))
            let silo := shr(96, calldataload(add(currentOffset, 1)))
            currentOffset := add(currentOffset, 21)

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

            // store common param
            mstore(add(ptr, 0x24), receiver)

            switch cType
            // 1 is the default non-protected collateral
            case 1 {
                // selector supply(uint256,address)
                mstore(ptr, DEPOSIT)
                mstore(add(ptr, 0x4), amount)
                // common param here
                // call silo
                if iszero(call(gas(), silo, 0x0, ptr, 0x44, 0x0, 0x0)) {
                    returndatacopy(0x0, 0x0, returndatasize())
                    revert(0x0, returndatasize())
                }
            }
            // others are id'ed by their enum
            default {
                // selector supply(uint256,address,uint256)
                mstore(ptr, DEPOSIT_WITH_COLLATERAL_TYPE)
                mstore(add(ptr, 0x4), amount)
                // common param here
                mstore(add(ptr, 0x44), cType)
                // call silo
                if iszero(call(gas(), silo, 0x0, ptr, 0x64, 0x0, 0x0)) {
                    returndatacopy(0x0, 0x0, returndatasize())
                    revert(0x0, returndatasize())
                }
            }
        }
        return currentOffset;
    }

    bytes32 private constant MAX_REPAY = 0x5f30114900000000000000000000000000000000000000000000000000000000;
    bytes32 private constant REPAY = 0xacb7081500000000000000000000000000000000000000000000000000000000;

    /**
     * @notice Repays debt to Silo V2 lending pool
     * @dev Zero amount uses contract balance. Max amount (0xffffffffffffffffffffffffffff) repays minimum of contract balance and user debt.
     * @param asset The underlying token address
     * @param amount The amount to repay (0 = contract balance, type(uint112).max = safe max)
     * @param receiver The borrower address (on behalf of)
     * @param currentOffset Current position in the calldata (lender-specific data)
     * @return Updated calldata offset after processing
     * @custom:calldata-offset-table (lender-specific blob)
     * | Offset | Length (bytes) | Description                     |
     * |--------|----------------|---------------------------------|
     * | 0      | 20             | silo                            |
     */
    function _repayToSiloV2(
        address asset,
        uint256 amount,
        address receiver,
        uint256 currentOffset
    ) internal returns (uint256) {
        assembly {
            function _balanceOf(t, u) -> b {
                // selector for balanceOf(address)
                mstore(0, ERC20_BALANCE_OF)
                // add this address as parameter (u)
                mstore(0x04, u)
                // call to token
                if iszero(staticcall(gas(), t, 0x0, 0x24, 0x0, 0x20)) {
                    returndatacopy(0, 0, returndatasize())
                    revert(0, returndatasize())
                }
                // load the balance and return it
                b := mload(0x0)
            }

            let silo := shr(96, calldataload(currentOffset))
            currentOffset := add(currentOffset, 20)

            switch amount
            case 0 { amount := _balanceOf(asset, address()) }
            // safe repay maximum: fetch contract balance and user debt and take minimum
            case 0xffffffffffffffffffffffffffff {
                amount := _balanceOf(asset, address())

                // call maxRepay(address) to get maxrepayable assets
                mstore(0, MAX_REPAY)
                // add caller address as parameter
                mstore(0x04, receiver)
                // call to debt token
                if iszero(staticcall(gas(), silo, 0x0, 0x24, 0x0, 0x20)) {
                    returndatacopy(0, 0, returndatasize())
                    revert(0, returndatasize())
                }
                // load the retrieved balance
                let borrowBalance := mload(0x0)
                // if borrow balance is less than the amount, select borrow balance
                if lt(borrowBalance, amount) { amount := borrowBalance }
            }

            let ptr := mload(0x40)

            // selector repay(uint256,address)
            mstore(ptr, REPAY)
            mstore(add(ptr, 0x04), amount)
            mstore(add(ptr, 0x24), receiver)
            // call silo
            if iszero(call(gas(), silo, 0x0, ptr, 0x44, 0x0, 0x0)) {
                returndatacopy(0x0, 0x0, returndatasize())
                revert(0x0, returndatasize())
            }
        }

        return currentOffset;
    }
}
