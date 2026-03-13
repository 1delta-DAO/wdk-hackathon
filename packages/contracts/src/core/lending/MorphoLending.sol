// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.8.34;

import {ERC20Selectors} from "../selectors/ERC20Selectors.sol";
import {Masks} from "../masks/Masks.sol";

/**
 * @notice Lending base contract that wraps Morpho Blue.
 * Asset, amount, and receiver are passed as explicit parameters.
 * The calldata blob contains market params, flags, morpho address, and optional callback data.
 *
 * Flags byte at blob offset 96: uses Masks.USE_SHARES_FLAG (bit 126) and Masks.NATIVE_FLAG (bit 127)
 * relative to the 32-byte calldataload at blob offset 80 (lltv | flags | ...).
 */
abstract contract MorphoLending is ERC20Selectors, Masks {
    error ListaProviderCallbackNotAllowed();

    /// @dev  position(...)
    bytes32 private constant MORPHO_POSITION = 0x93c5206200000000000000000000000000000000000000000000000000000000;

    /// @dev  market(...)
    bytes32 private constant MORPHO_MARKET = 0x5c60e39a00000000000000000000000000000000000000000000000000000000;

    /// @dev  repay(...)
    bytes32 private constant MORPHO_REPAY = 0x20b76e8100000000000000000000000000000000000000000000000000000000;

    /// @dev  supplyCollateral(...)
    bytes32 private constant MORPHO_SUPPLY_COLLATERAL = 0x238d657900000000000000000000000000000000000000000000000000000000;

    /// @dev  supply(...)
    bytes32 private constant MORPHO_SUPPLY = 0xa99aad8900000000000000000000000000000000000000000000000000000000;

    /// @dev  borrow(...)
    bytes32 private constant MORPHO_BORROW = 0x50d8cd4b00000000000000000000000000000000000000000000000000000000;

    /// @dev  withdrawCollateral(...)
    bytes32 private constant MORPHO_WITHDRAW_COLLATERAL = 0x8720316d00000000000000000000000000000000000000000000000000000000;

    bytes32 private constant LISTA_PROVIDER_SUPPLY_COLLATERAL =
        0xac69d35900000000000000000000000000000000000000000000000000000000;

    /**
     * @notice Borrows from Morpho Blue lending pool
     * @dev Supports borrowing by assets or shares. We allow all morphos (incl forks).
     * @param amount The amount to borrow
     * @param receiver The address to receive borrowed tokens
     * @param callerAddress Address of the caller (onBehalfOf)
     * @param currentOffset Current position in the calldata (lender-specific data)
     * @return Updated calldata offset after processing
     * @custom:calldata-offset-table (lender-specific blob)
     * | Offset | Length (bytes) | Description                     |
     * |--------|----------------|---------------------------------|
     * | 0      | 20             | MarketParams.loanToken          |
     * | 20     | 20             | MarketParams.collateralToken    |
     * | 40     | 20             | MarketParams.oracle             |
     * | 60     | 20             | MarketParams.irm                |
     * | 80     | 16             | MarketParams.lltv               |
     * | 96     |  1             | flags (USE_SHARES_FLAG=bit6, NATIVE_FLAG=bit7) |
     * | 97     | 20             | morpho                          |
     */
    function _morphoBorrow(
        address, /* asset */
        uint256 amount,
        address receiver,
        address callerAddress,
        uint256 currentOffset
    ) internal returns (uint256) {
        assembly {
            let ptr := mload(0x40)

            // borrow(...)
            mstore(ptr, MORPHO_BORROW)

            // market data from blob
            mstore(add(ptr, 4), shr(96, calldataload(currentOffset))) // MarketParams.loanToken
            mstore(add(ptr, 36), shr(96, calldataload(add(currentOffset, 20)))) // MarketParams.collateralToken
            mstore(add(ptr, 68), shr(96, calldataload(add(currentOffset, 40)))) // MarketParams.oracle
            mstore(add(ptr, 100), shr(96, calldataload(add(currentOffset, 60)))) // MarketParams.irm

            let lltvAndFlags := calldataload(add(currentOffset, 80))
            mstore(add(ptr, 132), shr(128, lltvAndFlags)) // MarketParams.lltv

            // check if it is by shares or assets
            switch and(USE_SHARES_FLAG, lltvAndFlags)
            case 0 {
                mstore(add(ptr, 164), amount) // assets
                mstore(add(ptr, 196), 0) // shares
            }
            default {
                mstore(add(ptr, 164), 0) // assets
                mstore(add(ptr, 196), amount) // shares
            }

            // onbehalf
            mstore(add(ptr, 228), callerAddress) // onBehalfOf
            mstore(add(ptr, 260), receiver) // receiver

            let morpho := shr(96, calldataload(add(currentOffset, 97)))
            currentOffset := add(currentOffset, 117)

            if iszero(
                call(
                    gas(),
                    morpho,
                    0x0,
                    ptr,
                    292, // = 9 * 32 + 4
                    0x0,
                    0x0
                )
            ) {
                let rdlen := returndatasize()
                returndatacopy(0, 0, rdlen)
                revert(0x0, rdlen)
            }
        }

        return currentOffset;
    }

    /**
     * @notice Deposits lending token to Morpho Blue
     * @dev This deposits LENDING TOKEN. Supports deposits by assets or shares. We allow all morphos (incl forks).
     * @param asset The loan token address (used for balance lookup when amount=0)
     * @param amount The amount to deposit (0 = contract balance)
     * @param receiver The address to receive supply position
     * @param callerAddress Address of the caller (for callbacks)
     * @param currentOffset Current position in the calldata (lender-specific data)
     * @return Updated calldata offset after processing
     * @custom:calldata-offset-table (lender-specific blob)
     * | Offset | Length (bytes) | Description                     |
     * |--------|----------------|---------------------------------|
     * | 0      | 20             | MarketParams.loanToken          |
     * | 20     | 20             | MarketParams.collateralToken    |
     * | 40     | 20             | MarketParams.oracle             |
     * | 60     | 20             | MarketParams.irm                |
     * | 80     | 16             | MarketParams.lltv               |
     * | 96     |  1             | flags (USE_SHARES_FLAG=bit6, NATIVE_FLAG=bit7) |
     * | 97     | 20             | morpho                          |
     * | 117    | 2              | calldataLength                  |
     * | 119    | calldataLength | calldata                        |
     */
    function _encodeMorphoDeposit(
        address asset,
        uint256 amount,
        address receiver,
        address callerAddress,
        uint256 currentOffset
    ) internal returns (uint256) {
        assembly {
            let ptrBase := mload(0x40)
            let ptr := add(128, ptrBase)

            // supply(...)
            mstore(ptr, MORPHO_SUPPLY)
            // market data from blob
            mstore(add(ptr, 4), shr(96, calldataload(currentOffset))) // MarketParams.loanToken
            mstore(add(ptr, 36), shr(96, calldataload(add(currentOffset, 20)))) // MarketParams.collateralToken
            mstore(add(ptr, 68), shr(96, calldataload(add(currentOffset, 40)))) // MarketParams.oracle
            mstore(add(ptr, 100), shr(96, calldataload(add(currentOffset, 60)))) // MarketParams.irm

            let lltvAndFlags := calldataload(add(currentOffset, 80))
            mstore(add(ptr, 132), shr(128, lltvAndFlags)) // MarketParams.lltv

            // check if it is by shares or assets
            switch and(USE_SHARES_FLAG, lltvAndFlags)
            case 0 {
                // if the amount is zero, we assume that the contract balance is deposited
                if iszero(amount) {
                    // selector for balanceOf(address)
                    mstore(0, ERC20_BALANCE_OF)
                    // add this address as parameter
                    mstore(0x04, address())
                    // call to token (use asset param)
                    if iszero(staticcall(gas(), asset, 0x0, 0x24, 0x0, 0x20)) {
                        returndatacopy(0, 0, returndatasize())
                        revert(0, returndatasize())
                    }
                    // load the retrieved balance
                    amount := mload(0x0)
                }

                mstore(add(ptr, 164), amount) // assets
                mstore(add(ptr, 196), 0) // shares
            }
            default {
                mstore(add(ptr, 164), 0) // assets
                mstore(add(ptr, 196), amount) // shares
            }

            let morpho := shr(96, calldataload(add(currentOffset, 97)))

            // get calldatalength
            let inputCalldataLength := and(UINT16_MASK, shr(240, calldataload(add(currentOffset, 117))))
            let calldataLength := inputCalldataLength

            currentOffset := add(currentOffset, 119)

            // leftover params
            mstore(add(ptr, 228), receiver) // onBehalfOf is the receiver here
            mstore(add(ptr, 260), 0x120) // offset
            // add calldata if needed
            if xor(0, calldataLength) {
                calldataLength := add(calldataLength, 20)
                mstore(add(ptr, 324), shl(96, callerAddress)) // caller
                calldatacopy(add(ptr, 344), currentOffset, inputCalldataLength) // calldata
                currentOffset := add(currentOffset, inputCalldataLength)
            }

            mstore(add(ptr, 292), calldataLength) // calldatalength

            if iszero(
                call(
                    gas(),
                    morpho,
                    0x0,
                    ptr,
                    add(calldataLength, 324), // = 10 * 32 + 4
                    0x0,
                    0x0
                )
            ) {
                let rdlen := returndatasize()
                returndatacopy(0, 0, rdlen)
                revert(0x0, rdlen)
            }
        }
        return currentOffset;
    }

    /**
     * @notice Deposits collateral to Morpho Blue
     * @dev This deposits COLLATERAL - never uses shares. We allow all morphos (incl forks).
     * @param asset The collateral token address (used for balance lookup when amount=0)
     * @param amount The amount to deposit (0 = contract balance)
     * @param receiver The address to receive collateral position
     * @param callerAddress Address of the caller (for callbacks)
     * @param currentOffset Current position in the calldata (lender-specific data)
     * @return Updated calldata offset after processing
     * @custom:calldata-offset-table (lender-specific blob)
     * | Offset | Length (bytes) | Description                     |
     * |--------|----------------|---------------------------------|
     * | 0      | 20             | MarketParams.loanToken          |
     * | 20     | 20             | MarketParams.collateralToken    |
     * | 40     | 20             | MarketParams.oracle             |
     * | 60     | 20             | MarketParams.irm                |
     * | 80     | 16             | MarketParams.lltv               |
     * | 96     |  1             | flags (NATIVE_FLAG=bit7)        |
     * | 97     | 20             | morpho (or lista provider)      |
     * | 117    | 2              | calldataLength                  |
     * | 119    | calldataLength | calldata                        |
     */
    function _encodeMorphoDepositCollateral(
        address asset,
        uint256 amount,
        address receiver,
        address callerAddress,
        uint256 currentOffset
    ) internal returns (uint256) {
        assembly {
            let ptrBase := mload(0x40)
            let ptr := add(256, ptrBase)

            let lltvAndFlags := calldataload(add(currentOffset, 80))
            let target := shr(96, calldataload(add(currentOffset, 97)))
            let inputCalldataLength := and(UINT16_MASK, shr(240, calldataload(add(currentOffset, 117))))
            let calldataLength := inputCalldataLength
            let dataOffset := add(currentOffset, 119)

            let isNative := and(NATIVE_FLAG, lltvAndFlags)

            switch isNative
            case 0 {
                // if the amount is zero, we assume that the contract balance is deposited
                if iszero(amount) {
                    // selector for balanceOf(address)
                    mstore(0, ERC20_BALANCE_OF)
                    // add this address as parameter
                    mstore(0x04, address())
                    // call to token (use asset param = collateral token)
                    if iszero(staticcall(gas(), asset, 0x0, 0x24, 0x0, 0x20)) {
                        returndatacopy(0, 0, returndatasize())
                        revert(0, returndatasize())
                    }
                    // load the retrieved balance
                    amount := mload(0x0)
                }
                // morpho supply collateral
                mstore(ptr, MORPHO_SUPPLY_COLLATERAL)
            }
            default {
                if iszero(amount) {
                    amount := selfbalance()
                }
                // lista provider supply collateral
                mstore(ptr, LISTA_PROVIDER_SUPPLY_COLLATERAL)
            }

            // market data from blob
            mstore(add(ptr, 4), shr(96, calldataload(currentOffset)))
            mstore(add(ptr, 36), shr(96, calldataload(add(currentOffset, 20))))
            mstore(add(ptr, 68), shr(96, calldataload(add(currentOffset, 40))))
            mstore(add(ptr, 100), shr(96, calldataload(add(currentOffset, 60))))
            mstore(add(ptr, 132), shr(128, lltvAndFlags))

            switch isNative
            case 0 {
                mstore(add(ptr, 164), amount)
                mstore(add(ptr, 196), receiver)
                mstore(add(ptr, 228), 0x100)
                if xor(0, calldataLength) {
                    calldataLength := add(calldataLength, 20)
                    mstore(add(ptr, 292), shl(96, callerAddress)) // caller
                    calldatacopy(add(ptr, 312), dataOffset, inputCalldataLength) // calldata
                }
                mstore(add(ptr, 260), calldataLength) // calldatalength
                if iszero(call(gas(), target, 0x0, ptr, add(calldataLength, 292), 0x0, 0x0)) {
                    let rdlen := returndatasize()
                    returndatacopy(0, 0, rdlen)
                    revert(0x0, rdlen)
                }
            }
            default {
                // native case via lista provider (lista only)
                mstore(add(ptr, 164), receiver)
                mstore(add(ptr, 196), 0xE0)
                switch calldataLength
                case 0 {
                    mstore(add(ptr, 228), 0)
                    if iszero(call(gas(), target, amount, ptr, 260, 0x0, 0x0)) {
                        let rdlen := returndatasize()
                        returndatacopy(0, 0, rdlen)
                        revert(0x0, rdlen)
                    }
                }
                default {
                    // ListaProviderCallbackNotAllowed()
                    mstore(0x0, 0x88036ba500000000000000000000000000000000000000000000000000000000)
                    revert(0x0, 0x04)
                }
            }

            currentOffset := add(dataOffset, inputCalldataLength)
        }
        return currentOffset;
    }

    /**
     * @notice Withdraws collateral from Morpho Blue
     * @param amount The amount to withdraw (type(uint112).max = user's full collateral balance)
     * @param receiver The address to receive withdrawn collateral
     * @param callerAddress Address of the caller (onBehalfOf)
     * @param currentOffset Current position in the calldata (lender-specific data)
     * @return Updated calldata offset after processing
     * @custom:calldata-offset-table (lender-specific blob)
     * | Offset | Length (bytes) | Description                     |
     * |--------|----------------|---------------------------------|
     * | 0      | 20             | MarketParams.loanToken          |
     * | 20     | 20             | MarketParams.collateralToken    |
     * | 40     | 20             | MarketParams.oracle             |
     * | 60     | 20             | MarketParams.irm                |
     * | 80     | 16             | MarketParams.lltv               |
     * | 96     |  1             | flags (NATIVE_FLAG=bit7)        |
     * | 97     | 20             | morpho                          |
     */
    function _encodeMorphoWithdrawCollateral(
        address, /* asset */
        uint256 amount,
        address receiver,
        address callerAddress,
        uint256 currentOffset
    ) internal returns (uint256) {
        assembly {
            let ptr := mload(0x40)

            // withdrawCollateral(...)
            mstore(ptr, MORPHO_WITHDRAW_COLLATERAL)

            // market data from blob
            mstore(add(ptr, 4), shr(96, calldataload(currentOffset))) // MarketParams.loanToken
            mstore(add(ptr, 36), shr(96, calldataload(add(currentOffset, 20)))) // MarketParams.collateralToken
            mstore(add(ptr, 68), shr(96, calldataload(add(currentOffset, 40)))) // MarketParams.oracle
            mstore(add(ptr, 100), shr(96, calldataload(add(currentOffset, 60)))) // MarketParams.irm

            let lltvAndFlags := calldataload(add(currentOffset, 80))
            mstore(add(ptr, 132), shr(128, lltvAndFlags)) // MarketParams.lltv

            mstore(add(ptr, 196), callerAddress) // onBehalfOf
            mstore(add(ptr, 228), receiver) // receiver

            let morpho := shr(96, calldataload(add(currentOffset, 97)))

            let isNative := and(NATIVE_FLAG, lltvAndFlags)

            // maxUint112 means read collateral balance
            if eq(amount, 0xffffffffffffffffffffffffffff) {
                // for lista native case, read the moolah address from the provider
                // for morpho case it is the morpho itself
                let morphoRead := morpho
                if isNative {
                    mstore(0x0, 0x195be17a00000000000000000000000000000000000000000000000000000000) // MOOLAH()
                    if iszero(staticcall(gas(), morpho, 0x0, 0x04, 0x0, 0x20)) { revert(0x0, 0x0) }
                    morphoRead := mload(0x0)
                }

                let ptrBase := add(ptr, 280)
                let marketId := keccak256(add(ptr, 4), 160)
                // position datas (1st slot of return data is the user shares)
                mstore(ptrBase, MORPHO_POSITION)
                mstore(add(ptrBase, 0x4), marketId)
                mstore(add(ptrBase, 0x24), callerAddress)
                if iszero(staticcall(gas(), morphoRead, ptrBase, 0x44, ptrBase, 0x60)) { revert(0x0, 0x0) }
                amount := mload(add(ptrBase, 0x40))
            }

            // amount is stored last
            mstore(add(ptr, 164), amount) // assets

            currentOffset := add(currentOffset, 117)

            if iszero(
                call(
                    gas(),
                    morpho,
                    0x0,
                    ptr,
                    260, // = 8 * 32 + 4
                    0x0,
                    0x0
                )
            ) {
                let rdlen := returndatasize()
                returndatacopy(0, 0, rdlen)
                revert(0x0, rdlen)
            }
        }
        return currentOffset;
    }

    /**
     * @notice Withdraws borrow asset from Morpho Blue
     * @dev Supports withdrawal by assets or shares
     * @param amount The amount to withdraw (type(uint112).max = user's full supply balance)
     * @param receiver The address to receive withdrawn tokens
     * @param callerAddress Address of the caller (onBehalfOf)
     * @param currentOffset Current position in the calldata (lender-specific data)
     * @return Updated calldata offset after processing
     * @custom:calldata-offset-table (lender-specific blob)
     * | Offset | Length (bytes) | Description                     |
     * |--------|----------------|---------------------------------|
     * | 0      | 20             | MarketParams.loanToken          |
     * | 20     | 20             | MarketParams.collateralToken    |
     * | 40     | 20             | MarketParams.oracle             |
     * | 60     | 20             | MarketParams.irm                |
     * | 80     | 16             | MarketParams.lltv               |
     * | 96     |  1             | flags (USE_SHARES_FLAG=bit6, NATIVE_FLAG=bit7) |
     * | 97     | 20             | morpho                          |
     */
    function _encodeMorphoWithdraw(
        address, /* asset */
        uint256 amount,
        address receiver,
        address callerAddress,
        uint256 currentOffset
    ) internal returns (uint256) {
        assembly {
            let ptrBase := mload(0x40)
            let ptr := add(ptrBase, 256)

            // market data from blob
            mstore(add(ptr, 4), shr(96, calldataload(currentOffset))) // MarketParams.loanToken
            mstore(add(ptr, 36), shr(96, calldataload(add(currentOffset, 20)))) // MarketParams.collateralToken
            mstore(add(ptr, 68), shr(96, calldataload(add(currentOffset, 40)))) // MarketParams.oracle
            mstore(add(ptr, 100), shr(96, calldataload(add(currentOffset, 60)))) // MarketParams.irm

            let lltvAndFlags := calldataload(add(currentOffset, 80))
            mstore(add(ptr, 132), shr(128, lltvAndFlags)) // MarketParams.lltv

            mstore(add(ptr, 228), callerAddress) // onBehalfOf
            mstore(add(ptr, 260), receiver) // receiver

            let morpho := shr(96, calldataload(add(currentOffset, 97)))
            currentOffset := add(currentOffset, 117)

            // check if it is by shares or assets
            switch and(USE_SHARES_FLAG, lltvAndFlags)
            case 0 {
                // Withdraw amount variations
                // type(uint112).max: user supply balance
                // other: amount provided
                switch amount
                // maximum uint112 means withdraw everything
                case 0xffffffffffffffffffffffffffff {
                    // we need to fetch user shares and just withdraw all shares
                    let marketId := keccak256(add(ptr, 4), 160)
                    // position datas (1st slot of return data is the user shares)
                    mstore(ptrBase, MORPHO_POSITION)
                    mstore(add(ptrBase, 0x4), marketId)
                    mstore(add(ptrBase, 0x24), callerAddress)
                    if iszero(staticcall(gas(), morpho, ptrBase, 0x44, ptrBase, 0x20)) { revert(0x0, 0x0) }
                    mstore(add(ptr, 164), 0) // assets
                    mstore(add(ptr, 196), mload(ptrBase)) // shares
                }
                // explicit amount
                default {
                    mstore(add(ptr, 164), amount) // assets
                    mstore(add(ptr, 196), 0) // shares
                }
            }
            default {
                mstore(add(ptr, 164), 0) // assets
                mstore(add(ptr, 196), amount) // shares
            }

            // withdraw(...)
            // we have to do it like this to override the selector only in this memory position
            mstore(sub(ptr, 28), 0x5c2bea49)
            if iszero(
                call(
                    gas(),
                    morpho,
                    0x0,
                    ptr,
                    292, // = 9 * 32 + 4
                    0x0,
                    0x0
                )
            ) {
                let rdlen := returndatasize()
                returndatacopy(0, 0, rdlen)
                revert(0x0, rdlen)
            }
        }
        return currentOffset;
    }

    /**
     * @notice Repays debt to Morpho Blue
     * @dev Supports repayment by assets or shares. Max amount repays safe maximum.
     * @param asset The loan token address (used for balance lookup)
     * @param amount The amount to repay (0 = contract balance, type(uint112).max = safe max)
     * @param receiver The borrower address (on behalf of)
     * @param callerAddress Address of the caller (for callbacks)
     * @param currentOffset Current position in the calldata (lender-specific data)
     * @return Updated calldata offset after processing
     * @custom:calldata-offset-table (lender-specific blob)
     * | Offset | Length (bytes) | Description                     |
     * |--------|----------------|---------------------------------|
     * | 0      | 20             | MarketParams.loanToken          |
     * | 20     | 20             | MarketParams.collateralToken    |
     * | 40     | 20             | MarketParams.oracle             |
     * | 60     | 20             | MarketParams.irm                |
     * | 80     | 16             | MarketParams.lltv               |
     * | 96     |  1             | flags (USE_SHARES_FLAG=bit6, NATIVE_FLAG=bit7) |
     * | 97     | 20             | morpho                          |
     * | 117    | 2              | calldataLength                  |
     * | 119    | calldataLength | calldata                        |
     */
    function _morphoRepay(
        address asset,
        uint256 amount,
        address receiver,
        address callerAddress,
        uint256 currentOffset
    ) internal returns (uint256) {
        assembly {
            let ptrBase := mload(0x40)
            let ptr := add(ptrBase, 256)

            // market data from blob
            mstore(add(ptr, 4), shr(96, calldataload(currentOffset))) // MarketParams.loanToken
            mstore(add(ptr, 36), shr(96, calldataload(add(currentOffset, 20)))) // MarketParams.collateralToken
            mstore(add(ptr, 68), shr(96, calldataload(add(currentOffset, 40)))) // MarketParams.oracle
            mstore(add(ptr, 100), shr(96, calldataload(add(currentOffset, 60)))) // MarketParams.irm

            let lltvAndFlags := calldataload(add(currentOffset, 80))
            mstore(add(ptr, 132), shr(128, lltvAndFlags)) // MarketParams.lltv

            let isNative := and(NATIVE_FLAG, lltvAndFlags)
            let isShares := and(USE_SHARES_FLAG, lltvAndFlags)

            let morpho := shr(96, calldataload(add(currentOffset, 97)))

            let repayAm := amount

            /**
             *  if repayAmount is Max -> repay safe maximum (to prevent too low contract balance to revert)
             *  else if repayAmount is 0 -> repay contract balance as assets
             *  else repay amount as shares or assets, based on flag set
             */
            switch repayAm
            case 0xffffffffffffffffffffffffffff {
                // max flag: resolve available balance (ERC20 or native)
                switch isNative
                case 0 {
                    mstore(0x0, ERC20_BALANCE_OF)
                    mstore(0x04, address())
                    if iszero(staticcall(gas(), asset, 0x0, 0x24, 0x0, 0x20)) { revert(0x0, 0x0) }
                    repayAm := mload(0x0)
                }
                default { repayAm := selfbalance() }

                // for lista native case, we need to read the moolah address from the provider
                // for morpho case it is the morpho
                let morphoRead := morpho
                if isNative {
                    mstore(0x0, 0x195be17a00000000000000000000000000000000000000000000000000000000) // MOOLAH()
                    if iszero(staticcall(gas(), morpho, 0x0, 0x04, 0x0, 0x20)) { revert(0x0, 0x0) }
                    morphoRead := mload(0x0)
                }

                // by assets safe - will not revert if too much is repaid
                // accrue interest (0x151c1ade)
                mstore(sub(ptr, 28), 0x151c1ade)
                if iszero(call(gas(), morphoRead, 0x0, ptr, 0xA4, 0x0, 0x0)) { revert(0x0, 0x0) }

                // get market params for conversion
                let marketId := keccak256(add(ptr, 4), 160)
                mstore(0x0, MORPHO_MARKET)
                mstore(0x4, marketId)
                if iszero(staticcall(gas(), morphoRead, 0x0, 0x24, ptrBase, 0x80)) { revert(0x0, 0x0) }
                let totalBorrowAssets := mload(add(ptrBase, 0x40))
                let totalBorrowShares := mload(add(ptrBase, 0x60))

                // position datas
                mstore(ptrBase, MORPHO_POSITION)
                mstore(add(ptrBase, 0x4), marketId)
                mstore(add(ptrBase, 0x24), receiver)
                if iszero(staticcall(gas(), morphoRead, ptrBase, 0x44, ptrBase, 0x40)) { revert(0x0, 0x0) }
                let userBorrowShares := mload(add(ptrBase, 0x20))

                // mulDivUp(shares, totalAssets + VIRTUAL_ASSETS, totalShares + VIRTUAL_SHARES);
                let maxAssets := add(totalBorrowShares, 1000000) // VIRTUAL_SHARES=1e6
                maxAssets := div(
                    add(
                        mul(userBorrowShares, add(totalBorrowAssets, 1)), // VIRTUAL_ASSETS=1
                        sub(maxAssets, 1)
                    ),
                    maxAssets
                )

                // if maxAssets is greater than repay amount
                // we repay whatever is possible
                switch gt(maxAssets, repayAm)
                case 1 {
                    mstore(add(ptr, 164), repayAm) // assets
                    mstore(add(ptr, 196), 0) // shares
                }
                // otherwise, repay all shares, leaving no dust
                default {
                    mstore(add(ptr, 164), 0) // assets
                    mstore(add(ptr, 196), userBorrowShares) // shares
                    repayAm := maxAssets
                }
            }
            // by balance (using assets)
            case 0 {
                // resolve available balance (ERC20 or native)
                switch isNative
                case 0 {
                    mstore(0x0, ERC20_BALANCE_OF)
                    mstore(0x04, address())
                    if iszero(staticcall(gas(), asset, 0x0, 0x24, 0x0, 0x20)) { revert(0x0, 0x0) }
                    repayAm := mload(0x0)
                }
                default { repayAm := selfbalance() }

                mstore(add(ptr, 164), repayAm) // assets
                mstore(add(ptr, 196), 0) // shares
            }
            // plain amount (assets or shares)
            default {
                switch isShares
                case 0 {
                    mstore(add(ptr, 164), repayAm) // assets
                    mstore(add(ptr, 196), 0) // shares
                }
                default {
                    mstore(add(ptr, 164), 0) // assets
                    mstore(add(ptr, 196), repayAm) // shares
                }
            }

            // native: send repayAm as callValue; non-native: callValue = 0
            let callValue := mul(repayAm, iszero(iszero(isNative)))

            mstore(add(ptr, 228), receiver) // onBehalfOf is the receiver here
            mstore(add(ptr, 260), 0x120) // offset

            // get calldatalength
            let inputCalldataLength := and(UINT16_MASK, shr(240, calldataload(add(currentOffset, 117))))
            let calldataLength := inputCalldataLength
            currentOffset := add(currentOffset, 119)

            if isNative {
                // block callbacks for lista provider case
                if calldataLength {
                    // ListaProviderCallbackNotAllowed()
                    mstore(0x0, 0x88036ba500000000000000000000000000000000000000000000000000000000)
                    revert(0x0, 0x04)
                }
            }

            // add calldata if needed
            if xor(0, calldataLength) {
                calldataLength := add(calldataLength, 20)
                mstore(add(ptr, 324), shl(96, callerAddress)) // caller
                calldatacopy(add(ptr, 344), currentOffset, inputCalldataLength) // calldata
                currentOffset := add(currentOffset, inputCalldataLength)
            }

            // repay(...)
            mstore(sub(ptr, 28), 0x20b76e81)
            mstore(add(ptr, 292), calldataLength) // calldatalength
            if iszero(call(gas(), morpho, callValue, ptr, add(calldataLength, 324), 0x0, 0x0)) {
                let rdlen := returndatasize()
                returndatacopy(0, 0, rdlen)
                revert(0x0, rdlen)
            }
        }
        return currentOffset;
    }
}
