// SPDX-License-Identifier: MIT

pragma solidity 0.8.34;

import {UniversalSettlementLending} from "./lending/UniversalSettlementLending.sol";

/**
 * @title SettlementExecutor
 * @notice Orchestrates three-phase lending settlements with merkle-verified actions
 *         and per-asset zero-sum accounting.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 *  OVERVIEW
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  A settlement executes four stages in sequence:
 *
 *      1. PRE-ACTIONS   — Merkle-verified lending ops (withdraw, repay, …)
 *      2. INTENT        — Optional asset conversion (e.g. DEX swap)
 *      3. POST-ACTIONS  — Merkle-verified lending ops (deposit, borrow, …)
 *      4. VALIDATION    — Assert every per-asset delta is zero
 *
 *  The invariant enforced by stage 4 guarantees that every token the contract
 *  receives during the settlement is fully consumed — nothing is left behind
 *  and nothing is created from thin air.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ZERO-SUM DELTA ACCOUNTING
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Each lending operation returns three values:
 *
 *      (address assetUsed, uint256 amountIn, uint256 amountOut)
 *
 *    • assetUsed  — the ERC-20 address the operation actually touched
 *    • amountIn   — tokens the contract sent to the protocol  (deposit / repay)
 *    • amountOut  — tokens the contract received from the protocol (withdraw / borrow)
 *
 *  The executor maintains a compact array of AssetDelta structs.
 *  After each operation the corresponding entry is updated:
 *
 *      delta[assetUsed] += int256(amountOut) − int256(amountIn)
 *
 *  The intent phase (stage 2) may further modify deltas when it converts one
 *  asset into another — it subtracts the input amount and adds the output
 *  amount, potentially introducing a new asset entry.
 *
 *  Asset identification is SELF-VERIFYING: deltas use the `assetUsed` address
 *  returned by the lending router, not the `asset` field the solver declared
 *  in the execution blob.  A dishonest solver cannot mis-label an asset to
 *  break accounting because the lending operation itself determines what token
 *  was moved.
 *
 *  Example — cross-asset migration with a swap:
 *
 *    ┌─────────────────────────┬──────────────┬──────────────┐
 *    │ Stage                   │ WETH delta   │ USDC delta   │
 *    ├─────────────────────────┼──────────────┼──────────────┤
 *    │ Pre:  withdraw 100 WETH │ +100         │              │
 *    │ Pre:  repay 5 000 USDC  │              │ −5 000       │
 *    │ Intent: swap WETH→USDC  │ −100         │ +5 000       │
 *    │ Post: deposit 100 WETH  │  — (net 0)   │              │
 *    │ Post: borrow 5 000 USDC │              │  — (net 0)   │
 *    ├─────────────────────────┼──────────────┼──────────────┤
 *    │ Net                     │ 0 ✓          │ 0 ✓          │
 *    └─────────────────────────┴──────────────┴──────────────┘
 *
 *  If the intent is empty (no conversion), the pre-action deltas must already
 *  be consumed one-to-one by the post-actions.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 *  MERKLE TREE VERIFICATION
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  The user constructs a merkle tree off-chain where each leaf encodes one
 *  lending action configuration they approve:
 *
 *      leaf = keccak256(op ‖ lender ‖ lenderData)
 *
 *  The user signs only the 32-byte root.  Key properties:
 *
 *    1. ORDER-INDEPENDENT — Position of a leaf in the tree does not matter;
 *       sorted-pair hashing (min first) makes proof direction irrelevant.
 *
 *    2. SUBSET SELECTION — The solver picks only the actions it needs; unused
 *       leaves have zero on-chain cost.
 *
 *    3. SEPARATED CONCERNS — The leaf covers FIXED params (op, lender, pool
 *       addresses). VARIABLE params (asset, amount, receiver) are provided
 *       by the solver at execution time and validated by zero-sum accounting.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DATA LAYOUTS
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * @dev Order data (signed by user):
 *   [32: merkleRoot][2: settlementDataLength][settlementData]
 *
 * @dev Execution data (solver-provided):
 *   [1: numPre][1: numPost]
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

    /// @dev At least one asset has a non-zero net delta after all phases.
    error UnbalancedSettlement();

    // ── Types ───────────────────────────────────────────────

    /**
     * @notice Per-asset accounting entry.
     * @param asset  Token address (derived from `assetUsed` returned by the lending operation).
     * @param delta  Signed net flow through the contract.
     *               Positive = surplus (received > sent), negative = deficit.
     */
    struct AssetDelta {
        address asset;
        int256 delta;
    }

    // ── Settlement entry point ──────────────────────────────

    /**
     * @notice Execute a full settlement and assert zero-sum balances.
     *
     * @param callerAddress  The order signer / position owner.
     * @param orderData      [32: merkleRoot][2: settlementLen][settlementData]
     * @param executionData  [1: numPre][1: numPost][actions…]
     * @param fillerCalldata Forwarded to `_executeIntent` for DEX fills.
     */
    function _executeSettlement(
        address callerAddress,
        bytes memory orderData,
        bytes memory executionData,
        bytes memory fillerCalldata
    ) internal {
        bytes32 merkleRoot;
        uint256 settlementLen;

        assembly {
            let od := add(orderData, 0x20)
            merkleRoot := mload(od)
            settlementLen := and(0xffff, shr(240, mload(add(od, 32))))
        }

        uint256 numPre;
        uint256 numPost;
        uint256 execOffset;

        assembly {
            let ed := add(executionData, 0x20)
            numPre := shr(248, mload(ed))
            numPost := shr(248, mload(add(ed, 1)))
            execOffset := 2
        }

        // Worst case: every action touches a unique asset.
        AssetDelta[] memory deltas = new AssetDelta[](numPre + numPost);
        uint256 deltaCount;

        // ── Stage 1: pre-actions ──
        (execOffset, deltaCount) = _executeActions(
            callerAddress, merkleRoot, executionData, execOffset, numPre, deltas, deltaCount
        );

        // ── Stage 2: intent (optional conversion) ──
        deltaCount = _executeIntent(
            callerAddress, orderData, 34, settlementLen, fillerCalldata, deltas, deltaCount
        );

        // ── Stage 3: post-actions ──
        (execOffset, deltaCount) = _executeActions(
            callerAddress, merkleRoot, executionData, execOffset, numPost, deltas, deltaCount
        );

        // ── Stage 4: zero-sum check ──
        _verifyZeroDeltas(deltas, deltaCount);
    }

    // ── Merkle-verified action batch ────────────────────────

    /**
     * @notice Parse, verify, execute, and account for a batch of lending actions.
     *
     *         Per action the function:
     *           1. Extracts variable params (asset, amount, receiver) from the blob.
     *           2. Extracts the action config (op, lender, lenderData).
     *           3. Hashes the config into a leaf and walks the merkle proof.
     *           4. Reverts with `InvalidMerkleProof` if the root doesn't match.
     *           5. Dispatches to `_lendingOperations`.
     *           6. Accumulates the returned `(assetUsed, amountIn, amountOut)` into
     *              the per-asset delta array.
     *
     * @param callerAddress The order signer.
     * @param merkleRoot    Signed root covering all approved action configs.
     * @param executionData Solver blob containing actions and proofs.
     * @param execOffset    Current read cursor into executionData.
     * @param count         Number of actions to execute in this batch.
     * @param deltas        Delta accumulator (modified in-place).
     * @param deltaCount    Current number of unique assets in `deltas`.
     * @return newExecOffset  Advanced cursor.
     * @return newDeltaCount  Updated unique-asset count.
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

                // ── Variable params (54 bytes) ──
                asset := shr(96, mload(ed))
                amount := shr(144, mload(add(ed, 20)))
                receiver := shr(96, mload(add(ed, 34)))

                // ── Action config header (5 bytes) ──
                let actionStart := add(ed, 54)
                op := shr(248, mload(actionStart))
                lender := and(0xffff, shr(240, mload(add(actionStart, 1))))
                dataLen := and(0xffff, shr(240, mload(add(actionStart, 3))))

                // ── Copy lenderData into bytes memory ──
                let fmp := mload(0x40)
                mstore(fmp, dataLen)
                let src := add(actionStart, 5)
                let dest := add(fmp, 0x20)
                for { let j := 0 } lt(j, dataLen) { j := add(j, 32) } {
                    mstore(add(dest, j), mload(add(src, j)))
                }
                lenderData := fmp
                mstore(0x40, add(dest, and(add(dataLen, 31), not(31))))

                // ── Compute leaf = keccak256(op ‖ lender ‖ lenderData) ──
                let leafLen := add(3, dataLen)
                let scratch := mload(0x40)
                mstore8(scratch, op)
                mstore8(add(scratch, 1), shr(8, lender))
                mstore8(add(scratch, 2), and(0xff, lender))
                for { let j := 0 } lt(j, dataLen) { j := add(j, 32) } {
                    mstore(add(add(scratch, 3), j), mload(add(src, j)))
                }
                let leaf := keccak256(scratch, leafLen)

                // ── Walk merkle proof (sorted-pair hashing) ──
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

                // ── Root check ──
                if xor(leaf, merkleRoot) {
                    mstore(0x00, 0xb05e92fa00000000000000000000000000000000000000000000000000000000)
                    revert(0x00, 0x04)
                }

                // ── Advance cursor ──
                newExecOffset := add(
                    newExecOffset,
                    add(add(60, dataLen), mul(proofLen, 32))
                )
            }

            // Dispatch and fold into delta array.
            newDeltaCount = _dispatchAndAccumulate(
                callerAddress, asset, amount, receiver, op, lender, lenderData, deltas, newDeltaCount
            );

            unchecked { ++i; }
        }
    }

    // ── Internal helpers ────────────────────────────────────

    /**
     * @notice Dispatch one lending operation and fold its result into the deltas.
     * @dev Extracted from `_executeActions` to stay below the EVM stack limit.
     *      Uses `assetUsed` from the lending router — not the solver-declared
     *      `asset` — so delta accounting is self-verifying.
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
        if (change != 0) {
            return _updateDelta(deltas, deltaCount, assetUsed, change);
        }
        return deltaCount;
    }

    /**
     * @notice Upsert a per-asset delta entry.
     * @dev Linear scan — O(n) where n = number of unique assets in this
     *      settlement, typically 2–4.  Appends a new entry when the asset
     *      is seen for the first time.
     *
     * @param deltas Pre-allocated array (length ≥ numPre + numPost).
     * @param count  Current number of occupied entries.
     * @param asset  Token address to update.
     * @param change Signed amount to add:  +amountOut − amountIn.
     * @return newCount  `count` if the asset already existed, `count + 1` if new.
     */
    function _updateDelta(
        AssetDelta[] memory deltas,
        uint256 count,
        address asset,
        int256 change
    ) internal pure returns (uint256 newCount) {
        for (uint256 i; i < count;) {
            if (deltas[i].asset == asset) {
                deltas[i].delta += change;
                return count;
            }
            unchecked { ++i; }
        }
        deltas[count] = AssetDelta(asset, change);
        return count + 1;
    }

    /**
     * @notice Assert every tracked asset has a net-zero delta.
     * @dev Called once at the end of `_executeSettlement`.
     *      Reverts on the first non-zero entry.
     */
    function _verifyZeroDeltas(AssetDelta[] memory deltas, uint256 count) internal pure {
        for (uint256 i; i < count;) {
            if (deltas[i].delta != 0) revert UnbalancedSettlement();
            unchecked { ++i; }
        }
    }

    // ── Virtual hooks ───────────────────────────────────────

    /**
     * @notice Intent hook — called between pre-actions and post-actions.
     *
     * @dev Concrete implementations use this to execute asset conversions
     *      (DEX swaps, RFQ fills, etc.).  The `deltas` array arrives with
     *      the accumulated state from pre-actions and MUST be updated to
     *      reflect any conversion:
     *
     *        _updateDelta(deltas, deltaCount, inputToken,  -int256(inputAmount));
     *        _updateDelta(deltas, deltaCount, outputToken, +int256(outputAmount));
     *
     *      The orderData's `settlementData` region is the natural place to
     *      encode user-signed constraints for the conversion, for example:
     *
     *        [20: inputToken][14: maxInput][20: outputToken][14: minOutput]
     *
     *      or an oracle address + acceptable price band.
     *
     *      If no conversion is needed the implementation returns `deltaCount`
     *      unchanged and leaves the array untouched — post-actions must then
     *      fully consume the pre-action deltas on their own.
     *
     * @param callerAddress  The order signer.
     * @param orderData      Full order blob (settlementData at `[offset … offset+length)`).
     * @param offset         Start of settlementData within orderData.
     * @param length         Byte length of settlementData (0 = no-op).
     * @param fillerCalldata Solver-provided payload for the conversion execution.
     * @param deltas         Per-asset delta array (modified in-place).
     * @param deltaCount     Current number of unique assets tracked.
     * @return newDeltaCount Updated count (may grow if the conversion introduces a new asset).
     */
    function _executeIntent(
        address callerAddress,
        bytes memory orderData,
        uint256 offset,
        uint256 length,
        bytes memory fillerCalldata,
        AssetDelta[] memory deltas,
        uint256 deltaCount
    ) internal virtual returns (uint256 newDeltaCount);
}
