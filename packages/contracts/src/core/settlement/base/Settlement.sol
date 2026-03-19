// SPDX-License-Identifier: MIT

pragma solidity 0.8.34;

import {SettlementBase} from "../SettlementBase.sol";
import {SettlementExecutor} from "../SettlementExecutor.sol";
import {MorphoFlashLoans} from "../flash-loan/Morpho.sol";
import {MorphoSettlementCallback} from "../flash-loan/MorphoSettlementCallback.sol";

/**
 * @title Settlement (Base)
 * @notice Base chain settlement: Morpho Blue flash loans only (no Lista/Moolah).
 */
contract Settlement is
    SettlementBase,
    MorphoFlashLoans,
    MorphoSettlementCallback
{
    function _morphoPool() internal pure override returns (address) {
        return 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb;
    }

    function _flashLoan(
        address flashLoanAsset,
        uint256 flashLoanAmount,
        address user,
        bytes memory data
    ) internal override {
        morphoFlashLoan(flashLoanAsset, flashLoanAmount, user, data);
    }

    function _executeIntent(
        address callerAddress,
        bytes memory settlementData,
        bytes memory fillerCalldata,
        AssetDelta[] memory deltas,
        uint256 deltaCount
    ) internal override(SettlementBase, SettlementExecutor) returns (uint256) {
        return SettlementBase._executeIntent(callerAddress, settlementData, fillerCalldata, deltas, deltaCount);
    }

    function _postSettlementCheck(
        address callerAddress,
        bytes memory settlementData,
        uint256 riskyLenderMask
    ) internal view override(SettlementBase, SettlementExecutor) {
        SettlementBase._postSettlementCheck(callerAddress, settlementData, riskyLenderMask);
    }
}
