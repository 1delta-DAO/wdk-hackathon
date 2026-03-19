// SPDX-License-Identifier: MIT

pragma solidity 0.8.34;

import {SettlementBase} from "../SettlementBase.sol";
import {SettlementExecutor} from "../SettlementExecutor.sol";
import {MorphoFlashLoans} from "../flash-loan/Morpho.sol";
import {MorphoSettlementCallback} from "../flash-loan/MorphoSettlementCallback.sol";

/**
 * @title Settlement (Arbitrum)
 * @notice Arbitrum settlement: Morpho Blue flash loans only (no Lista/Moolah).
 */
contract Settlement is
    SettlementBase,
    MorphoFlashLoans,
    MorphoSettlementCallback
{
    function _morphoPool() internal pure override returns (address) {
        return 0x6c247b1F6182318877311737BaC0844bAa518F5e;
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
        bytes memory settlementData
    ) internal view override(SettlementBase, SettlementExecutor) {
        SettlementBase._postSettlementCheck(callerAddress, settlementData);
    }
}
