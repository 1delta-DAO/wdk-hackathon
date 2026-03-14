// SPDX-License-Identifier: MIT

pragma solidity 0.8.34;

abstract contract DeltaErrors {
    error InvalidOperation();

    function _invalidOperation() internal pure {
        revert InvalidOperation();
    }
}
