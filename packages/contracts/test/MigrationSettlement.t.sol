// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {MigrationSettlement} from "../src/core/settlement/MigrationSettlement.sol";
import {SettlementExecutor} from "../src/core/settlement/SettlementExecutor.sol";
import {AaveV3AprChecker} from "../src/core/settlement/apr/AaveV3AprChecker.sol";
import {EIP712OrderVerifier} from "../src/core/settlement/EIP712OrderVerifier.sol";
import {IAaveV3Pool} from "../src/core/settlement/apr/IAaveV3Pool.sol";

// ── Mocks ────────────────────────────────────────────────────────────────

contract MockAaveV3Pool {
    uint128 public borrowRate;

    function setBorrowRate(uint128 _rate) external {
        borrowRate = _rate;
    }

    function getReserveData(address) external view returns (IAaveV3Pool.ReserveDataLegacy memory data) {
        data.currentVariableBorrowRate = borrowRate;
    }
}

/// @dev Mimics Morpho Blue: accepts flashLoan, immediately calls back onMorphoFlashLoan on msg.sender
contract MockMorphoBlue {
    function flashLoan(address, uint256 assets, bytes calldata data) external {
        (bool ok,) = msg.sender.call(
            abi.encodeWithSignature("onMorphoFlashLoan(uint256,bytes)", assets, data)
        );
        require(ok, "MockMorphoBlue: callback failed");
    }
}

// ── Test harness ─────────────────────────────────────────────────────────

/// @dev Extends MigrationSettlement but records lending calls instead of hitting real protocols.
contract MigrationTestHarness is MigrationSettlement {
    struct LendingCall {
        address callerAddress;
        address asset;
        uint256 amount;
        address receiver;
        uint256 op;
        uint256 lender;
        bytes data;
    }

    LendingCall[] internal _calls;

    function _lendingOperations(
        address callerAddress,
        address asset,
        uint256 amount,
        address receiver,
        uint256 lendingOperation,
        uint256 lender,
        bytes memory data
    ) internal override returns (uint256 amountIn, uint256 amountOut) {
        _calls.push(LendingCall({
            callerAddress: callerAddress,
            asset: asset,
            amount: amount,
            receiver: receiver,
            op: lendingOperation,
            lender: lender,
            data: data
        }));
    }

    function executeSettlement(
        address callerAddress,
        bytes memory orderData,
        bytes memory executionData
    ) external {
        _executeSettlement(callerAddress, orderData, executionData, bytes(""));
    }

    function getLendingCallCount() external view returns (uint256) {
        return _calls.length;
    }

    function getLendingCall(uint256 i) external view returns (LendingCall memory) {
        return _calls[i];
    }
}

// ── Tests ────────────────────────────────────────────────────────────────

contract MigrationSettlementTest is Test {
    MigrationTestHarness harness;
    MockAaveV3Pool sourcePool;
    MockAaveV3Pool destPool;

    address constant MORPHO_BLUE_ADDR = 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb;
    address constant USER = address(0xCAFE);
    address constant DEBT_ASSET = address(0xDE87);
    address constant COLL_ASSET = address(0xC011);
    address constant RECEIVER = address(0xBEEF);

    // EIP-712 signing helpers
    bytes32 constant MIGRATION_ORDER_TYPEHASH =
        keccak256("MigrationOrder(bytes32 merkleRoot,uint48 deadline,bytes settlementData)");

    address userAddr;
    uint256 userPk;

    function setUp() public {
        harness = new MigrationTestHarness();
        sourcePool = new MockAaveV3Pool();
        destPool = new MockAaveV3Pool();

        (userAddr, userPk) = makeAddrAndKey("signingUser");
    }

    // ── EIP-712 signing helper ───────────────────────────────────────────

    function _signOrder(
        uint256 pk,
        bytes32 merkleRoot,
        uint48 deadline,
        bytes memory settlementData
    ) internal view returns (bytes memory) {
        bytes32 domainSeparator = harness.DOMAIN_SEPARATOR();
        bytes32 structHash = keccak256(
            abi.encode(MIGRATION_ORDER_TYPEHASH, merkleRoot, deadline, keccak256(settlementData))
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    // ── Merkle helpers ──────────────────────────────────────────────────

    function _leaf(uint8 op, uint16 lender, bytes memory data) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(op, lender, data));
    }

    function _pair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return uint256(a) < uint256(b)
            ? keccak256(abi.encodePacked(a, b))
            : keccak256(abi.encodePacked(b, a));
    }

    // ── Encoding helpers ────────────────────────────────────────────────

    function _settlementData() internal view returns (bytes memory) {
        return abi.encodePacked(
            uint8(1), // intentType = Aave V3 migration
            address(sourcePool),
            address(destPool),
            DEBT_ASSET
        );
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
        bytes memory r = abi.encodePacked(
            asset, amount, receiver, op, lender, uint16(data.length), data, uint8(proof.length)
        );
        for (uint256 i; i < proof.length; i++) {
            r = abi.encodePacked(r, proof[i]);
        }
        return r;
    }

    // ── Build a 4-leaf migration (repay, withdraw, deposit, borrow) ─────

    struct MigrationFixture {
        bytes32 root;
        bytes orderData;
        bytes executionData;
        bytes settlement;
        bytes d0; // repay lenderData
        bytes d1; // withdraw lenderData
        bytes d2; // deposit lenderData
        bytes d3; // borrow lenderData
    }

    function _buildMigration(bytes memory settlement) internal pure returns (MigrationFixture memory f) {
        f.settlement = settlement;
        f.d0 = abi.encodePacked(address(0x11));           // repay lenderData
        f.d1 = abi.encodePacked(address(0x22), address(0x11)); // withdraw lenderData
        f.d2 = abi.encodePacked(address(0x33));           // deposit lenderData
        f.d3 = abi.encodePacked(uint8(2), address(0x33)); // borrow lenderData

        bytes32 l0 = _leaf(2, 0, f.d0); // repay
        bytes32 l1 = _leaf(3, 0, f.d1); // withdraw
        bytes32 l2 = _leaf(0, 0, f.d2); // deposit
        bytes32 l3 = _leaf(1, 0, f.d3); // borrow

        bytes32 h01 = _pair(l0, l1);
        bytes32 h23 = _pair(l2, l3);
        f.root = _pair(h01, h23);

        bytes32[] memory pr0 = new bytes32[](2);
        pr0[0] = l1; pr0[1] = h23;
        bytes32[] memory pr1 = new bytes32[](2);
        pr1[0] = l0; pr1[1] = h23;
        bytes32[] memory pr2 = new bytes32[](2);
        pr2[0] = l3; pr2[1] = h01;
        bytes32[] memory pr3 = new bytes32[](2);
        pr3[0] = l2; pr3[1] = h01;

        f.orderData = _orderData(f.root, settlement);
        f.executionData = abi.encodePacked(
            uint8(2), uint8(2), // 2 pre, 2 post
            _action(DEBT_ASSET, 1000, RECEIVER, 2, 0, f.d0, pr0),   // pre: repay
            _action(COLL_ASSET, 5000, RECEIVER, 3, 0, f.d1, pr1),   // pre: withdraw
            _action(COLL_ASSET, 5000, RECEIVER, 0, 0, f.d2, pr2),   // post: deposit
            _action(DEBT_ASSET, 1000, RECEIVER, 1, 0, f.d3, pr3)    // post: borrow
        );
    }

    // ── Test: migration passes when dest rate < source rate ─────────────

    function test_simpleMigration_aprPasses() public {
        sourcePool.setBorrowRate(5e25);
        destPool.setBorrowRate(3e25);

        MigrationFixture memory f = _buildMigration(_settlementData());
        harness.executeSettlement(USER, f.orderData, f.executionData);

        assertEq(harness.getLendingCallCount(), 4);

        MigrationTestHarness.LendingCall memory c0 = harness.getLendingCall(0);
        assertEq(c0.op, 2, "first action should be repay");
        assertEq(c0.asset, DEBT_ASSET);

        MigrationTestHarness.LendingCall memory c1 = harness.getLendingCall(1);
        assertEq(c1.op, 3, "second action should be withdraw");
        assertEq(c1.asset, COLL_ASSET);

        MigrationTestHarness.LendingCall memory c2 = harness.getLendingCall(2);
        assertEq(c2.op, 0, "third action should be deposit");
        assertEq(c2.asset, COLL_ASSET);

        MigrationTestHarness.LendingCall memory c3 = harness.getLendingCall(3);
        assertEq(c3.op, 1, "fourth action should be borrow");
        assertEq(c3.asset, DEBT_ASSET);
    }

    // ── Test: migration reverts when dest rate >= source rate ────────────

    function test_simpleMigration_aprReverts() public {
        sourcePool.setBorrowRate(3e25);
        destPool.setBorrowRate(5e25);

        MigrationFixture memory f = _buildMigration(_settlementData());

        vm.expectRevert(AaveV3AprChecker.DestinationRateNotBetter.selector);
        harness.executeSettlement(USER, f.orderData, f.executionData);
    }

    // ── Test: no APR check when settlementData is empty ─────────────────

    function test_migration_noAprCheck() public {
        MigrationFixture memory f = _buildMigration(hex"");
        harness.executeSettlement(USER, f.orderData, f.executionData);

        assertEq(harness.getLendingCallCount(), 4, "all 4 lending ops should execute");
    }

    // ── Test: full entrypoint through MockMorphoBlue with EIP-712 sig ───

    function test_runMigration_entrypoint() public {
        sourcePool.setBorrowRate(5e25);
        destPool.setBorrowRate(3e25);

        MockMorphoBlue mockImpl = new MockMorphoBlue();
        vm.etch(MORPHO_BLUE_ADDR, address(mockImpl).code);

        MigrationFixture memory f = _buildMigration(_settlementData());

        uint48 deadline = uint48(block.timestamp + 1 hours);
        bytes memory sig = _signOrder(userPk, f.root, deadline, f.settlement);

        harness.runMigration(
            DEBT_ASSET,
            1000,
            deadline,
            sig,
            f.orderData,
            f.executionData
        );

        assertEq(harness.getLendingCallCount(), 4, "all 4 lending ops should execute via entrypoint");

        assertEq(harness.getLendingCall(0).op, 2, "repay");
        assertEq(harness.getLendingCall(1).op, 3, "withdraw");
        assertEq(harness.getLendingCall(2).op, 0, "deposit");
        assertEq(harness.getLendingCall(3).op, 1, "borrow");
    }

    // ── Test: expired deadline reverts ───────────────────────────────────

    function test_runMigration_expiredDeadline_reverts() public {
        sourcePool.setBorrowRate(5e25);
        destPool.setBorrowRate(3e25);

        MockMorphoBlue mockImpl = new MockMorphoBlue();
        vm.etch(MORPHO_BLUE_ADDR, address(mockImpl).code);

        MigrationFixture memory f = _buildMigration(_settlementData());

        uint48 deadline = uint48(block.timestamp - 1);
        bytes memory sig = _signOrder(userPk, f.root, deadline, f.settlement);

        vm.expectRevert(EIP712OrderVerifier.OrderExpired.selector);
        harness.runMigration(
            DEBT_ASSET, 1000, deadline, sig, f.orderData, f.executionData
        );
    }

    // ── Test: malformed signature reverts ───────────────────────────────

    function test_runMigration_malformedSignature_reverts() public {
        sourcePool.setBorrowRate(5e25);
        destPool.setBorrowRate(3e25);

        MockMorphoBlue mockImpl = new MockMorphoBlue();
        vm.etch(MORPHO_BLUE_ADDR, address(mockImpl).code);

        MigrationFixture memory f = _buildMigration(_settlementData());

        uint48 deadline = uint48(block.timestamp + 1 hours);
        bytes memory badSig = new bytes(65); // all zeros → ecrecover returns address(0)

        vm.expectRevert(EIP712OrderVerifier.InvalidOrderSignature.selector);
        harness.runMigration(
            DEBT_ASSET, 1000, deadline, badSig, f.orderData, f.executionData
        );
    }

    // ── Test: invalid merkle proof reverts ───────────────────────────────

    function test_runMigration_invalidProof_reverts() public {
        sourcePool.setBorrowRate(5e25);
        destPool.setBorrowRate(3e25);

        bytes memory settlement = _settlementData();

        bytes memory goodData = abi.encodePacked(address(0x11));
        bytes memory badData = abi.encodePacked(address(0x99));

        bytes32 realLeaf = _leaf(2, 0, goodData);
        bytes32 fakeLeaf = keccak256("fake");
        bytes32 root = _pair(realLeaf, fakeLeaf);

        bytes memory od = _orderData(root, settlement);

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = fakeLeaf;

        bytes memory ed = abi.encodePacked(
            uint8(1), uint8(0),
            _action(DEBT_ASSET, 100, RECEIVER, 2, 0, badData, proof)
        );

        vm.expectRevert(SettlementExecutor.InvalidMerkleProof.selector);
        harness.executeSettlement(USER, od, ed);
    }
}
