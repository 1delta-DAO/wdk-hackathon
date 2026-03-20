// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {SettlementExecutor} from "../src/core/settlement/SettlementExecutor.sol";

// ═══════════════════════════════════════════════════════════════════════════════
//  Harness: op-aware mock for delta accounting tests
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @notice Harness whose lending ops return realistic (amountIn, amountOut) based
 *         on the operation type, exercising the zero-sum delta accounting path.
 *
 *         Op semantics:
 *           0 DEPOSIT  → amountIn = amount  (contract sends tokens to pool)
 *           1 BORROW   → amountOut = amount (contract receives tokens from pool)
 *           2 REPAY    → amountIn = amount  (contract sends tokens to pool)
 *           3 WITHDRAW → amountOut = amount (contract receives tokens from pool)
 *
 *         The intent can optionally apply a single conversion stored in
 *         `pendingConversion` — subtract input delta, add output delta.
 */
contract DeltaHarness is SettlementExecutor {
    struct Conversion {
        address inputAsset;
        uint256 inputAmount;
        address outputAsset;
        uint256 outputAmount;
    }

    Conversion public pendingConversion;
    bool public hasConversion;

    /// @notice Pre-configure the intent to apply a conversion.
    function setConversion(
        address inputAsset,
        uint256 inputAmount,
        address outputAsset,
        uint256 outputAmount
    ) external {
        pendingConversion = Conversion(inputAsset, inputAmount, outputAsset, outputAmount);
        hasConversion = true;
    }

    function _lendingOperations(
        address,
        address asset,
        uint256 amount,
        address,
        uint256 lendingOperation,
        uint256,
        bytes memory
    ) internal pure override returns (address assetUsed, uint256 amountIn, uint256 amountOut) {
        assetUsed = asset;

        // DEPOSIT (0) / REPAY (2) → tokens leave the contract
        if (lendingOperation == 0 || lendingOperation == 2) {
            amountIn = amount;
        }
        // BORROW (1) / WITHDRAW (3) → tokens enter the contract
        else if (lendingOperation == 1 || lendingOperation == 3) {
            amountOut = amount;
        }
    }

    function _executeIntent(
        address,
        bytes memory,
        bytes memory,
        AssetDelta[] memory deltas,
        uint256 deltaCount
    ) internal override returns (uint256 newDeltaCount) {
        if (!hasConversion) return deltaCount;

        Conversion memory c = pendingConversion;
        newDeltaCount = _updateDelta(deltas, deltaCount, c.inputAsset, -int256(c.inputAmount), 0);
        newDeltaCount = _updateDelta(deltas, newDeltaCount, c.outputAsset, int256(c.outputAmount), 0);
    }

    function executeSettlement(
        address callerAddress,
        bytes memory orderData,
        bytes memory executionData,
        bytes memory fillerCalldata
    ) external {
        _executeSettlement(callerAddress, 0, orderData, executionData, fillerCalldata);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Test: Zero-sum delta accounting
// ═══════════════════════════════════════════════════════════════════════════════

contract SettlementDeltaTest is Test {
    DeltaHarness harness;

    address constant CALLER = address(0xCAFE);
    address constant WETH = address(0xABCD);
    address constant USDC = address(0xDCBA);
    address constant RECEIVER = address(0xBEEF);

    function setUp() public {
        harness = new DeltaHarness();
    }

    // ── Helpers ──────────────────────────────────────────────

    function _leaf(uint8 op, uint16 lender, bytes memory data) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(op, lender, data));
    }

    function _pair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return uint256(a) < uint256(b)
            ? keccak256(abi.encodePacked(a, b))
            : keccak256(abi.encodePacked(b, a));
    }

    function _orderData(bytes32 root) internal pure returns (bytes memory) {
        return abi.encodePacked(root, uint16(0));
    }

    function _execHeader(uint8 numPre, uint8 numPost) internal pure returns (bytes memory) {
        return abi.encodePacked(numPre, numPost, address(0));
    }

    function _action(
        address asset,
        uint112 amount,
        uint8 op,
        bytes memory data,
        bytes32[] memory proof
    ) internal pure returns (bytes memory) {
        bytes memory r = abi.encodePacked(
            asset, amount, address(0xBEEF), op, uint16(0), uint16(data.length), data, uint8(proof.length)
        );
        for (uint256 i; i < proof.length; i++) {
            r = abi.encodePacked(r, proof[i]);
        }
        return r;
    }

    // ── Balanced: single-asset withdraw → deposit ────────────

    function test_balanced_sameAsset_withdrawThenDeposit() public {
        bytes memory d0 = hex"AA";
        bytes memory d1 = hex"BB";

        bytes32 l0 = _leaf(3, 0, d0); // withdraw
        bytes32 l1 = _leaf(0, 0, d1); // deposit
        bytes32 root = _pair(l0, l1);

        bytes32[] memory p0 = new bytes32[](1);
        p0[0] = l1;
        bytes32[] memory p1 = new bytes32[](1);
        p1[0] = l0;

        bytes memory od = _orderData(root);
        bytes memory ed = abi.encodePacked(
            _execHeader(1, 1),
            // Pre: withdraw 100 WETH → delta[WETH] = +100
            _action(WETH, uint112(100), 3, d0, p0),
            // Post: deposit 100 WETH → delta[WETH] = +100 - 100 = 0
            _action(WETH, uint112(100), 0, d1, p1)
        );

        harness.executeSettlement(CALLER, od, ed, bytes(""));
    }

    // ── Balanced: multi-asset migration ──────────────────────
    //    withdraw WETH + repay USDC → deposit WETH + borrow USDC

    function test_balanced_multiAsset_migration() public {
        bytes memory dWithdraw = hex"01";
        bytes memory dRepay = hex"02";
        bytes memory dDeposit = hex"03";
        bytes memory dBorrow = hex"04";

        bytes32 l0 = _leaf(3, 0, dWithdraw);
        bytes32 l1 = _leaf(2, 0, dRepay);
        bytes32 l2 = _leaf(0, 0, dDeposit);
        bytes32 l3 = _leaf(1, 0, dBorrow);

        bytes32 h01 = _pair(l0, l1);
        bytes32 h23 = _pair(l2, l3);
        bytes32 root = _pair(h01, h23);

        bytes32[] memory pr0 = new bytes32[](2);
        pr0[0] = l1; pr0[1] = h23;
        bytes32[] memory pr1 = new bytes32[](2);
        pr1[0] = l0; pr1[1] = h23;
        bytes32[] memory pr2 = new bytes32[](2);
        pr2[0] = l3; pr2[1] = h01;
        bytes32[] memory pr3 = new bytes32[](2);
        pr3[0] = l2; pr3[1] = h01;

        bytes memory od = _orderData(root);
        bytes memory ed = abi.encodePacked(
            _execHeader(2, 2),
            _action(WETH, uint112(100), 3, dWithdraw, pr0),
            _action(USDC, uint112(500), 2, dRepay, pr1),
            _action(WETH, uint112(100), 0, dDeposit, pr2),
            _action(USDC, uint112(500), 1, dBorrow, pr3)
        );

        harness.executeSettlement(CALLER, od, ed, bytes(""));
    }

    // ── Non-borrow surplus → reverts (solver must re-deposit) ───

    function test_nonBorrowSurplus_reverts() public {
        bytes memory d0 = hex"AA";
        bytes memory d1 = hex"BB";

        bytes32 l0 = _leaf(3, 0, d0);
        bytes32 l1 = _leaf(0, 0, d1);
        bytes32 root = _pair(l0, l1);

        bytes32[] memory p0 = new bytes32[](1);
        p0[0] = l1;
        bytes32[] memory p1 = new bytes32[](1);
        p1[0] = l0;

        bytes memory od = _orderData(root);
        bytes memory ed = abi.encodePacked(
            _execHeader(1, 1),
            // Pre: withdraw 100 WETH
            _action(WETH, uint112(100), 3, d0, p0),
            // Post: deposit only 50 WETH → surplus of 50
            _action(WETH, uint112(50), 0, d1, p1)
        );

        // Non-borrow surplus reverts — solver must deposit all excess
        // back into a lender for the user.
        vm.expectRevert(SettlementExecutor.UnbalancedSettlement.selector);
        harness.executeSettlement(CALLER, od, ed, bytes(""));
    }

    // ── Unbalanced: deficit reverts ──────────────────────────

    function test_revert_unbalanced_deficit() public {
        bytes memory d0 = hex"AA";
        bytes memory d1 = hex"BB";

        bytes32 l0 = _leaf(3, 0, d0);
        bytes32 l1 = _leaf(0, 0, d1);
        bytes32 root = _pair(l0, l1);

        bytes32[] memory p0 = new bytes32[](1);
        p0[0] = l1;
        bytes32[] memory p1 = new bytes32[](1);
        p1[0] = l0;

        bytes memory od = _orderData(root);
        bytes memory ed = abi.encodePacked(
            _execHeader(1, 1),
            // Pre: withdraw 50 WETH
            _action(WETH, uint112(50), 3, d0, p0),
            // Post: deposit 100 WETH → deficit of 50
            _action(WETH, uint112(100), 0, d1, p1)
        );

        vm.expectRevert(SettlementExecutor.UnbalancedSettlement.selector);
        harness.executeSettlement(CALLER, od, ed, bytes(""));
    }

    // ── Unbalanced: one asset balanced, other not → reverts ──

    function test_revert_unbalanced_oneOfTwoAssets() public {
        bytes memory dWithdraw = hex"01";
        bytes memory dRepay = hex"02";
        bytes memory dDeposit = hex"03";
        bytes memory dBorrow = hex"04";

        bytes32 l0 = _leaf(3, 0, dWithdraw);
        bytes32 l1 = _leaf(2, 0, dRepay);
        bytes32 l2 = _leaf(0, 0, dDeposit);
        bytes32 l3 = _leaf(1, 0, dBorrow);

        bytes32 h01 = _pair(l0, l1);
        bytes32 h23 = _pair(l2, l3);
        bytes32 root = _pair(h01, h23);

        bytes32[] memory pr0 = new bytes32[](2);
        pr0[0] = l1; pr0[1] = h23;
        bytes32[] memory pr1 = new bytes32[](2);
        pr1[0] = l0; pr1[1] = h23;
        bytes32[] memory pr2 = new bytes32[](2);
        pr2[0] = l3; pr2[1] = h01;
        bytes32[] memory pr3 = new bytes32[](2);
        pr3[0] = l2; pr3[1] = h01;

        bytes memory od = _orderData(root);
        bytes memory ed = abi.encodePacked(
            _execHeader(2, 2),
            // WETH balanced: withdraw 100, deposit 100
            _action(WETH, uint112(100), 3, dWithdraw, pr0),
            _action(USDC, uint112(500), 2, dRepay, pr1),
            _action(WETH, uint112(100), 0, dDeposit, pr2),
            // USDC unbalanced: repay 500, borrow only 400
            _action(USDC, uint112(400), 1, dBorrow, pr3)
        );

        vm.expectRevert(SettlementExecutor.UnbalancedSettlement.selector);
        harness.executeSettlement(CALLER, od, ed, bytes(""));
    }

    // ── Intent conversion balances a cross-asset settlement ──

    function test_balanced_intentConversion() public {
        bytes memory dWithdraw = hex"01";
        bytes memory dDeposit = hex"02";

        bytes32 l0 = _leaf(3, 0, dWithdraw);
        bytes32 l1 = _leaf(0, 0, dDeposit);
        bytes32 root = _pair(l0, l1);

        bytes32[] memory p0 = new bytes32[](1);
        p0[0] = l1;
        bytes32[] memory p1 = new bytes32[](1);
        p1[0] = l0;

        // Pre:    withdraw 100 WETH        → delta[WETH] = +100
        // Intent: convert 100 WETH → 200 USDC → delta[WETH] = 0, delta[USDC] = +200
        // Post:   deposit 200 USDC         → delta[USDC] = 0
        harness.setConversion(WETH, 100, USDC, 200);

        bytes memory od = _orderData(root);
        bytes memory ed = abi.encodePacked(
            _execHeader(1, 1),
            _action(WETH, uint112(100), 3, dWithdraw, p0),
            _action(USDC, uint112(200), 0, dDeposit, p1)
        );

        harness.executeSettlement(CALLER, od, ed, bytes(""));
    }

    // ── Intent conversion with insufficient output → reverts ─

    function test_revert_intentConversion_insufficientOutput() public {
        bytes memory dWithdraw = hex"01";
        bytes memory dDeposit = hex"02";

        bytes32 l0 = _leaf(3, 0, dWithdraw);
        bytes32 l1 = _leaf(0, 0, dDeposit);
        bytes32 root = _pair(l0, l1);

        bytes32[] memory p0 = new bytes32[](1);
        p0[0] = l1;
        bytes32[] memory p1 = new bytes32[](1);
        p1[0] = l0;

        // Intent converts 100 WETH → 150 USDC, but post needs 200
        harness.setConversion(WETH, 100, USDC, 150);

        bytes memory od = _orderData(root);
        bytes memory ed = abi.encodePacked(
            _execHeader(1, 1),
            _action(WETH, uint112(100), 3, dWithdraw, p0),
            _action(USDC, uint112(200), 0, dDeposit, p1)
        );

        vm.expectRevert(SettlementExecutor.UnbalancedSettlement.selector);
        harness.executeSettlement(CALLER, od, ed, bytes(""));
    }

    // ── No actions, no intent → trivially balanced ───────────

    function test_balanced_noActions() public {
        bytes memory od = abi.encodePacked(bytes32(0), uint16(0));
        bytes memory ed = abi.encodePacked(_execHeader(0, 0));

        harness.executeSettlement(CALLER, od, ed, bytes(""));
    }
}
