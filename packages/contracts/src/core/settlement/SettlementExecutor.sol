// SPDX-License-Identifier: MIT

pragma solidity 0.8.34;

import {UniversalSettlementLending} from "./lending/UniversalSettlementLending.sol";

/**
 * @title SettlementExecutor
 * @notice Executes structured settlement flows: pre-actions → intent → post-actions.
 *         Uses a merkle root to verify that each action the solver chooses was
 *         pre-approved by the order signer.
 *
 * @dev Order data layout (signed/stored — compact):
 *   [32: merkleRoot]
 *   [2: settlementDataLength (uint16)]
 *   [settlementDataLength: settlementData]
 *
 *   The merkle tree leaves are keccak256(abi.encodePacked(op, lender, lenderData))
 *   for each action config the user approves.
 *
 * @dev Execution data layout (provided by solver at runtime):
 *   [1: numPreActions (uint8)]
 *   [1: numPostActions (uint8)]
 *   [per action (pre then post)]:
 *       [20: asset (address)]
 *       [14: amount (uint112)]
 *       [20: receiver (address)]
 *       [1: lendingOperation (uint8)]
 *       [2: lender (uint16)]
 *       [2: lenderDataLength (uint16)]
 *       [lenderDataLength: lenderData]
 *       [1: proofLength (count of 32-byte elements)]
 *       [proofLength * 32: merkleProof]
 */
abstract contract SettlementExecutor is UniversalSettlementLending {
    error InvalidMerkleProof();

    /**
     * @notice Execute a full settlement: pre-actions, intent, post-actions
     * @param callerAddress The order signer / original caller
     * @param orderData Packed order blob: [32: merkleRoot][2: settlementLen][settlementData]
     * @param executionData Solver-provided blob: [1: numPre][1: numPost][actions with proofs...]
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
     * @notice Execute a batch of merkle-verified lending actions
     * @param callerAddress The order signer
     * @param merkleRoot The root hash of allowed action configs
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
