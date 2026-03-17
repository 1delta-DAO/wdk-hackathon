// SPDX-License-Identifier: MIT

pragma solidity 0.8.34;

import {UniversalSettlementLending} from "./lending/UniversalSettlementLending.sol";

/**
 * @title SettlementExecutor
 * @notice Executes structured settlement flows: pre-actions → intent → post-actions.
 *         Uses a merkle root to verify that each action the solver chooses was
 *         pre-approved by the order signer.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 *  MERKLE TREE VERIFICATION MODEL
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  The user constructs a merkle tree off-chain where each leaf represents one
 *  lending action configuration they are willing to allow:
 *
 *      leaf = keccak256(op ‖ lender ‖ lenderData)
 *
 *  The tree is built from an unordered set of approved actions. The user signs
 *  only the 32-byte merkle root. This single root is sufficient to validate
 *  ANY subset of the approved leaves — the solver can pick 1, 2, or all of
 *  them in any order, and each is independently verified against the same root.
 *
 *  Key properties:
 *
 *  1. ORDER-INDEPENDENT — The position of a leaf in the tree does not matter.
 *     A leaf at index 0 and a leaf at index 3 are equally valid; they simply
 *     require different proof paths. The solver can execute actions in any
 *     sequence (e.g., use leaf 3 as a pre-action and leaf 0 as a post-action).
 *
 *  2. ONE ROOT, MANY LEAVES — A single bytes32 root covers the entire set of
 *     approved actions. Whether the user approves 2 or 20 actions, the order
 *     data remains 32 bytes (plus settlement params). The proof cost scales
 *     logarithmically: log2(N) sibling hashes per action verified.
 *
 *  3. SUBSET SELECTION — The solver is not required to use all leaves. They
 *     pick only the actions needed for the specific settlement strategy and
 *     provide proofs for just those. Unused leaves incur zero on-chain cost.
 *
 *  4. REUSE ACROSS SETTLEMENTS — The same signed order (same root) can be
 *     settled multiple times with different action selections. Today the solver
 *     picks Aave (best rate), tomorrow they pick Morpho — same user signature.
 *
 *  5. SEPARATED CONCERNS — The leaf contains only the FIXED lending parameters
 *     (operation type, lender ID, protocol-specific data like pool addresses
 *     or market params). The VARIABLE parameters (asset, amount, receiver)
 *     are provided by the solver at execution time and are NOT part of the
 *     leaf or the merkle tree. This separation is what enables solver autonomy.
 *
 *  Proof verification uses sorted-pair hashing (smaller hash first) so that
 *  proof elements work regardless of whether the node is a left or right child:
 *
 *      parent = keccak256(min(a, b) ‖ max(a, b))
 *
 *  Example with 4 approved actions:
 *
 *              root                    ← user signs this (32 bytes)
 *             /    \
 *           h01     h23
 *          /   \   /   \
 *        L0    L1 L2   L3              ← each is keccak256(op ‖ lender ‖ data)
 *
 *  To use L2, solver provides proof [L3, h01]. Verification:
 *    1. hash(L2, L3) → h23     (sorted: min(L2,L3) first)
 *    2. hash(h01, h23) → root  (sorted: min(h01,h23) first)
 *    3. Compare with signed root ✓
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 *  EXECUTION FLOW
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  _executeSettlement orchestrates a 3-phase flow:
 *
 *    Phase 1: PRE-ACTIONS
 *      For each of numPre actions, the executor:
 *        a) Parses variable params (asset, amount, receiver) from executionData
 *        b) Parses action config (op, lender, lenderData) from executionData
 *        c) Computes the leaf hash from the action config
 *        d) Walks the merkle proof to reconstruct the root
 *        e) Reverts with InvalidMerkleProof() if root doesn't match
 *        f) Dispatches the verified action to _lendingOperations
 *
 *    Phase 2: INTENT SETTLEMENT
 *      Calls _executeIntent (virtual) with the settlementData from orderData
 *      and the solver's fillerCalldata. Concrete implementations use this to
 *      execute swaps via an isolated forwarder contract.
 *
 *    Phase 3: POST-ACTIONS
 *      Same as Phase 1, for numPost actions.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DATA LAYOUTS
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * @dev Order data (signed by user — compact, constant-size header):
 *   [32: merkleRoot]                    — covers all approved action configs
 *   [2: settlementDataLength (uint16)]
 *   [settlementDataLength: settlementData]
 *
 * @dev Execution data (provided by solver at runtime — variable-size):
 *   [1: numPreActions (uint8)]
 *   [1: numPostActions (uint8)]
 *   [per action (pre-actions first, then post-actions)]:
 *       ┌─ variable params (54 bytes) ─────────────────────────┐
 *       │ [20: asset (address)]                                │
 *       │ [14: amount (uint112)]                               │
 *       │ [20: receiver (address)]                             │
 *       ├─ action config (5 + lenderDataLength bytes) ─────────┤
 *       │ [1: lendingOperation (uint8)]                        │
 *       │ [2: lender (uint16)]                                 │
 *       │ [2: lenderDataLength (uint16)]                       │
 *       │ [lenderDataLength: lenderData]                       │
 *       ├─ merkle proof ───────────────────────────────────────┤
 *       │ [1: proofLength (uint8, count of 32-byte siblings)]  │
 *       │ [proofLength * 32: merkle proof siblings]            │
 *       └──────────────────────────────────────────────────────┘
 *
 *   Total bytes per action: 60 + lenderDataLength + proofLength * 32
 *
 * @dev Amount sentinel values:
 *   0                       — use the contract's current balance of the asset
 *   type(uint112).max       — protocol-specific "safe max" (full user balance)
 */
abstract contract SettlementExecutor is UniversalSettlementLending {
    error InvalidMerkleProof();

    /**
     * @notice Execute a full settlement: pre-actions, intent, post-actions.
     *         The merkle root is extracted once from orderData and used to verify
     *         every action in both pre and post phases. Each action is verified
     *         independently — the solver can pick any subset of approved leaves
     *         in any order.
     * @param callerAddress The order signer / original caller
     * @param orderData Packed order blob: [32: merkleRoot][2: settlementLen][settlementData]
     * @param executionData Solver-provided blob: [1: numPre][1: numPost][actions with proofs...]
     * @param fillerCalldata Solver-provided calldata forwarded to _executeIntent for DEX fills
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

        // Execute pre-actions
        execOffset = _executeActions(callerAddress, merkleRoot, executionData, execOffset, numPre);

        // Execute intent settlement (settlementData starts at byte 34 of orderData)
        _executeIntent(callerAddress, orderData, 34, settlementLen, fillerCalldata);

        // Execute post-actions
        _executeActions(callerAddress, merkleRoot, executionData, execOffset, numPost);
    }

    /**
     * @notice Execute a batch of merkle-verified lending actions.
     *
     *         For each action, the function:
     *         1. Parses the solver-provided variable params (asset, amount, receiver)
     *         2. Parses the action config (op, lender, lenderData)
     *         3. Reconstructs the leaf: keccak256(op ‖ lender ‖ lenderData)
     *         4. Walks the merkle proof using sorted-pair hashing to compute the root
     *         5. Reverts if the computed root != the signed merkleRoot
     *         6. Dispatches the action to _lendingOperations
     *
     *         The same merkleRoot is used for every action. Because sorted-pair
     *         hashing produces the same root regardless of tree position, the
     *         solver can present leaves in any order — a leaf used as pre-action
     *         by one solver could be used as a post-action by another.
     *
     * @param callerAddress The order signer
     * @param merkleRoot The root hash of allowed action configs (one root validates all leaves)
     * @param executionData The solver-provided blob containing actions + proofs
     * @param execOffset Current byte offset into executionData
     * @param count Number of actions to execute
     * @return newExecOffset Updated offset into executionData
     */
    function _executeActions(
        address callerAddress,
        bytes32 merkleRoot,
        bytes memory executionData,
        uint256 execOffset,
        uint256 count
    ) internal returns (uint256 newExecOffset) {
        newExecOffset = execOffset;

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

                // Parse variable params: [20: asset][14: amount][20: receiver] = 54 bytes
                asset := shr(96, mload(ed))
                amount := shr(144, mload(add(ed, 20)))
                receiver := shr(96, mload(add(ed, 34)))

                // Parse action config: [1: op][2: lender][2: dataLen] = 5 bytes
                let actionStart := add(ed, 54)
                op := shr(248, mload(actionStart))
                lender := and(0xffff, shr(240, mload(add(actionStart, 1))))
                dataLen := and(0xffff, shr(240, mload(add(actionStart, 3))))

                // Build bytes memory for lenderData
                let fmp := mload(0x40)
                mstore(fmp, dataLen)
                let src := add(actionStart, 5)
                let dest := add(fmp, 0x20)
                for { let j := 0 } lt(j, dataLen) { j := add(j, 32) } {
                    mstore(add(dest, j), mload(add(src, j)))
                }
                lenderData := fmp
                mstore(0x40, add(dest, and(add(dataLen, 31), not(31))))

                // Compute leaf = keccak256(op ++ lender ++ lenderData)
                // Pack into scratch space: [1: op][2: lender][dataLen: lenderData]
                let leafLen := add(3, dataLen)
                let scratch := mload(0x40)
                // Store op (1 byte) and lender (2 bytes) at the start
                mstore8(scratch, op)
                mstore8(add(scratch, 1), shr(8, lender))
                mstore8(add(scratch, 2), and(0xff, lender))
                // Copy lenderData
                for { let j := 0 } lt(j, dataLen) { j := add(j, 32) } {
                    mstore(add(add(scratch, 3), j), mload(add(src, j)))
                }
                let leaf := keccak256(scratch, leafLen)

                // Parse proof: [1: proofLength][proofLength * 32: proof]
                let proofStart := add(actionStart, add(5, dataLen))
                let proofLen := shr(248, mload(proofStart))
                let proofPtr := add(proofStart, 1)

                // Verify merkle proof
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

                // Check against root
                if xor(leaf, merkleRoot) {
                    // InvalidMerkleProof()
                    mstore(0x00, 0xb05e92fa00000000000000000000000000000000000000000000000000000000)
                    revert(0x00, 0x04)
                }

                // Advance offset: 20(asset) + 14(amount) + 20(receiver) + 1(op) + 2(lender)
                //                  + 2(dataLen) + dataLen + 1(proofLen) + proofLen*32 = 60 + dataLen + proofLen*32
                newExecOffset := add(
                    newExecOffset,
                    add(add(60, dataLen), mul(proofLen, 32))
                )
            }

            _lendingOperations(callerAddress, asset, amount, receiver, op, lender, lenderData);

            unchecked { ++i; }
        }
    }

    /**
     * @notice Virtual hook for the intent settlement step (swap/fill)
     * @param callerAddress The order signer
     * @param orderData The full order blob (settlementData is at orderData[offset..offset+length])
     * @param offset Byte offset into orderData where settlementData begins
     * @param length Length of the settlementData
     * @param fillerCalldata Solver-provided calldata for DEX/fill execution
     */
    function _executeIntent(
        address callerAddress,
        bytes memory orderData,
        uint256 offset,
        uint256 length,
        bytes memory fillerCalldata
    ) internal virtual;
}
