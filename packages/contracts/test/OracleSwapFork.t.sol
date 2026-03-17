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

    // EIP-712
    bytes32 constant MIGRATION_ORDER_TYPEHASH =
        keccak256("MigrationOrder(bytes32 merkleRoot,uint48 deadline,bytes settlementData)");

    Settlement settlement;
    AaveOracleAdapter oracleAdapter;
    FixedRateSwapper swapper;

    address user;
    uint256 userPk;

    address aWETH;
    address aUSDT;

    uint256 constant USER_COLLATERAL = 10 ether;
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

    function _signOrder(
        uint256 pk,
        bytes32 merkleRoot,
        uint48 deadline,
        bytes memory settlementPayload
    ) internal view returns (bytes memory) {
        bytes32 domainSeparator = settlement.DOMAIN_SEPARATOR();
        bytes32 structHash = keccak256(
            abi.encode(MIGRATION_ORDER_TYPEHASH, merkleRoot, deadline, keccak256(settlementPayload))
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

        // Settlement approvals
        vm.startPrank(address(settlement));
        IERC20(WETH).approve(AAVE_V3_CORE, type(uint256).max);
        IERC20(USDC).approve(AAVE_V3_CORE, type(uint256).max);
        IERC20(USDC).approve(MORPHO_BLUE, type(uint256).max);
        // USDT non-standard approve (no return value) — use low-level call
        (bool ok,) = USDT.call(abi.encodeWithSelector(IERC20.approve.selector, AAVE_V3_CORE, type(uint256).max));
        require(ok, "USDT approve failed");
        vm.stopPrank();

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

        // Fund the mock swapper with USDT (simulate DEX liquidity)
        deal(USDT, address(swapper), 100_000e6);
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
        uint64 swapTolerance = 50_000; // 0.5% tolerance
        bytes memory settlementPayload = abi.encodePacked(
            uint8(1),                    // 1 conversion
            WETH,                        // assetIn
            USDT,                        // assetOut
            address(oracleAdapter),      // oracle
            swapTolerance                // tolerance
        );

        bytes memory orderData = abi.encodePacked(root, uint16(settlementPayload.length), settlementPayload);

        // ── Build fillerCalldata (solver-provided swap execution) ──
        // [per swap: 20+20+14+20+2+calldataLen]
        bytes memory swapCalldata = abi.encodeCall(FixedRateSwapper.swap, (WETH, SWAP_AMOUNT, USDT));
        bytes memory fillerCalldata = abi.encodePacked(
            WETH,                               // assetIn
            USDT,                               // assetOut
            uint112(SWAP_AMOUNT),               // amountIn
            address(swapper),                   // target (mock DEX)
            uint16(swapCalldata.length),        // calldataLen
            swapCalldata                        // DEX calldata
        );

        // ── Build executionData ──
        bytes memory executionData = abi.encodePacked(
            uint8(1), uint8(1), address(0),     // 1 pre, 1 post, no fee recipient
            // Pre: withdraw 1 WETH from Aave
            _action(WETH, uint112(SWAP_AMOUNT), address(settlement), 3, 0, withdrawData, pr0),
            // Post: deposit all USDT to Aave for user
            _action(USDT, 0, user, 0, 0, depositData, pr1)
        );

        // ── Sign and execute ──
        uint48 deadline = uint48(block.timestamp + 1 hours);
        bytes memory sig = _signOrder(userPk, root, deadline, settlementPayload);

        console.log("fillerCalldata length:", fillerCalldata.length);
        console.log("swapCalldata length:", swapCalldata.length);
        settlement.settle(
            0,                  // maxFeeBps = 0 (no fee)
            deadline,
            sig,
            orderData,
            executionData,
            fillerCalldata
        );

        // ── Verify results ──
        uint256 userAUsdtAfter = IERC20(aUSDT).balanceOf(user);

        console.log("--- Post-swap ---");
        console.log("User aWETH balance:", IERC20(aWETH).balanceOf(user));
        console.log("User aUSDT balance:", userAUsdtAfter);
        console.log("Settlement WETH:", IERC20(WETH).balanceOf(address(settlement)));
        console.log("Settlement USDT:", IERC20(USDT).balanceOf(address(settlement)));

        // User should have lost 1 WETH of collateral
        assertApproxEqAbs(
            IERC20(aWETH).balanceOf(user),
            USER_COLLATERAL - SWAP_AMOUNT,
            2, // 1-2 wei rounding
            "user aWETH should decrease by swap amount"
        );

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

    function test_forkSwap_flashLoan_debtRepayWithSwap() public {
        if (address(settlement) == address(0)) return;

        uint256 borrowAmount = 1_000e6; // 1000 USDT debt
        address vDebtUSDT;
        {
            IAaveV3Pool.ReserveDataLegacy memory usdtReserve = IPool(AAVE_V3_CORE).getReserveData(USDT);
            vDebtUSDT = usdtReserve.variableDebtTokenAddress;
        }

        // ── User borrows USDT against WETH collateral ──
        vm.startPrank(user);
        IPool(AAVE_V3_CORE).borrow(USDT, borrowAmount, 2, 0, user);
        vm.stopPrank();

        uint256 userDebt = IERC20(vDebtUSDT).balanceOf(user);
        uint256 expectedUsdt = oracleAdapter.getExpectedOutput(WETH, USDT, SWAP_AMOUNT);

        console.log("--- Pre-settlement (flash loan + swap) ---");
        console.log("User aWETH   :", IERC20(aWETH).balanceOf(user));
        console.log("User USDT debt:", userDebt);
        console.log("1 WETH at oracle rate:", expectedUsdt, "USDT");

        // ── Grant settlement additional permissions ──
        vm.startPrank(user);
        ICreditDelegation(vDebtUSDT).approveDelegation(address(settlement), type(uint256).max);
        vm.stopPrank();

        // Settlement needs USDT approval for Morpho flash loan repayment
        vm.prank(address(settlement));
        (bool ok2,) = USDT.call(abi.encodeWithSelector(IERC20.approve.selector, MORPHO_BLUE, type(uint256).max));
        require(ok2);

        // ── Build merkle tree: 3 leaves ──
        // No borrow needed — the swap output (~2344 USDT) covers the 1000 USDT flash loan.
        // Excess USDT is refunded to the signer.
        bytes memory repayData    = abi.encodePacked(uint8(2), vDebtUSDT, AAVE_V3_CORE);
        bytes memory withdrawData = abi.encodePacked(aWETH, AAVE_V3_CORE);
        bytes memory depositData  = abi.encodePacked(AAVE_V3_CORE);

        bytes32 l0 = _leaf(2, 0, repayData);      // repay USDT
        bytes32 l1 = _leaf(3, 0, withdrawData);    // withdraw WETH
        bytes32 l2 = _leaf(0, 0, depositData);     // deposit WETH

        bytes32 h01  = _pair(l0, l1);
        bytes32 root = _pair(h01, l2);

        bytes32[] memory pr0 = new bytes32[](2);
        pr0[0] = l1; pr0[1] = l2;
        bytes32[] memory pr1 = new bytes32[](2);
        pr1[0] = l0; pr1[1] = l2;
        bytes32[] memory pr2 = new bytes32[](1);
        pr2[0] = h01;

        // ── settlementData: 1 conversion WETH→USDT ──
        uint64 swapTolerance = 50_000; // 0.5%
        bytes memory settlementPayload = abi.encodePacked(
            uint8(1), WETH, USDT, address(oracleAdapter), swapTolerance
        );

        bytes memory orderData = abi.encodePacked(root, uint16(settlementPayload.length), settlementPayload);

        // ── fillerCalldata: swap 1 WETH → USDT ──
        bytes memory swapCalldata = abi.encodeCall(FixedRateSwapper.swap, (WETH, SWAP_AMOUNT, USDT));
        bytes memory fillerCalldata = abi.encodePacked(
            WETH, USDT, uint112(SWAP_AMOUNT), address(swapper),
            uint16(swapCalldata.length), swapCalldata
        );

        // ── Post-action borrow: debt minus what the swap covers ──
        // The flash loan repays the full debt. The swap produces ~2344 USDT.
        // After all actions: settlement needs USDT to repay the flash loan.
        //   flash loan amount = userDebt
        //   pre: repay userDebt (USDT leaves)
        //   pre: withdraw all WETH (WETH arrives)
        //   intent: swap 1 WETH → ~2344 USDT (WETH leaves, USDT arrives)
        //   post: deposit 9 WETH (WETH leaves)
        //   post: borrow (userDebt - swapOutput + tiny extra) USDT
        //
        // For deltas to balance on USDT:
        //   -userDebt + swapOutput + borrowAmount = 0
        //   borrowAmount = userDebt - swapOutput
        //
        // But we also need the flash loan repayment: the settlement must hold
        // exactly userDebt USDT when the callback returns.
        // After all actions: settlement has (swapOutput + postBorrow) USDT.
        // We need swapOutput + postBorrow = userDebt → postBorrow = userDebt - swapOutput.
        //
        // The USDT delta = -userDebt (repay) + swapOutput (swap) + postBorrow (borrow) = 0.  ✓

        // Flow:
        //   Flash loan: +userDebt USDT
        //   Pre repay:  -userDebt USDT (delta = -userDebt)
        //   Pre withdraw: +10 WETH (delta = +10)
        //   Swap:        -1 WETH, +swapOutput USDT (~2344)
        //   Post deposit: -9 WETH (delta[WETH] = 0)
        //   USDT delta = -userDebt + swapOutput > 0 (non-borrow surplus → refunded to user)
        //   After settlement: contract holds swapOutput USDT, flash loan takes userDebt,
        //   excess (swapOutput - userDebt) is refunded to user.

        bytes memory executionData = abi.encodePacked(
            uint8(2), uint8(1), address(0), // 2 pre, 1 post, no fee recipient
            // Pre: repay full USDT debt
            _action(USDT, type(uint112).max, user, 2, 0, repayData, pr0),
            // Pre: withdraw all WETH
            _action(WETH, type(uint112).max, address(settlement), 3, 0, withdrawData, pr1),
            // Post: deposit remaining WETH back
            _action(WETH, 0, user, 0, 0, depositData, pr2)
        );

        // ── Sign and execute via flash loan ──
        uint48 deadline = uint48(block.timestamp + 1 hours);
        bytes memory sig = _signOrder(userPk, root, deadline, settlementPayload);

        settlement.settleWithFlashLoan(
            USDT,                // flash loan USDT to repay debt first
            userDebt,            // flash loan the full debt
            MORPHO_BLUE,
            0,
            0,                   // maxFeeBps = 0
            deadline,
            sig,
            orderData,
            executionData,
            fillerCalldata
        );

        // ── Verify results ──
        uint256 aWethAfter = IERC20(aWETH).balanceOf(user);
        uint256 debtAfter = IERC20(vDebtUSDT).balanceOf(user);
        uint256 aUsdtAfter = IERC20(aUSDT).balanceOf(user);

        uint256 userUsdtBalance = IERC20(USDT).balanceOf(user);

        console.log("--- Post-settlement ---");
        console.log("User aWETH      :", aWethAfter);
        console.log("User USDT debt  :", debtAfter);
        console.log("User USDT wallet:", userUsdtBalance);
        console.log("Settlement WETH :", IERC20(WETH).balanceOf(address(settlement)));
        console.log("Settlement USDT :", IERC20(USDT).balanceOf(address(settlement)));

        // User lost 1 WETH of collateral (swapped to USDT)
        assertApproxEqAbs(aWethAfter, USER_COLLATERAL - SWAP_AMOUNT, 2, "lost 1 WETH");

        // Debt fully repaid — no new borrow, swap covers the flash loan
        assertEq(debtAfter, 0, "user debt should be zero");

        // User received refund: swap produced ~2344 USDT, flash loan took ~1000 USDT,
        // excess (~1344 USDT) was refunded to user as raw USDT (non-borrow surplus refund)
        uint256 expectedRefund = expectedUsdt - userDebt;
        assertApproxEqAbs(userUsdtBalance, expectedRefund + borrowAmount, 5, "user got USDT refund");
        console.log("User USDT refund (swap excess):", userUsdtBalance - borrowAmount);

        // Settlement should be clean
        assertEq(IERC20(WETH).balanceOf(address(settlement)), 0, "no WETH left");
        assertEq(IERC20(USDT).balanceOf(address(settlement)), 0, "no USDT left");

        console.log("Flash loan + oracle swap completed successfully!");
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

    function test_forkSwap_flashLoan_collateralSwap() public {
        if (address(settlement) == address(0)) return;

        uint256 usdcBorrow = 1_000e6;
        address vDebtUSDC;
        {
            IAaveV3Pool.ReserveDataLegacy memory usdcReserve = IPool(AAVE_V3_CORE).getReserveData(USDC);
            vDebtUSDC = usdcReserve.variableDebtTokenAddress;
        }

        // ── User opens WETH collateral + USDC debt position ──
        vm.startPrank(user);
        IPool(AAVE_V3_CORE).borrow(USDC, usdcBorrow, 2, 0, user);
        // Grant settlement permissions
        ICreditDelegation(vDebtUSDC).approveDelegation(address(settlement), type(uint256).max);
        vm.stopPrank();

        // Settlement needs USDT approval for Morpho (flash loan uses USDC, not USDT, but we need it for deposits)
        // USDC approvals already set in setUp

        uint256 userDebt = IERC20(vDebtUSDC).balanceOf(user);
        uint256 swapAll = IERC20(aWETH).balanceOf(user); // swap entire WETH position
        uint256 expectedUsdt = oracleAdapter.getExpectedOutput(WETH, USDT, swapAll);

        console.log("--- Pre-settlement (collateral swap) ---");
        console.log("User aWETH      :", IERC20(aWETH).balanceOf(user));
        console.log("User USDC debt  :", userDebt);
        console.log("User aUSDT      :", IERC20(aUSDT).balanceOf(user));
        console.log("10 WETH at oracle:", expectedUsdt, "USDT");

        // ── Merkle tree: 4 leaves ──
        bytes memory repayData    = abi.encodePacked(uint8(2), vDebtUSDC, AAVE_V3_CORE);
        bytes memory withdrawData = abi.encodePacked(aWETH, AAVE_V3_CORE);
        bytes memory depositData  = abi.encodePacked(AAVE_V3_CORE);
        bytes memory borrowData   = abi.encodePacked(uint8(2), AAVE_V3_CORE);

        bytes32 l0 = _leaf(2, 0, repayData);      // repay USDC
        bytes32 l1 = _leaf(3, 0, withdrawData);    // withdraw WETH
        bytes32 l2 = _leaf(0, 0, depositData);     // deposit USDT
        bytes32 l3 = _leaf(1, 0, borrowData);      // borrow USDC

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

        // ── settlementData: swap WETH → USDT ──
        uint64 swapTolerance = 50_000; // 0.5%
        bytes memory settlementPayload = abi.encodePacked(
            uint8(1), WETH, USDT, address(oracleAdapter), swapTolerance
        );
        bytes memory orderData = abi.encodePacked(root, uint16(settlementPayload.length), settlementPayload);

        // ── fillerCalldata: swap all WETH → USDT ──
        bytes memory swapCalldata = abi.encodeCall(FixedRateSwapper.swap, (WETH, swapAll, USDT));
        bytes memory fillerCalldata = abi.encodePacked(
            WETH, USDT, uint112(swapAll), address(swapper),
            uint16(swapCalldata.length), swapCalldata
        );

        // ── executionData ──
        // Delta trace:
        //   Flash loan:    +userDebt USDC
        //   Pre repay:     -userDebt USDC          → delta[USDC] = -userDebt
        //   Pre withdraw:  +swapAll WETH            → delta[WETH] = +swapAll
        //   Swap:          -swapAll WETH, +Y USDT   → delta[WETH] = 0, delta[USDT] = +Y
        //   Post deposit:  -Y USDT (amount=0)       → delta[USDT] = 0
        //   Post borrow:   +userDebt USDC           → delta[USDC] = 0
        //   All zeros ✓
        bytes memory executionData = abi.encodePacked(
            uint8(2), uint8(2), address(0),
            // Pre: repay full USDC debt
            _action(USDC, type(uint112).max, user, 2, 0, repayData, pr0),
            // Pre: withdraw all WETH
            _action(WETH, type(uint112).max, address(settlement), 3, 0, withdrawData, pr1),
            // Post: deposit all USDT as new collateral
            _action(USDT, 0, user, 0, 0, depositData, pr2),
            // Post: borrow USDC to repay flash loan
            _action(USDC, uint112(userDebt), address(settlement), 1, 0, borrowData, pr3)
        );

        // ── Sign and execute ──
        uint48 deadline = uint48(block.timestamp + 1 hours);
        bytes memory sig = _signOrder(userPk, root, deadline, settlementPayload);

        settlement.settleWithFlashLoan(
            USDC,
            userDebt,
            MORPHO_BLUE,
            0,
            0, // maxFeeBps = 0
            deadline,
            sig,
            orderData,
            executionData,
            fillerCalldata
        );

        // ── Verify: collateral changed from WETH to USDT, debt unchanged ──
        uint256 aWethAfter = IERC20(aWETH).balanceOf(user);
        uint256 aUsdtAfter = IERC20(aUSDT).balanceOf(user);
        uint256 debtAfter  = IERC20(vDebtUSDC).balanceOf(user);

        console.log("--- Post-settlement (collateral swap) ---");
        console.log("User aWETH      :", aWethAfter);
        console.log("User aUSDT      :", aUsdtAfter);
        console.log("User USDC debt  :", debtAfter);
        console.log("Settlement WETH :", IERC20(WETH).balanceOf(address(settlement)));
        console.log("Settlement USDC :", IERC20(USDC).balanceOf(address(settlement)));
        console.log("Settlement USDT :", IERC20(USDT).balanceOf(address(settlement)));

        // WETH collateral fully removed
        assertEq(aWethAfter, 0, "all WETH withdrawn");

        // USDT collateral received (all the swap output deposited)
        assertGt(aUsdtAfter, 0, "user has USDT collateral");
        assertApproxEqRel(aUsdtAfter, expectedUsdt, 1e15, "aUSDT matches oracle output");

        // USDC debt approximately the same (re-borrowed to repay flash loan)
        assertApproxEqAbs(debtAfter, userDebt, 5, "USDC debt unchanged");

        // Settlement clean
        assertEq(IERC20(WETH).balanceOf(address(settlement)), 0, "no WETH left");
        assertEq(IERC20(USDC).balanceOf(address(settlement)), 0, "no USDC left");
        assertEq(IERC20(USDT).balanceOf(address(settlement)), 0, "no USDT left");

        console.log("Collateral swap: %s aWETH -> %s aUSDT, debt unchanged at %s USDC", swapAll, aUsdtAfter, debtAfter);
    }
}
