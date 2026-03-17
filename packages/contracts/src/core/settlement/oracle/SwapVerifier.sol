// SPDX-License-Identifier: MIT

pragma solidity 0.8.34;

import {ISettlementPriceOracle} from "./ISettlementPriceOracle.sol";

/**
 * @title SwapVerifier
 * @notice Verifies that a swap execution produced an output amount within
 *         an acceptable slippage band of the oracle price.
 *
 * @dev The slippage parameter uses the same 1e7 denominator as the fee system:
 *
 *        1e7 = 100%  |  100 000 = 1%  |  1 000 = 1 bps  |  10 = 0.01 bps
 *
 *      Verification formula (no division, overflow-safe for reasonable amounts):
 *
 *        amountOut × 1e7  ≥  expectedOut × (1e7 − maxSlippageBps)
 *
 *      This means: the solver must deliver at least (100% − slippage) of the
 *      oracle price.  The user signs the oracle address and slippage tolerance,
 *      so the solver cannot use a manipulated oracle or excessive slippage.
 */
abstract contract SwapVerifier {
    /// @dev Swap output is below the oracle price minus allowed slippage.
    error SlippageExceeded();

    /// @dev 100% = 1e7, matching the fee denominator.
    uint256 private constant SLIPPAGE_DENOMINATOR = 1e7;

    /**
     * @notice Verify a swap output against an oracle price.
     * @param oracle          Oracle that returns expected output for the pair.
     * @param assetIn         Input token.
     * @param assetOut        Output token.
     * @param amountIn        Actual input amount.
     * @param amountOut       Actual output amount received from the swap.
     * @param maxSlippageBps  Maximum allowed slippage (1e7 denominator).
     */
    function _verifySwapOutput(
        address oracle,
        address assetIn,
        address assetOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 maxSlippageBps
    ) internal view {
        uint256 expectedOut = ISettlementPriceOracle(oracle).getExpectedOutput(assetIn, assetOut, amountIn);

        // amountOut >= expectedOut × (1 − slippage)
        // amountOut × DENOMINATOR >= expectedOut × (DENOMINATOR − maxSlippageBps)
        if (amountOut * SLIPPAGE_DENOMINATOR < expectedOut * (SLIPPAGE_DENOMINATOR - maxSlippageBps)) {
            revert SlippageExceeded();
        }
    }
}
