// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {SettlementExecutor} from "../src/core/settlement/SettlementExecutor.sol";

/**
 * @notice Concrete harness that inherits SettlementExecutor.
 *         Overrides lending dispatch and intent to record calls instead of hitting real protocols.
 *         Returns (asset, 0, 0) so deltas are always zero — isolates merkle tests from accounting.
 */
contract SettlementHarness is SettlementExecutor {
    struct LendingCall {
        address callerAddress;
        address asset;
        uint256 amount;
        address receiver;
        uint256 op;
        uint256 lender;
        bytes data;
    }

    struct IntentCall {
        address callerAddress;
        bytes settlementData;
        bytes fillerCalldata;
    }

    LendingCall[] public lendingCalls;
    IntentCall[] public intentCalls;

    function getLendingCallCount() external view returns (uint256) {
        return lendingCalls.length;
    }

    function getLendingCall(uint256 i) external view returns (LendingCall memory) {
        return lendingCalls[i];
    }

    function getIntentCallCount() external view returns (uint256) {
        return intentCalls.length;
    }

    function getIntentCall(uint256 i) external view returns (IntentCall memory) {
        return intentCalls[i];
    }

    function _lendingOperations(
        address callerAddress,
        address asset,
        uint256 amount,
        address receiver,
        uint256 lendingOperation,
        uint256 lender,
        bytes memory data
    ) internal override returns (address assetUsed, uint256 amountIn, uint256 amountOut) {
        assetUsed = asset;
        lendingCalls.push(LendingCall({
            callerAddress: callerAddress,
            asset: asset,
            amount: amount,
            receiver: receiver,
            op: lendingOperation,
            lender: lender,
            data: data
        }));
    }

    function _executeIntent(
        address callerAddress,
        bytes memory settlementData,
        bytes memory fillerCalldata,
        AssetDelta[] memory,
        uint256 deltaCount
    ) internal override returns (uint256 newDeltaCount) {
        newDeltaCount = deltaCount;
        intentCalls.push(IntentCall({
            callerAddress: callerAddress,
            settlementData: settlementData,
            fillerCalldata: fillerCalldata
        }));
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

contract SettlementExecutorTest is Test {
    SettlementHarness harness;

    address constant CALLER = address(0xCAFE);
    address constant ASSET_A = address(0xA);
    address constant ASSET_B = address(0xB);
    address constant RECEIVER = address(0xBEEF);

    function setUp() public {
        harness = new SettlementHarness();
    }

    // ── Merkle helpers ──────────────────────────────────────

    function _leaf(uint8 op, uint16 lender, bytes memory data) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(op, lender, data));
    }

    function _pair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return uint256(a) < uint256(b)
            ? keccak256(abi.encodePacked(a, b))
            : keccak256(abi.encodePacked(b, a));
    }

    // ── Encoding helpers ────────────────────────────────────

    /// @dev Execution data header: [1: numPre][1: numPost][1: numAssets][20: feeRecipient]
    function _execHeader(uint8 numPre, uint8 numPost, uint8 numAssets) internal pure returns (bytes memory) {
        return abi.encodePacked(numPre, numPost, numAssets, address(0));
    }

    function _orderData(bytes32 root, bytes memory settlement) internal pure returns (bytes memory) {
        return abi.encodePacked(root, uint16(settlement.length), settlement);
    }

    function _action(
        address asset,
        uint112 amount,
        address receiver,
        uint8 op,
        uint16 lender,
        bytes memory data,
        bytes32[] memory proof
    ) internal pure returns (bytes memory) {
        bytes memory r = abi.encodePacked(asset, amount, receiver, op, lender, uint16(data.length), data, uint8(proof.length));
        for (uint256 i; i < proof.length; i++) {
            r = abi.encodePacked(r, proof[i]);
        }
        return r;
    }

    // ── Tests ───────────────────────────────────────────────

    function test_singlePre_singlePost() public {
        bytes memory poolData = abi.encodePacked(address(0x1111));
        bytes memory borrowData = abi.encodePacked(uint8(2), address(0x1111));

        bytes32 l0 = _leaf(0, 0, poolData);
        bytes32 l1 = _leaf(1, 1, borrowData);
        bytes32 root = _pair(l0, l1);

        bytes32[] memory p0 = new bytes32[](1);
        p0[0] = l1;
        bytes32[] memory p1 = new bytes32[](1);
        p1[0] = l0;

        bytes memory od = _orderData(root, hex"DEADBEEF");
        bytes memory ed = abi.encodePacked(
            _execHeader(1, 1, 2),
            _action(ASSET_A, 1000, RECEIVER, 0, 0, poolData, p0),
            _action(ASSET_B, 500, RECEIVER, 1, 1, borrowData, p1)
        );

        harness.executeSettlement(CALLER, od, ed, bytes(""));

        assertEq(harness.getLendingCallCount(), 2);
        assertEq(harness.getIntentCallCount(), 1);

        SettlementHarness.LendingCall memory c0 = harness.getLendingCall(0);
        assertEq(c0.callerAddress, CALLER);
        assertEq(c0.asset, ASSET_A);
        assertEq(c0.amount, 1000);
        // Receiver is now always orderSigner (CALLER) — adapters hardcode
        // address(this) for borrow/withdraw, deposit/repay use orderSigner
        assertEq(c0.receiver, CALLER);
        assertEq(c0.op, 0);

        SettlementHarness.LendingCall memory c1 = harness.getLendingCall(1);
        assertEq(c1.asset, ASSET_B);
        assertEq(c1.amount, 500);
        assertEq(c1.op, 1);

        SettlementHarness.IntentCall memory ic = harness.getIntentCall(0);
        assertEq(ic.callerAddress, CALLER);
        assertEq(ic.settlementData, hex"DEADBEEF");
    }

    function test_noActions_intentOnly() public {
        bytes memory od = _orderData(bytes32(0), hex"1234");
        bytes memory ed = abi.encodePacked(_execHeader(0, 0, 0));

        harness.executeSettlement(CALLER, od, ed, bytes(""));

        assertEq(harness.getLendingCallCount(), 0);
        assertEq(harness.getIntentCallCount(), 1);
    }

    function test_revert_invalidProof() public {
        bytes memory data = abi.encodePacked(address(0x1111));
        bytes32 realLeaf = _leaf(0, 0, data);
        bytes32 fakeLeaf = keccak256("fake");
        bytes32 root = _pair(realLeaf, fakeLeaf);

        bytes memory od = _orderData(root, hex"");

        bytes memory badData = abi.encodePacked(address(0x9999));
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = fakeLeaf;

        bytes memory ed = abi.encodePacked(
            _execHeader(1, 0, 1),
            _action(ASSET_A, 100, RECEIVER, 0, 0, badData, proof)
        );

        vm.expectRevert(SettlementExecutor.InvalidMerkleProof.selector);
        harness.executeSettlement(CALLER, od, ed, bytes(""));
    }

    function test_solverChoosesFromMenu_4leaves() public {
        bytes memory p0 = abi.encodePacked(address(0xAA));
        bytes memory p1 = abi.encodePacked(address(0xBB));
        bytes memory p2 = abi.encodePacked(address(0xCC));
        bytes memory p3 = abi.encodePacked(address(0xDD));

        bytes32 l0 = _leaf(0, 0, p0);
        bytes32 l1 = _leaf(0, 0, p1);
        bytes32 l2 = _leaf(0, 0, p2);
        bytes32 l3 = _leaf(0, 0, p3);

        bytes32 h01 = _pair(l0, l1);
        bytes32 h23 = _pair(l2, l3);
        bytes32 root = _pair(h01, h23);

        bytes32[] memory proof = new bytes32[](2);
        proof[0] = l3;
        proof[1] = h01;

        bytes memory od = _orderData(root, hex"");
        bytes memory ed = abi.encodePacked(
            _execHeader(1, 0, 1),
            _action(ASSET_A, 5000, RECEIVER, 0, 0, p2, proof)
        );

        harness.executeSettlement(CALLER, od, ed, bytes(""));

        assertEq(harness.getLendingCallCount(), 1);
        assertEq(harness.getLendingCall(0).data, p2);
    }

    function test_twoPre_twoPost() public {
        bytes memory d0 = abi.encodePacked(address(0x11));
        bytes memory d1 = abi.encodePacked(uint8(2), address(0x11));
        bytes memory d2 = abi.encodePacked(address(0x22));
        bytes memory d3 = abi.encodePacked(address(0x33), address(0x22));

        bytes32 l0 = _leaf(0, 0, d0);
        bytes32 l1 = _leaf(1, 0, d1);
        bytes32 l2 = _leaf(2, 0, d2);
        bytes32 l3 = _leaf(3, 0, d3);

        bytes32 h01 = _pair(l0, l1);
        bytes32 h23 = _pair(l2, l3);
        bytes32 root = _pair(h01, h23);

        bytes memory ed = _buildTwoPreTwoPostExecData(l0, l1, l2, l3, h01, h23, d0, d1, d2, d3);
        bytes memory od = _orderData(root, hex"CAFE");

        harness.executeSettlement(CALLER, od, ed, bytes(""));

        assertEq(harness.getLendingCallCount(), 4);
        assertEq(harness.getIntentCallCount(), 1);
        assertEq(harness.getLendingCall(0).op, 0);
        assertEq(harness.getLendingCall(1).op, 2);
        assertEq(harness.getLendingCall(2).op, 1);
        assertEq(harness.getLendingCall(3).op, 3);
    }

    function test_fillerCalldata_passedToIntent() public {
        bytes memory od = _orderData(bytes32(0), hex"AA");
        bytes memory ed = abi.encodePacked(_execHeader(0, 0, 0));
        bytes memory filler = hex"DEADBEEFCAFE";

        harness.executeSettlement(CALLER, od, ed, filler);

        assertEq(harness.getIntentCallCount(), 1);
        SettlementHarness.IntentCall memory ic = harness.getIntentCall(0);
        assertEq(ic.fillerCalldata, filler);
    }

    function _buildTwoPreTwoPostExecData(
        bytes32 l0, bytes32 l1, bytes32 l2, bytes32 l3,
        bytes32 h01, bytes32 h23,
        bytes memory d0, bytes memory d1, bytes memory d2, bytes memory d3
    ) internal pure returns (bytes memory) {
        bytes32[] memory pr0 = new bytes32[](2);
        pr0[0] = l1; pr0[1] = h23;
        bytes32[] memory pr1 = new bytes32[](2);
        pr1[0] = l0; pr1[1] = h23;
        bytes32[] memory pr2 = new bytes32[](2);
        pr2[0] = l3; pr2[1] = h01;
        bytes32[] memory pr3 = new bytes32[](2);
        pr3[0] = l2; pr3[1] = h01;

        return abi.encodePacked(
            _execHeader(2, 2, 2),
            _actionPure(ASSET_A, 100, RECEIVER, 0, 0, d0, pr0),
            _actionPure(ASSET_A, 200, RECEIVER, 2, 0, d2, pr2),
            _actionPure(ASSET_B, 300, RECEIVER, 1, 0, d1, pr1),
            _actionPure(ASSET_B, 400, RECEIVER, 3, 0, d3, pr3)
        );
    }

    function _actionPure(
        address asset,
        uint112 amount,
        address receiver,
        uint8 op,
        uint16 lender,
        bytes memory data,
        bytes32[] memory proof
    ) internal pure returns (bytes memory) {
        bytes memory r = abi.encodePacked(asset, amount, receiver, op, lender, uint16(data.length), data, uint8(proof.length));
        for (uint256 i; i < proof.length; i++) {
            r = abi.encodePacked(r, proof[i]);
        }
        return r;
    }
}
