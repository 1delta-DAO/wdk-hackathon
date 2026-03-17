// SPDX-License-Identifier: MIT

pragma solidity 0.8.34;

import {MorphoSettlementCallback} from "./flash-loan/MorphoSettlementCallback.sol";
import {MoolahSettlementCallback} from "./flash-loan/MoolahSettlementCallback.sol";
import {MorphoFlashLoans} from "./flash-loan/Morpho.sol";
import {EIP712OrderVerifier} from "./EIP712OrderVerifier.sol";
import {SwapVerifier} from "./oracle/SwapVerifier.sol";
import {SettlementForwarder} from "./SettlementForwarder.sol";

/**
 * @title Settlement
 * @notice Concrete settlement contract with EIP-712 order verification, flash loan
 *         support, delta-validated lending actions, and oracle-verified DEX swaps.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ORACLE-VERIFIED SWAPS
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  The user pre-defines allowed asset conversions in the signed orderData.
 *  Each conversion specifies an oracle and a slippage tolerance.  The solver
 *  executes the swap in the isolated forwarder, then the contract verifies
 *  the received amount against the oracle price.
 *
 *  settlementData format (user-signed):
 *    [1: numConversions]
 *    [per conversion (68 bytes)]:
 *        [20: assetIn][20: assetOut][20: oracle][8: maxSlippageBps]
 *
 *  fillerCalldata format (solver-provided):
 *    [per conversion]:
 *        [20: assetIn][20: assetOut][14: amountIn]
 *        [20: target][2: calldataLen][calldataLen: calldata]
 *
 *  The conversions are matched in order: conversion 0 in settlementData
 *  is paired with swap 0 in fillerCalldata.  The assetIn/assetOut in both
 *  MUST match — the contract verifies this.
 *
 *  If fillerCalldata is empty, the intent is a no-op (same-asset settlement).
 *  If settlementData is empty (numConversions = 0), no swaps are allowed.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 *  SECURITY MODEL
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  1. Swaps execute in the SettlementForwarder (no token approvals → cannot
 *     drain user funds via transferFrom).
 *  2. The user signs which (assetIn, assetOut, oracle, slippage) pairs are
 *     allowed — the solver cannot invent new conversion paths.
 *  3. The oracle verifies the received amount — the solver cannot fill at a
 *     bad price beyond the signed slippage tolerance.
 *  4. The zero-sum delta check ensures everything balances at the end.
 */
contract Settlement is
    MorphoFlashLoans,
    MorphoSettlementCallback,
    MoolahSettlementCallback,
    EIP712OrderVerifier,
    SwapVerifier
{
    SettlementForwarder public immutable forwarder;

    /// @dev assetIn/assetOut in fillerCalldata doesn't match settlementData.
    error ConversionMismatch();

    constructor() {
        forwarder = new SettlementForwarder(address(this));
    }

    // ── External Entry Points ────────────────────────────

    /**
     * @notice Direct settlement without flash loan.
     */
    function settle(
        uint256 maxFeeBps,
        uint48 deadline,
        bytes calldata signature,
        bytes calldata orderData,
        bytes calldata executionData,
        bytes calldata fillerCalldata
    ) external {
        (address user,) = _verifyAndExtract(deadline, signature, orderData);
        _executeSettlement(user, maxFeeBps, orderData, executionData, fillerCalldata);
    }

    /**
     * @notice Flash-loan-wrapped settlement with EIP-712 order verification.
     */
    function settleWithFlashLoan(
        address flashLoanAsset,
        uint256 flashLoanAmount,
        address flashLoanPool,
        uint8 poolId,
        uint256 maxFeeBps,
        uint48 deadline,
        bytes calldata signature,
        bytes calldata orderData,
        bytes calldata executionData,
        bytes calldata fillerCalldata
    ) external {
        (address user,) = _verifyAndExtract(deadline, signature, orderData);

        // Callback layout: [20: user][1: poolId][8: maxFeeBps][2: orderLen][orderData][2: fillerLen][filler][executionData]
        uint256 paramsLen = 1 + 8 + 2 + orderData.length + 2 + fillerCalldata.length + executionData.length;

        bytes memory fullData = abi.encodePacked(
            flashLoanPool,
            uint16(paramsLen),
            poolId,
            uint64(maxFeeBps),
            uint16(orderData.length),
            orderData,
            uint16(fillerCalldata.length),
            fillerCalldata,
            executionData
        );

        morphoFlashLoan(flashLoanAsset, flashLoanAmount, user, fullData);
    }

    // ── Order Verification ───────────────────────────────

    function _verifyAndExtract(
        uint48 deadline,
        bytes calldata signature,
        bytes calldata orderData
    ) internal view returns (address user, bytes32 merkleRoot) {
        bytes memory settlementData;
        assembly {
            merkleRoot := calldataload(orderData.offset)
            let sLen := shr(240, calldataload(add(orderData.offset, 32)))

            let fmp := mload(0x40)
            settlementData := fmp
            mstore(fmp, sLen)
            calldatacopy(add(fmp, 0x20), add(orderData.offset, 34), sLen)
            mstore(0x40, add(add(fmp, 0x20), and(add(sLen, 31), not(31))))
        }

        user = _recoverOrderSigner(merkleRoot, deadline, settlementData, signature);
    }

    // ── Intent: Oracle-Verified Swaps ────────────────────

    /**
     * @notice Executes solver swaps via the isolated forwarder, verifies each
     *         against the user-signed oracle + slippage, and updates deltas.
     *
     * @dev If fillerCalldata is empty → no-op (same-asset settlement).
     *      Otherwise, loops through each conversion defined in settlementData:
     *        1. Parse (assetIn, assetOut, oracle, maxSlippageBps) from settlementData
     *        2. Parse (assetIn, assetOut, amountIn, target, calldata) from fillerCalldata
     *        3. Verify assetIn/assetOut match between both
     *        4. Transfer amountIn to forwarder
     *        5. Execute swap via forwarder
     *        6. Sweep assetOut back
     *        7. Verify output against oracle + slippage
     *        8. Update deltas: delta[assetIn] -= amountIn, delta[assetOut] += output
     */
    function _executeIntent(
        address, /* callerAddress */
        bytes memory settlementData,
        bytes memory fillerCalldata,
        AssetDelta[] memory deltas,
        uint256 deltaCount
    ) internal override returns (uint256 newDeltaCount) {
        if (fillerCalldata.length == 0) return deltaCount;

        newDeltaCount = deltaCount;

        // Parse numConversions from settlementData
        uint256 numConversions;
        assembly {
            numConversions := shr(248, mload(add(settlementData, 0x20)))
        }

        // settlementData cursor: after the 1-byte numConversions header
        uint256 sdOffset = 1;
        // fillerCalldata cursor
        uint256 fcOffset;

        for (uint256 i; i < numConversions;) {
            uint256 fcLen;
            (newDeltaCount, fcLen) = _executeSwap(settlementData, sdOffset, fillerCalldata, fcOffset, deltas, newDeltaCount);
            sdOffset += 68;
            fcOffset += fcLen;
            unchecked { ++i; }
        }
    }

    /**
     * @notice Execute one oracle-verified swap and update deltas.
     * @dev Extracted to avoid stack-too-deep in the conversion loop.
     * @return newDeltaCount Updated delta count.
     * @return fcConsumed    Bytes consumed from fillerCalldata for this swap.
     */
    function _executeSwap(
        bytes memory settlementData,
        uint256 sdOffset,
        bytes memory fillerCalldata,
        uint256 fcOffset,
        AssetDelta[] memory deltas,
        uint256 deltaCount
    ) private returns (uint256 newDeltaCount, uint256 fcConsumed) {
        // ── Parse user-signed conversion params (68 bytes) ──
        address sdAssetIn;
        address sdAssetOut;
        address oracle;
        uint256 maxSlippageBps;

        assembly {
            let sd := add(add(settlementData, 0x20), sdOffset)
            sdAssetIn := shr(96, mload(sd))
            sdAssetOut := shr(96, mload(add(sd, 20)))
            oracle := shr(96, mload(add(sd, 40)))
            maxSlippageBps := shr(192, mload(add(sd, 60)))
        }

        // ── Parse solver-provided swap details ──
        address fcAssetIn;
        address fcAssetOut;
        uint256 amountIn;
        address target;
        uint256 swapCalldataLen;

        assembly {
            let fc := add(add(fillerCalldata, 0x20), fcOffset)
            fcAssetIn := shr(96, mload(fc))
            fcAssetOut := shr(96, mload(add(fc, 20)))
            amountIn := shr(144, mload(add(fc, 40)))
            target := shr(96, mload(add(fc, 54)))
            swapCalldataLen := and(0xffff, shr(240, mload(add(fc, 74))))
        }

        // Verify asset pair matches user-signed config
        if (fcAssetIn != sdAssetIn || fcAssetOut != sdAssetOut) revert ConversionMismatch();

        // ── Execute the swap ──
        uint256 amountOut = _forwardSwap(fcAssetIn, fcAssetOut, amountIn, target, fillerCalldata, fcOffset, swapCalldataLen);

        // ── Oracle verification ──
        _verifySwapOutput(oracle, fcAssetIn, fcAssetOut, amountIn, amountOut, maxSlippageBps);

        // ── Update deltas ──
        newDeltaCount = _updateDelta(deltas, deltaCount, fcAssetIn, -int256(amountIn), 0);
        newDeltaCount = _updateDelta(deltas, newDeltaCount, fcAssetOut, int256(amountOut), 0);

        // 20 + 20 + 14 + 20 + 2 + swapCalldataLen = 76 + swapCalldataLen
        fcConsumed = 76 + swapCalldataLen;
    }

    /**
     * @notice Transfer tokens to forwarder, execute swap, sweep output back.
     * @return amountOut The output amount received.
     */
    function _forwardSwap(
        address assetIn,
        address assetOut,
        uint256 amountIn,
        address target,
        bytes memory fillerCalldata,
        uint256 fcOffset,
        uint256 swapCalldataLen
    ) private returns (uint256 amountOut) {
        address payable fwd = payable(address(forwarder));

        // Snapshot output balance
        uint256 balBefore;
        assembly {
            mstore(0, ERC20_BALANCE_OF)
            mstore(4, address())
            if iszero(staticcall(gas(), assetOut, 0, 0x24, 0, 0x20)) {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
            balBefore := mload(0)
        }

        // Transfer input to forwarder
        assembly {
            mstore(0, ERC20_TRANSFER)
            mstore(4, fwd)
            mstore(0x24, amountIn)
            if iszero(call(gas(), assetIn, 0, 0, 0x44, 0, 0x20)) {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
        }

        // Build swap calldata and execute
        bytes memory swapCalldata = new bytes(swapCalldataLen);
        assembly {
            let src := add(add(fillerCalldata, 0x20), add(fcOffset, 76))
            let dest := add(swapCalldata, 0x20)
            for { let j := 0 } lt(j, swapCalldataLen) { j := add(j, 32) } {
                mstore(add(dest, j), mload(add(src, j)))
            }
        }
        SettlementForwarder(fwd).execute(target, swapCalldata);

        // Sweep output back
        SettlementForwarder(fwd).sweep(assetOut);

        // Measure output
        assembly {
            mstore(0, ERC20_BALANCE_OF)
            mstore(4, address())
            if iszero(staticcall(gas(), assetOut, 0, 0x24, 0, 0x20)) {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
            amountOut := sub(mload(0), balBefore)
        }
    }
}
