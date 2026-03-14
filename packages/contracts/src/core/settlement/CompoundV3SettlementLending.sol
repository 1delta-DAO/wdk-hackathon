// SPDX-License-Identifier: MIT

pragma solidity 0.8.34;

import {ERC20Selectors} from "../selectors/ERC20Selectors.sol";
import {Masks} from "../masks/Masks.sol";

// solhint-disable max-line-length

/**
 * @notice Settlement lending contract wrapping Compound V3 with bytes memory for lender params.
 */
abstract contract CompoundV3SettlementLending is ERC20Selectors, Masks {
    /**
     * @notice Withdraws from Compound V3 lending pool
     * @param asset The underlying token address
     * @param amount The amount to withdraw (type(uint112).max = user's full balance)
     * @param receiver The address to receive withdrawn tokens
     * @param callerAddress Address of the caller
     * @param data Lender-specific data: [1: isBase][20: comet]
     */
    function _withdrawFromCompoundV3(
        address asset,
        uint256 amount,
        address receiver,
        address callerAddress,
        bytes memory data
    ) internal {
        assembly {
            let ptr := mload(0x40)
            let d := add(data, 0x20)

            let isBase := shr(248, mload(d))
            let cometPool := shr(96, mload(add(d, 1)))

            if eq(amount, 0xffffffffffffffffffffffffffff) {
                switch isBase
                case 0 {
                    // userCollateral(address,address)
                    mstore(ptr, 0x2b92a07d00000000000000000000000000000000000000000000000000000000)
                    mstore(add(ptr, 0x04), callerAddress)
                    mstore(add(ptr, 0x24), asset)
                    if iszero(staticcall(gas(), cometPool, ptr, 0x44, ptr, 0x20)) {
                        returndatacopy(0, 0, returndatasize())
                        revert(0, returndatasize())
                    }
                    amount := and(UINT128_MASK, mload(ptr))
                }
                default {
                    mstore(0, ERC20_BALANCE_OF)
                    mstore(0x04, callerAddress)
                    if iszero(staticcall(gas(), cometPool, 0x0, 0x24, 0x0, 0x20)) {
                        returndatacopy(0, 0, returndatasize())
                        revert(0, returndatasize())
                    }
                    amount := mload(0x0)
                }
            }

            // withdrawFrom(address,address,address,uint256)
            mstore(ptr, 0x2644131800000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 0x04), callerAddress)
            mstore(add(ptr, 0x24), receiver)
            mstore(add(ptr, 0x44), asset)
            mstore(add(ptr, 0x64), amount)
            if iszero(call(gas(), cometPool, 0x0, ptr, 0x84, 0x0, 0x0)) {
                returndatacopy(0x0, 0x0, returndatasize())
                revert(0x0, returndatasize())
            }
        }
    }

    /**
     * @notice Borrows from Compound V3 lending pool
     * @param asset The underlying token address to borrow
     * @param amount The amount to borrow
     * @param receiver The address to receive borrowed tokens
     * @param callerAddress Address of the caller
     * @param data Lender-specific data: [20: comet]
     */
    function _borrowFromCompoundV3(
        address asset,
        uint256 amount,
        address receiver,
        address callerAddress,
        bytes memory data
    ) internal {
        assembly {
            let ptr := mload(0x40)
            let cometPool := shr(96, mload(add(data, 0x20)))

            // withdrawFrom(address,address,address,uint256)
            mstore(ptr, 0x2644131800000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 0x04), callerAddress)
            mstore(add(ptr, 0x24), receiver)
            mstore(add(ptr, 0x44), asset)
            mstore(add(ptr, 0x64), amount)
            if iszero(call(gas(), cometPool, 0x0, ptr, 0x84, 0x0, 0x0)) {
                returndatacopy(0x0, 0x0, returndatasize())
                revert(0x0, returndatasize())
            }
        }
    }

    /**
     * @notice Deposits to Compound V3 lending pool
     * @param asset The underlying token address to deposit
     * @param amount The amount to deposit (0 = contract balance)
     * @param receiver The address to receive cTokens
     * @param data Lender-specific data: [20: comet]
     */
    function _depositToCompoundV3(
        address asset,
        uint256 amount,
        address receiver,
        bytes memory data
    ) internal {
        assembly {
            let comet := shr(96, mload(add(data, 0x20)))

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
            // supplyTo(address,address,uint256)
            mstore(ptr, 0x4232cd6300000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 0x04), receiver)
            mstore(add(ptr, 0x24), asset)
            mstore(add(ptr, 0x44), amount)
            if iszero(call(gas(), comet, 0x0, ptr, 0x64, 0x0, 0x0)) {
                returndatacopy(0x0, 0x0, returndatasize())
                revert(0x0, returndatasize())
            }
        }
    }

    /**
     * @notice Repays debt to Compound V3 lending pool
     * @param asset The underlying token address to repay
     * @param amount The amount to repay (0 = contract balance, type(uint112).max = safe max)
     * @param receiver The borrower address (on behalf of)
     * @param data Lender-specific data: [20: comet]
     */
    function _repayToCompoundV3(
        address asset,
        uint256 amount,
        address receiver,
        bytes memory data
    ) internal {
        assembly {
            let comet := shr(96, mload(add(data, 0x20)))

            switch amount
            case 0 {
                mstore(0, ERC20_BALANCE_OF)
                mstore(0x04, address())
                if iszero(staticcall(gas(), asset, 0x0, 0x24, 0x0, 0x20)) {
                    returndatacopy(0, 0, returndatasize())
                    revert(0, returndatasize())
                }
                amount := mload(0x0)
            }
            case 0xffffffffffffffffffffffffffff {
                mstore(0, ERC20_BALANCE_OF)
                mstore(0x04, address())
                if iszero(staticcall(gas(), asset, 0x0, 0x24, 0x0, 0x20)) {
                    returndatacopy(0, 0, returndatasize())
                    revert(0, returndatasize())
                }
                amount := mload(0x0)

                // borrowBalanceOf(address)
                mstore(0, 0x374c49b400000000000000000000000000000000000000000000000000000000)
                mstore(0x04, receiver)
                if iszero(staticcall(gas(), comet, 0x0, 0x24, 0x0, 0x20)) {
                    returndatacopy(0, 0, returndatasize())
                    revert(0, returndatasize())
                }
                let userBorrowBalance := mload(0x0)
                if gt(amount, userBorrowBalance) { amount := userBorrowBalance }
            }

            let ptr := mload(0x40)
            // supplyTo(address,address,uint256)
            mstore(ptr, 0x4232cd6300000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 0x04), receiver)
            mstore(add(ptr, 0x24), asset)
            mstore(add(ptr, 0x44), amount)
            if iszero(call(gas(), comet, 0x0, ptr, 0x64, 0x0, 0x0)) {
                returndatacopy(0x0, 0x0, returndatasize())
                revert(0x0, returndatasize())
            }
        }
    }
}
