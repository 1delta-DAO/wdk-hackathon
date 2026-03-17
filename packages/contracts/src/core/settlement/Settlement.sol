// SPDX-License-Identifier: MIT

pragma solidity 0.8.34;

import {MorphoSettlementCallback} from "./flash-loan/MorphoSettlementCallback.sol";
import {MoolahSettlementCallback} from "./flash-loan/MoolahSettlementCallback.sol";
import {MorphoFlashLoans} from "./flash-loan/Morpho.sol";
import {EIP712OrderVerifier} from "./EIP712OrderVerifier.sol";
import {SettlementForwarder} from "./SettlementForwarder.sol";

/**
 * @title Settlement
 * @notice Concrete settlement contract with EIP-712 order verification, flash loan
 *         support, delta-validated lending actions, and isolated DEX execution.
 *
 *         The user signs (merkleRoot, deadline, settlementData) via EIP-712.
 *         The solver submits the signature along with execution data.
 *         The contract recovers the signer and uses it as the position owner
 *         for all lending operations, ensuring only the signer's positions
 *         are touched.
 *
 * @dev settlementData format (inside orderData):
 *   [20: inputToken][14: inputAmount][20: outputToken][14: minOutputAmount]
 *
 * @dev fillerCalldata format:
 *   [20: target][remaining: calldata to forward]
 */
contract Settlement is
    MorphoFlashLoans,
    MorphoSettlementCallback,
    MoolahSettlementCallback,
    EIP712OrderVerifier
{
    SettlementForwarder public immutable forwarder;

    error InsufficientOutput();

    constructor() {
        forwarder = new SettlementForwarder(address(this));
    }

    // ── External Entry Points ────────────────────────────

    /**
     * @notice Direct settlement without flash loan.
     *         Verifies the EIP-712 signature, recovers the signer as position owner,
     *         then executes the full pre-actions → intent → post-actions → fee → delta check flow.
     * @param maxFeeBps          Maximum solver fee the user allows (must match signed orderData)
     * @param deadline        Order expiry timestamp (included in signed data)
     * @param signature       65-byte EIP-712 signature (r ++ s ++ v) from position owner
     * @param orderData       Packed order: [32: merkleRoot][2: settlementLen][settlementData]
     * @param executionData   Solver-provided: [1: numPre][1: numPost][20: feeRecipient][20: feeAsset][14: feeAmount][actions...]
     * @param fillerCalldata  Solver-provided DEX/fill calldata for the intent step
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
     *         Recovers the signer from the signature, then initiates a Morpho flash
     *         loan whose callback executes the full settlement flow.
     * @param flashLoanAsset  Token to flash borrow
     * @param flashLoanAmount Amount to flash borrow
     * @param flashLoanPool   The Morpho-style pool to flash borrow from
     * @param poolId          Pool identifier (0 = Morpho Blue, etc.)
     * @param deadline        Order expiry timestamp
     * @param signature       65-byte EIP-712 signature (r ++ s ++ v)
     * @param orderData       Packed order blob
     * @param executionData   Solver-provided action data
     * @param fillerCalldata  Solver-provided DEX/fill calldata
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

    /**
     * @notice Parse orderData, recover the EIP-712 signer, and return both.
     * @dev Extracts merkleRoot and settlementData from orderData, then calls
     *      _recoverOrderSigner which checks the deadline and ecrecovers.
     * @return user           The recovered signer (position owner)
     * @return merkleRoot     The merkle root from orderData (for reference)
     */
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

    // ── Intent Implementation ────────────────────────────

    /**
     * @notice Executes the solver's fill/swap via an isolated forwarder and folds
     *         the conversion into the settlement's per-asset delta ledger.
     *
     * @dev Flow:
     *      1. Parse user-signed constraints from settlementData:
     *         [20: inputToken][14: inputAmount][20: outputToken][14: minOutputAmount]
     *      2. Snapshot `balanceOf(outputToken)` on this contract.
     *      3. Transfer `inputAmount` of `inputToken` to the forwarder.
     *      4. Execute the solver-provided DEX calldata via the forwarder (sandboxed).
     *      5. Sweep `outputToken` back from the forwarder.
     *      6. Verify `outputReceived >= minOutputAmount`.
     *      7. Update deltas:
     *           delta[inputToken]  -= inputAmount
     *           delta[outputToken] += outputReceived
     *
     *      If `fillerCalldata` is empty the function is a no-op — deltas pass
     *      through unchanged and post-actions must consume them directly.
     */
    function _executeIntent(
        address, /* callerAddress */
        bytes memory orderData,
        uint256 offset,
        uint256 length,
        bytes memory fillerCalldata,
        AssetDelta[] memory deltas,
        uint256 deltaCount
    ) internal override returns (uint256 newDeltaCount) {
        if (fillerCalldata.length == 0) return deltaCount;

        address inputToken;
        uint256 inputAmount;
        address outputToken;
        uint256 minOutputAmount;

        assembly {
            let sd := add(add(orderData, 0x20), offset)
            inputToken := shr(96, mload(sd))
            inputAmount := shr(144, mload(add(sd, 20)))
            outputToken := shr(96, mload(add(sd, 34)))
            minOutputAmount := shr(144, mload(add(sd, 54)))
        }

        // Snapshot output balance before swap
        uint256 balBefore;
        address payable fwd = payable(address(forwarder));
        assembly {
            mstore(0, ERC20_BALANCE_OF)
            mstore(4, address())
            if iszero(staticcall(gas(), outputToken, 0, 0x24, 0, 0x20)) {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
            balBefore := mload(0)
        }

        // 1. Transfer input tokens to forwarder
        assembly {
            mstore(0, ERC20_TRANSFER)
            mstore(4, fwd)
            mstore(0x24, inputAmount)
            if iszero(call(gas(), inputToken, 0, 0, 0x44, 0, 0x20)) {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
        }

        // 2. Parse target and calldata from fillerCalldata: [20: target][remaining: calldata]
        address target;
        assembly {
            target := shr(96, mload(add(fillerCalldata, 0x20)))
        }
        uint256 fwdCalldataLen = fillerCalldata.length - 20;
        bytes memory fwdCalldata = new bytes(fwdCalldataLen);
        assembly {
            let src := add(fillerCalldata, 0x34)
            let dest := add(fwdCalldata, 0x20)
            for { let i := 0 } lt(i, fwdCalldataLen) { i := add(i, 32) } {
                mstore(add(dest, i), mload(add(src, i)))
            }
        }

        // 3. Execute via forwarder (isolated context)
        SettlementForwarder(fwd).execute(target, fwdCalldata);

        // 4. Sweep output tokens back
        SettlementForwarder(fwd).sweep(outputToken);

        // 5. Verify minimum output received
        uint256 balAfter;
        assembly {
            mstore(0, ERC20_BALANCE_OF)
            mstore(4, address())
            if iszero(staticcall(gas(), outputToken, 0, 0x24, 0, 0x20)) {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
            balAfter := mload(0)
        }

        uint256 outputReceived = balAfter - balBefore;
        if (outputReceived < minOutputAmount) revert InsufficientOutput();

        // 6. Update deltas: input consumed, output received
        newDeltaCount = _updateDelta(deltas, deltaCount, inputToken, -int256(inputAmount), 0);
        newDeltaCount = _updateDelta(deltas, newDeltaCount, outputToken, int256(outputReceived), 0);
    }
}
