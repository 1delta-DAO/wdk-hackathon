// SPDX-License-Identifier: MIT

pragma solidity 0.8.34;

import {AaveSettlementLending} from "./AaveSettlementLending.sol";
import {CompoundV3SettlementLending} from "./CompoundV3SettlementLending.sol";
import {CompoundV2SettlementLending} from "./CompoundV2SettlementLending.sol";
import {MorphoSettlementLending} from "./MorphoSettlementLending.sol";
import {SiloV2SettlementLending} from "./SiloV2SettlementLending.sol";
import {LenderIds, LenderOps} from "./DeltaEnums.sol";
import {DeltaErrors} from "../../errors/Errors.sol";

// solhint-disable max-line-length

/**
 * @notice Settlement version of UniversalLending using bytes memory for lender-specific data.
 * Asset, amount, receiver, and caller are explicit parameters.
 * The lender-specific data blob is passed as bytes memory (e.g. from stored order params).
 */
abstract contract UniversalSettlementLending is
    AaveSettlementLending,
    CompoundV3SettlementLending,
    CompoundV2SettlementLending,
    MorphoSettlementLending,
    SiloV2SettlementLending,
    DeltaErrors
{
    /**
     * @notice Executes any lending operation across various lenders
     * @param callerAddress Address of the caller
     * @param asset The token address for the lending operation
     * @param amount The amount for the lending operation (0 = contract balance, type(uint112).max = max/safe max)
     * @param receiver The receiver address
     * @param lendingOperation The lending operation type (from LenderOps)
     * @param lender The lender identifier (from LenderIds)
     * @param data Lender-specific data blob (bytes memory)
     */
    function _lendingOperations(
        address callerAddress,
        address asset,
        uint256 amount,
        address receiver,
        uint256 lendingOperation,
        uint256 lender,
        bytes memory data
    )
        internal
        virtual
    {
        /**
         * Deposit collateral
         */
        if (lendingOperation == LenderOps.DEPOSIT) {
            if (lender < LenderIds.UP_TO_AAVE_V3) {
                _depositToAaveV3(asset, amount, receiver, data);
            } else if (lender < LenderIds.UP_TO_AAVE_V2) {
                _depositToAaveV2(asset, amount, receiver, data);
            } else if (lender < LenderIds.UP_TO_COMPOUND_V3) {
                _depositToCompoundV3(asset, amount, receiver, data);
            } else if (lender < LenderIds.UP_TO_COMPOUND_V2) {
                _depositToCompoundV2(asset, amount, receiver, data);
            } else if (lender < LenderIds.UP_TO_MORPHO) {
                _encodeMorphoDepositCollateral(asset, amount, receiver, callerAddress, data);
            } else if (lender < LenderIds.UP_TO_SILO_V2) {
                _depositToSiloV2(asset, amount, receiver, data);
            } else {
                _invalidOperation();
            }
        }
        /**
         * Borrow
         */
        else if (lendingOperation == LenderOps.BORROW) {
            if (lender < LenderIds.UP_TO_AAVE_V2) {
                _borrowFromAave(asset, amount, receiver, callerAddress, data);
            } else if (lender < LenderIds.UP_TO_COMPOUND_V3) {
                _borrowFromCompoundV3(asset, amount, receiver, callerAddress, data);
            } else if (lender < LenderIds.UP_TO_COMPOUND_V2) {
                _borrowFromCompoundV2(asset, amount, receiver, callerAddress, data);
            } else if (lender < LenderIds.UP_TO_MORPHO) {
                _morphoBorrow(asset, amount, receiver, callerAddress, data);
            } else if (lender < LenderIds.UP_TO_SILO_V2) {
                _borrowFromSiloV2(asset, amount, receiver, callerAddress, data);
            } else {
                _invalidOperation();
            }
        }
        /**
         * Repay
         */
        else if (lendingOperation == LenderOps.REPAY) {
            if (lender < LenderIds.UP_TO_AAVE_V2) {
                _repayToAave(asset, amount, receiver, data);
            } else if (lender < LenderIds.UP_TO_COMPOUND_V3) {
                _repayToCompoundV3(asset, amount, receiver, data);
            } else if (lender < LenderIds.UP_TO_COMPOUND_V2) {
                _repayToCompoundV2(asset, amount, receiver, data);
            } else if (lender < LenderIds.UP_TO_MORPHO) {
                _morphoRepay(asset, amount, receiver, callerAddress, data);
            } else if (lender < LenderIds.UP_TO_SILO_V2) {
                _repayToSiloV2(asset, amount, receiver, data);
            } else {
                _invalidOperation();
            }
        }
        /**
         * Withdraw collateral
         */
        else if (lendingOperation == LenderOps.WITHDRAW) {
            if (lender < LenderIds.UP_TO_AAVE_V2) {
                _withdrawFromAave(asset, amount, receiver, callerAddress, data);
            } else if (lender < LenderIds.UP_TO_COMPOUND_V3) {
                _withdrawFromCompoundV3(asset, amount, receiver, callerAddress, data);
            } else if (lender < LenderIds.UP_TO_COMPOUND_V2) {
                _withdrawFromCompoundV2(asset, amount, receiver, callerAddress, data);
            } else if (lender < LenderIds.UP_TO_MORPHO) {
                _encodeMorphoWithdrawCollateral(asset, amount, receiver, callerAddress, data);
            } else if (lender < LenderIds.UP_TO_SILO_V2) {
                _withdrawFromSiloV2(asset, amount, receiver, callerAddress, data);
            } else {
                _invalidOperation();
            }
        }
        /**
         * deposit lendingToken
         */
        else if (lendingOperation == LenderOps.DEPOSIT_LENDING_TOKEN) {
            _encodeMorphoDeposit(asset, amount, receiver, callerAddress, data);
        }
        /**
         * withdraw lendingToken
         */
        else if (lendingOperation == LenderOps.WITHDRAW_LENDING_TOKEN) {
            _encodeMorphoWithdraw(asset, amount, receiver, callerAddress, data);
        } else {
            _invalidOperation();
        }
    }
}
