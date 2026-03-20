// SPDX-License-Identifier: MIT

pragma solidity 0.8.34;

import {SettlementBase} from "../SettlementBase.sol";
import {SettlementExecutor} from "../SettlementExecutor.sol";
import {MorphoFlashLoans} from "../flash-loan/Morpho.sol";
import {MorphoSettlementCallback} from "../flash-loan/MorphoSettlementCallback.sol";
import {MoolahSettlementCallback} from "../flash-loan/MoolahSettlementCallback.sol";

/**
 * @title Settlement (Ethereum)
 * @notice Ethereum settlement: supports both Morpho Blue and Moolah (Lista DAO)
 *         flash loan callbacks. Uses Morpho as the flash loan provider.
 */
contract Settlement is
    SettlementBase,
    MorphoFlashLoans,
    MorphoSettlementCallback,
    MoolahSettlementCallback
{
    function _morphoPool() internal pure override returns (address) {
        return 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb;
    }

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
        address orderSigner,
        bytes memory settlementData,
        bytes memory fillerCalldata,
        AssetDelta[] memory deltas,
        uint256 deltaCount
    ) internal override(SettlementBase, SettlementExecutor) returns (uint256) {
        return SettlementBase._executeIntent(orderSigner, settlementData, fillerCalldata, deltas, deltaCount);
    }

    function _postSettlementCheck(
        address orderSigner,
        bytes memory settlementData,
        uint256 riskyLenderMask
    ) internal view override(SettlementBase, SettlementExecutor) {
        SettlementBase._postSettlementCheck(orderSigner, settlementData, riskyLenderMask);
    }
}
