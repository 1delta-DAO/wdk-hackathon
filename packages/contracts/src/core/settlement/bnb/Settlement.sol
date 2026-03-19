// SPDX-License-Identifier: MIT

pragma solidity 0.8.34;

import {SettlementBase} from "../SettlementBase.sol";
import {SettlementExecutor} from "../SettlementExecutor.sol";
import {MorphoFlashLoans} from "../flash-loan/Morpho.sol";
import {MoolahSettlementCallback} from "../flash-loan/MoolahSettlementCallback.sol";

/**
 * @title Settlement (BNB Chain)
 * @notice BNB chain settlement: Moolah (Lista DAO) flash loans only (no Morpho callback).
 *         Reuses MorphoFlashLoans since Moolah shares the same flash loan interface.
 */
contract Settlement is
    SettlementBase,
    MorphoFlashLoans,
    MoolahSettlementCallback
{
    function _moolahPool() internal pure override returns (address) {
        return 0xf820fB4680712CD7263a0D3D024D5b5aEA82Fd70;
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
