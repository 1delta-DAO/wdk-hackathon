// SPDX-License-Identifier: MIT

pragma solidity 0.8.34;

import {MorphoSettlementCallback} from "./flash-loan/MorphoSettlementCallback.sol";
import {MoolahSettlementCallback} from "./flash-loan/MoolahSettlementCallback.sol";
import {MorphoFlashLoans} from "./flash-loan/Morpho.sol";
import {SettlementForwarder} from "./SettlementForwarder.sol";

/**
 * @title Settlement
 * @notice Concrete settlement contract with external entry points for solvers.
 *         Supports direct settlement and flash-loan-wrapped settlement.
 *         Filler calldata is executed in an isolated forwarder contract
 *         that has no token approvals.
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
    MoolahSettlementCallback
{
    SettlementForwarder public immutable forwarder;

    error InsufficientOutput();

    constructor() {
        forwarder = new SettlementForwarder(address(this));
    }

    // ── External Entry Points ────────────────────────────

    /**
     * @notice Direct settlement without flash loan.
     * @param callerAddress The order signer whose positions are managed
     * @param orderData Packed order: [32: merkleRoot][2: settlementLen][settlementData]
     * @param executionData Solver-provided: [1: numPre][1: numPost][actions...]
     * @param fillerCalldata Solver-provided DEX/fill calldata for the intent step
     */
    function settle(
        address callerAddress,
        bytes calldata orderData,
        bytes calldata executionData,
        bytes calldata fillerCalldata
    ) external {
        _executeSettlement(callerAddress, orderData, executionData, fillerCalldata);
    }

    /**
     * @notice Flash-loan-wrapped settlement.
     * @param callerAddress The order signer
     * @param asset Token to flash borrow
     * @param amount Amount to flash borrow
     * @param flashLoanPool The Morpho-style pool to flash borrow from
     * @param poolId Pool identifier (0 = Morpho Blue, etc.)
     * @param orderData Packed order blob
     * @param executionData Solver-provided action data
     * @param fillerCalldata Solver-provided DEX/fill calldata
     */
    function settleWithFlashLoan(
        address callerAddress,
        address asset,
        uint256 amount,
        address flashLoanPool,
        uint8 poolId,
        bytes calldata orderData,
        bytes calldata executionData,
        bytes calldata fillerCalldata
    ) external {
        uint256 paramsLen = 20 + 1 + 2 + orderData.length + 2 + fillerCalldata.length + executionData.length;

        bytes memory fullData = abi.encodePacked(
            flashLoanPool,
            uint16(paramsLen),
            callerAddress,
            poolId,
            uint16(orderData.length),
            orderData,
            uint16(fillerCalldata.length),
            fillerCalldata,
            executionData
        );

        morphoFlashLoan(asset, amount, callerAddress, fullData);
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
        newDeltaCount = _updateDelta(deltas, deltaCount, inputToken, -int256(inputAmount));
        newDeltaCount = _updateDelta(deltas, newDeltaCount, outputToken, int256(outputReceived));
    }
}
