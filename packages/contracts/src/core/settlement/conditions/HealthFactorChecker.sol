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
}
