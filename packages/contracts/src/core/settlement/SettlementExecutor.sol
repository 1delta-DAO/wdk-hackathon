// SPDX-License-Identifier: MIT

pragma solidity 0.8.34;

import {UniversalSettlementLending} from "./lending/UniversalSettlementLending.sol";

/**
 * @title SettlementExecutor
 * @notice Orchestrates three-phase lending settlements with merkle-verified actions,
 *         per-asset zero-sum accounting, and a percentage-based solver fee that
 *         can only be charged on borrowed assets.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 *  SOLVER FEE — BORROW-ONLY, PERCENTAGE-BASED
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  The user signs `maxFeeBps` — the maximum fee as a fraction of the total
 *  amount borrowed.  Denominator is 1e7 (sub-basis-point precision):
 *
 *      100% = 1e7    |  1 bps = 1 000    |  0.01 bps = 10
 *
 *  After all three phases the executor checks each asset's delta:
 *
 *    • delta > 0, totalBorrowed > 0 → borrow surplus = fee
 *        Verified: surplus × 1e7 ≤ totalBorrowed × maxFeeBps
 *        Transferred to feeRecipient.
 *    • delta > 0, totalBorrowed == 0 → non-borrow surplus → refund to signer
 *    • delta < 0                     → deficit → revert (UnbalancedSettlement)
 *    • delta == 0                    → balanced → ok
 *
 *  The refund covers the case where a swap output exceeds the debt being
 *  repaid — min(balance, debt) caps the repay, and the leftover is sent
 *  back to the signer.
 *
 *  Example with maxFeeBps = 50 000 (0.5%), borrow 1000 USDC:
 *    max fee = 1000 × 50 000 / 1e7 = 5 USDC
 *    solver borrows 1005, repays 1000, keeps 5 ✓
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DATA LAYOUTS
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * @dev Order data (signed by user):
 *   [32: merkleRoot][2: settlementDataLength][settlementData]
 *
 * @dev Execution data (solver-provided):
 *   [1: numPre][1: numPost][20: feeRecipient]
 *   [per action]:
 *       [20: asset][14: amount][20: receiver]          — variable params (54 B)
 *       [1: op][2: lender][2: dataLen][data]           — action config
 *       [1: proofLen][proofLen × 32: proof siblings]   — merkle proof
 *
 * @dev Amount sentinels:
 *   0                 — contract's current token balance
 *   type(uint112).max — protocol-specific "safe max" (full user position)
 */
abstract contract SettlementExecutor is UniversalSettlementLending {
    // ── Errors ──────────────────────────────────────────────

    /// @dev Merkle proof does not reconstruct the signed root.
    error InvalidMerkleProof();

    /// @dev An asset has a negative delta or a non-borrow surplus.
    error UnbalancedSettlement();

    /// @dev Borrow surplus exceeds the user-signed percentage cap.
    error FeeExceedsMax();

    // ── Constants ───────────────────────────────────────────

    /// @dev LenderOps.BORROW — must match DeltaEnums.sol
    uint256 private constant OP_BORROW = 1;

    /// @dev Fee denominator — allows sub-basis-point precision.
    ///      100% = 1e7.  1 bps = 1 000.  0.01 bps = 10.  1 unit = 0.0001 bps.
    uint256 private constant FEE_DENOMINATOR = 1e7;

    // ── Types ───────────────────────────────────────────────

    /**
     * @notice Per-asset accounting entry.
     * @param asset          Token address (from lending operation's `assetUsed`).
     * @param delta          Signed net flow.  Positive = surplus, negative = deficit.
     * @param totalBorrowed  Gross amount received via BORROW ops on this asset.
     *                       Used as the denominator for the percentage fee check.
     *                       Zero means this asset was never borrowed — no fee allowed.
     */
    struct AssetDelta {
        address asset;
        int256 delta;
        uint256 totalBorrowed;
    }

    // ── Settlement entry point ──────────────────────────────

    /**
     * @notice Execute a full settlement and assert zero-sum balances.
     *
     * @param callerAddress  The order signer / position owner.
     * @param maxFeeBps      Maximum solver fee as a fraction of total borrow (user-signed).
     *                       Denominator is 1e7 (100% = 1e7, 1 bps = 1 000).
     *                       E.g. 50 000 = 0.5%, 500 = 0.005%.  Set to 0 for fee-free.
     * @param orderData      [32: merkleRoot][2: settlementLen][settlementData]
     * @param executionData  [1: numPre][1: numPost][20: feeRecipient][actions…]
     * @param fillerCalldata Forwarded to `_executeIntent` for DEX fills.
     */
    function _executeSettlement(
        address callerAddress,
        uint256 maxFeeBps,
        bytes memory orderData,
        bytes memory executionData,
        bytes memory fillerCalldata
    ) internal {
        bytes32 merkleRoot;
        bytes memory settlementData;

        assembly {
            let od := add(orderData, 0x20)
            merkleRoot := mload(od)
            let sLen := and(0xffff, shr(240, mload(add(od, 32))))

            // Copy settlementData into its own bytes memory
            let fmp := mload(0x40)
            settlementData := fmp
            mstore(fmp, sLen)
            let src := add(od, 34)
            let dest := add(fmp, 0x20)
            for { let j := 0 } lt(j, sLen) { j := add(j, 32) } {
                mstore(add(dest, j), mload(add(src, j)))
            }
            mstore(0x40, add(dest, and(add(sLen, 31), not(31))))
        }

        uint256 numPre;
        uint256 numPost;
        address feeRecipient;
        uint256 execOffset;

        assembly {
            let ed := add(executionData, 0x20)
            numPre := shr(248, mload(ed))
            numPost := shr(248, mload(add(ed, 1)))
            feeRecipient := shr(96, mload(add(ed, 2)))
            // header: 1 + 1 + 20 = 22 bytes
            execOffset := 22
        }

        AssetDelta[] memory deltas = new AssetDelta[](numPre + numPost);
        uint256 deltaCount;

        // ── Stage 1: pre-actions ──
        (execOffset, deltaCount) = _executeActions(
            callerAddress, merkleRoot, executionData, execOffset, numPre, deltas, deltaCount
        );

        // ── Stage 2: intent (optional conversion) ──
        deltaCount = _executeIntent(
            callerAddress, settlementData, fillerCalldata, deltas, deltaCount
        );

        // ── Stage 3: post-actions ──
        (execOffset, deltaCount) = _executeActions(
            callerAddress, merkleRoot, executionData, execOffset, numPost, deltas, deltaCount
        );

        // ── Stage 4 + 5: refund excess to signer, sweep borrow fees, verify ──
        _sweepAndVerify(deltas, deltaCount, callerAddress, feeRecipient, maxFeeBps);
    }

    // ── Merkle-verified action batch ────────────────────────

    /**
     * @notice Parse, verify, execute, and account for a batch of lending actions.
     */
    function _executeActions(
        address callerAddress,
        bytes32 merkleRoot,
        bytes memory executionData,
        uint256 execOffset,
        uint256 count,
        AssetDelta[] memory deltas,
        uint256 deltaCount
    ) internal returns (uint256 newExecOffset, uint256 newDeltaCount) {
        newExecOffset = execOffset;
        newDeltaCount = deltaCount;

        for (uint256 i; i < count;) {
            uint256 op;
            uint256 lender;
            uint256 dataLen;
            bytes memory lenderData;
            address asset;
            uint256 amount;
            address receiver;

            assembly {
                let ed := add(add(executionData, 0x20), newExecOffset)

                asset := shr(96, mload(ed))
                amount := shr(144, mload(add(ed, 20)))
                receiver := shr(96, mload(add(ed, 34)))

                let actionStart := add(ed, 54)
                op := shr(248, mload(actionStart))
                lender := and(0xffff, shr(240, mload(add(actionStart, 1))))
                dataLen := and(0xffff, shr(240, mload(add(actionStart, 3))))

                let fmp := mload(0x40)
                mstore(fmp, dataLen)
                let src := add(actionStart, 5)
                let dest := add(fmp, 0x20)
                for { let j := 0 } lt(j, dataLen) { j := add(j, 32) } {
                    mstore(add(dest, j), mload(add(src, j)))
                }
                lenderData := fmp
                mstore(0x40, add(dest, and(add(dataLen, 31), not(31))))

                let leafLen := add(3, dataLen)
                let scratch := mload(0x40)
                mstore8(scratch, op)
                mstore8(add(scratch, 1), shr(8, lender))
                mstore8(add(scratch, 2), and(0xff, lender))
                for { let j := 0 } lt(j, dataLen) { j := add(j, 32) } {
                    mstore(add(add(scratch, 3), j), mload(add(src, j)))
                }
                let leaf := keccak256(scratch, leafLen)

                let proofStart := add(actionStart, add(5, dataLen))
                let proofLen := shr(248, mload(proofStart))
                let proofPtr := add(proofStart, 1)

                for { let p := 0 } lt(p, proofLen) { p := add(p, 1) } {
                    let sibling := mload(proofPtr)
                    switch lt(leaf, sibling)
                    case 1 {
                        mstore(0x00, leaf)
                        mstore(0x20, sibling)
                    }
                    default {
                        mstore(0x00, sibling)
                        mstore(0x20, leaf)
                    }
                    leaf := keccak256(0x00, 0x40)
                    proofPtr := add(proofPtr, 32)
                }

                if xor(leaf, merkleRoot) {
                    mstore(0x00, 0xb05e92fa00000000000000000000000000000000000000000000000000000000)
                    revert(0x00, 0x04)
                }

                newExecOffset := add(
                    newExecOffset,
                    add(add(60, dataLen), mul(proofLen, 32))
                )
            }

            newDeltaCount = _dispatchAndAccumulate(
                callerAddress, asset, amount, receiver, op, lender, lenderData, deltas, newDeltaCount
            );

            unchecked { ++i; }
        }
    }

    // ── Internal helpers ────────────────────────────────────

    /**
     * @notice Dispatch one lending operation, fold into deltas, track borrows.
     */
    function _dispatchAndAccumulate(
        address callerAddress,
        address asset,
        uint256 amount,
        address receiver,
        uint256 op,
        uint256 lender,
        bytes memory lenderData,
        AssetDelta[] memory deltas,
        uint256 deltaCount
    ) private returns (uint256 newDeltaCount) {
        (address assetUsed, uint256 amountIn, uint256 amountOut) =
            _lendingOperations(callerAddress, asset, amount, receiver, op, lender, lenderData);

        int256 change = int256(amountOut) - int256(amountIn);

        // For BORROW ops, track the gross borrowed amount for fee % calculation
        uint256 borrowAmount = (op == OP_BORROW) ? amountOut : 0;

        if (change != 0 || borrowAmount != 0) {
            newDeltaCount = _updateDelta(deltas, deltaCount, assetUsed, change, borrowAmount);
        } else {
            newDeltaCount = deltaCount;
        }
    }

    /**
     * @notice Refund non-borrow surplus to signer, sweep borrow-surplus as fee,
     *         and verify all deltas resolve to zero.
     *
     * @dev For each tracked asset:
     *
     *        delta > 0, totalBorrowed > 0 → borrow surplus = solver fee
     *            Percentage-checked: surplus × 1e7 ≤ totalBorrowed × maxFeeBps
     *            Transferred to feeRecipient.
     *
     *        delta > 0, totalBorrowed == 0 → non-borrow surplus (e.g. repay excess)
     *            Refunded to the signer (callerAddress).
     *            This covers the case where a swap output exceeds the debt being
     *            repaid — min(balance, debt) caps the repay, and the leftover
     *            belongs to the user.
     *
     *        delta < 0 → deficit → revert (UnbalancedSettlement)
     *        delta == 0 → balanced → ok
     */
    function _sweepAndVerify(
        AssetDelta[] memory deltas,
        uint256 count,
        address callerAddress,
        address feeRecipient,
        uint256 maxFeeBps
    ) private {
        for (uint256 i; i < count;) {
            int256 d = deltas[i].delta;

            if (d < 0) {
                revert UnbalancedSettlement();
            }

            if (d > 0) {
                uint256 surplus = uint256(d);
                uint256 borrowed = deltas[i].totalBorrowed;

                if (borrowed > 0) {
                    // Borrow surplus → solver fee (percentage-checked)
                    if (surplus * FEE_DENOMINATOR > borrowed * maxFeeBps) {
                        revert FeeExceedsMax();
                    }
                    if (feeRecipient != address(0)) {
                        _transferOut(deltas[i].asset, surplus, feeRecipient);
                    }
                } else {
                    // Non-borrow surplus (e.g. repay used less than swap output)
                    // → refund to signer
                    _transferOut(deltas[i].asset, surplus, callerAddress);
                }
            }

            unchecked { ++i; }
        }
    }

    /**
     * @notice Transfer tokens out — used for both solver fees and signer refunds.
     */
    function _transferOut(address asset, uint256 amount, address recipient) private {
        assembly {
            mstore(0x00, 0xa9059cbb00000000000000000000000000000000000000000000000000000000)
            mstore(0x04, recipient)
            mstore(0x24, amount)

            let success := call(gas(), asset, 0, 0x00, 0x44, 0x00, 0x20)
            let rdsize := returndatasize()
            success := and(
                success,
                or(iszero(rdsize), and(gt(rdsize, 31), eq(mload(0x00), 1)))
            )
            if iszero(success) {
                returndatacopy(0, 0, rdsize)
                revert(0, rdsize)
            }
        }
    }

    /**
     * @notice Upsert a per-asset delta entry with borrow tracking.
     * @param deltas       Pre-allocated array.
     * @param count        Current number of occupied entries.
     * @param asset        Token address to update.
     * @param change       Signed delta change (+amountOut − amountIn).
     * @param borrowAmount Gross borrow amount to add (0 for non-borrow ops).
     */
    function _updateDelta(
        AssetDelta[] memory deltas,
        uint256 count,
        address asset,
        int256 change,
        uint256 borrowAmount
    ) internal pure returns (uint256 newCount) {
        for (uint256 i; i < count;) {
            if (deltas[i].asset == asset) {
                deltas[i].delta += change;
                deltas[i].totalBorrowed += borrowAmount;
                return count;
            }
            unchecked { ++i; }
        }
        deltas[count] = AssetDelta(asset, change, borrowAmount);
        return count + 1;
    }

    // ── Virtual hooks ───────────────────────────────────────

    /**
     * @notice Intent hook — called between pre-actions and post-actions.
     * @dev Concrete implementations use this to execute asset conversions.
     *      The `deltas` array MUST be updated in-place to reflect any conversion.
     *      If no conversion is needed, return `deltaCount` unchanged.
     *
     * @param callerAddress  The order signer / position owner.
     * @param settlementData The user-signed settlement parameters (extracted from orderData).
     *                       Empty bytes if no intent parameters were signed.
     * @param fillerCalldata Solver-provided swap execution payload.
     *                       Empty bytes if no conversion needed (no-op).
     * @param deltas         Per-asset delta array (modified in-place).
     * @param deltaCount     Current number of unique assets tracked.
     * @return newDeltaCount Updated count after any new assets introduced by conversions.
     */
    function _executeIntent(
        address callerAddress,
        bytes memory settlementData,
        bytes memory fillerCalldata,
        AssetDelta[] memory deltas,
        uint256 deltaCount
    ) internal virtual returns (uint256 newDeltaCount);
}
