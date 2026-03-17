// SPDX-License-Identifier: MIT

pragma solidity 0.8.34;

import {IAaveV3Pool} from "./IAaveV3Pool.sol";

abstract contract AaveV3AprChecker {
    error DestinationRateNotBetter();

    /// @dev DestinationRateNotBetter()
    bytes4 internal constant DESTINATION_RATE_NOT_BETTER = 0x0bda8a05;

    /**
     * @notice Reverts if the destination Aave V3 pool's variable borrow rate
     *         is not strictly lower than the source pool's rate for the given asset.
               This is a simple postCheck, other criteria can be added (health check, utilization, ...)
     * @param sourcePool The Aave V3 pool the position is migrating FROM
     * @param destPool   The Aave V3 pool the position is migrating TO
     * @param asset      The borrow asset whose rates are compared
     */
    function _requireBorrowRateImproved(
        address sourcePool,
        address destPool,
        address asset
    ) internal view {
        uint128 sourceRate = IAaveV3Pool(sourcePool).getReserveData(asset).currentVariableBorrowRate;
        uint128 destRate = IAaveV3Pool(destPool).getReserveData(asset).currentVariableBorrowRate;

        if (destRate >= sourceRate) {
            revert DestinationRateNotBetter();
        }
    }
}
