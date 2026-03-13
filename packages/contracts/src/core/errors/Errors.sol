// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.8.34;

abstract contract DeltaErrors {
    error InvalidOperation();

    function _invalidOperation() internal pure {
        revert InvalidOperation();
    }
}
