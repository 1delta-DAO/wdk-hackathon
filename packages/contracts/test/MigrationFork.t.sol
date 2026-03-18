// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test, console} from "forge-std/Test.sol";
import {MigrationSettlement} from "../src/core/settlement/MigrationSettlement.sol";
import {IAaveV3Pool} from "../src/core/settlement/apr/IAaveV3Pool.sol";
import {AaveV3AprChecker} from "../src/core/settlement/apr/AaveV3AprChecker.sol";
import {SettlementExecutor} from "../src/core/settlement/SettlementExecutor.sol";
import {EIP712OrderVerifier} from "../src/core/settlement/EIP712OrderVerifier.sol";


interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

interface IPool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf) external;
    function getReserveData(address asset) external view returns (IAaveV3Pool.ReserveDataLegacy memory);
}

interface ICreditDelegation {
    function approveDelegation(address delegatee, uint256 amount) external;
}

interface IWETH {
    function deposit() external payable;
}


contract MigrationForkTest is Test {
    // Ethereum mainnet
    address constant AAVE_V3_CORE  = 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2;
    address constant AAVE_V3_PRIME = 0x4e033931ad43597d96D6bcc25c280717730B58B1;
    address constant MORPHO_BLUE   = 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb;
    address constant WETH          = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant USDC          = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;

    // EIP-712
    bytes32 constant MIGRATION_ORDER_TYPEHASH =
        keccak256("MigrationOrder(bytes32 merkleRoot,uint48 deadline,bytes settlementData)");

    MigrationSettlement settlement;

    address user;
    uint256 userPk;
    address whale;

    // Source pool (Prime) tokens
    address aWETH_src;
    address vDebtUSDC_src;

    // Destination pool (Core) tokens
    address aWETH_dst;
    address vDebtUSDC_dst;

    uint256 constant USER_COLLATERAL  = 10 ether;
    uint256 constant USER_BORROW      = 1_000e6;        // 1 000 USDC
    uint256 constant WHALE_COLLATERAL = 500 ether;
    uint256 constant WHALE_BORROW     = 500_000e6;      // 500K USDC

    // ── Helpers ──────────────────────────────────────────────────────────

    function _leaf(uint8 op, uint16 lender, bytes memory data) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(op, lender, data));
    }

    function _pair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return uint256(a) < uint256(b)
            ? keccak256(abi.encodePacked(a, b))
            : keccak256(abi.encodePacked(b, a));
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

    function _signOrder(
        uint256 pk,
        bytes32 merkleRoot,
        uint48 deadline,
        bytes memory settlementData
    ) internal view returns (bytes memory) {
        bytes32 domainSeparator = settlement.DOMAIN_SEPARATOR();
        bytes32 structHash = keccak256(
            abi.encode(MIGRATION_ORDER_TYPEHASH, merkleRoot, deadline, keccak256(settlementData))
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }


    function setUp() public {
        try vm.envString("ETH_RPC_URL") returns (string memory rpcUrl) {
            vm.createSelectFork(rpcUrl);
        } catch {
            return;
        }

        (user, userPk) = makeAddrAndKey("user1");
        whale = makeAddr("user2");

        settlement = new MigrationSettlement();

        // Source (Prime) reserve tokens
        IAaveV3Pool.ReserveDataLegacy memory srcWeth = IPool(AAVE_V3_PRIME).getReserveData(WETH);
        IAaveV3Pool.ReserveDataLegacy memory srcUsdc = IPool(AAVE_V3_PRIME).getReserveData(USDC);
        aWETH_src     = srcWeth.aTokenAddress;
        vDebtUSDC_src = srcUsdc.variableDebtTokenAddress;

        // Destination (Core) reserve tokens
        IAaveV3Pool.ReserveDataLegacy memory dstWeth = IPool(AAVE_V3_CORE).getReserveData(WETH);
        IAaveV3Pool.ReserveDataLegacy memory dstUsdc = IPool(AAVE_V3_CORE).getReserveData(USDC);
        aWETH_dst     = dstWeth.aTokenAddress;
        vDebtUSDC_dst = dstUsdc.variableDebtTokenAddress;

        // Settlement contract approvals (via approveToken — no prank needed)
        settlement.approveToken(USDC, AAVE_V3_PRIME, type(uint256).max);
        settlement.approveToken(USDC, AAVE_V3_CORE, type(uint256).max);
        settlement.approveToken(WETH, AAVE_V3_CORE, type(uint256).max);
        settlement.approveToken(WETH, AAVE_V3_PRIME, type(uint256).max);
        settlement.approveToken(USDC, MORPHO_BLUE, type(uint256).max);
    }


    function test_forkMigration_primeToCoreAfterRatePump() public {
        if (address(settlement) == address(0)) return;

        // User deposits WETH and borrows USDC on the Prime pool
        vm.deal(user, USER_COLLATERAL + 1 ether);
        vm.startPrank(user);
        IWETH(WETH).deposit{value: USER_COLLATERAL}();
        IERC20(WETH).approve(AAVE_V3_PRIME, type(uint256).max);
        IPool(AAVE_V3_PRIME).supply(WETH, USER_COLLATERAL, user, 0);
        IPool(AAVE_V3_PRIME).borrow(USDC, USER_BORROW, 2, 0, user);
        vm.stopPrank();

        assertGt(IERC20(vDebtUSDC_src).balanceOf(user), 0, "user should have Prime debt");

        // Record initial rates
        uint128 primeRateInitial = IPool(AAVE_V3_PRIME).getReserveData(USDC).currentVariableBorrowRate;
        uint128 coreRate         = IPool(AAVE_V3_CORE).getReserveData(USDC).currentVariableBorrowRate;
        console.log("Prime USDC borrow rate (initial):", primeRateInitial);
        console.log("Core  USDC borrow rate          :", coreRate);
        assertGt(primeRateInitial, coreRate, "Prime rate should already be higher than Core");

        // Whale borrows massively on Prime to pump its rate
        vm.deal(whale, WHALE_COLLATERAL + 1 ether);
        vm.startPrank(whale);
        IWETH(WETH).deposit{value: WHALE_COLLATERAL}();
        IERC20(WETH).approve(AAVE_V3_PRIME, type(uint256).max);
        IPool(AAVE_V3_PRIME).supply(WETH, WHALE_COLLATERAL, whale, 0);
        IPool(AAVE_V3_PRIME).borrow(USDC, WHALE_BORROW, 2, 0, whale);
        vm.stopPrank();

        uint128 primeRatePumped = IPool(AAVE_V3_PRIME).getReserveData(USDC).currentVariableBorrowRate;
        console.log("Prime USDC borrow rate (pumped) :", primeRatePumped);
        assertGt(primeRatePumped, primeRateInitial, "whale borrow should have increased Prime rate");
        assertGt(primeRatePumped, coreRate, "pumped Prime rate must exceed Core rate for migration");

        // User grants settlement the needed permissions
        vm.startPrank(user);
        IERC20(aWETH_src).approve(address(settlement), type(uint256).max);
        ICreditDelegation(vDebtUSDC_dst).approveDelegation(address(settlement), type(uint256).max);
        vm.stopPrank();

        // Build the migration order
        uint256 flashLoanAmount = IERC20(vDebtUSDC_src).balanceOf(user);

        bytes memory repayData    = abi.encodePacked(uint8(2), vDebtUSDC_src, AAVE_V3_PRIME);
        bytes memory withdrawData = abi.encodePacked(aWETH_src, AAVE_V3_PRIME);
        bytes memory depositData  = abi.encodePacked(AAVE_V3_CORE);
        bytes memory borrowData   = abi.encodePacked(uint8(2), AAVE_V3_CORE);

        bytes32 l0 = _leaf(2, 0, repayData);
        bytes32 l1 = _leaf(3, 0, withdrawData);
        bytes32 l2 = _leaf(0, 0, depositData);
        bytes32 l3 = _leaf(1, 0, borrowData);

        bytes32 h01  = _pair(l0, l1);
        bytes32 h23  = _pair(l2, l3);
        bytes32 root = _pair(h01, h23);

        bytes32[] memory pr0 = new bytes32[](2);
        pr0[0] = l1; pr0[1] = h23;
        bytes32[] memory pr1 = new bytes32[](2);
        pr1[0] = l0; pr1[1] = h23;
        bytes32[] memory pr2 = new bytes32[](2);
        pr2[0] = l3; pr2[1] = h01;
        bytes32[] memory pr3 = new bytes32[](2);
        pr3[0] = l2; pr3[1] = h01;

        bytes memory settlementPayload = abi.encodePacked(
            uint8(1), AAVE_V3_PRIME, AAVE_V3_CORE, USDC
        );

        bytes memory orderData = abi.encodePacked(root, uint16(settlementPayload.length), settlementPayload);

        bytes memory executionData = abi.encodePacked(
            uint8(2), uint8(2), address(0),
            _action(USDC, type(uint112).max, user, 2, 0, repayData, pr0),
            _action(WETH, type(uint112).max, address(settlement), 3, 0, withdrawData, pr1),
            _action(WETH, 0, user, 0, 0, depositData, pr2),
            _action(USDC, uint112(flashLoanAmount), address(settlement), 1, 0, borrowData, pr3)
        );

        // Sign and execute migration
        uint48 deadline = uint48(block.timestamp + 1 hours);
        bytes memory sig = _signOrder(userPk, root, deadline, settlementPayload);

        settlement.runMigration(
            USDC, flashLoanAmount, deadline, sig, orderData, executionData
        );

        // Verify position migrated from Prime → Core
        uint256 srcDebtAfter = IERC20(vDebtUSDC_src).balanceOf(user);
        uint256 srcCollAfter = IERC20(aWETH_src).balanceOf(user);
        uint256 dstDebtAfter = IERC20(vDebtUSDC_dst).balanceOf(user);
        uint256 dstCollAfter = IERC20(aWETH_dst).balanceOf(user);

        console.log("--- Post-migration ---");
        console.log("Prime aWETH balance    :", srcCollAfter);
        console.log("Prime USDC debt        :", srcDebtAfter);
        console.log("Core  aWETH balance    :", dstCollAfter);
        console.log("Core  USDC debt        :", dstDebtAfter);

        assertEq(srcDebtAfter, 0, "Prime debt should be fully repaid");
        assertEq(srcCollAfter, 0, "Prime collateral should be fully withdrawn");
        assertGt(dstCollAfter, 0, "user should have collateral on Core");
        assertGt(dstDebtAfter, 0, "user should have debt on Core");

        assertEq(IERC20(USDC).balanceOf(address(settlement)), 0, "no USDC left in settlement");
        assertEq(IERC20(WETH).balanceOf(address(settlement)), 0, "no WETH left in settlement");
    }

    // Test: Core → Prime reverts on APR check

    function test_forkMigration_coreToPrime_aprReverts() public {
        if (address(settlement) == address(0)) return;

        vm.deal(user, USER_COLLATERAL + 1 ether);
        vm.startPrank(user);
        IWETH(WETH).deposit{value: USER_COLLATERAL}();
        IERC20(WETH).approve(AAVE_V3_CORE, type(uint256).max);
        IPool(AAVE_V3_CORE).supply(WETH, USER_COLLATERAL, user, 0);
        IPool(AAVE_V3_CORE).borrow(USDC, USER_BORROW, 2, 0, user);
        vm.stopPrank();

        uint128 coreRate  = IPool(AAVE_V3_CORE).getReserveData(USDC).currentVariableBorrowRate;
        uint128 primeRate = IPool(AAVE_V3_PRIME).getReserveData(USDC).currentVariableBorrowRate;
        console.log("Core  USDC borrow rate:", coreRate);
        console.log("Prime USDC borrow rate:", primeRate);
        assertLt(coreRate, primeRate, "Core rate should be lower than Prime");

        vm.startPrank(user);
        IERC20(aWETH_dst).approve(address(settlement), type(uint256).max);
        ICreditDelegation(vDebtUSDC_src).approveDelegation(address(settlement), type(uint256).max);
        vm.stopPrank();

        uint256 flashLoanAmount = IERC20(vDebtUSDC_dst).balanceOf(user);

        bytes memory repayData    = abi.encodePacked(uint8(2), vDebtUSDC_dst, AAVE_V3_CORE);
        bytes memory withdrawData = abi.encodePacked(aWETH_dst, AAVE_V3_CORE);
        bytes memory depositData  = abi.encodePacked(AAVE_V3_PRIME);
        bytes memory borrowData   = abi.encodePacked(uint8(2), AAVE_V3_PRIME);

        bytes32 l0 = _leaf(2, 0, repayData);
        bytes32 l1 = _leaf(3, 0, withdrawData);
        bytes32 l2 = _leaf(0, 0, depositData);
        bytes32 l3 = _leaf(1, 0, borrowData);

        bytes32 h01  = _pair(l0, l1);
        bytes32 h23  = _pair(l2, l3);
        bytes32 root = _pair(h01, h23);

        bytes32[] memory pr0 = new bytes32[](2);
        pr0[0] = l1; pr0[1] = h23;
        bytes32[] memory pr1 = new bytes32[](2);
        pr1[0] = l0; pr1[1] = h23;
        bytes32[] memory pr2 = new bytes32[](2);
        pr2[0] = l3; pr2[1] = h01;
        bytes32[] memory pr3 = new bytes32[](2);
        pr3[0] = l2; pr3[1] = h01;

        bytes memory settlementPayload = abi.encodePacked(
            uint8(1), AAVE_V3_CORE, AAVE_V3_PRIME, USDC
        );

        bytes memory orderData = abi.encodePacked(root, uint16(settlementPayload.length), settlementPayload);

        bytes memory executionData = abi.encodePacked(
            uint8(2), uint8(2), address(0),
            _action(USDC, type(uint112).max, user, 2, 0, repayData, pr0),
            _action(WETH, type(uint112).max, address(settlement), 3, 0, withdrawData, pr1),
            _action(WETH, 0, user, 0, 0, depositData, pr2),
            _action(USDC, uint112(flashLoanAmount), address(settlement), 1, 0, borrowData, pr3)
        );

        uint48 deadline = uint48(block.timestamp + 1 hours);
        bytes memory sig = _signOrder(userPk, root, deadline, settlementPayload);

        vm.expectRevert(AaveV3AprChecker.DestinationRateNotBetter.selector);
        settlement.runMigration(USDC, flashLoanAmount, deadline, sig, orderData, executionData);

        assertGt(IERC20(vDebtUSDC_dst).balanceOf(user), 0, "Core debt unchanged");
        assertGt(IERC20(aWETH_dst).balanceOf(user), 0, "Core collateral unchanged");
    }

    // Test: Invalid merkle proof reverts

    function test_forkMigration_invalidMerkleProof_reverts() public {
        if (address(settlement) == address(0)) return;

        vm.deal(user, USER_COLLATERAL + 1 ether);
        vm.startPrank(user);
        IWETH(WETH).deposit{value: USER_COLLATERAL}();
        IERC20(WETH).approve(AAVE_V3_PRIME, type(uint256).max);
        IPool(AAVE_V3_PRIME).supply(WETH, USER_COLLATERAL, user, 0);
        IPool(AAVE_V3_PRIME).borrow(USDC, USER_BORROW, 2, 0, user);
        vm.stopPrank();

        vm.deal(whale, WHALE_COLLATERAL + 1 ether);
        vm.startPrank(whale);
        IWETH(WETH).deposit{value: WHALE_COLLATERAL}();
        IERC20(WETH).approve(AAVE_V3_PRIME, type(uint256).max);
        IPool(AAVE_V3_PRIME).supply(WETH, WHALE_COLLATERAL, whale, 0);
        IPool(AAVE_V3_PRIME).borrow(USDC, WHALE_BORROW, 2, 0, whale);
        vm.stopPrank();

        vm.startPrank(user);
        IERC20(aWETH_src).approve(address(settlement), type(uint256).max);
        ICreditDelegation(vDebtUSDC_dst).approveDelegation(address(settlement), type(uint256).max);
        vm.stopPrank();

        uint256 flashLoanAmount = IERC20(vDebtUSDC_src).balanceOf(user);

        bytes memory repayData    = abi.encodePacked(uint8(2), vDebtUSDC_src, AAVE_V3_PRIME);
        bytes memory withdrawData = abi.encodePacked(aWETH_src, AAVE_V3_PRIME);
        bytes memory depositData  = abi.encodePacked(AAVE_V3_CORE);
        bytes memory borrowData   = abi.encodePacked(uint8(2), AAVE_V3_CORE);

        bytes32 l0 = _leaf(2, 0, repayData);
        bytes32 l1 = _leaf(3, 0, withdrawData);
        bytes32 l2 = _leaf(0, 0, depositData);
        bytes32 l3 = _leaf(1, 0, borrowData);

        bytes32 h01  = _pair(l0, l1);
        bytes32 h23  = _pair(l2, l3);
        bytes32 root = _pair(h01, h23);

        bytes32[] memory pr0_bad = new bytes32[](2);
        pr0_bad[0] = bytes32(uint256(0xDEAD));
        pr0_bad[1] = h23;
        bytes32[] memory pr1 = new bytes32[](2);
        pr1[0] = l0; pr1[1] = h23;
        bytes32[] memory pr2 = new bytes32[](2);
        pr2[0] = l3; pr2[1] = h01;
        bytes32[] memory pr3 = new bytes32[](2);
        pr3[0] = l2; pr3[1] = h01;

        bytes memory settlementPayload = abi.encodePacked(
            uint8(1), AAVE_V3_PRIME, AAVE_V3_CORE, USDC
        );

        bytes memory orderData = abi.encodePacked(root, uint16(settlementPayload.length), settlementPayload);

        bytes memory executionData = abi.encodePacked(
            uint8(2), uint8(2), address(0),
            _action(USDC, type(uint112).max, user, 2, 0, repayData, pr0_bad),
            _action(WETH, type(uint112).max, address(settlement), 3, 0, withdrawData, pr1),
            _action(WETH, 0, user, 0, 0, depositData, pr2),
            _action(USDC, uint112(flashLoanAmount), address(settlement), 1, 0, borrowData, pr3)
        );

        uint48 deadline = uint48(block.timestamp + 1 hours);
        bytes memory sig = _signOrder(userPk, root, deadline, settlementPayload);

        vm.expectRevert(SettlementExecutor.InvalidMerkleProof.selector);
        settlement.runMigration(USDC, flashLoanAmount, deadline, sig, orderData, executionData);

        assertGt(IERC20(vDebtUSDC_src).balanceOf(user), 0, "Prime debt unchanged");
        assertGt(IERC20(aWETH_src).balanceOf(user), 0, "Prime collateral unchanged");
    }
}
