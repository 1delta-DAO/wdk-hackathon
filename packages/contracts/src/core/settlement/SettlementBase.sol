// SPDX-License-Identifier: MIT

pragma solidity 0.8.34;

import {SettlementExecutor} from "./SettlementExecutor.sol";
import {EIP712OrderVerifier} from "./EIP712OrderVerifier.sol";
import {SwapVerifier} from "./oracle/SwapVerifier.sol";
import {HealthFactorChecker} from "./conditions/HealthFactorChecker.sol";
import {LenderIds} from "./lending/DeltaEnums.sol";
import {SettlementForwarder} from "./SettlementForwarder.sol";

/**
 * @title SettlementBase
 * @notice Abstract settlement with EIP-712 order verification, oracle-verified
 *         swaps, and post-settlement health factor checks.
 *
 *         Chain-specific subcontracts wire in the appropriate flash loan provider
 *         and callback(s) by overriding `_flashLoan`.
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
 *        [20: assetIn][20: assetOut][20: oracle][8: swapTolerance]
 *    [optional 1: numConditions]
 *    [optional per condition — variable size based on lenderId]:
 *        Aave       (lenderId 0-1999):    [2: lenderId][20: pool][14: minHF]                = 36 bytes
 *        CompoundV3 (lenderId 2000-2999): [2: lenderId][20: comet][2: assetBitmap][14: minHF] = 38 bytes
 *        CompoundV2 (lenderId 3000-3999): [2: lenderId][20: comptroller][14: minHF]         = 36 bytes
 *        Morpho     (lenderId 4000-4999): [2: lenderId][20: morpho][32: marketId][14: minHF] = 68 bytes
 *        SiloV2     (lenderId 5000-5999): [2: lenderId][20: silo][14: minHF]                = 36 bytes
 *
 *  fillerCalldata format (solver-provided):
 *    [per conversion]:
 *        [20: assetIn][20: assetOut][14: amountIn]
 *        [20: target][2: calldataLen][calldataLen: calldata]
 *
 *  amountIn sentinels:
 *    0 — contract's full balance of assetIn (prevents dust from max withdrawals)
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
abstract contract SettlementBase is
    SettlementExecutor,
    EIP712OrderVerifier,
    SwapVerifier,
    HealthFactorChecker
{
    SettlementForwarder public immutable forwarder;

    /// @dev assetIn/assetOut in fillerCalldata doesn't match settlementData.
    error ConversionMismatch();

    /// @dev A condition lenderId has no corresponding health factor check.
    error UnsupportedConditionLender();

    constructor() {
        forwarder = new SettlementForwarder(address(this));
    }

    // ── Flash loan hook (chain-specific) ──────────────────

    /**
     * @notice Initiate a flash loan via the chain's provider.
     * @param flashLoanAsset  Token to flash-borrow
     * @param flashLoanAmount Amount to flash-borrow
     * @param user            Original caller / position owner
     * @param data            Provider-specific encoded data
     */
    function _flashLoan(
        address flashLoanAsset,
        uint256 flashLoanAmount,
        address user,
        bytes memory data
    ) internal virtual;

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
        (address user,) = _verifyAndExtract(maxFeeBps, deadline, signature, orderData);
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
        (address user,) = _verifyAndExtract(maxFeeBps, deadline, signature, orderData);

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

        _flashLoan(flashLoanAsset, flashLoanAmount, user, fullData);
    }

    // ── Order Verification ───────────────────────────────

    function _verifyAndExtract(
        uint256 maxFeeBps,
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

        user = _recoverOrderSigner(merkleRoot, deadline, maxFeeBps, settlementData, signature);
    }

    // ── Intent: Oracle-Verified Swaps ────────────────────

    function _executeIntent(
        address, /* orderSigner */
        bytes memory settlementData,
        bytes memory fillerCalldata,
        AssetDelta[] memory deltas,
        uint256 deltaCount
    ) internal virtual override returns (uint256 newDeltaCount) {
        if (fillerCalldata.length == 0) return deltaCount;

        newDeltaCount = deltaCount;

        uint256 numConversions;
        assembly {
            numConversions := shr(248, mload(add(settlementData, 0x20)))
        }

        uint256 sdOffset = 1;
        uint256 fcOffset;

        for (uint256 i; i < numConversions;) {
            uint256 fcLen;
            (newDeltaCount, fcLen) = _executeSwap(settlementData, sdOffset, fillerCalldata, fcOffset, deltas, newDeltaCount);
            sdOffset += 68;
            fcOffset += fcLen;
            unchecked { ++i; }
        }
    }

    function _executeSwap(
        bytes memory settlementData,
        uint256 sdOffset,
        bytes memory fillerCalldata,
        uint256 fcOffset,
        AssetDelta[] memory deltas,
        uint256 deltaCount
    ) private returns (uint256 newDeltaCount, uint256 fcConsumed) {
        address sdAssetIn;
        address sdAssetOut;
        address oracle;
        uint256 swapTolerance;

        assembly {
            let sd := add(add(settlementData, 0x20), sdOffset)
            sdAssetIn := shr(96, mload(sd))
            sdAssetOut := shr(96, mload(add(sd, 20)))
            oracle := shr(96, mload(add(sd, 40)))
            swapTolerance := shr(192, mload(add(sd, 60)))
        }

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

        if (fcAssetIn != sdAssetIn || fcAssetOut != sdAssetOut) revert ConversionMismatch();

        if (amountIn == 0) {
            assembly {
                let ptr := mload(0x40)
                mstore(ptr, 0x70a0823100000000000000000000000000000000000000000000000000000000)
                mstore(add(ptr, 4), address())
                if iszero(staticcall(gas(), fcAssetIn, ptr, 0x24, ptr, 0x20)) {
                    returndatacopy(0, 0, returndatasize())
                    revert(0, returndatasize())
                }
                amountIn := mload(ptr)
            }
            if (amountIn == 0) {
                newDeltaCount = deltaCount;
                fcConsumed = 76 + swapCalldataLen;
                return (newDeltaCount, fcConsumed);
            }
        }

        uint256 amountOut = _forwardSwap(fcAssetIn, fcAssetOut, amountIn, target, fillerCalldata, fcOffset, swapCalldataLen);
        _verifySwapOutput(oracle, fcAssetIn, fcAssetOut, amountIn, amountOut, swapTolerance);

        newDeltaCount = _updateDelta(deltas, deltaCount, fcAssetIn, -int256(amountIn), 0);
        newDeltaCount = _updateDelta(deltas, newDeltaCount, fcAssetOut, int256(amountOut), 0);

        fcConsumed = 76 + swapCalldataLen;
    }

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

        uint256 balBefore;
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, 0x70a0823100000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 4), address())
            if iszero(staticcall(gas(), assetOut, ptr, 0x24, ptr, 0x20)) {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
            balBefore := mload(ptr)
        }

        assembly {
            let ptr := mload(0x40)
            mstore(ptr, 0xa9059cbb00000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 4), fwd)
            mstore(add(ptr, 0x24), amountIn)
            if iszero(call(gas(), assetIn, 0, ptr, 0x44, 0, 0x20)) {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
        }

        bytes memory swapCalldata = new bytes(swapCalldataLen);
        assembly {
            let src := add(add(fillerCalldata, 0x20), add(fcOffset, 76))
            let dest := add(swapCalldata, 0x20)
            for { let j := 0 } lt(j, swapCalldataLen) { j := add(j, 32) } {
                mstore(add(dest, j), mload(add(src, j)))
            }
        }
        SettlementForwarder(fwd).execute(target, swapCalldata);
        SettlementForwarder(fwd).sweep(assetOut);

        assembly {
            let ptr := mload(0x40)
            mstore(ptr, 0x70a0823100000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 4), address())
            if iszero(staticcall(gas(), assetOut, ptr, 0x24, ptr, 0x20)) {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
            amountOut := sub(mload(ptr), balBefore)
        }
    }

    // ── Post-Settlement Conditions ───────────────────────

    function _postSettlementCheck(
        address orderSigner,
        bytes memory settlementData,
        uint256 riskyLenderMask
    ) internal view virtual override {
        uint256 numConversions;
        assembly {
            numConversions := shr(248, mload(add(settlementData, 0x20)))
        }

        uint256 conditionsOffset = 1 + numConversions * 68;

        if (settlementData.length <= conditionsOffset) return;

        uint256 numConditions;
        assembly {
            numConditions := shr(248, mload(add(add(settlementData, 0x20), conditionsOffset)))
        }

        uint256 cursor = conditionsOffset + 1;

        for (uint256 i; i < numConditions;) {
            uint256 lenderId;
            assembly {
                lenderId := and(0xffff, shr(240, mload(add(add(settlementData, 0x20), cursor))))
            }

            // Bitmap: bit 0 = Aave (<2000), bit 1 = CompV3 (<3000),
            //         bit 2 = CompV2 (<4000), bit 3 = Morpho (<5000), bit 4 = Silo (<6000)
            // Only run the expensive health check if this lender bucket had a risky op.
            if (lenderId < LenderIds.UP_TO_AAVE_V2) {
                if (riskyLenderMask & 1 != 0) {
                    address pool;
                    uint256 minHF;
                    assembly {
                        let ptr := add(add(settlementData, 0x20), cursor)
                        pool := shr(96, mload(add(ptr, 2)))
                        minHF := shr(144, mload(add(ptr, 22)))
                    }
                    _checkAaveHealthFactor(pool, orderSigner, minHF);
                }
                cursor += 36;
            } else if (lenderId < LenderIds.UP_TO_COMPOUND_V3) {
                if (riskyLenderMask & 2 != 0) {
                    address comet;
                    uint256 assetBitmap;
                    uint256 minHF;
                    assembly {
                        let ptr := add(add(settlementData, 0x20), cursor)
                        comet := shr(96, mload(add(ptr, 2)))
                        assetBitmap := and(0xffff, shr(240, mload(add(ptr, 22))))
                        minHF := shr(144, mload(add(ptr, 24)))
                    }
                    _checkCompoundV3HealthFactor(comet, orderSigner, assetBitmap, minHF);
                }
                cursor += 38;
            } else if (lenderId < LenderIds.UP_TO_COMPOUND_V2) {
                if (riskyLenderMask & 4 != 0) {
                    address comptroller;
                    assembly {
                        let ptr := add(add(settlementData, 0x20), cursor)
                        comptroller := shr(96, mload(add(ptr, 2)))
                    }
                    _checkCompoundV2Solvency(comptroller, orderSigner);
                }
                cursor += 36;
            } else if (lenderId < LenderIds.UP_TO_MORPHO) {
                if (riskyLenderMask & 8 != 0) {
                    address morpho;
                    bytes32 marketId;
                    uint256 minHF;
                    assembly {
                        let ptr := add(add(settlementData, 0x20), cursor)
                        morpho := shr(96, mload(add(ptr, 2)))
                        marketId := mload(add(ptr, 22))
                        minHF := shr(144, mload(add(ptr, 54)))
                    }
                    _checkMorphoHealthFactor(morpho, marketId, orderSigner, minHF);
                }
                cursor += 68;
            } else if (lenderId < LenderIds.UP_TO_SILO_V2) {
                if (riskyLenderMask & 16 != 0) {
                    address silo;
                    assembly {
                        let ptr := add(add(settlementData, 0x20), cursor)
                        silo := shr(96, mload(add(ptr, 2)))
                    }
                    _checkSiloV2Solvency(silo, orderSigner);
                }
                cursor += 36;
            } else {
                revert UnsupportedConditionLender();
            }

            unchecked { ++i; }
        }
    }
}
