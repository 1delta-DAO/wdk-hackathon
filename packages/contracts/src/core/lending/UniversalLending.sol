// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.8.34;

import {AaveLending} from "./AaveLending.sol";
import {CompoundV3Lending} from "./CompoundV3Lending.sol";
import {CompoundV2Lending} from "./CompoundV2Lending.sol";
import {MorphoLending} from "./MorphoLending.sol";
import {SiloV2Lending} from "./SiloV2Lending.sol";
import {LenderIds, LenderOps} from "./DeltaEnums.sol";
import {DeltaErrors} from "../errors/Errors.sol";

// solhint-disable max-line-length

/**
 * @notice Merge all lending ops in one operation
 * Asset, amount, and receiver are passed as explicit parameters.
 * The calldata blob at currentOffset only contains lender-specific data.
 */
abstract contract UniversalLending is
    AaveLending,
    CompoundV3Lending,
    CompoundV2Lending,
    MorphoLending,
    SiloV2Lending,
    DeltaErrors
{
    /**
     * @notice Executes any lending operation across various lenders
     * @dev Routes to appropriate lender based on operation and lender ID
     * @param callerAddress Address of the caller
     * @param asset The token address for the lending operation
     * @param amount The amount for the lending operation (0 = contract balance, type(uint112).max = max/safe max)
     * @param receiver The receiver address
     * @param currentOffset Current position in the calldata (points to lender-specific data)
     * @return Updated calldata offset after processing
     * @custom:calldata-offset-table
     * | Offset | Length (bytes) | Description                     |
     * |--------|----------------|---------------------------------|
     * | 0      | 1              | lendingOperation                |
     * | 1      | 2              | lender                          |
     * | 3      | variable       | lender-specific data            |
     */
    function _lendingOperations(
        address callerAddress,
        address asset,
        uint256 amount,
        address receiver,
        uint256 currentOffset
    )
        internal
        returns (uint256)
    {
        uint256 lendingOperation;
        uint256 lender;
        assembly {
            let slice := calldataload(currentOffset)
            lendingOperation := shr(248, slice)
            lender := and(UINT16_MASK, shr(232, slice))
            currentOffset := add(currentOffset, 3)
        }
        /**
         * Deposit collateral
         */
        if (lendingOperation == LenderOps.DEPOSIT) {
            if (lender < LenderIds.UP_TO_AAVE_V3) {
                return _depositToAaveV3(asset, amount, receiver, currentOffset);
            } else if (lender < LenderIds.UP_TO_AAVE_V2) {
                return _depositToAaveV2(asset, amount, receiver, currentOffset);
            } else if (lender < LenderIds.UP_TO_COMPOUND_V3) {
                return _depositToCompoundV3(asset, amount, receiver, currentOffset);
            } else if (lender < LenderIds.UP_TO_COMPOUND_V2) {
                return _depositToCompoundV2(asset, amount, receiver, currentOffset);
            } else if (lender < LenderIds.UP_TO_MORPHO) {
                return _encodeMorphoDepositCollateral(asset, amount, receiver, callerAddress, currentOffset);
            } else if (lender < LenderIds.UP_TO_SILO_V2) {
                return _depositToSiloV2(asset, amount, receiver, currentOffset);
            } else {
                _invalidOperation();
            }
        }
        /**
         * Borrow
         */
        else if (lendingOperation == LenderOps.BORROW) {
            if (lender < LenderIds.UP_TO_AAVE_V2) {
                return _borrowFromAave(asset, amount, receiver, callerAddress, currentOffset);
            } else if (lender < LenderIds.UP_TO_COMPOUND_V3) {
                return _borrowFromCompoundV3(asset, amount, receiver, callerAddress, currentOffset);
            } else if (lender < LenderIds.UP_TO_COMPOUND_V2) {
                return _borrowFromCompoundV2(asset, amount, receiver, callerAddress, currentOffset);
            } else if (lender < LenderIds.UP_TO_MORPHO) {
                return _morphoBorrow(asset, amount, receiver, callerAddress, currentOffset);
            } else if (lender < LenderIds.UP_TO_SILO_V2) {
                return _borrowFromSiloV2(asset, amount, receiver, callerAddress, currentOffset);
            } else {
                _invalidOperation();
            }
        }
        /**
         * Repay
         */
        else if (lendingOperation == LenderOps.REPAY) {
            if (lender < LenderIds.UP_TO_AAVE_V2) {
                return _repayToAave(asset, amount, receiver, currentOffset);
            } else if (lender < LenderIds.UP_TO_COMPOUND_V3) {
                return _repayToCompoundV3(asset, amount, receiver, currentOffset);
            } else if (lender < LenderIds.UP_TO_COMPOUND_V2) {
                return _repayToCompoundV2(asset, amount, receiver, currentOffset);
            } else if (lender < LenderIds.UP_TO_MORPHO) {
                return _morphoRepay(asset, amount, receiver, callerAddress, currentOffset);
            } else if (lender < LenderIds.UP_TO_SILO_V2) {
                return _repayToSiloV2(asset, amount, receiver, currentOffset);
            } else {
                _invalidOperation();
            }
        }
        /**
         * Withdraw collateral
         */
        else if (lendingOperation == LenderOps.WITHDRAW) {
            if (lender < LenderIds.UP_TO_AAVE_V2) {
                return _withdrawFromAave(asset, amount, receiver, callerAddress, currentOffset);
            } else if (lender < LenderIds.UP_TO_COMPOUND_V3) {
                return _withdrawFromCompoundV3(asset, amount, receiver, callerAddress, currentOffset);
            } else if (lender < LenderIds.UP_TO_COMPOUND_V2) {
                return _withdrawFromCompoundV2(asset, amount, receiver, callerAddress, currentOffset);
            } else if (lender < LenderIds.UP_TO_MORPHO) {
                return _encodeMorphoWithdrawCollateral(asset, amount, receiver, callerAddress, currentOffset);
            } else if (lender < LenderIds.UP_TO_SILO_V2) {
                return _withdrawFromSiloV2(asset, amount, receiver, callerAddress, currentOffset);
            } else {
                _invalidOperation();
            }
        }
        /**
         * deposit lendingToken
         */
        else if (lendingOperation == LenderOps.DEPOSIT_LENDING_TOKEN) {
            return _encodeMorphoDeposit(asset, amount, receiver, callerAddress, currentOffset);
        }
        /**
         * withdraw lendingToken
         */
        else if (lendingOperation == LenderOps.WITHDRAW_LENDING_TOKEN) {
            return _encodeMorphoWithdraw(asset, amount, receiver, callerAddress, currentOffset);
        } else {
            _invalidOperation();
        }
    }
}
