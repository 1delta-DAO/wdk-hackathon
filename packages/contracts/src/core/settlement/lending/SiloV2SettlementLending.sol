// SPDX-License-Identifier: MIT

pragma solidity 0.8.34;

import {ERC20Selectors} from "../../selectors/ERC20Selectors.sol";
import {Masks} from "../../masks/Masks.sol";

// solhint-disable max-line-length

/**
 * @title SiloV2SettlementLending
 * @notice Settlement lending module for Silo V2 isolated lending markets.
 * @dev Provides low-level assembly interactions for deposit, withdraw, borrow, and repay
 *      operations on Silo V2 vaults. Silo V2 supports multiple collateral types per silo
 *      (protected vs standard collateral) via a `cType` parameter.
 *
 *      Supported operations:
 *        - Withdraw:  Uses withdraw/redeem with optional collateral type. Max amount uses
 *                     balanceOf on the silo share token, then redeems all shares
 *        - Borrow:    Calls silo.borrow() or silo.borrowShares() depending on mode
 *        - Deposit:   Calls silo.deposit() or silo.depositWithCollateralType() depending on cType
 *        - Repay:     Calls silo.repay(). Safe max uses silo.maxRepay() to cap the amount
 *
 *      Amount semantics:
 *        - 0:                       Use contract's current balance of the asset
 *        - type(uint112).max:       Use caller's full silo share balance (for withdraw) or
 *                                   min(contractBalance, maxRepay) for repay
 *        - any other value:         Use as-is
 *
 *      Collateral types (cType):
 *        - 0: Protected collateral (uses extended selectors with collateral type param)
 *        - 1: Standard collateral (uses base ERC4626 selectors)
 *
 *      Data layout: [1: cType/mode][20: silo] for withdraw/borrow/deposit, [20: silo] for repay
 */
abstract contract SiloV2SettlementLending is ERC20Selectors, Masks {
    bytes32 private constant WITHDRAW = 0xb460af9400000000000000000000000000000000000000000000000000000000;
    bytes32 private constant WITHDRAW_WITH_COLLATERAL_TYPE = 0xb8337c2a00000000000000000000000000000000000000000000000000000000;

    bytes32 private constant REDEEM = 0xba08765200000000000000000000000000000000000000000000000000000000;
    bytes32 private constant REDEEM_WITH_COLLATERAL_TYPE = 0xda53766000000000000000000000000000000000000000000000000000000000;

    /**
     * @notice Withdraws from Silo V2 lending pool
     * @param amount The amount to withdraw (type(uint112).max = user's full silo balance)
     * @param receiver The address to receive withdrawn tokens
     * @param callerAddress Address of the caller
     * @param data Lender-specific data: [1: cType][20: silo]
     */
    function _withdrawFromSiloV2(
        address, /* asset */
        uint256 amount,
        address receiver,
        address callerAddress,
        bytes memory data
    ) internal returns (uint256 amountIn, uint256 amountOut) {
        assembly {
            let ptr := mload(0x40)
            let d := add(data, 0x20)

            let cType := shr(248, mload(d))
            let silo := shr(96, mload(add(d, 1)))

            // store common parameters
            mstore(add(ptr, 0x24), receiver)
            mstore(add(ptr, 0x44), callerAddress)

            switch amount
            case 0xffffffffffffffffffffffffffff {
                mstore(0, ERC20_BALANCE_OF)
                mstore(0x04, callerAddress)
                if iszero(staticcall(gas(), silo, 0x0, 0x24, 0x0, 0x20)) {
                    returndatacopy(0, 0, returndatasize())
                    revert(0, returndatasize())
                }
                amount := mload(0x0)

                switch cType
                case 1 {
                    mstore(ptr, REDEEM)
                    mstore(add(ptr, 0x4), amount)
                    if iszero(call(gas(), silo, 0x0, ptr, 0x64, 0x0, 0x0)) {
                        returndatacopy(0x0, 0x0, returndatasize())
                        revert(0x0, returndatasize())
                    }
                }
                default {
                    mstore(ptr, REDEEM_WITH_COLLATERAL_TYPE)
                    mstore(add(ptr, 0x4), amount)
                    mstore(add(ptr, 0x64), cType)
                    if iszero(call(gas(), silo, 0x0, ptr, 0x84, 0x0, 0x0)) {
                        returndatacopy(0x0, 0x0, returndatasize())
                        revert(0x0, returndatasize())
                    }
                }
            }
            default {
                switch cType
                case 1 {
                    mstore(ptr, WITHDRAW)
                    mstore(add(ptr, 0x4), amount)
                    if iszero(call(gas(), silo, 0x0, ptr, 0x64, 0x0, 0x0)) {
                        returndatacopy(0x0, 0x0, returndatasize())
                        revert(0x0, returndatasize())
                    }
                }
                default {
                    mstore(ptr, WITHDRAW_WITH_COLLATERAL_TYPE)
                    mstore(add(ptr, 0x4), amount)
                    mstore(add(ptr, 0x64), cType)
                    if iszero(call(gas(), silo, 0x0, ptr, 0x84, 0x0, 0x0)) {
                        returndatacopy(0x0, 0x0, returndatasize())
                        revert(0x0, returndatasize())
                    }
                }
            }

            amountOut := amount
        }
    }

    bytes32 private constant BORROW = 0xd516418400000000000000000000000000000000000000000000000000000000;
    bytes32 private constant BORROW_SHARES = 0x889576f700000000000000000000000000000000000000000000000000000000;

    /**
     * @notice Borrows from Silo V2 lending pool
     * @param amount The amount to borrow
     * @param receiver The address to receive borrowed tokens
     * @param callerAddress Address of the caller
     * @param data Lender-specific data: [1: mode][20: silo]
     */
    function _borrowFromSiloV2(
        address, /* asset */
        uint256 amount,
        address receiver,
        address callerAddress,
        bytes memory data
    ) internal returns (uint256 amountIn, uint256 amountOut) {
        assembly {
            let d := add(data, 0x20)
            let mode := shr(248, mload(d))
            let silo := shr(96, mload(add(d, 1)))

            let ptr := mload(0x40)

            switch mode
            case 0 {
                mstore(ptr, BORROW)
            }
            default {
                mstore(ptr, BORROW_SHARES)
            }
            mstore(add(ptr, 0x4), amount)
            mstore(add(ptr, 0x24), receiver)
            mstore(add(ptr, 0x44), callerAddress)

            if iszero(call(gas(), silo, 0x0, ptr, 0x64, 0x0, 0x0)) {
                returndatacopy(0x0, 0x0, returndatasize())
                revert(0x0, returndatasize())
            }

            amountOut := amount
        }
    }

    bytes32 private constant DEPOSIT = 0x6e553f6500000000000000000000000000000000000000000000000000000000;
    bytes32 private constant DEPOSIT_WITH_COLLATERAL_TYPE = 0xb7ec8d4b00000000000000000000000000000000000000000000000000000000;

    /**
     * @notice Deposits to Silo V2 lending pool
     * @param asset The underlying token address
     * @param amount The amount to deposit (0 = contract balance)
     * @param receiver The address to receive silo shares
     * @param data Lender-specific data: [1: cType][20: silo]
     */
    function _depositToSiloV2(
        address asset,
        uint256 amount,
        address receiver,
        bytes memory data
    ) internal returns (uint256 amountIn, uint256 amountOut) {
        assembly {
            let d := add(data, 0x20)
            let cType := shr(248, mload(d))
            let silo := shr(96, mload(add(d, 1)))

            if iszero(amount) {
                mstore(0, ERC20_BALANCE_OF)
                mstore(0x04, address())
                if iszero(staticcall(gas(), asset, 0x0, 0x24, 0x0, 0x20)) {
                    returndatacopy(0, 0, returndatasize())
                    revert(0, returndatasize())
                }
                amount := mload(0x0)
            }

            let ptr := mload(0x40)
            mstore(add(ptr, 0x24), receiver)

            switch cType
            case 1 {
                mstore(ptr, DEPOSIT)
                mstore(add(ptr, 0x4), amount)
                if iszero(call(gas(), silo, 0x0, ptr, 0x44, 0x0, 0x0)) {
                    returndatacopy(0x0, 0x0, returndatasize())
                    revert(0x0, returndatasize())
                }
            }
            default {
                mstore(ptr, DEPOSIT_WITH_COLLATERAL_TYPE)
                mstore(add(ptr, 0x4), amount)
                mstore(add(ptr, 0x44), cType)
                if iszero(call(gas(), silo, 0x0, ptr, 0x64, 0x0, 0x0)) {
                    returndatacopy(0x0, 0x0, returndatasize())
                    revert(0x0, returndatasize())
                }
            }

            amountIn := amount
        }
    }

    bytes32 private constant MAX_REPAY = 0x5f30114900000000000000000000000000000000000000000000000000000000;
    bytes32 private constant REPAY = 0xacb7081500000000000000000000000000000000000000000000000000000000;

    /**
     * @notice Repays debt to Silo V2 lending pool
     * @param asset The underlying token address
     * @param amount The amount to repay (0 = contract balance, type(uint112).max = safe max)
     * @param receiver The borrower address (on behalf of)
     * @param data Lender-specific data: [20: silo]
     */
    function _repayToSiloV2(
        address asset,
        uint256 amount,
        address receiver,
        bytes memory data
    ) internal returns (uint256 amountIn, uint256 amountOut) {
        assembly {
            function _balanceOf(t, u) -> b {
                mstore(0, ERC20_BALANCE_OF)
                mstore(0x04, u)
                if iszero(staticcall(gas(), t, 0x0, 0x24, 0x0, 0x20)) {
                    returndatacopy(0, 0, returndatasize())
                    revert(0, returndatasize())
                }
                b := mload(0x0)
            }

            let silo := shr(96, mload(add(data, 0x20)))

            switch amount
            case 0 { amount := _balanceOf(asset, address()) }
            case 0xffffffffffffffffffffffffffff {
                amount := _balanceOf(asset, address())

                mstore(0, MAX_REPAY)
                mstore(0x04, receiver)
                if iszero(staticcall(gas(), silo, 0x0, 0x24, 0x0, 0x20)) {
                    returndatacopy(0, 0, returndatasize())
                    revert(0, returndatasize())
                }
                let borrowBalance := mload(0x0)
                if lt(borrowBalance, amount) { amount := borrowBalance }
            }

            let ptr := mload(0x40)
            mstore(ptr, REPAY)
            mstore(add(ptr, 0x04), amount)
            mstore(add(ptr, 0x24), receiver)
            if iszero(call(gas(), silo, 0x0, ptr, 0x44, 0x0, 0x0)) {
                returndatacopy(0x0, 0x0, returndatasize())
                revert(0x0, returndatasize())
            }

            amountIn := amount
        }
    }
}
