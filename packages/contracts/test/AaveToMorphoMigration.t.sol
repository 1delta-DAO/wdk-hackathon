// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test, console} from "forge-std/Test.sol";
import {Settlement} from "../src/core/settlement/Settlement.sol";
import {IAaveV3Pool} from "../src/core/settlement/apr/IAaveV3Pool.sol";
import {SettlementExecutor} from "../src/core/settlement/SettlementExecutor.sol";
import {EIP712OrderVerifier} from "../src/core/settlement/EIP712OrderVerifier.sol";

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

interface IPool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)
        external;
    function getReserveData(address asset) external view returns (IAaveV3Pool.ReserveDataLegacy memory);
}

interface ICreditDelegation {
    function approveDelegation(address delegatee, uint256 amount) external;
}

interface IWETH {
    function deposit() external payable;
}

interface IWstETH {
    function wrap(uint256 amount) external returns (uint256);
}

interface IStETH {
    function submit(address referral) external payable returns (uint256);
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
    function setAuthorization(address authorized, bool newIsAuthorized) external;
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

// ═══════════════════════════════════════════════════════════════════════════════
//  Aave wstETH/WETH → Morpho Blue wstETH/WETH Migration Fork Test
// ═══════════════════════════════════════════════════════════════════════════════

contract AaveToMorphoMigrationTest is Test {
    // ── Ethereum mainnet addresses ──────────────────────────

    // Aave V3 Core
    address constant AAVE_V3_CORE = 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2;

    // Morpho Blue
    address constant MORPHO_BLUE = 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb;

    // wstETH/WETH Morpho market params
    address constant MORPHO_ORACLE = 0xbD60A6770b27E084E8617335ddE769241B0e71D8;
    address constant MORPHO_IRM = 0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC;
    uint256 constant MORPHO_LLTV = 965_000_000_000_000_000; // 96.5%
    bytes32 constant MORPHO_MARKET_ID = 0xb8fc70e82bc5bb53e773626fcc6a23f7eefa036918d7ef216ecfb1950a94a85e;

    // Tokens
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant WSTETH = 0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0;
    address constant STETH = 0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84;

    // EIP-712
    bytes32 constant MIGRATION_ORDER_TYPEHASH =
        keccak256("MigrationOrder(bytes32 merkleRoot,uint48 deadline,bytes settlementData)");

    Settlement settlement;

    address user;
    uint256 userPk;

    // Aave source tokens
    address aWstETH;
    address vDebtWETH;

    uint256 constant USER_COLLATERAL = 10 ether; // 10 wstETH
    uint256 constant USER_BORROW = 5 ether; // 5 WETH

    // ── Helpers ─────────────────────────────────────────────

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

    function _morphoMarketParams() internal pure returns (IMorpho.MarketParams memory) {
        return IMorpho.MarketParams({
            loanToken: WETH,
            collateralToken: WSTETH,
            oracle: MORPHO_ORACLE,
            irm: MORPHO_IRM,
            lltv: MORPHO_LLTV
        });
    }

    // ── Setup ───────────────────────────────────────────────

    function setUp() public {
        try vm.envString("ETH_RPC_URL") returns (string memory rpcUrl) {
            vm.createSelectFork(rpcUrl);
        } catch {
            return;
        }

        (user, userPk) = makeAddrAndKey("morphoMigUser");

        settlement = new Settlement();

        // Aave reserve tokens
        IAaveV3Pool.ReserveDataLegacy memory wstethData = IPool(AAVE_V3_CORE).getReserveData(WSTETH);
        IAaveV3Pool.ReserveDataLegacy memory wethData = IPool(AAVE_V3_CORE).getReserveData(WETH);
        aWstETH = wstethData.aTokenAddress;
        vDebtWETH = wethData.variableDebtTokenAddress;

        // Settlement approvals
        settlement.approveToken(WETH, AAVE_V3_CORE, type(uint256).max);
        settlement.approveToken(WSTETH, AAVE_V3_CORE, type(uint256).max);
        settlement.approveToken(WETH, MORPHO_BLUE, type(uint256).max);
        settlement.approveToken(WSTETH, MORPHO_BLUE, type(uint256).max);

        console.log("aWstETH:", aWstETH);
        console.log("vDebtWETH:", vDebtWETH);
    }

    // ── Test: Aave wstETH/WETH → Morpho wstETH/WETH ────────

    function test_forkMigration_aaveToMorpho_wstethWeth() public {
        if (address(settlement) == address(0)) return;

        // ── Setup: user creates leveraged wstETH/WETH position on Aave ──
        // Get wstETH: ETH → stETH → wstETH
        vm.deal(user, USER_COLLATERAL + USER_BORROW + 2 ether);
        vm.startPrank(user);
        // Wrap ETH to wstETH
        uint256 stethAmount = IStETH(STETH).submit{value: USER_COLLATERAL + 1 ether}(address(0));
        IERC20(STETH).approve(WSTETH, stethAmount);
        uint256 wstethAmount = IWstETH(WSTETH).wrap(stethAmount);

        // Supply wstETH as collateral on Aave
        IERC20(WSTETH).approve(AAVE_V3_CORE, wstethAmount);
        IPool(AAVE_V3_CORE).supply(WSTETH, wstethAmount, user, 0);

        // Borrow WETH against it
        IPool(AAVE_V3_CORE).borrow(WETH, USER_BORROW, 2, 0, user);
        vm.stopPrank();

        uint256 aaveCollBefore = IERC20(aWstETH).balanceOf(user);
        uint256 aaveDebtBefore = IERC20(vDebtWETH).balanceOf(user);

        console.log("--- Pre-migration ---");
        console.log("Aave aWstETH :", aaveCollBefore);
        console.log("Aave WETH debt:", aaveDebtBefore);

        assertGt(aaveCollBefore, 0, "user should have Aave collateral");
        assertGt(aaveDebtBefore, 0, "user should have Aave debt");

        // ── User grants settlement permissions ──
        vm.startPrank(user);
        // Aave: approve aToken pull (for withdraw)
        IERC20(aWstETH).approve(address(settlement), type(uint256).max);
        // Morpho: authorize settlement to borrow on behalf
        IMorpho(MORPHO_BLUE).setAuthorization(address(settlement), true);
        vm.stopPrank();

        // ── Build merkle tree ──
        // Leaf 0: Repay WETH on Aave (op=2, lender=0)
        bytes memory repayData = abi.encodePacked(uint8(2), vDebtWETH, AAVE_V3_CORE);
        // Leaf 1: Withdraw wstETH from Aave (op=3, lender=0)
        bytes memory withdrawData = abi.encodePacked(aWstETH, AAVE_V3_CORE);
        // Leaf 2: Deposit wstETH to Morpho (op=0, lender=4000)
        // Morpho deposit data: [20: loan][20: coll][20: oracle][20: irm][16: lltv][1: flags][20: morpho][2: cbLen=0]
        bytes memory morphoDepositData = abi.encodePacked(
            WETH, WSTETH, MORPHO_ORACLE, MORPHO_IRM, uint128(MORPHO_LLTV), uint8(0), MORPHO_BLUE, uint16(0)
        );
        // Leaf 3: Borrow WETH from Morpho (op=1, lender=4000)
        // Morpho borrow data: [20: loan][20: coll][20: oracle][20: irm][16: lltv][1: flags][20: morpho]
        bytes memory morphoBorrowData = abi.encodePacked(
            WETH, WSTETH, MORPHO_ORACLE, MORPHO_IRM, uint128(MORPHO_LLTV), uint8(0), MORPHO_BLUE
        );

        bytes32 l0 = _leaf(2, 0, repayData);         // Aave repay
        bytes32 l1 = _leaf(3, 0, withdrawData);       // Aave withdraw
        bytes32 l2 = _leaf(0, 4000, morphoDepositData); // Morpho deposit
        bytes32 l3 = _leaf(1, 4000, morphoBorrowData); // Morpho borrow

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

        // No conversions (same-asset: wstETH collateral stays wstETH, WETH debt stays WETH)
        bytes memory settlementPayload = hex"";

        bytes memory orderData = abi.encodePacked(root, uint16(0));

        uint256 flashLoanAmount = aaveDebtBefore;

        bytes memory executionData = abi.encodePacked(
            uint8(2),                 // 2 pre-actions
            uint8(2),                 // 2 post-actions
            address(0),               // no fee recipient
            // Pre: repay WETH debt on Aave
            _action(WETH, type(uint112).max, user, 2, 0, repayData, pr0),
            // Pre: withdraw all wstETH from Aave
            _action(WSTETH, type(uint112).max, address(settlement), 3, 0, withdrawData, pr1),
            // Post: deposit wstETH to Morpho (amount=0 → balance)
            _action(WSTETH, 0, user, 0, 4000, morphoDepositData, pr2),
            // Post: borrow WETH from Morpho (to repay flash loan)
            _action(WETH, uint112(flashLoanAmount), address(settlement), 1, 4000, morphoBorrowData, pr3)
        );

        // ── Sign and execute ──
        uint48 deadline = uint48(block.timestamp + 1 hours);
        bytes memory sig = _signOrder(userPk, root, deadline, settlementPayload);

        settlement.settleWithFlashLoan(
            WETH,
            flashLoanAmount,
            MORPHO_BLUE,       // flash loan source
            0,                 // poolId
            0,                 // maxFeeBps = 0 (fee-free)
            deadline,
            sig,
            orderData,
            executionData,
            hex""              // no filler calldata (no swap needed)
        );

        // ── Verify: Aave position closed ──
        uint256 aaveCollAfter = IERC20(aWstETH).balanceOf(user);
        uint256 aaveDebtAfter = IERC20(vDebtWETH).balanceOf(user);

        console.log("--- Post-migration ---");
        console.log("Aave aWstETH :", aaveCollAfter);
        console.log("Aave WETH debt:", aaveDebtAfter);

        assertEq(aaveDebtAfter, 0, "Aave debt should be fully repaid");
        assertEq(aaveCollAfter, 0, "Aave collateral should be fully withdrawn");

        // ── Verify: Morpho position opened ──
        (, uint128 morphoBorrowShares, uint128 morphoCollateral) =
            IMorpho(MORPHO_BLUE).position(MORPHO_MARKET_ID, user);

        console.log("Morpho collateral (wstETH):", morphoCollateral);
        console.log("Morpho borrow shares:", morphoBorrowShares);

        assertGt(morphoCollateral, 0, "user should have Morpho collateral");
        assertGt(morphoBorrowShares, 0, "user should have Morpho debt");

        // Collateral should be approximately what was on Aave (minus dust)
        assertApproxEqRel(morphoCollateral, aaveCollBefore, 0.001e18, "collateral ~= original");

        // ── Verify: settlement contract is clean ──
        assertEq(IERC20(WETH).balanceOf(address(settlement)), 0, "no WETH left in settlement");
        // wstETH dust may remain due to balance-sentinel deposit
        assertLt(IERC20(WSTETH).balanceOf(address(settlement)), 10, "no significant wstETH left");

        console.log("Aave -> Morpho migration completed successfully!");
    }
}
