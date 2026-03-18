// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test, console} from "forge-std/Test.sol";
import {Settlement} from "../src/core/settlement/Settlement.sol";
import {AaveOracleAdapter, IAaveOracle} from "../src/core/settlement/oracle/AaveOracleAdapter.sol";
import {ISettlementPriceOracle} from "../src/core/settlement/oracle/ISettlementPriceOracle.sol";
import {IAaveV3Pool} from "../src/core/settlement/apr/IAaveV3Pool.sol";
import {HealthFactorChecker} from "../src/core/settlement/conditions/HealthFactorChecker.sol";

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

interface IPool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)
        external;
    function getReserveData(address asset) external view returns (IAaveV3Pool.ReserveDataLegacy memory);
    function getUserAccountData(address user)
        external
        view
        returns (
            uint256 totalCollateralBase,
            uint256 totalDebtBase,
            uint256 availableBorrowsBase,
            uint256 currentLiquidationThreshold,
            uint256 ltv,
            uint256 healthFactor
        );
}

interface ICreditDelegation {
    function approveDelegation(address delegatee, uint256 amount) external;
}

interface IWETH {
    function deposit() external payable;
}

contract FixedRateSwapper {
    ISettlementPriceOracle public oracle;

    constructor(address _oracle) {
        oracle = ISettlementPriceOracle(_oracle);
    }

    function swap(address tokenIn, uint256 amountIn, address tokenOut) external {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        uint256 amountOut = oracle.getExpectedOutput(tokenIn, tokenOut, amountIn);
        (bool ok,) = tokenOut.call(abi.encodeWithSelector(IERC20.transfer.selector, msg.sender, amountOut));
        require(ok, "transfer failed");
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Health Factor Condition Fork Tests
// ═══════════════════════════════════════════════════════════════════════════════

contract HealthFactorForkTest is Test {
    // Ethereum mainnet
    address constant AAVE_V3_CORE = 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2;
    address constant MORPHO_BLUE = 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb;
    address constant AAVE_ORACLE = 0x54586bE62E3c3580375aE3723C145253060Ca0C2;
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant WBTC = 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599;

    bytes32 constant MIGRATION_ORDER_TYPEHASH =
        keccak256("MigrationOrder(bytes32 merkleRoot,uint48 deadline,bytes settlementData)");

    Settlement settlement;
    AaveOracleAdapter oracleAdapter;
    FixedRateSwapper swapper;

    address user;
    uint256 userPk;

    address aWETH;
    address aWBTC;
    address vDebtUSDC;

    uint256 constant USER_COLLATERAL = 1 ether;

    // ── Helpers ──────────────────────────────────────────────

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

    function _signOrder(uint256 pk, bytes32 merkleRoot, uint48 deadline, bytes memory settlementPayload)
        internal
        view
        returns (bytes memory)
    {
        bytes32 domainSeparator = settlement.DOMAIN_SEPARATOR();
        bytes32 structHash =
            keccak256(abi.encode(MIGRATION_ORDER_TYPEHASH, merkleRoot, deadline, keccak256(settlementPayload)));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    // ── Setup ────────────────────────────────────────────────

    function setUp() public {
        try vm.envString("ETH_RPC_URL") returns (string memory rpcUrl) {
            vm.createSelectFork(rpcUrl);
        } catch {
            return;
        }

        (user, userPk) = makeAddrAndKey("hfUser");

        settlement = new Settlement();
        oracleAdapter = new AaveOracleAdapter(AAVE_ORACLE);
        swapper = new FixedRateSwapper(address(oracleAdapter));

        IAaveV3Pool.ReserveDataLegacy memory wethData = IPool(AAVE_V3_CORE).getReserveData(WETH);
        aWETH = wethData.aTokenAddress;
        IAaveV3Pool.ReserveDataLegacy memory wbtcData = IPool(AAVE_V3_CORE).getReserveData(WBTC);
        aWBTC = wbtcData.aTokenAddress;
        IAaveV3Pool.ReserveDataLegacy memory usdcData = IPool(AAVE_V3_CORE).getReserveData(USDC);
        vDebtUSDC = usdcData.variableDebtTokenAddress;

        // Settlement approvals
        vm.startPrank(address(settlement));
        IERC20(WETH).approve(AAVE_V3_CORE, type(uint256).max);
        IERC20(USDC).approve(AAVE_V3_CORE, type(uint256).max);
        IERC20(USDC).approve(MORPHO_BLUE, type(uint256).max);
        IERC20(WBTC).approve(AAVE_V3_CORE, type(uint256).max);
        vm.stopPrank();

        // Forwarder approves the mock swapper
        address fwd = address(settlement.forwarder());
        vm.prank(fwd);
        IERC20(WETH).approve(address(swapper), type(uint256).max);

        // User deposits WETH on Aave V3 Core
        vm.deal(user, USER_COLLATERAL + 1 ether);
        vm.startPrank(user);
        IWETH(WETH).deposit{value: USER_COLLATERAL}();
        IERC20(WETH).approve(AAVE_V3_CORE, type(uint256).max);
        IPool(AAVE_V3_CORE).supply(WETH, USER_COLLATERAL, user, 0);
        IERC20(aWETH).approve(address(settlement), type(uint256).max);
        vm.stopPrank();

        // Fund the mock swapper with WBTC for collateral swap tests
        deal(WBTC, address(swapper), 10e8);
    }

    // ═══════════════════════════════════════════════════════════
    //  Helper: build a collateral swap settlement (WETH -> WBTC)
    //  with the given health factor condition.
    //  Returns (orderData, executionData, fillerCalldata, settlementPayload, merkleRoot)
    // ═══════════════════════════════════════════════════════════

    struct SettlementParams {
        bytes orderData;
        bytes executionData;
        bytes fillerCalldata;
        bytes settlementPayload;
        bytes32 merkleRoot;
    }

    function _buildCollateralSwapSettlement(uint112 minHF) internal view returns (SettlementParams memory p) {
        uint256 userDebt = IERC20(vDebtUSDC).balanceOf(user);
        uint256 swapAll = IERC20(aWETH).balanceOf(user);

        bytes memory repayData = abi.encodePacked(uint8(2), vDebtUSDC, AAVE_V3_CORE);
        bytes memory withdrawData = abi.encodePacked(aWETH, AAVE_V3_CORE);
        bytes memory depositData = abi.encodePacked(AAVE_V3_CORE);
        bytes memory borrowData = abi.encodePacked(uint8(2), AAVE_V3_CORE);

        bytes32 l0 = _leaf(2, 0, repayData);
        bytes32 l1 = _leaf(3, 0, withdrawData);
        bytes32 l2 = _leaf(0, 0, depositData);
        bytes32 l3 = _leaf(1, 0, borrowData);

        bytes32 h01 = _pair(l0, l1);
        bytes32 h23 = _pair(l2, l3);
        bytes32 root = _pair(h01, h23);
        p.merkleRoot = root;

        bytes32[] memory pr0 = new bytes32[](2);
        pr0[0] = l1;
        pr0[1] = h23;
        bytes32[] memory pr1 = new bytes32[](2);
        pr1[0] = l0;
        pr1[1] = h23;
        bytes32[] memory pr2 = new bytes32[](2);
        pr2[0] = l3;
        pr2[1] = h01;
        bytes32[] memory pr3 = new bytes32[](2);
        pr3[0] = l2;
        pr3[1] = h01;

        // settlementData: 1 conversion (WETH->WBTC) + 1 condition (health factor)
        p.settlementPayload = abi.encodePacked(
            uint8(1),
            WETH,
            WBTC,
            address(oracleAdapter),
            uint64(50_000), // 0.5% swap tolerance
            uint8(1), // numConditions = 1
            uint16(0), // lenderId = 0 (Aave V3)
            AAVE_V3_CORE, // pool
            minHF // minHealthFactor (uint112, 14 bytes)
        );

        p.orderData = abi.encodePacked(root, uint16(p.settlementPayload.length), p.settlementPayload);

        bytes memory swapCalldata = abi.encodeCall(FixedRateSwapper.swap, (WETH, swapAll, WBTC));
        p.fillerCalldata = abi.encodePacked(
            WETH, WBTC, uint112(swapAll), address(swapper), uint16(swapCalldata.length), swapCalldata
        );

        p.executionData = abi.encodePacked(
            uint8(2),
            uint8(2),
            address(0),
            _action(USDC, type(uint112).max, user, 2, 0, repayData, pr0),
            _action(WETH, type(uint112).max, address(settlement), 3, 0, withdrawData, pr1),
            _action(WBTC, 0, user, 0, 0, depositData, pr2),
            _action(USDC, uint112(userDebt), address(settlement), 1, 0, borrowData, pr3)
        );
    }

    // ═══════════════════════════════════════════════════════════
    //  Test 1: Health factor passes — collateral swap with
    //  reasonable minHF succeeds
    // ═══════════════════════════════════════════════════════════

    function test_healthFactor_passes() public {
        if (address(settlement) == address(0)) return;

        // Borrow ~50% LTV
        uint256 wethPrice = IAaveOracle(AAVE_ORACLE).getAssetPrice(WETH);
        uint256 usdcBorrow = (wethPrice * 50) / (100 * 1e2);

        vm.startPrank(user);
        IPool(AAVE_V3_CORE).borrow(USDC, usdcBorrow, 2, 0, user);
        ICreditDelegation(vDebtUSDC).approveDelegation(address(settlement), type(uint256).max);
        vm.stopPrank();

        (, uint256 totalDebtBase,,,, uint256 hfBefore) = IPool(AAVE_V3_CORE).getUserAccountData(user);
        console.log("--- Pre-settlement ---");
        console.log("User aWETH      :", IERC20(aWETH).balanceOf(user));
        console.log("User USDC debt  :", IERC20(vDebtUSDC).balanceOf(user));
        console.log("Health factor   :", hfBefore);
        console.log("Total debt base :", totalDebtBase);

        // minHF = 1.2 — should pass after collateral swap (same debt, different collateral)
        SettlementParams memory p = _buildCollateralSwapSettlement(uint112(1.2e18));
        uint256 flashAmount = IERC20(vDebtUSDC).balanceOf(user);

        uint48 deadline = uint48(block.timestamp + 1 hours);
        bytes memory sig = _signOrder(userPk, p.merkleRoot, deadline, p.settlementPayload);

        settlement.settleWithFlashLoan(
            USDC,
            flashAmount,
            MORPHO_BLUE,
            0,
            0,
            deadline,
            sig,
            p.orderData,
            p.executionData,
            p.fillerCalldata
        );

        (,,,,,uint256 hfAfter) = IPool(AAVE_V3_CORE).getUserAccountData(user);

        console.log("--- Post-settlement ---");
        console.log("User aWETH      :", IERC20(aWETH).balanceOf(user));
        console.log("User aWBTC      :", IERC20(aWBTC).balanceOf(user));
        console.log("User USDC debt  :", IERC20(vDebtUSDC).balanceOf(user));
        console.log("Health factor   :", hfAfter);

        assertEq(IERC20(aWETH).balanceOf(user), 0, "all WETH withdrawn");
        assertGt(IERC20(aWBTC).balanceOf(user), 0, "user has WBTC collateral");
        assertGt(hfAfter, 1.2e18, "health factor above minimum");
    }

    // ═══════════════════════════════════════════════════════════
    //  Test 2: Health factor reverts — minHF set unreasonably
    //  high so settlement fails post-condition
    // ═══════════════════════════════════════════════════════════

    function test_healthFactor_reverts_belowMinimum() public {
        if (address(settlement) == address(0)) return;

        // Borrow ~50% LTV
        uint256 wethPrice = IAaveOracle(AAVE_ORACLE).getAssetPrice(WETH);
        uint256 usdcBorrow = (wethPrice * 50) / (100 * 1e2);

        vm.startPrank(user);
        IPool(AAVE_V3_CORE).borrow(USDC, usdcBorrow, 2, 0, user);
        ICreditDelegation(vDebtUSDC).approveDelegation(address(settlement), type(uint256).max);
        vm.stopPrank();

        // minHF = 50 — unreasonably high, guaranteed to fail
        SettlementParams memory p = _buildCollateralSwapSettlement(uint112(50e18));
        uint256 flashAmount = IERC20(vDebtUSDC).balanceOf(user);

        uint48 deadline = uint48(block.timestamp + 1 hours);
        bytes memory sig = _signOrder(userPk, p.merkleRoot, deadline, p.settlementPayload);

        vm.expectRevert(HealthFactorChecker.HealthFactorTooLow.selector);
        settlement.settleWithFlashLoan(
            USDC,
            flashAmount,
            MORPHO_BLUE,
            0,
            0,
            deadline,
            sig,
            p.orderData,
            p.executionData,
            p.fillerCalldata
        );
    }

    // ═══════════════════════════════════════════════════════════
    //  Test 3: No conditions — backward compatibility
    //  settlementData has no conditions section, works as before
    // ═══════════════════════════════════════════════════════════

    function test_healthFactor_noConditions_backwardCompat() public {
        if (address(settlement) == address(0)) return;

        // Borrow ~50% LTV
        uint256 wethPrice = IAaveOracle(AAVE_ORACLE).getAssetPrice(WETH);
        uint256 usdcBorrow = (wethPrice * 50) / (100 * 1e2);

        vm.startPrank(user);
        IPool(AAVE_V3_CORE).borrow(USDC, usdcBorrow, 2, 0, user);
        ICreditDelegation(vDebtUSDC).approveDelegation(address(settlement), type(uint256).max);
        vm.stopPrank();

        uint256 userDebt = IERC20(vDebtUSDC).balanceOf(user);
        uint256 swapAll = IERC20(aWETH).balanceOf(user);

        bytes memory repayData = abi.encodePacked(uint8(2), vDebtUSDC, AAVE_V3_CORE);
        bytes memory withdrawData = abi.encodePacked(aWETH, AAVE_V3_CORE);
        bytes memory depositData = abi.encodePacked(AAVE_V3_CORE);
        bytes memory borrowData = abi.encodePacked(uint8(2), AAVE_V3_CORE);

        bytes32 l0 = _leaf(2, 0, repayData);
        bytes32 l1 = _leaf(3, 0, withdrawData);
        bytes32 l2 = _leaf(0, 0, depositData);
        bytes32 l3 = _leaf(1, 0, borrowData);

        bytes32 h01 = _pair(l0, l1);
        bytes32 h23 = _pair(l2, l3);
        bytes32 root = _pair(h01, h23);

        bytes32[] memory pr0 = new bytes32[](2);
        pr0[0] = l1;
        pr0[1] = h23;
        bytes32[] memory pr1 = new bytes32[](2);
        pr1[0] = l0;
        pr1[1] = h23;
        bytes32[] memory pr2 = new bytes32[](2);
        pr2[0] = l3;
        pr2[1] = h01;
        bytes32[] memory pr3 = new bytes32[](2);
        pr3[0] = l2;
        pr3[1] = h01;

        // settlementData WITHOUT conditions (old format)
        bytes memory settlementPayload = abi.encodePacked(
            uint8(1), WETH, WBTC, address(oracleAdapter), uint64(50_000)
        );

        bytes memory orderData = abi.encodePacked(root, uint16(settlementPayload.length), settlementPayload);

        bytes memory swapCalldata = abi.encodeCall(FixedRateSwapper.swap, (WETH, swapAll, WBTC));
        bytes memory fillerCalldata = abi.encodePacked(
            WETH, WBTC, uint112(swapAll), address(swapper), uint16(swapCalldata.length), swapCalldata
        );

        bytes memory executionData = abi.encodePacked(
            uint8(2),
            uint8(2),
            address(0),
            _action(USDC, type(uint112).max, user, 2, 0, repayData, pr0),
            _action(WETH, type(uint112).max, address(settlement), 3, 0, withdrawData, pr1),
            _action(WBTC, 0, user, 0, 0, depositData, pr2),
            _action(USDC, uint112(userDebt), address(settlement), 1, 0, borrowData, pr3)
        );

        uint48 deadline = uint48(block.timestamp + 1 hours);
        bytes memory sig = _signOrder(userPk, root, deadline, settlementPayload);

        settlement.settleWithFlashLoan(
            USDC, userDebt, MORPHO_BLUE, 0, 0, deadline, sig, orderData, executionData, fillerCalldata
        );

        assertEq(IERC20(aWETH).balanceOf(user), 0, "all WETH withdrawn");
        assertGt(IERC20(aWBTC).balanceOf(user), 0, "user has WBTC collateral");
        console.log("Backward compat: collateral swap succeeded without conditions");
    }

    // ═══════════════════════════════════════════════════════════
    //  Test 4: No debt — health factor is max, any condition passes
    // ═══════════════════════════════════════════════════════════

    function test_healthFactor_noDebt_alwaysPasses() public {
        if (address(settlement) == address(0)) return;

        // No borrow — user only has 1 WETH collateral, no debt
        // Simple withdraw + deposit (no swap needed, same asset)
        bytes memory withdrawData = abi.encodePacked(aWETH, AAVE_V3_CORE);
        bytes memory depositData = abi.encodePacked(AAVE_V3_CORE);

        bytes32 l0 = _leaf(3, 0, withdrawData);
        bytes32 l1 = _leaf(0, 0, depositData);
        bytes32 root = _pair(l0, l1);

        bytes32[] memory pr0 = new bytes32[](1);
        pr0[0] = l1;
        bytes32[] memory pr1 = new bytes32[](1);
        pr1[0] = l0;

        // settlementData: 0 conversions + 1 condition with very high minHF
        bytes memory settlementPayload = abi.encodePacked(
            uint8(0), // numConversions = 0
            uint8(1), // numConditions = 1
            uint16(0), // lenderId = 0 (Aave V3)
            AAVE_V3_CORE, // pool
            uint112(100e18) // minHF = 100 (absurdly high, but should pass with no debt)
        );

        bytes memory orderData = abi.encodePacked(root, uint16(settlementPayload.length), settlementPayload);

        bytes memory executionData = abi.encodePacked(
            uint8(1),
            uint8(1),
            address(0),
            _action(WETH, type(uint112).max, address(settlement), 3, 0, withdrawData, pr0),
            _action(WETH, 0, user, 0, 0, depositData, pr1)
        );

        uint48 deadline = uint48(block.timestamp + 1 hours);
        bytes memory sig = _signOrder(userPk, root, deadline, settlementPayload);

        // Empty fillerCalldata — no swap
        settlement.settle(0, deadline, sig, orderData, executionData, "");

        (,,,,,uint256 hfAfter) = IPool(AAVE_V3_CORE).getUserAccountData(user);
        assertEq(hfAfter, type(uint256).max, "health factor is max with no debt");
        console.log("No-debt test passed: HF = type(uint256).max");
    }
}
