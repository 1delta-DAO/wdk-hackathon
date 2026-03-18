// SPDX-License-Identifier: MIT

pragma solidity 0.8.34;

/**
 * @title HealthFactorChecker
 * @notice Per-lender health factor verification for post-settlement conditions.
 *         Ensures a user's lending position stays above a signed minimum health
 *         factor after all settlement actions complete.
 *
 * @dev Aave V2 / V3:
 *      getUserAccountData(address) ->
 *
 *        (uint256 totalCollateralBase,
 *         uint256 totalDebtBase,
 *         uint256 availableBorrowsBase,
 *         uint256 currentLiquidationThreshold,
 *         uint256 ltv,
 *         uint256 healthFactor)           ← 6th slot, offset 0xA0
 *
 *      healthFactor uses 18 decimals (1e18 = 1.0).
 *      When the user has no debt, healthFactor = type(uint256).max.
 *
 *      Morpho Blue:
 *      Per-market isolated health factor computed from on-chain state:
 *
 *        1. position(marketId, user)     → (supplyShares, borrowShares, collateral)
 *        2. idToMarketParams(marketId)   → (loanToken, collateralToken, oracle, irm, lltv)
 *        3. market(marketId)             → (totalSupplyAssets, totalSupplyShares,
 *                                           totalBorrowAssets, totalBorrowShares, ...)
 *        4. IOracle(oracle).price()      → collateralPrice (scaled 1e36)
 *
 *        borrowed    = mulDivUp(borrowShares, totalBorrowAssets + 1, totalBorrowShares + 1e6)
 *        maxBorrow   = collateral * collateralPrice / 1e36 * lltv / 1e18
 *        healthFactor = maxBorrow * 1e18 / borrowed
 *
 *      When borrowShares == 0, the position is healthy (no debt).
 */
abstract contract HealthFactorChecker {
    error HealthFactorTooLow();

    /// @dev HealthFactorTooLow()
    bytes4 private constant _HF_TOO_LOW = 0x62e82dca;

    /**
     * @notice Reverts if the user's Aave health factor is below `minHealthFactor`.
     *         Works for both Aave V2 and V3 (same getUserAccountData interface).
     * @param pool             The Aave lending pool address
     * @param user             The position owner
     * @param minHealthFactor  Minimum acceptable health factor (18 decimals)
     */
    function _checkAaveHealthFactor(
        address pool,
        address user,
        uint256 minHealthFactor
    ) internal view {
        assembly {
            let ptr := mload(0x40)

            // getUserAccountData(address) selector: 0xbf92857c
            mstore(ptr, 0xbf92857c00000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 0x04), user)

            // staticcall — returns 6 × 32 = 192 bytes (0xC0)
            if iszero(staticcall(gas(), pool, ptr, 0x24, ptr, 0xC0)) {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }

            // skip to healthFactor at offset 0xA0
            let hf := mload(add(ptr, 0xA0))

            if lt(hf, minHealthFactor) {
                mstore(0x00, _HF_TOO_LOW)
                revert(0x00, 0x04)
            }
        }
    }

    /**
     * @notice Reverts if the user's Morpho Blue market health factor is below `minHealthFactor`.
     *         Fetches all required data on-chain from the marketId alone.
     * @param morpho           The Morpho Blue contract address
     * @param marketId         The Morpho Blue market identifier
     * @param user             The position owner
     * @param minHealthFactor  Minimum acceptable health factor (18 decimals)
     */
    function _checkMorphoHealthFactor(
        address morpho,
        bytes32 marketId,
        address user,
        uint256 minHealthFactor
    ) internal view {
        assembly {
            let ptr := mload(0x40)

            // 1. position(marketId, user) → (supplyShares, borrowShares, collateral)
            mstore(ptr, 0x93c5206200000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 0x04), marketId)
            mstore(add(ptr, 0x24), user)
            if iszero(staticcall(gas(), morpho, ptr, 0x44, ptr, 0x60)) {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
            let borrowShares := mload(add(ptr, 0x20))
            let collateral := mload(add(ptr, 0x40))

            // No debt → healthy, skip remaining checks
            if borrowShares {
                // 2. idToMarketParams(marketId) → (loanToken, collateralToken, oracle, irm, lltv)
                mstore(ptr, 0x2c3c915700000000000000000000000000000000000000000000000000000000)
                mstore(add(ptr, 0x04), marketId)
                if iszero(staticcall(gas(), morpho, ptr, 0x24, ptr, 0xA0)) {
                    returndatacopy(0, 0, returndatasize())
                    revert(0, returndatasize())
                }
                let oracle := mload(add(ptr, 0x40))
                let lltv := mload(add(ptr, 0x80))

                // 3. market(marketId) → (..., totalBorrowAssets, totalBorrowShares, ...)
                mstore(ptr, 0x5c60e39a00000000000000000000000000000000000000000000000000000000)
                mstore(add(ptr, 0x04), marketId)
                if iszero(staticcall(gas(), morpho, ptr, 0x24, ptr, 0xC0)) {
                    returndatacopy(0, 0, returndatasize())
                    revert(0, returndatasize())
                }
                let totalBorrowAssets := mload(add(ptr, 0x40))
                let totalBorrowShares := mload(add(ptr, 0x60))

                // 4. borrowed = mulDivUp(borrowShares, totalBorrowAssets + 1, totalBorrowShares + 1e6)
                let denom := add(totalBorrowShares, 1000000)
                let borrowed := div(
                    add(mul(borrowShares, add(totalBorrowAssets, 1)), sub(denom, 1)),
                    denom
                )

                // 5. IOracle(oracle).price() → collateralPrice (scaled 1e36)
                mstore(ptr, 0xa035b1fe00000000000000000000000000000000000000000000000000000000)
                if iszero(staticcall(gas(), oracle, ptr, 0x04, ptr, 0x20)) {
                    returndatacopy(0, 0, returndatasize())
                    revert(0, returndatasize())
                }
                let collateralPrice := mload(ptr)

                // 6. maxBorrow = collateral * collateralPrice / 1e36 * lltv / 1e18
                let collValue := div(mul(collateral, collateralPrice), 0xc097ce7bc90715b34b9f1000000000)
                let maxBorrow := div(mul(collValue, lltv), 0xde0b6b3a7640000)

                // 7. Check: maxBorrow * 1e18 >= borrowed * minHealthFactor
                if lt(
                    mul(maxBorrow, 0xde0b6b3a7640000),
                    mul(borrowed, minHealthFactor)
                ) {
                    mstore(0x00, _HF_TOO_LOW)
                    revert(0x00, 0x04)
                }
            }
        }
    }
}
