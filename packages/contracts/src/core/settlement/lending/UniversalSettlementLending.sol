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
 * @title UniversalSettlementLending
 * @notice Unified lending router that dispatches any lending operation to the correct protocol handler.
 * @dev Inherits all protocol-specific settlement lending modules and routes operations based on
 *      (lendingOperation, lender) pairs. This is the single entry point for all lending interactions
 *      during order settlement.
 *
 *      Protocol routing uses LenderIds thresholds:
 *        - lender < 1000:  Aave V3
 *        - lender < 2000:  Aave V2
 *        - lender < 3000:  Compound V3
 *        - lender < 4000:  Compound V2
 *        - lender < 5000:  Morpho Blue
 *        - lender < 6000:  Silo V2
 *
 *      Operations (LenderOps):
 *        - DEPOSIT (0):               Deposit collateral to lending pool
 *        - BORROW (1):                Borrow assets from lending pool
 *        - REPAY (2):                 Repay borrowed debt
 *        - WITHDRAW (3):              Withdraw collateral from lending pool
 *        - DEPOSIT_LENDING_TOKEN (4): Morpho-only: supply loan token
 *        - WITHDRAW_LENDING_TOKEN (5):Morpho-only: withdraw loan token
 *
 *      Return values (uint256 amountIn, uint256 amountOut):
 *        - Withdraw/Repay: returns the remaining deposit/borrow balance after the operation
 *        - Deposit/Borrow: returns (0, 0) for a consistent return layout
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
     * @return amountIn The resolved amount paid/consumed (deposit, repay) or 0 (withdraw, borrow)
     * @return amountOut The resolved amount received/withdrawn (withdraw, borrow) or 0 (deposit, repay)
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
        returns (uint256 amountIn, uint256 amountOut)
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
                (amountIn, amountOut) = _repayToAave(asset, amount, receiver, data);
            } else if (lender < LenderIds.UP_TO_COMPOUND_V3) {
                (amountIn, amountOut) = _repayToCompoundV3(asset, amount, receiver, data);
            } else if (lender < LenderIds.UP_TO_COMPOUND_V2) {
                (amountIn, amountOut) = _repayToCompoundV2(asset, amount, receiver, data);
            } else if (lender < LenderIds.UP_TO_MORPHO) {
                (amountIn, amountOut) = _morphoRepay(asset, amount, receiver, callerAddress, data);
            } else if (lender < LenderIds.UP_TO_SILO_V2) {
                (amountIn, amountOut) = _repayToSiloV2(asset, amount, receiver, data);
            } else {
                _invalidOperation();
            }
        }
        /**
         * Withdraw collateral
         */
        else if (lendingOperation == LenderOps.WITHDRAW) {
            if (lender < LenderIds.UP_TO_AAVE_V2) {
                (amountIn, amountOut) = _withdrawFromAave(asset, amount, receiver, callerAddress, data);
            } else if (lender < LenderIds.UP_TO_COMPOUND_V3) {
                (amountIn, amountOut) = _withdrawFromCompoundV3(asset, amount, receiver, callerAddress, data);
            } else if (lender < LenderIds.UP_TO_COMPOUND_V2) {
                (amountIn, amountOut) = _withdrawFromCompoundV2(asset, amount, receiver, callerAddress, data);
            } else if (lender < LenderIds.UP_TO_MORPHO) {
                (amountIn, amountOut) = _encodeMorphoWithdrawCollateral(asset, amount, receiver, callerAddress, data);
            } else if (lender < LenderIds.UP_TO_SILO_V2) {
                (amountIn, amountOut) = _withdrawFromSiloV2(asset, amount, receiver, callerAddress, data);
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
            (amountIn, amountOut) = _encodeMorphoWithdraw(asset, amount, receiver, callerAddress, data);
        } else {
            _invalidOperation();
        }
    }
}
