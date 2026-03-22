// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test, console} from "forge-std/Test.sol";
import {Settlement} from "../src/core/settlement/Settlement.sol";
import {SettlementForwarder} from "../src/core/settlement/SettlementForwarder.sol";
import {AaveOracleAdapter, IAaveOracle, IERC20Decimals} from
    "../src/core/settlement/oracle/AaveOracleAdapter.sol";
import {ISettlementPriceOracle} from "../src/core/settlement/oracle/ISettlementPriceOracle.sol";
import {IAaveV3Pool} from "../src/core/settlement/apr/IAaveV3Pool.sol";
import {SettlementExecutor} from "../src/core/settlement/SettlementExecutor.sol";
import {EIP712OrderVerifier} from "../src/core/settlement/EIP712OrderVerifier.sol";
import {SwapVerifier} from "../src/core/settlement/oracle/SwapVerifier.sol";

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

interface IPool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
    function getReserveData(address asset) external view returns (IAaveV3Pool.ReserveDataLegacy memory);
}

interface ICreditDelegation {
    function approveDelegation(address delegatee, uint256 amount) external;
}

interface IWETH {
    function deposit() external payable;
}

/**
 * @title FixedRateSwapper
 * @notice Test mock: swaps tokenIn → tokenOut at the exact oracle rate.
 *         Pre-funded with output tokens.  Pulls input via transferFrom
 *         (caller must have approved this contract).
 */
contract FixedRateSwapper {
    ISettlementPriceOracle public oracle;

    constructor(address _oracle) {
        oracle = ISettlementPriceOracle(_oracle);
    }

    function swap(address tokenIn, uint256 amountIn, address tokenOut) external {
        // type(uint256).max sentinel: use caller's full balance
        if (amountIn == type(uint256).max) {
            amountIn = IERC20(tokenIn).balanceOf(msg.sender);
        }
        // Pull input from caller (the forwarder)
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);

        // Calculate output at exact oracle rate
        uint256 amountOut = oracle.getExpectedOutput(tokenIn, tokenOut, amountIn);

        // Send output to caller (low-level call for non-standard tokens like USDT)
        (bool ok,) = tokenOut.call(abi.encodeWithSelector(IERC20.transfer.selector, msg.sender, amountOut));
        require(ok, "transfer failed");
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Oracle adapter unit tests (against live mainnet oracle)
// ═══════════════════════════════════════════════════════════════════════════════

contract OracleAdapterForkTest is Test {
    address constant AAVE_ORACLE = 0x54586bE62E3c3580375aE3723C145253060Ca0C2;
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant WBTC = 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599;
    address constant DAI  = 0x6B175474E89094C44Da98b954EedeAC495271d0F;

    AaveOracleAdapter adapter;

    function setUp() public {
        try vm.envString("ETH_RPC_URL") returns (string memory rpcUrl) {
            vm.createSelectFork(rpcUrl);
        } catch {
            return;
        }
        adapter = new AaveOracleAdapter(AAVE_ORACLE);
    }

    function test_forkOracle_wethToUsdc() public {
        if (address(adapter) == address(0)) return;
        uint256 priceWeth = IAaveOracle(AAVE_ORACLE).getAssetPrice(WETH);
        uint256 priceUsdc = IAaveOracle(AAVE_ORACLE).getAssetPrice(USDC);
        console.log("WETH price (8 dec USD):", priceWeth);
        console.log("USDC price (8 dec USD):", priceUsdc);

        uint256 expectedOut = adapter.getExpectedOutput(WETH, USDC, 1e18);
        console.log("1 WETH -> USDC expected:", expectedOut);

        assertGt(expectedOut, 1_000e6, "ETH > $1000");
        assertLt(expectedOut, 100_000e6, "ETH < $100k");
    }

    function test_forkOracle_usdcToWeth() public {
        if (address(adapter) == address(0)) return;
        uint256 expectedOut = adapter.getExpectedOutput(USDC, WETH, 3_000e6);
        console.log("3000 USDC -> WETH expected:", expectedOut);
        assertGt(expectedOut, 0.5e18);
        assertLt(expectedOut, 5e18);
    }

    function test_forkOracle_wbtcToUsdc() public {
        if (address(adapter) == address(0)) return;
        uint256 expectedOut = adapter.getExpectedOutput(WBTC, USDC, 1e8);
        console.log("1 WBTC -> USDC expected:", expectedOut);
        assertGt(expectedOut, 50_000e6);
        assertLt(expectedOut, 200_000e6);
    }

    function test_forkOracle_wethToWbtc() public {
        if (address(adapter) == address(0)) return;
        uint256 expectedOut = adapter.getExpectedOutput(WETH, WBTC, 10e18);
        console.log("10 WETH -> WBTC expected:", expectedOut);
        assertGt(expectedOut, 0.1e8);
        assertLt(expectedOut, 2e8);
    }

    function test_forkOracle_daiToUsdc() public {
        if (address(adapter) == address(0)) return;
        uint256 expectedOut = adapter.getExpectedOutput(DAI, USDC, 1_000e18);
        console.log("1000 DAI -> USDC expected:", expectedOut);
        assertGt(expectedOut, 990e6);
        assertLt(expectedOut, 1010e6);
    }

    function test_forkOracle_roundtrip() public {
        if (address(adapter) == address(0)) return;
        uint256 usdcOut = adapter.getExpectedOutput(WETH, USDC, 1e18);
        uint256 wethBack = adapter.getExpectedOutput(USDC, WETH, usdcOut);
        console.log("1 WETH -> USDC:", usdcOut, "-> WETH:", wethBack);
        assertApproxEqRel(wethBack, 1e18, 1e14, "roundtrip < 0.01% loss");
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Full swap settlement test (withdraw WETH → swap WETH→USDT → deposit USDT)
// ═══════════════════════════════════════════════════════════════════════════════

contract OracleSwapSettlementForkTest is Test {
    // Ethereum mainnet
    address constant AAVE_V3_CORE  = 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2;
    address constant MORPHO_BLUE   = 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb;
    address constant AAVE_ORACLE   = 0x54586bE62E3c3580375aE3723C145253060Ca0C2;
    address constant WETH          = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant USDC          = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant USDT          = 0xdAC17F958D2ee523a2206206994597C13D831ec7;
    address constant WBTC          = 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599;

    // EIP-712
    bytes32 constant INFINITE_ORDER_TYPEHASH =
        keccak256("InfiniteOrder(bytes32 merkleRoot,uint48 deadline,uint256 maxFeeBps,address solver,bytes settlementData)");

    Settlement settlement;
    AaveOracleAdapter oracleAdapter;
    FixedRateSwapper swapper;

    address user;
    uint256 userPk;

    address aWETH;
    address aUSDT;
    address aWBTC;

    uint256 constant USER_COLLATERAL = 1 ether;
    uint256 constant SWAP_AMOUNT = 1 ether; // swap 1 WETH → USDT

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

    /// @dev Settlement call args packed into a struct to avoid stack-too-deep.
    struct FlashArgs {
        address asset;
        uint256 amount;
        address pool;
        uint48 deadline;
        bytes sig;
        bytes od;
        bytes ed;
        bytes fc;
    }

    FlashArgs private _fa;

    function _settleFlash(
        address asset, uint256 amount, address pool,
        uint256, /* feeBps */ uint48 deadline, bytes memory sig,
        bytes memory od, bytes memory ed, bytes memory fc
    ) internal {
        _fa = FlashArgs(asset, amount, pool, deadline, sig, od, ed, fc);
        _doSettle();
    }

    function _doSettle() private {
        FlashArgs storage a = _fa;
        settlement.settleWithFlashLoan(a.asset, a.amount, a.pool, 0, 0, address(0), a.deadline, a.sig, a.od, a.ed, a.fc);
    }

    function _doPlainSettle(
        uint48 deadline, bytes memory sig,
        bytes memory od, bytes memory ed, bytes memory fc
    ) internal {
        _fa.deadline = deadline; _fa.sig = sig; _fa.od = od; _fa.ed = ed; _fa.fc = fc;
        _doPlainSettleInner();
    }

    function _doPlainSettleInner() private {
        FlashArgs storage a = _fa;
        settlement.settle(0, address(0), a.deadline, a.sig, a.od, a.ed, a.fc);
    }

    function _signOrder(
        uint256 pk,
        bytes32 merkleRoot,
        uint48 deadline,
        uint256 maxFeeBps,
        address solver,
        bytes memory settlementPayload
    ) internal view returns (bytes memory) {
        bytes32 domainSeparator = settlement.DOMAIN_SEPARATOR();
        bytes32 structHash = keccak256(
            abi.encode(INFINITE_ORDER_TYPEHASH, merkleRoot, deadline, maxFeeBps, solver, keccak256(settlementPayload))
        );
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

        (user, userPk) = makeAddrAndKey("swapUser");

        settlement = new Settlement();
        oracleAdapter = new AaveOracleAdapter(AAVE_ORACLE);
        swapper = new FixedRateSwapper(address(oracleAdapter));

        // Get aToken addresses
        IAaveV3Pool.ReserveDataLegacy memory wethData = IPool(AAVE_V3_CORE).getReserveData(WETH);
        aWETH = wethData.aTokenAddress;
        IAaveV3Pool.ReserveDataLegacy memory usdtData = IPool(AAVE_V3_CORE).getReserveData(USDT);
        aUSDT = usdtData.aTokenAddress;
        IAaveV3Pool.ReserveDataLegacy memory wbtcData = IPool(AAVE_V3_CORE).getReserveData(WBTC);
        aWBTC = wbtcData.aTokenAddress;

        // Settlement approvals (via approveToken — no prank needed)
        settlement.approveToken(WETH, AAVE_V3_CORE, type(uint256).max);
        settlement.approveToken(USDC, AAVE_V3_CORE, type(uint256).max);
        settlement.approveToken(USDC, MORPHO_BLUE, type(uint256).max);
        settlement.approveToken(WBTC, AAVE_V3_CORE, type(uint256).max);
        // USDT non-standard approve — approveToken handles it (assembly approve)
        settlement.approveToken(USDT, AAVE_V3_CORE, type(uint256).max);

        // Forwarder approves the mock swapper for WETH (so it can pull)
        address fwd = address(settlement.forwarder());
        vm.prank(fwd);
        IERC20(WETH).approve(address(swapper), type(uint256).max);

        // User deposits WETH on Aave Core
        vm.deal(user, USER_COLLATERAL + 1 ether);
        vm.startPrank(user);
        IWETH(WETH).deposit{value: USER_COLLATERAL}();
        IERC20(WETH).approve(AAVE_V3_CORE, type(uint256).max);
        IPool(AAVE_V3_CORE).supply(WETH, USER_COLLATERAL, user, 0);

        // User grants settlement permission to pull aWETH
        IERC20(aWETH).approve(address(settlement), type(uint256).max);
        vm.stopPrank();

        // Fund the mock swapper with liquidity from whales
        // USDT deal() doesn't work reliably (proxy/non-standard storage), so use whale transfer
        address usdtWhale = 0xF977814e90dA44bFA03b6295A0616a897441aceC; // Binance hot wallet
        vm.prank(usdtWhale);
        (bool ok2,) = USDT.call(abi.encodeWithSelector(IERC20.transfer.selector, address(swapper), 100_000e6));
        require(ok2, "USDT whale transfer failed");

        deal(WBTC, address(swapper), 10e8);
    }

    // ═══════════════════════════════════════════════════════════
    //  Test: withdraw WETH → swap WETH→USDT at oracle rate → deposit USDT
    // ═══════════════════════════════════════════════════════════

    function test_forkSwap_wethToUsdt_atOracleRate() public {
        if (address(settlement) == address(0)) return;

        // ── Log pre-state ──
        uint256 expectedUsdt = oracleAdapter.getExpectedOutput(WETH, USDT, SWAP_AMOUNT);
        console.log("--- Oracle ---");
        console.log("WETH price (8 dec):", IAaveOracle(AAVE_ORACLE).getAssetPrice(WETH));
        console.log("USDT price (8 dec):", IAaveOracle(AAVE_ORACLE).getAssetPrice(USDT));
        console.log("1 WETH -> USDT at oracle rate:", expectedUsdt);

        console.log("--- Pre-swap ---");
        console.log("User aWETH balance:", IERC20(aWETH).balanceOf(user));

        // ── Build merkle tree ──
        // Leaf 0: withdraw WETH from Aave Core (pre-action)
        bytes memory withdrawData = abi.encodePacked(aWETH, AAVE_V3_CORE);
        // Leaf 1: deposit USDT to Aave Core (post-action)
        bytes memory depositData = abi.encodePacked(AAVE_V3_CORE);

        bytes32 l0 = _leaf(3, 0, withdrawData); // op=3 (withdraw)
        bytes32 l1 = _leaf(0, 0, depositData);  // op=0 (deposit)
        bytes32 root = _pair(l0, l1);

        bytes32[] memory pr0 = new bytes32[](1);
        pr0[0] = l1;
        bytes32[] memory pr1 = new bytes32[](1);
        pr1[0] = l0;

        // ── Build settlementData (user-signed conversion config) ──
        // [1: numConversions][per conversion: 20+20+20+8 = 68 bytes]
        uint64 swapTolerance = 500_000; // 5% tolerance (generous for fork test rounding)
        bytes memory settlementPayload = abi.encodePacked(
            uint8(1),                    // 1 conversion
            WETH,                        // assetIn
            USDT,                        // assetOut
            address(oracleAdapter),      // oracle
            swapTolerance                // tolerance
        );

        bytes memory orderData = abi.encodePacked(root, uint16(settlementPayload.length), settlementPayload);

        // ── Build fillerCalldata (solver-provided swap execution) ──
        // Use actual aWETH balance (may be 1 wei less than 1e18 due to Aave rounding)
        // Use 0 amountIn in both fillerCalldata (balance sentinel) and swap calldata
        // The settlement uses its full WETH balance after the withdraw.
        // The FixedRateSwapper also uses type(uint256).max as a sentinel to pull all available.
        bytes memory swapCalldata = abi.encodeCall(FixedRateSwapper.swap, (WETH, type(uint256).max, USDT));
        bytes memory fillerCalldata = abi.encodePacked(
            WETH,                               // assetIn
            USDT,                               // assetOut
            uint112(0),                         // amountIn = 0 (balance sentinel: use contract balance)
            uint8(0),                           // deltaIdxIn (WETH)
            uint8(1),                           // deltaIdxOut (USDT)
            address(swapper),                   // target (mock DEX)
            uint16(swapCalldata.length),        // calldataLen
            swapCalldata                        // DEX calldata
        );

        // ── Build executionData ──
        bytes memory executionData = abi.encodePacked(
            uint8(1), uint8(1), uint8(2), address(0),     // 1 pre, 1 post, 2 assets, no fee recipient
            // Pre: withdraw all WETH from Aave
            _action(WETH, type(uint112).max, address(settlement), 3, 0, withdrawData, pr0),
            // Post: deposit all USDT to Aave for user
            _action(USDT, 0, user, 0, 0, depositData, pr1)
        );

        // ── Sign and execute ──
        uint48 deadline = uint48(block.timestamp + 1 hours);
        bytes memory sig = _signOrder(userPk, root, deadline, 0, address(0), settlementPayload);

        console.log("fillerCalldata length:", fillerCalldata.length);
        console.log("swapCalldata length:", swapCalldata.length);
        _doPlainSettle(deadline, sig, orderData, executionData, fillerCalldata);

        // ── Verify results ──
        uint256 userAUsdtAfter = IERC20(aUSDT).balanceOf(user);

        console.log("--- Post-swap ---");
        console.log("User aWETH balance:", IERC20(aWETH).balanceOf(user));
        console.log("User aUSDT balance:", userAUsdtAfter);
        console.log("Settlement WETH:", IERC20(WETH).balanceOf(address(settlement)));
        console.log("Settlement USDT:", IERC20(USDT).balanceOf(address(settlement)));

        // All WETH collateral was swapped (1 WETH collateral, 1 WETH swap)
        assertEq(IERC20(aWETH).balanceOf(user), 0, "all aWETH swapped away");

        // User should have received aUSDT (USDT deposited to Aave on their behalf)
        assertGt(userAUsdtAfter, 0, "user should have aUSDT");
        assertApproxEqRel(userAUsdtAfter, expectedUsdt, 1e15, "aUSDT should match oracle output within 0.1%");

        // Settlement should hold nothing
        assertEq(IERC20(WETH).balanceOf(address(settlement)), 0, "no WETH left");
        assertEq(IERC20(USDT).balanceOf(address(settlement)), 0, "no USDT left");

        console.log("Oracle-verified swap: 1 WETH -> %s aUSDT (oracle: %s)", userAUsdtAfter, expectedUsdt);
    }

    // ═══════════════════════════════════════════════════════════
    //  Test: flash loan flow — user has WETH collateral + USDT debt
    //  Sells 1 WETH → USDT to reduce debt, requires flash loan to unlock collateral
    // ═══════════════════════════════════════════════════════════

    function test_forkSwap_flashLoan_debtSwap() public {
        if (address(settlement) == address(0)) return;

        // User has WETH collateral, borrows USDC, then migrates debt to USDT
        // via flash loan: repay USDC → swap WETH→USDT would change collateral,
        // but here we do: flash USDC, repay USDC, withdraw WETH, swap WETH→USDT,
        // deposit USDT, borrow USDC to repay flash.
        // This is the same pattern as collateral swap but with a debt-side swap.

        uint256 borrowAmount = 1_000e6;
        address vDebtUSDC;
        {
            IAaveV3Pool.ReserveDataLegacy memory usdcReserve = IPool(AAVE_V3_CORE).getReserveData(USDC);
            vDebtUSDC = usdcReserve.variableDebtTokenAddress;
        }

        vm.startPrank(user);
        IPool(AAVE_V3_CORE).borrow(USDC, borrowAmount, 2, 0, user);
        ICreditDelegation(vDebtUSDC).approveDelegation(address(settlement), type(uint256).max);
        vm.stopPrank();

        uint256 userDebt = IERC20(vDebtUSDC).balanceOf(user);
        uint256 swapAll = IERC20(aWETH).balanceOf(user);

        console.log("--- Pre-settlement (debt swap via flash loan) ---");
        console.log("User aWETH     :", swapAll);
        console.log("User USDC debt :", userDebt);

        settlement.approveToken(USDC, MORPHO_BLUE, type(uint256).max);

        (bytes32 merkleRoot, bytes memory orderData, bytes memory executionData,
         bytes memory fillerCalldata, bytes memory settlementPayload)
            = _buildDebtSwap(vDebtUSDC, swapAll, userDebt);

        uint48 deadline = uint48(block.timestamp + 1 hours);
        bytes memory sig = _signOrder(userPk, merkleRoot, deadline, 0, address(0), settlementPayload);

        _settleFlash(USDC, userDebt, MORPHO_BLUE, 0, deadline, sig, orderData, executionData, fillerCalldata);

        uint256 aWethAfter = IERC20(aWETH).balanceOf(user);
        uint256 debtAfter = IERC20(vDebtUSDC).balanceOf(user);

        console.log("--- Post-settlement ---");
        console.log("User aWETH     :", aWethAfter);
        console.log("User USDC debt :", debtAfter);

        // WETH withdrawn, swapped to USDT, deposited as supply — no WETH collateral left
        assertEq(aWethAfter, 0, "all WETH swapped");
        // Debt unchanged (repaid old USDC, re-borrowed same amount for flash loan)
        assertApproxEqAbs(debtAfter, userDebt, 5, "USDC debt unchanged");
        // Nothing left in settlement
        assertEq(IERC20(WETH).balanceOf(address(settlement)), 0, "no WETH left");
        assertEq(IERC20(USDC).balanceOf(address(settlement)), 0, "no USDC left");
        assertEq(IERC20(USDT).balanceOf(address(settlement)), 0, "no USDT left");

        console.log("Debt swap via flash loan completed!");
    }

    // ═══════════════════════════════════════════════════════════
    //  Test: collateral swap — WETH collateral + USDC debt
    //  converts to USDT collateral + USDC debt (same debt, new collateral)
    //
    //  Flow:
    //    1. Flash loan USDC to repay debt (unlocks WETH collateral)
    //    2. Pre: repay USDC debt, withdraw all WETH
    //    3. Intent: swap all WETH → USDT at oracle rate
    //    4. Post: deposit USDT as new collateral, borrow USDC to repay flash loan
    //    5. Result: collateral changed from WETH to USDT, debt stays USDC
    // ═══════════════════════════════════════════════════════════

    // ═══════════════════════════════════════════════════════════
    //  Test: plain withdraw reverts when debt makes HF < 1
    //  With 1 WETH collateral (~$2344) and 1800 USDC debt,
    //  withdrawing all WETH would violate the health factor.
    // ═══════════════════════════════════════════════════════════

    function test_forkSwap_plainWithdraw_reverts_undercollateralized() public {
        if (address(settlement) == address(0)) return;

        // Borrow ~50% LTV — enough that plain withdraw of ALL collateral reverts
        uint256 wethPrice = IAaveOracle(AAVE_ORACLE).getAssetPrice(WETH); // 8 decimals
        uint256 usdcBorrow = (wethPrice * 50) / (100 * 1e2); // ~50% of 1 WETH in USDC (6 dec)

        vm.startPrank(user);
        IPool(AAVE_V3_CORE).borrow(USDC, usdcBorrow, 2, 0, user);
        vm.stopPrank();

        console.log("--- Undercollateralized plain withdraw test ---");
        console.log("User aWETH     :", IERC20(aWETH).balanceOf(user));
        console.log("User USDC debt :", usdcBorrow);
        console.log("WETH price     :", wethPrice);

        // Plain withdraw of all WETH should revert (health factor violation)
        vm.startPrank(user);
        vm.expectRevert(); // Aave reverts with HEALTH_FACTOR_LOWER_THAN_LIQUIDATION_THRESHOLD
        IPool(AAVE_V3_CORE).withdraw(WETH, type(uint256).max, user);
        vm.stopPrank();

        console.log("Plain withdraw reverted as expected - flash loan required!");
    }

    // ═══════════════════════════════════════════════════════════
    //  Test: collateral swap WITH debt — WETH collateral + USDC debt
    //  converts to USDT collateral + USDC debt.
    //
    //  Key: user has high LTV so plain withdraw is impossible.
    //  Flash loan is REQUIRED to atomically repay → withdraw → swap → deposit → reborrow.
    // ═══════════════════════════════════════════════════════════

    function test_forkSwap_flashLoan_collateralSwap() public {
        if (address(settlement) == address(0)) return;

        // Borrow ~50% LTV — plain withdraw would violate HF
        uint256 wethPrice = IAaveOracle(AAVE_ORACLE).getAssetPrice(WETH);
        uint256 usdcBorrow = (wethPrice * 50) / (100 * 1e2);

        address vDebtUSDC;
        {
            IAaveV3Pool.ReserveDataLegacy memory usdcReserve = IPool(AAVE_V3_CORE).getReserveData(USDC);
            vDebtUSDC = usdcReserve.variableDebtTokenAddress;
        }

        vm.startPrank(user);
        IPool(AAVE_V3_CORE).borrow(USDC, usdcBorrow, 2, 0, user);
        ICreditDelegation(vDebtUSDC).approveDelegation(address(settlement), type(uint256).max);
        vm.stopPrank();

        uint256 userDebt = IERC20(vDebtUSDC).balanceOf(user);
        uint256 swapAll = IERC20(aWETH).balanceOf(user);

        console.log("--- Pre-settlement (collateral swap WETH -> WBTC) ---");
        console.log("User aWETH      :", swapAll);
        console.log("User USDC debt  :", userDebt);

        bytes memory orderData;
        bytes memory executionData;
        bytes memory fillerCalldata;
        bytes memory settlementPayload;
        bytes32 merkleRoot;
        {
            bytes memory repayData    = abi.encodePacked(uint8(2), vDebtUSDC, AAVE_V3_CORE);
            bytes memory withdrawData = abi.encodePacked(aWETH, AAVE_V3_CORE);
            bytes memory depositData  = abi.encodePacked(AAVE_V3_CORE);
            bytes memory borrowData   = abi.encodePacked(uint8(2), AAVE_V3_CORE);

            bytes32 l0 = _leaf(2, 0, repayData);
            bytes32 l1 = _leaf(3, 0, withdrawData);
            bytes32 l2 = _leaf(0, 0, depositData);
            bytes32 l3 = _leaf(1, 0, borrowData);

            bytes32 h01  = _pair(l0, l1);
            bytes32 h23  = _pair(l2, l3);
            bytes32 root = _pair(h01, h23);
            merkleRoot = root;

            settlementPayload = abi.encodePacked(
                uint8(1), WETH, WBTC, address(oracleAdapter), uint64(500_000)
            );
            orderData = abi.encodePacked(root, uint16(settlementPayload.length), settlementPayload);

            {
                bytes memory sc = abi.encodeCall(FixedRateSwapper.swap, (WETH, swapAll, WBTC));
                fillerCalldata = abi.encodePacked(
                    WETH, WBTC, uint112(swapAll),
                    uint8(1), uint8(2),  // deltaIdxIn (WETH), deltaIdxOut (WBTC)
                    address(swapper), uint16(sc.length), sc
                );
            }

            executionData = abi.encodePacked(uint8(2), uint8(2), uint8(3), address(0));
            {
                bytes32[] memory p = new bytes32[](2);
                p[0] = l1; p[1] = h23;
                executionData = abi.encodePacked(executionData, _action(USDC, type(uint112).max, user, 2, 0, repayData, p));
            }
            {
                bytes32[] memory p = new bytes32[](2);
                p[0] = l0; p[1] = h23;
                executionData = abi.encodePacked(executionData, _action(WETH, type(uint112).max, address(settlement), 3, 0, withdrawData, p));
            }
            {
                bytes32[] memory p = new bytes32[](2);
                p[0] = l3; p[1] = h01;
                executionData = abi.encodePacked(executionData, _action(WBTC, 0, user, 0, 0, depositData, p));
            }
            {
                bytes32[] memory p = new bytes32[](2);
                p[0] = l2; p[1] = h01;
                executionData = abi.encodePacked(executionData, _action(USDC, uint112(userDebt), address(settlement), 1, 0, borrowData, p));
            }
        }

        uint48 deadline = uint48(block.timestamp + 1 hours);
        bytes memory sig = _signOrder(userPk, merkleRoot, deadline, 0, address(0), settlementPayload);

        _settleFlash(USDC, userDebt, MORPHO_BLUE, 0, deadline, sig, orderData, executionData, fillerCalldata);

        console.log("--- Post-settlement (collateral swap) ---");
        console.log("User aWETH      :", IERC20(aWETH).balanceOf(user));
        console.log("User aWBTC      :", IERC20(aWBTC).balanceOf(user));
        console.log("User USDC debt  :", IERC20(vDebtUSDC).balanceOf(user));

        assertEq(IERC20(aWETH).balanceOf(user), 0, "all WETH withdrawn");
        assertGt(IERC20(aWBTC).balanceOf(user), 0, "user has WBTC collateral");
        assertApproxEqAbs(IERC20(vDebtUSDC).balanceOf(user), userDebt, 5, "USDC debt unchanged");
        assertEq(IERC20(WETH).balanceOf(address(settlement)), 0, "no WETH left");
        assertEq(IERC20(USDC).balanceOf(address(settlement)), 0, "no USDC left");
        assertEq(IERC20(WBTC).balanceOf(address(settlement)), 0, "no WBTC left");
    }

    /// @dev Builds a debt-swap settlement: repay USDC, withdraw WETH, swap WETH->USDT,
    ///      deposit USDT as new collateral, borrow USDC to repay flash loan.
    function _buildDebtSwap(
        address vDebtUSDC,
        uint256 swapAll,
        uint256 userDebt
    ) internal view returns (
        bytes32 root,
        bytes memory orderData,
        bytes memory executionData,
        bytes memory fillerCalldata,
        bytes memory settlementPayload
    ) {
        bytes memory repayData    = abi.encodePacked(uint8(2), vDebtUSDC, AAVE_V3_CORE);
        bytes memory withdrawData = abi.encodePacked(aWETH, AAVE_V3_CORE);
        bytes memory depositData  = abi.encodePacked(AAVE_V3_CORE);
        bytes memory borrowData   = abi.encodePacked(uint8(2), AAVE_V3_CORE);

        bytes32 l0 = _leaf(2, 0, repayData);
        bytes32 l1 = _leaf(3, 0, withdrawData);
        bytes32 l2 = _leaf(0, 0, depositData);
        bytes32 l3 = _leaf(1, 0, borrowData);

        bytes32 h01 = _pair(l0, l1);
        bytes32 h23 = _pair(l2, l3);
        root = _pair(h01, h23);

        settlementPayload = abi.encodePacked(
            uint8(1), WETH, USDT, address(oracleAdapter), uint64(500_000)
        );
        orderData = abi.encodePacked(root, uint16(settlementPayload.length), settlementPayload);

        {
            bytes memory swapCalldata = abi.encodeCall(FixedRateSwapper.swap, (WETH, swapAll, USDT));
            fillerCalldata = abi.encodePacked(
                WETH, USDT, uint112(swapAll),
                uint8(1), uint8(2),  // deltaIdxIn (WETH), deltaIdxOut (USDT)
                address(swapper),
                uint16(swapCalldata.length), swapCalldata
            );
        }

        // Build executionData incrementally to avoid stack-too-deep
        executionData = abi.encodePacked(uint8(2), uint8(2), uint8(3), address(0));
        {
            bytes32[] memory pr = new bytes32[](2);
            pr[0] = l1; pr[1] = h23;
            executionData = abi.encodePacked(executionData, _action(USDC, type(uint112).max, user, 2, 0, repayData, pr));
        }
        {
            bytes32[] memory pr = new bytes32[](2);
            pr[0] = l0; pr[1] = h23;
            executionData = abi.encodePacked(executionData, _action(WETH, type(uint112).max, address(settlement), 3, 0, withdrawData, pr));
        }
        {
            bytes32[] memory pr = new bytes32[](2);
            pr[0] = l3; pr[1] = h01;
            executionData = abi.encodePacked(executionData, _action(USDT, 0, user, 0, 0, depositData, pr));
        }
        {
            bytes32[] memory pr = new bytes32[](2);
            pr[0] = l2; pr[1] = h01;
            executionData = abi.encodePacked(executionData, _action(USDC, uint112(userDebt), address(settlement), 1, 0, borrowData, pr));
        }
    }
}
