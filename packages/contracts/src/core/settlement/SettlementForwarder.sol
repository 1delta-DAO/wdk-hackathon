// SPDX-License-Identifier: MIT

pragma solidity 0.8.34;

/**
 * @title SettlementForwarder
 * @notice Minimal execution sandbox for solver-provided calldata.
 *         Isolates the settlement contract from arbitrary external calls
 *         that could drain user allowances.  The only approval the forwarder
 *         grants is a scoped one (specific token → specific target → specific
 *         amount) set atomically by the settlement contract before executing
 *         the swap, ensuring it cannot be exploited externally.
 */
contract SettlementForwarder {
    address public immutable settlement;

    error OnlySettlement();

    constructor(address _settlement) {
        settlement = _settlement;
    }

    /// @notice Approve a token spender, execute calldata, then revoke.
    /// @dev Called by the settlement contract to approve the DEX target
    ///      before the swap so the router can transferFrom the forwarder.
    ///      The approval is revoked after the call for safety.
    /// @param token   The ERC20 token to approve.
    /// @param spender The DEX target that needs the approval.
    /// @param amount  The exact approval amount.
    /// @param target  The contract to call after approving.
    /// @param data    The calldata to forward to `target`.
    function approveAndExecute(
        address token,
        address spender,
        uint256 amount,
        address target,
        bytes calldata data
    ) external payable {
        if (msg.sender != settlement) revert OnlySettlement();
        assembly {
            let ptr := mload(0x40)

            // approve(spender, amount)
            mstore(ptr, 0x095ea7b300000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 0x04), spender)
            mstore(add(ptr, 0x24), amount)
            // Best-effort approve — some tokens may not return bool
            let ok := call(gas(), token, 0, ptr, 0x44, 0x00, 0x20)
            let rds := returndatasize()
            ok := and(ok, or(iszero(rds), and(gt(rds, 31), eq(mload(0x00), 1))))
            if iszero(ok) {
                returndatacopy(0, 0, rds)
                revert(0, rds)
            }

            // Execute the swap
            calldatacopy(0, data.offset, data.length)
            if iszero(call(gas(), target, callvalue(), 0, data.length, 0, 0)) {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }

            // Revoke approval
            mstore(ptr, 0x095ea7b300000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 0x04), spender)
            mstore(add(ptr, 0x24), 0)
            pop(call(gas(), token, 0, ptr, 0x44, 0x00, 0x20))
        }
    }

    /// @notice Execute arbitrary calldata in this contract's context.
    /// @dev Use approveAndExecute instead when the target needs to pull tokens.
    /// @param target The contract to call (e.g., DEX router)
    /// @param data The calldata to forward
    function execute(address target, bytes calldata data) external payable {
        if (msg.sender != settlement) revert OnlySettlement();
        assembly {
            calldatacopy(0, data.offset, data.length)
            if iszero(call(gas(), target, callvalue(), 0, data.length, 0, 0)) {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
        }
    }

    /// @notice Sweep full ERC20 balance back to the settlement contract.
    /// @param token The ERC20 token to sweep
    function sweep(address token) external {
        if (msg.sender != settlement) revert OnlySettlement();
        address _settlement = settlement;
        assembly {
            // balanceOf(address(this))
            mstore(0, 0x70a0823100000000000000000000000000000000000000000000000000000000)
            mstore(4, address())
            if iszero(staticcall(gas(), token, 0, 0x24, 0, 0x20)) {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
            let bal := mload(0)
            if gt(bal, 0) {
                // transfer(settlement, bal)
                mstore(0, 0xa9059cbb00000000000000000000000000000000000000000000000000000000)
                mstore(4, _settlement)
                mstore(0x24, bal)
                if iszero(call(gas(), token, 0, 0, 0x44, 0, 0x20)) {
                    returndatacopy(0, 0, returndatasize())
                    revert(0, returndatasize())
                }
            }
        }
    }

    /// @notice Accept ETH for native token swaps
    receive() external payable {}
}
