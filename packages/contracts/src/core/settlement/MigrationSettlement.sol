// SPDX-License-Identifier: MIT

pragma solidity 0.8.34;

import {MorphoSettlementCallback} from "./flash-loan/MorphoSettlementCallback.sol";
import {MorphoFlashLoans} from "./flash-loan/Morpho.sol";
import {AaveV3AprChecker} from "./apr/AaveV3AprChecker.sol";
import {EIP712OrderVerifier} from "./EIP712OrderVerifier.sol";

/**
 * @title MigrationSettlement
 * @notice Position migratior across Aave V3 pools with
 *         on-chain borrow rate validation and EIP-712 order signing.
 *         Uses Morpho Blue as flash loan source.
 *
 * @dev settlementData layout (encoded inside orderData, parsed in _executeIntent):
 *   length == 0                → no APR check (no-op intent)
 *   length >= 61               → [1: intentType][20: sourcePool][20: destPool][20: borrowAsset]
 *     intentType == 1          → Aave V3 borrow-rate check: revert if destRate >= sourceRate
 *
 * @dev Migration flow:
 *   1. Call runMigration with the user's EIP-712 signature
 *   2. Contract verifies signature + deadline
 *   3. Flash loan the debt asset from Morpho Blue
 *   4. Pre-actions: repay debt on source, withdraw collateral from source
 *   5. Intent: verify destination borrow rate < source borrow rate
 *   6. Post-actions: deposit collateral on dest, borrow on dest
 *   7. Repay flash loan
 */
contract MigrationSettlement is MorphoSettlementCallback, MorphoFlashLoans, AaveV3AprChecker, EIP712OrderVerifier {
    address private constant FLASH_LOAN_POOL = 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb;

    function _morphoPool() internal pure override returns (address) {
        return FLASH_LOAN_POOL;
    }

    uint256 private constant INTENT_TYPE_AAVE_V3_MIGRATION = 1;

    /**
     * @param flashLoanAsset  The debt asset to flash-borrow
     * @param flashLoanAmount The debt amount to flash-borrow
     * @param deadline        Order expiry timestamp (included in signed data)
     * @param signature       65-byte EIP-712 signature (r ++ s ++ v) from position owner
     * @param orderData       Packed order: [32: merkleRoot][2: settlementDataLen][settlementData]
     * @param executionData   Solver blob: [1: numPre][1: numPost][actions with proofs...]
     */
    function runMigration(
        address flashLoanAsset,
        uint256 flashLoanAmount,
        uint48 deadline,
        bytes calldata signature,
        bytes calldata orderData,
        bytes calldata executionData
    ) external {
        bytes32 merkleRoot;
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

        address user = _recoverOrderSigner(merkleRoot, deadline, settlementData, signature);

        // Callback: [20: user][1: poolId][8: maxFeeBps=0][2: orderLen][orderData][2: fillerLen=0][executionData]
        uint256 paramsLength = 1 + 8 + 2 + orderData.length + 2 + executionData.length;
        bytes memory flashLoanData = abi.encodePacked(
            FLASH_LOAN_POOL,
            uint16(paramsLength),
            uint8(0), // poolId = 0 → Morpho Blue
            uint64(0), // maxFeeBps = 0 (migration has no solver fee)
            uint16(orderData.length),
            orderData,
            uint16(0), // fillerCalldataLen = 0 (no swap/fill for simple migration)
            executionData
        );
        morphoFlashLoan(flashLoanAsset, flashLoanAmount, user, flashLoanData);
    }

    /**
     * @notice Intent hook — validates that the destination lending rate is better
     *         than the source.  Performs NO asset conversion, so deltas pass
     *         through unchanged; pre-action outputs must exactly match post-action
     *         inputs for the zero-sum check to pass.
     *
     * @dev settlementData layout:
     *        length == 0  →  no-op (skip APR check)
     *        length >= 61 →  [1: intentType][20: sourcePool][20: destPool][20: borrowAsset]
     *          intentType == 1  →  Aave V3 borrow-rate comparison
     */
    function _executeIntent(
        address, /* callerAddress */
        bytes memory settlementData,
        bytes memory, /* fillerCalldata */
        AssetDelta[] memory,
        uint256 deltaCount
    ) internal view override returns (uint256 newDeltaCount) {
        newDeltaCount = deltaCount;

        if (settlementData.length == 0) return newDeltaCount;

        uint256 intentType;
        address sourcePool;
        address destPool;
        address borrowAsset;

        assembly {
            let d := add(settlementData, 0x20)
            intentType := shr(248, mload(d))
            sourcePool := shr(96, mload(add(d, 1)))
            destPool := shr(96, mload(add(d, 21)))
            borrowAsset := shr(96, mload(add(d, 41)))
        }

        if (intentType == INTENT_TYPE_AAVE_V3_MIGRATION) {
            _requireBorrowRateImproved(sourcePool, destPool, borrowAsset);
        }
    }
}
