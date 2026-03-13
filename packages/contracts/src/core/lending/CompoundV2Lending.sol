// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.8.34;

import {ERC20Selectors} from "../selectors/ERC20Selectors.sol";
import {Masks} from "../masks/Masks.sol";

// solhint-disable max-line-length

/**
 * @notice Lending base contract that wraps multiple Compound V2 lender types.
 * Most effective for Venus.
 * Asset, amount, and receiver are passed as explicit parameters.
 */
abstract contract CompoundV2Lending is ERC20Selectors, Masks {
    // NativeTransferFailed()
    bytes4 private constant NATIVE_TRANSFER_FAILED = 0xf4b3b1bc;

    /**
     * @notice Borrows from Compound V2 lending pool
     * @dev Note this is for Venus Finance only as other Compound forks do not have this feature
     * @param asset The underlying token address
     * @param amount The amount to borrow
     * @param receiver The address to receive borrowed tokens
     * @param callerAddress Address of the caller
     * @param currentOffset Current position in the calldata (lender-specific data)
     * @return Updated calldata offset after processing
     * @custom:calldata-offset-table (lender-specific blob)
     * | Offset | Length (bytes) | Description                     |
     * |--------|----------------|---------------------------------|
     * | 0      | 20             | cToken                          |
     */
    function _borrowFromCompoundV2(
        address asset,
        uint256 amount,
        address receiver,
        address callerAddress,
        uint256 currentOffset
    ) internal returns (uint256) {
        assembly {
            let ptr := mload(0x40)

            let cToken := shr(96, calldataload(currentOffset))
            currentOffset := add(currentOffset, 20)

            // selector for borrowBehalf(address,uint256)
            mstore(ptr, 0x856e5bb300000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 0x4), callerAddress) // user
            mstore(add(ptr, 0x24), amount) // to this address
            if iszero(call(gas(), cToken, 0x0, ptr, 0x44, 0x0, 0x20)) {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
            let rdsize := returndatasize()
            if and(eq(rdsize, 1), xor(mload(0x0), 0)) {
                returndatacopy(0, 0, rdsize)
                revert(0, rdsize)
            }
            if xor(address(), receiver) {
                // native case should not exist here
                if iszero(asset) { revert(0, 0) }

                // 4) TRANSFER TO RECIPIENT
                // selector for transfer(address,uint256)
                mstore(ptr, ERC20_TRANSFER)
                mstore(add(ptr, 0x04), receiver)
                mstore(add(ptr, 0x24), amount)

                let success := call(gas(), asset, 0, ptr, 0x44, ptr, 32)

                rdsize := returndatasize()

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
     * @notice Withdraws from Compound V2 lending pool
     * @dev Supports both transferFrom and redeemBehalf modes
     * @param asset The underlying token address
     * @param amount The amount to withdraw (type(uint112).max = user's full balance)
     * @param receiver The address to receive withdrawn tokens
     * @param callerAddress Address of the caller
     * @param currentOffset Current position in the calldata (lender-specific data)
     * @return Updated calldata offset after processing
     * @custom:calldata-offset-table (lender-specific blob)
     * | Offset | Length (bytes) | Description                     |
     * |--------|----------------|---------------------------------|
     * | 0      | 1              | selectorId (0=transferFrom+redeem, 1=redeemBehalf, 2=iToken redeem) |
     * | 1      | 20             | cToken                          |
     */
    function _withdrawFromCompoundV2(
        address asset,
        uint256 amount,
        address receiver,
        address callerAddress,
        uint256 currentOffset
    ) internal returns (uint256) {
        assembly {
            let ptr := mload(0x40)

            // read lender-specific data from blob
            let selectorId := shr(248, calldataload(currentOffset))
            let cToken := shr(96, calldataload(add(currentOffset, 1)))
            currentOffset := add(currentOffset, 21)

            if eq(amount, 0xffffffffffffffffffffffffffff) {
                // selector for balanceOfUnderlying(address)
                mstore(0, 0x3af9e66900000000000000000000000000000000000000000000000000000000)
                // add caller address as parameter
                mstore(0x04, callerAddress)
                // call to token
                pop(call(gas(), cToken, 0x0, 0x0, 0x24, 0x0, 0x20))
                // load the retrieved balance
                amount := mload(0x0)
            }

            // 1) CALCULATE TRANSFER AMOUNT
            // Store fnSig (=bytes4(abi.encodeWithSignature("exchangeRateCurrent()"))) at params
            mstore(
                0x0,
                0xbd6d894d00000000000000000000000000000000000000000000000000000000 // with padding
            )
            // call to collateralToken
            // accrues interest. No real risk of failure.
            pop(call(gas(), cToken, 0x0, 0x0, 0x24, 0x0, 0x20))

            // load the retrieved protocol share
            let refAmount := mload(0x0)

            // calculate collateral token amount, rounding up
            let cTokenTransferAmount :=
                add(
                    div(
                        mul(amount, 1000000000000000000), // multiply with 1e18
                        refAmount // divide by rate
                    ),
                    1
                )
            // FETCH BALANCE
            // selector for balanceOf(address)
            mstore(0x0, ERC20_BALANCE_OF)
            // add _from address as parameter
            mstore(0x4, callerAddress)

            // call to collateralToken
            if iszero(staticcall(gas(), cToken, 0x0, 0x24, 0x0, 0x20)) {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }

            // load the retrieved balance
            refAmount := mload(0x0)

            // floor to the balance
            if gt(cTokenTransferAmount, refAmount) { cTokenTransferAmount := refAmount }

            // switch-case over selectorId
            switch selectorId
            case 0 {
                // 2) TRANSFER VTOKENS

                // selector for transferFrom(address,address,uint256)
                mstore(ptr, ERC20_TRANSFER_FROM)
                mstore(add(ptr, 0x04), callerAddress) // from user
                mstore(add(ptr, 0x24), address()) // to this address
                mstore(add(ptr, 0x44), cTokenTransferAmount)

                let success := call(gas(), cToken, 0, ptr, 0x64, ptr, 32)
                let rdsize := returndatasize()
                success := and(success, or(iszero(rdsize), and(gt(rdsize, 31), eq(mload(ptr), 1))))
                if iszero(success) {
                    returndatacopy(0, 0, rdsize)
                    revert(0, rdsize)
                }

                // 3) REDEEM
                // selector for redeem(uint256)
                mstore(0, 0xdb006a7500000000000000000000000000000000000000000000000000000000)
                mstore(0x4, cTokenTransferAmount)

                if iszero(call(gas(), cToken, 0x0, 0x0, 0x24, 0x0, 0x20)) {
                    returndatacopy(0, 0, returndatasize())
                    revert(0, returndatasize())
                }
                rdsize := returndatasize()
                if and(eq(rdsize, 1), xor(mload(0x0), 0)) {
                    returndatacopy(0, 0, rdsize)
                    revert(0, rdsize)
                }
            }
            case 1 {
                // 2/3) REDEEM BEHALF (Venus only) - requires composer being the operator (cheaper version)
                // selector for redeemBehalf(address,uint256) - sends tokens to msg.sender
                mstore(ptr, 0x210bc05200000000000000000000000000000000000000000000000000000000)
                mstore(add(ptr, 0x4), callerAddress)
                mstore(add(ptr, 0x24), cTokenTransferAmount)

                if iszero(call(gas(), cToken, 0x0, ptr, 0x44, 0x0, 0x20)) {
                    returndatacopy(0, 0, returndatasize())
                    revert(0, returndatasize())
                }
                let rdsize := returndatasize()
                if and(eq(rdsize, 1), xor(mload(0), 0)) {
                    returndatacopy(0, 0, rdsize)
                    revert(0, rdsize)
                }
            }
            case 2 {
                // 2/3) REDEEM (iToken style) - redeem(address,uint256)
                // selector for redeem(address,uint256)
                mstore(ptr, 0x1e9a695000000000000000000000000000000000000000000000000000000000)
                mstore(add(ptr, 0x4), callerAddress)
                mstore(add(ptr, 0x24), cTokenTransferAmount)

                if iszero(call(gas(), cToken, 0x0, ptr, 0x44, 0x0, 0x0)) {
                    returndatacopy(0, 0, returndatasize())
                    revert(0, returndatasize())
                }
            }
            default { revert(0, 0) }

            // transfer tokens only if the receiver is not this address
            if xor(address(), receiver) {
                switch asset
                // native case
                case 0 {
                    if iszero(call(gas(), receiver, amount, 0, 0, 0, 0)) {
                        mstore(0, NATIVE_TRANSFER_FAILED)
                        revert(0, 0x4) // revert when native transfer fails
                    }
                }
                // erc20 case
                default {
                    // 4) TRANSFER TO RECIPIENT
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
        }
        return currentOffset;
    }

    /**
     * @notice Deposits to Compound V2 lending pool
     * @dev Supports both native and ERC20 tokens. Zero amount uses contract balance.
     * @param asset The underlying token address (0 = native)
     * @param amount The amount to deposit (0 = contract balance)
     * @param receiver The address to receive cTokens
     * @param currentOffset Current position in the calldata (lender-specific data)
     * @return Updated calldata offset after processing
     * @custom:calldata-offset-table (lender-specific blob)
     * | Offset | Length (bytes) | Description                     |
     * |--------|----------------|---------------------------------|
     * | 0      | 1              | selectorId (0=mintBehalf, 1=mint(uint), 2=mint(address,uint)/iToken) |
     * | 1      | 20             | cToken                          |
     */
    function _depositToCompoundV2(
        address asset,
        uint256 amount,
        address receiver,
        uint256 currentOffset
    ) internal returns (uint256) {
        assembly {
            // read lender-specific data from blob
            let selectorId := shr(248, calldataload(currentOffset))
            let cToken := shr(96, calldataload(add(currentOffset, 1)))
            currentOffset := add(currentOffset, 21)

            switch asset
            // case native
            case 0 {
                // zero is this balance
                if iszero(amount) { amount := selfbalance() }

                // switch-case over selectorId
                switch selectorId
                // iToken-style mint(address) - mints directly to receiver
                case 2 {
                    // selector for mint(address)
                    mstore(0, 0x6a62784200000000000000000000000000000000000000000000000000000000)
                    mstore(0x04, receiver)

                    if iszero(call(gas(), cToken, amount, 0x0, 0x24, 0x0, 0x0)) {
                        returndatacopy(0x0, 0, returndatasize())
                        revert(0x0, returndatasize())
                    }
                }
                // compound-style mint() - mints to msg.sender, then transfer
                default {
                    // selector for mint()
                    mstore(0, 0x1249c58b00000000000000000000000000000000000000000000000000000000)

                    if iszero(call(gas(), cToken, amount, 0x0, 0x4, 0x0, 0x20)) {
                        returndatacopy(0x0, 0, returndatasize())
                        revert(0x0, returndatasize())
                    }

                    // need to transfer collateral to receiver
                    if xor(receiver, address()) {
                        // selector for balanceOf(address)
                        mstore(0, ERC20_BALANCE_OF)
                        // add this address as parameter
                        mstore(0x04, address())
                        // call to token
                        if iszero(staticcall(gas(), cToken, 0x0, 0x24, 0x0, 0x20)) {
                            returndatacopy(0, 0, returndatasize())
                            revert(0, returndatasize())
                        }
                        // load the retrieved balance
                        let cBalance := mload(0x0)

                        let ptr := mload(0x40)
                        // TRANSFER COLLATERAL
                        // selector for transfer(address,uint256)
                        mstore(ptr, ERC20_TRANSFER)
                        mstore(add(ptr, 0x04), receiver)
                        mstore(add(ptr, 0x24), cBalance)

                        let success := call(gas(), cToken, 0, ptr, 0x44, ptr, 32)

                        let rdsize := returndatasize()

                        if iszero(
                            and(
                                success, // call itself succeeded
                                or(
                                    iszero(rdsize), // no return data, or
                                    and(
                                        gt(rdsize, 31), // at least 32 bytes
                                        eq(mload(ptr), 1) // starts with uint256(1)
                                    )
                                )
                            )
                        ) {
                            returndatacopy(0, 0, rdsize)
                            revert(0, rdsize)
                        }
                    }
                }
            }
            // erc20 case
            default {
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

                // switch-case over selectorId
                switch selectorId
                case 0 {
                    // selector for mintBehalf(address,uint256)
                    mstore(ptr, 0x23323e0300000000000000000000000000000000000000000000000000000000)
                    mstore(add(ptr, 0x04), receiver)
                    mstore(add(ptr, 0x24), amount)

                    if iszero(call(gas(), cToken, 0x0, ptr, 0x44, 0x0, 0x20)) {
                        returndatacopy(0, 0, returndatasize())
                        revert(0, returndatasize())
                    }
                    let rdsize := returndatasize()
                    if and(eq(rdsize, 1), xor(mload(0), 0)) {
                        returndatacopy(0, 0, rdsize)
                        revert(0, rdsize)
                    }
                }
                case 1 {
                    // selector for mint(uint)
                    mstore(ptr, 0xa0712d6800000000000000000000000000000000000000000000000000000000)
                    mstore(add(ptr, 0x04), amount)

                    if iszero(call(gas(), cToken, 0x0, ptr, 0x24, 0x0, 0x20)) {
                        returndatacopy(0, 0, returndatasize())
                        revert(0, returndatasize())
                    }
                    let rdsize := returndatasize()
                    if and(eq(rdsize, 1), xor(mload(0), 0)) {
                        returndatacopy(0, 0, rdsize)
                        revert(0, rdsize)
                    }

                    // need to transfer collateral to receiver
                    if xor(receiver, address()) {
                        // selector for balanceOf(address)
                        mstore(0, ERC20_BALANCE_OF)
                        // add this address as parameter
                        mstore(0x04, address())
                        // call to token
                        if iszero(staticcall(gas(), cToken, 0x0, 0x24, 0x0, 0x20)) {
                            returndatacopy(0, 0, returndatasize())
                            revert(0, returndatasize())
                        }
                        // load the retrieved balance
                        let cBalance := mload(0x0)

                        // TRANSFER COLLATERAL
                        // selector for transfer(address,uint256)
                        mstore(ptr, ERC20_TRANSFER)
                        mstore(add(ptr, 0x04), receiver)
                        mstore(add(ptr, 0x24), cBalance)

                        let success := call(gas(), cToken, 0, ptr, 0x44, ptr, 32)

                        rdsize := returndatasize()

                        if iszero(
                            and(
                                success, // call itself succeeded
                                or(
                                    iszero(rdsize), // no return data, or
                                    and(
                                        gt(rdsize, 31), // at least 32 bytes
                                        eq(mload(ptr), 1) // starts with uint256(1)
                                    )
                                )
                            )
                        ) {
                            returndatacopy(0, 0, rdsize)
                            revert(0, rdsize)
                        }
                    }
                }
                case 2 {
                    // selector for mint(address,uint256) - iToken style
                    mstore(ptr, 0x40c10f1900000000000000000000000000000000000000000000000000000000)
                    mstore(add(ptr, 0x04), receiver)
                    mstore(add(ptr, 0x24), amount)

                    if iszero(call(gas(), cToken, 0x0, ptr, 0x44, 0x0, 0x0)) {
                        returndatacopy(0, 0, returndatasize())
                        revert(0, returndatasize())
                    }
                }
                default { revert(0, 0) }
            }
        }
        return currentOffset;
    }

    /**
     * @notice Repays debt to Compound V2 lending pool
     * @dev Supports both native and ERC20 tokens. Zero amount uses contract balance. Max amount (0xffffffffffffffffffffffffffff) repays minimum of contract balance and user debt.
     * @param asset The underlying token address (0 = native)
     * @param amount The amount to repay (0 = contract balance, type(uint112).max = safe max)
     * @param receiver The borrower address (on behalf of)
     * @param currentOffset Current position in the calldata (lender-specific data)
     * @return Updated calldata offset after processing
     * @custom:calldata-offset-table (lender-specific blob)
     * | Offset | Length (bytes) | Description                     |
     * |--------|----------------|---------------------------------|
     * | 0      | 20             | cToken                          |
     */
    function _repayToCompoundV2(
        address asset,
        uint256 amount,
        address receiver,
        uint256 currentOffset
    ) internal returns (uint256) {
        assembly {
            let cToken := shr(96, calldataload(currentOffset))
            currentOffset := add(currentOffset, 20)

            let ptr := mload(0x40)

            switch asset
            // case native
            case 0 {
                switch amount
                case 0 {
                    // load the retrieved balance
                    amount := selfbalance()
                }
                // safe repay the maximum
                case 0xffffffffffffffffffffffffffff {
                    // contract balance
                    amount := selfbalance()

                    // selector for borrowBalanceCurrent(address)
                    mstore(0, 0x17bfdfbc00000000000000000000000000000000000000000000000000000000)
                    // add this address as parameter
                    mstore(0x04, receiver)
                    // call to token
                    pop(call(gas(), cToken, 0x0, 0x0, 0x24, 0x0, 0x20))
                    // need the exact borrow balance here
                    let borrowBal := mload(0x0)
                    // borrow balance smaller than amount available - use max
                    // otherwise, repay whatever is in the contract
                    if lt(borrowBal, amount) { amount := borrowBal }
                }

                // selector for repayBorrowBehalf(address)
                mstore(0, 0xe597461900000000000000000000000000000000000000000000000000000000)
                mstore(4, receiver) // user

                if iszero(
                    call(
                        gas(),
                        cToken,
                        amount,
                        0, // input = empty for fallback
                        0x24, // input size = selector + address + uint256
                        0, // output
                        0x0 // output size = zero
                    )
                ) {
                    returndatacopy(0x0, 0, returndatasize())
                    revert(0x0, returndatasize())
                }
            }
            // case ERC20
            default {
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
                // safe repay the maximum
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

                    // selector for borrowBalanceCurrent(address)
                    mstore(0, 0x17bfdfbc00000000000000000000000000000000000000000000000000000000)
                    // add this address as parameter
                    mstore(0x04, receiver)
                    // call to collateral token
                    pop(call(gas(), cToken, 0x0, 0x0, 0x24, 0x0, 0x20))

                    // borrow balance smaller than amount available - use max
                    // otherwise, repay whatever is in the contract
                    if lt(mload(0x0), amount) { amount := MAX_UINT256 }
                }

                // selector for repayBorrowBehalf(address,uint256)
                mstore(ptr, 0x2608f81800000000000000000000000000000000000000000000000000000000)
                mstore(add(ptr, 0x4), receiver) // user
                mstore(add(ptr, 0x24), amount) // to this address

                if iszero(
                    call(
                        gas(),
                        cToken,
                        0x0,
                        ptr, // input = empty for fallback
                        0x44, // input size = selector + address + uint256
                        ptr, // output
                        0x20 // output size
                    )
                ) {
                    returndatacopy(0x0, 0, returndatasize())
                    revert(0x0, returndatasize())
                }
                let rdsize := returndatasize()
                if and(eq(rdsize, 1), xor(mload(ptr), 0)) {
                    returndatacopy(0, 0, rdsize)
                    revert(0, rdsize)
                }
            }
        }
        return currentOffset;
    }
}
