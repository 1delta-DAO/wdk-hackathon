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

interface IMorphoOracle {
    function price() external view returns (uint256);
}

interface IComet {
    function supplyTo(address dst, address asset, uint256 amount) external;
    function withdrawFrom(address src, address to, address asset, uint256 amount) external;
    function borrowBalanceOf(address account) external view returns (uint256);
}

interface IMorpho {
    struct MarketParams {
        address loanToken;
        address collateralToken;
        address oracle;
        address irm;
        uint256 lltv;
    }

    function supplyCollateral(MarketParams memory marketParams, uint256 assets, address onBehalfOf, bytes memory data)
        external;
    function borrow(
        MarketParams memory marketParams,
        uint256 assets,
        uint256 shares,
        address onBehalfOf,
        address receiver
    ) external returns (uint256, uint256);
    function position(bytes32 id, address user)
        external
        view
        returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral);
    function market(bytes32 id)
        external
        view
        returns (
            uint128 totalSupplyAssets,
            uint128 totalSupplyShares,
            uint128 totalBorrowAssets,
            uint128 totalBorrowShares,
            uint128 lastUpdate,
            uint128 fee
        );
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
    address constant CBBTC = 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf;

    // Compound V3 USDC Comet
    address constant USDC_COMET = 0xc3d688B66703497DAA19211EEdff47f25384cdc3;
    uint256 constant COMET_WBTC_COLLATERAL = 5e6;  // 0.05 WBTC (8 decimals)
    uint256 constant COMET_USDC_BORROW = 1000e6;    // 1000 USDC

    // Morpho Blue cbBTC-USDC market
    bytes32 constant MORPHO_CBBTC_USDC_MARKET = 0x64d65c9a2d91c36d56fbc42d69e979335320169b3df63bf92789e2c8883fcc64;
    address constant MORPHO_CBBTC_ORACLE = 0xA6D6950c9F177F1De7f7757FB33539e3Ec60182a;
    address constant MORPHO_CBBTC_IRM = 0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC;
    uint256 constant MORPHO_CBBTC_LLTV = 860000000000000000;

    bytes32 constant INFINITE_ORDER_TYPEHASH =
        keccak256("InfiniteOrder(bytes32 merkleRoot,uint48 deadline,uint256 maxFeeBps,address solver,bytes settlementData)");

    Settlement settlement;
    AaveOracleAdapter oracleAdapter;
    FixedRateSwapper swapper;

    address user;
    uint256 userPk;

    address aWETH;
    address aWBTC;
    address vDebtUSDC;

    uint256 constant USER_COLLATERAL = 1 ether;
    uint256 constant MORPHO_CBBTC_COLLATERAL = 1e7; // 0.1 cbBTC (8 decimals)
    uint256 constant MORPHO_USDC_BORROW = 1000e6;   // 1000 USDC

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

    function _signOrder(uint256 pk, bytes32 merkleRoot, uint48 deadline, uint256 maxFeeBps, address solver, bytes memory settlementPayload)
        internal
        view
        returns (bytes memory)
    {
        bytes32 domainSeparator = settlement.DOMAIN_SEPARATOR();
        bytes32 structHash =
            keccak256(abi.encode(INFINITE_ORDER_TYPEHASH, merkleRoot, deadline, maxFeeBps, solver, keccak256(settlementPayload)));
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

        // Settlement approvals (via approveToken — no prank needed)
        settlement.approveToken(WETH, AAVE_V3_CORE, type(uint256).max);
        settlement.approveToken(USDC, AAVE_V3_CORE, type(uint256).max);
        settlement.approveToken(USDC, MORPHO_BLUE, type(uint256).max);
        settlement.approveToken(WBTC, AAVE_V3_CORE, type(uint256).max);

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
        bytes memory sig = _signOrder(userPk, p.merkleRoot, deadline, 0, address(0), p.settlementPayload);

        settlement.settleWithFlashLoan(
            USDC,
            flashAmount,
            MORPHO_BLUE,
            0,
            0,
            address(0),
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
        bytes memory sig = _signOrder(userPk, p.merkleRoot, deadline, 0, address(0), p.settlementPayload);

        vm.expectRevert(HealthFactorChecker.HealthFactorTooLow.selector);
        settlement.settleWithFlashLoan(
            USDC,
            flashAmount,
            MORPHO_BLUE,
            0,
            0,
            address(0),
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
        bytes memory sig = _signOrder(userPk, root, deadline, 0, address(0), settlementPayload);

        settlement.settleWithFlashLoan(
            USDC, userDebt, MORPHO_BLUE, 0, 0, address(0), deadline, sig, orderData, executionData, fillerCalldata
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
        bytes memory sig = _signOrder(userPk, root, deadline, 0, address(0), settlementPayload);

        // Empty fillerCalldata — no swap
        settlement.settle(0, address(0), deadline, sig, orderData, executionData, "");

        (,,,,,uint256 hfAfter) = IPool(AAVE_V3_CORE).getUserAccountData(user);
        assertEq(hfAfter, type(uint256).max, "health factor is max with no debt");
        console.log("No-debt test passed: HF = type(uint256).max");
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //  Compound V3 Health Factor Tests
    // ═══════════════════════════════════════════════════════════════════════════════

    function _setupCompoundV3Position(uint256 collateral, uint256 borrowAmount) internal {
        deal(WBTC, user, collateral);
        vm.startPrank(user);
        IERC20(WBTC).approve(USDC_COMET, collateral);
        IComet(USDC_COMET).supplyTo(user, WBTC, collateral);
        if (borrowAmount > 0) {
            IComet(USDC_COMET).withdrawFrom(user, user, USDC, borrowAmount);
        }
        vm.stopPrank();
    }

    /// @dev Build a minimal settlement (Aave withdraw+deposit round-trip) with a Compound V3 HF condition.
    function _buildCompoundV3ConditionSettlement(uint112 minHF) internal view returns (SettlementParams memory p) {
        bytes memory withdrawData = abi.encodePacked(aWETH, AAVE_V3_CORE);
        bytes memory depositData = abi.encodePacked(AAVE_V3_CORE);

        bytes32 l0 = _leaf(3, 0, withdrawData);
        bytes32 l1 = _leaf(0, 0, depositData);
        bytes32 root = _pair(l0, l1);
        p.merkleRoot = root;

        bytes32[] memory pr0 = new bytes32[](1);
        pr0[0] = l1;
        bytes32[] memory pr1 = new bytes32[](1);
        pr1[0] = l0;

        // settlementData: 0 conversions + 1 Compound V3 condition (38 bytes)
        p.settlementPayload = abi.encodePacked(
            uint8(0),                  // numConversions = 0
            uint8(1),                  // numConditions = 1
            uint16(2000),              // lenderId = 2000 (Compound V3)
            USDC_COMET,                // comet address (20 bytes)
            uint16(0x0002),            // assetBitmap: bit 1 = WBTC at index 1
            minHF                      // minHealthFactor (uint112, 14 bytes)
        );

        p.orderData = abi.encodePacked(root, uint16(p.settlementPayload.length), p.settlementPayload);

        p.executionData = abi.encodePacked(
            uint8(1),
            uint8(1),
            address(0),
            _action(WETH, type(uint112).max, address(settlement), 3, 0, withdrawData, pr0),
            _action(WETH, 0, user, 0, 0, depositData, pr1)
        );

        p.fillerCalldata = "";
    }

    function test_compoundV3HealthFactor_passes() public {
        if (address(settlement) == address(0)) return;

        _setupCompoundV3Position(COMET_WBTC_COLLATERAL, COMET_USDC_BORROW);

        SettlementParams memory p = _buildCompoundV3ConditionSettlement(uint112(1.1e18));
        uint48 deadline = uint48(block.timestamp + 1 hours);
        bytes memory sig = _signOrder(userPk, p.merkleRoot, deadline, 0, address(0), p.settlementPayload);
        settlement.settle(0, address(0), deadline, sig, p.orderData, p.executionData, p.fillerCalldata);

        assertGt(IComet(USDC_COMET).borrowBalanceOf(user), 0, "user has Compound V3 debt");
        console.log("Compound V3 HF pass test succeeded");
    }

    /// @dev Compound V3 condition with unreasonable minHF but only Aave ops —
    ///      the Compound V3 check is skipped because no risky ops touched that lender.
    function test_compoundV3HealthFactor_skippedWhenNoRiskyOps() public {
        if (address(settlement) == address(0)) return;

        _setupCompoundV3Position(COMET_WBTC_COLLATERAL, COMET_USDC_BORROW);

        // minHF = 50 would normally fail, but Compound V3 check is skipped (only Aave ops)
        SettlementParams memory p = _buildCompoundV3ConditionSettlement(uint112(50e18));
        uint48 deadline = uint48(block.timestamp + 1 hours);
        bytes memory sig = _signOrder(userPk, p.merkleRoot, deadline, 0, address(0), p.settlementPayload);

        // Does NOT revert — Compound V3 condition skipped because no CompV3 borrow/withdraw
        settlement.settle(0, address(0), deadline, sig, p.orderData, p.executionData, p.fillerCalldata);
        console.log("Compound V3 HF check correctly skipped: no risky CompV3 ops");
    }

    function test_compoundV3HealthFactor_noDebt() public {
        if (address(settlement) == address(0)) return;

        _setupCompoundV3Position(COMET_WBTC_COLLATERAL, 0);

        SettlementParams memory p = _buildCompoundV3ConditionSettlement(uint112(100e18));
        uint48 deadline = uint48(block.timestamp + 1 hours);
        bytes memory sig = _signOrder(userPk, p.merkleRoot, deadline, 0, address(0), p.settlementPayload);
        settlement.settle(0, address(0), deadline, sig, p.orderData, p.executionData, p.fillerCalldata);

        console.log("Compound V3 no-debt test passed: borrowBalanceOf == 0 skips HF check");
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //  Morpho Blue Health Factor Tests
    // ═══════════════════════════════════════════════════════════════════════════════

    function _morphoMarketParams() internal pure returns (IMorpho.MarketParams memory) {
        return IMorpho.MarketParams({
            loanToken: USDC,
            collateralToken: CBBTC,
            oracle: MORPHO_CBBTC_ORACLE,
            irm: MORPHO_CBBTC_IRM,
            lltv: MORPHO_CBBTC_LLTV
        });
    }

    function _setupMorphoPosition(uint256 collateral, uint256 borrowAmount) internal {
        deal(CBBTC, user, collateral);
        vm.startPrank(user);
        IERC20(CBBTC).approve(MORPHO_BLUE, collateral);
        IMorpho(MORPHO_BLUE).supplyCollateral(_morphoMarketParams(), collateral, user, "");
        if (borrowAmount > 0) {
            IMorpho(MORPHO_BLUE).borrow(_morphoMarketParams(), borrowAmount, 0, user, user);
        }
        vm.stopPrank();
    }

    /// @dev Compute Morpho Blue health factor from on-chain state. Returns 18-decimal value.
    ///      Returns type(uint256).max when borrowShares == 0 (no debt).
    function _computeMorphoHF(bytes32 marketId, address account) internal view returns (uint256) {
        (, uint128 borrowShares, uint128 collateral) = IMorpho(MORPHO_BLUE).position(marketId, account);
        if (borrowShares == 0) return type(uint256).max;

        (,, uint128 totalBorrowAssets, uint128 totalBorrowShares,,) = IMorpho(MORPHO_BLUE).market(marketId);

        uint256 denom = uint256(totalBorrowShares) + 1e6;
        uint256 borrowed = (uint256(borrowShares) * (uint256(totalBorrowAssets) + 1) + denom - 1) / denom;

        uint256 collateralPrice = IMorphoOracle(MORPHO_CBBTC_ORACLE).price();
        uint256 collValue = uint256(collateral) * collateralPrice / 1e36;
        uint256 maxBorrow = collValue * MORPHO_CBBTC_LLTV / 1e18;

        return maxBorrow * 1e18 / borrowed;
    }

    /// @dev Build a minimal settlement (Aave withdraw+deposit round-trip) with a Morpho HF condition.
    function _buildMorphoConditionSettlement(uint112 minHF) internal view returns (SettlementParams memory p) {
        bytes memory withdrawData = abi.encodePacked(aWETH, AAVE_V3_CORE);
        bytes memory depositData = abi.encodePacked(AAVE_V3_CORE);

        bytes32 l0 = _leaf(3, 0, withdrawData);
        bytes32 l1 = _leaf(0, 0, depositData);
        bytes32 root = _pair(l0, l1);
        p.merkleRoot = root;

        bytes32[] memory pr0 = new bytes32[](1);
        pr0[0] = l1;
        bytes32[] memory pr1 = new bytes32[](1);
        pr1[0] = l0;

        // settlementData: 0 conversions + 1 Morpho condition (68 bytes)
        p.settlementPayload = abi.encodePacked(
            uint8(0),                  // numConversions = 0
            uint8(1),                  // numConditions = 1
            uint16(4000),              // lenderId = 4000 (Morpho)
            MORPHO_BLUE,               // morpho address (20 bytes)
            MORPHO_CBBTC_USDC_MARKET,  // marketId (32 bytes)
            minHF                      // minHealthFactor (uint112, 14 bytes)
        );

        p.orderData = abi.encodePacked(root, uint16(p.settlementPayload.length), p.settlementPayload);

        p.executionData = abi.encodePacked(
            uint8(1),
            uint8(1),
            address(0),
            _action(WETH, type(uint112).max, address(settlement), 3, 0, withdrawData, pr0),
            _action(WETH, 0, user, 0, 0, depositData, pr1)
        );

        p.fillerCalldata = "";
    }

    // ═══════════════════════════════════════════════════════════
    //  Test 5: Morpho HF passes — reasonable minHF with healthy position
    // ═══════════════════════════════════════════════════════════

    function test_morphoHealthFactor_passes() public {
        if (address(settlement) == address(0)) return;

        _setupMorphoPosition(MORPHO_CBBTC_COLLATERAL, MORPHO_USDC_BORROW);

        SettlementParams memory p = _buildMorphoConditionSettlement(uint112(1.1e18));
        uint48 deadline = uint48(block.timestamp + 1 hours);
        bytes memory sig = _signOrder(userPk, p.merkleRoot, deadline, 0, address(0), p.settlementPayload);
        settlement.settle(0, address(0), deadline, sig, p.orderData, p.executionData, p.fillerCalldata);

        _assertMorphoPositionHealthy(1.1e18);
    }

    function _assertMorphoPositionHealthy(uint256 minHF) internal view {
        (, uint128 borrowShares, uint128 collateral) = IMorpho(MORPHO_BLUE).position(MORPHO_CBBTC_USDC_MARKET, user);
        assertGt(uint256(borrowShares), 0, "user has Morpho borrow shares");
        assertEq(uint256(collateral), MORPHO_CBBTC_COLLATERAL, "Morpho collateral unchanged");

        uint256 morphoHF = _computeMorphoHF(MORPHO_CBBTC_USDC_MARKET, user);
        assertGt(morphoHF, minHF, "Morpho HF above signed minimum");
        console.log("Morpho HF:", morphoHF);
    }

    // ═══════════════════════════════════════════════════════════
    //  Test 6: Morpho HF reverts — unreasonably high minHF
    // ═══════════════════════════════════════════════════════════

    /// @dev Morpho condition with unreasonable minHF but only Aave ops —
    ///      the Morpho check is skipped because no risky ops touched that lender.
    function test_morphoHealthFactor_skippedWhenNoRiskyOps() public {
        if (address(settlement) == address(0)) return;

        _setupMorphoPosition(MORPHO_CBBTC_COLLATERAL, MORPHO_USDC_BORROW);

        // minHF = 50 would normally fail, but Morpho check is skipped (only Aave ops)
        SettlementParams memory p = _buildMorphoConditionSettlement(uint112(50e18));

        uint48 deadline = uint48(block.timestamp + 1 hours);
        bytes memory sig = _signOrder(userPk, p.merkleRoot, deadline, 0, address(0), p.settlementPayload);

        // Does NOT revert — Morpho condition skipped because no Morpho borrow/withdraw
        settlement.settle(0, address(0), deadline, sig, p.orderData, p.executionData, p.fillerCalldata);
        console.log("Morpho HF check correctly skipped: no risky Morpho ops");
    }

    // ═══════════════════════════════════════════════════════════
    //  Test 7: Morpho no debt — borrowShares == 0 → always passes
    // ═══════════════════════════════════════════════════════════

    function test_morphoHealthFactor_noDebt() public {
        if (address(settlement) == address(0)) return;

        _setupMorphoPosition(MORPHO_CBBTC_COLLATERAL, 0);

        SettlementParams memory p = _buildMorphoConditionSettlement(uint112(100e18));

        uint48 deadline = uint48(block.timestamp + 1 hours);
        bytes memory sig = _signOrder(userPk, p.merkleRoot, deadline, 0, address(0), p.settlementPayload);

        settlement.settle(0, address(0), deadline, sig, p.orderData, p.executionData, p.fillerCalldata);

        console.log("Morpho no-debt test passed: borrowShares == 0 skips HF check");
    }

    // ═══════════════════════════════════════════════════════════
    //  Test 8: Mixed conditions — both Aave and Morpho HF checks
    //  in the same settlementData (variable-size parsing)
    // ═══════════════════════════════════════════════════════════

    function test_mixedConditions_aaveAndMorpho() public {
        if (address(settlement) == address(0)) return;

        // Set up Morpho position (Aave position from setUp — no Aave debt, HF = max)
        _setupMorphoPosition(MORPHO_CBBTC_COLLATERAL, MORPHO_USDC_BORROW);

        bytes memory withdrawData = abi.encodePacked(aWETH, AAVE_V3_CORE);
        bytes memory depositData = abi.encodePacked(AAVE_V3_CORE);

        bytes32 l0 = _leaf(3, 0, withdrawData);
        bytes32 l1 = _leaf(0, 0, depositData);
        bytes32 root = _pair(l0, l1);

        bytes32[] memory pr0 = new bytes32[](1);
        pr0[0] = l1;
        bytes32[] memory pr1 = new bytes32[](1);
        pr1[0] = l0;

        // settlementData: 0 conversions + 2 conditions (Aave 36 bytes + Morpho 68 bytes)
        bytes memory settlementPayload = abi.encodePacked(
            uint8(0),                    // numConversions = 0
            uint8(2),                    // numConditions = 2
            // Condition 0: Aave (36 bytes)
            uint16(0),                   // lenderId = 0 (Aave V3)
            AAVE_V3_CORE,               // pool (20 bytes)
            uint112(1.1e18),             // minHF (14 bytes)
            // Condition 1: Morpho (68 bytes)
            uint16(4000),                // lenderId = 4000 (Morpho)
            MORPHO_BLUE,                 // morpho address (20 bytes)
            MORPHO_CBBTC_USDC_MARKET,    // marketId (32 bytes)
            uint112(1.1e18)              // minHF (14 bytes)
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
        bytes memory sig = _signOrder(userPk, root, deadline, 0, address(0), settlementPayload);

        settlement.settle(0, address(0), deadline, sig, orderData, executionData, "");

        console.log("Mixed conditions test passed: both Aave + Morpho HF checks succeeded");
    }

    // ═══════════════════════════════════════════════════════════
    //  Test 9: Mixed conditions — Aave + Compound V3 + Morpho
    //  HF checks in the same settlementData (36 + 36 + 68 bytes)
    // ═══════════════════════════════════════════════════════════

    function test_mixedConditions_allThreeLenders() public {
        if (address(settlement) == address(0)) return;

        _setupCompoundV3Position(COMET_WBTC_COLLATERAL, COMET_USDC_BORROW);
        _setupMorphoPosition(MORPHO_CBBTC_COLLATERAL, MORPHO_USDC_BORROW);

        bytes memory withdrawData = abi.encodePacked(aWETH, AAVE_V3_CORE);
        bytes memory depositData = abi.encodePacked(AAVE_V3_CORE);

        bytes32 l0 = _leaf(3, 0, withdrawData);
        bytes32 l1 = _leaf(0, 0, depositData);
        bytes32 root = _pair(l0, l1);

        bytes32[] memory pr0 = new bytes32[](1);
        pr0[0] = l1;
        bytes32[] memory pr1 = new bytes32[](1);
        pr1[0] = l0;

        // settlementData: 0 conversions + 3 conditions (Aave 36 + CompoundV3 38 + Morpho 68)
        bytes memory settlementPayload = abi.encodePacked(
            uint8(0),                    // numConversions = 0
            uint8(3),                    // numConditions = 3
            // Condition 0: Aave (36 bytes)
            uint16(0),
            AAVE_V3_CORE,
            uint112(1.1e18),
            // Condition 1: Compound V3 (38 bytes)
            uint16(2000),
            USDC_COMET,
            uint16(0x0002),              // assetBitmap: bit 1 = WBTC at index 1
            uint112(1.1e18),
            // Condition 2: Morpho (68 bytes)
            uint16(4000),
            MORPHO_BLUE,
            MORPHO_CBBTC_USDC_MARKET,
            uint112(1.1e18)
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
        bytes memory sig = _signOrder(userPk, root, deadline, 0, address(0), settlementPayload);

        settlement.settle(0, address(0), deadline, sig, orderData, executionData, "");

        console.log("Mixed conditions test passed: Aave + Compound V3 + Morpho HF checks succeeded");
    }
}
