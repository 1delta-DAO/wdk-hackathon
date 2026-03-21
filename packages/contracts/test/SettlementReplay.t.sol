// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test, console} from "forge-std/Test.sol";

/**
 * @title SettlementReplay
 * @notice Replays a failed settlement multicall against an Arbitrum fork to
 *         get a full execution trace and identify the exact revert point.
 *
 * Run with:
 *   forge test --match-test test_replayFailedSettlement -vvvv \
 *     --fork-url $ARBITRUM_RPC_URL \
 *     --fork-block-number <block at time of failure>
 *
 * The --fork-block-number should be the block number at the time estimateGas
 * was called so state (balances, allowances, nonces) matches exactly.
 *
 * If --fork-block-number is omitted it forks at latest, which is fine for
 * diagnosing the issue as long as the order deadline has not expired.
 */
contract SettlementReplayTest is Test {
    // ── Addresses from the failed tx ──────────────────────────────────────────
    address constant SOLVER     = 0x5344B32F3713bFDd690571170594CEe5569B7812;
    address constant SETTLEMENT = 0x2FA48F02923a0C93326A68aA26E3a0b836d5685F;
    address constant USER       = 0x334d52E24d452fa20489f07Bd943b7cF943Cb881;
    address constant USDT       = 0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9;
    address constant WETH       = 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1;
    address constant MORPHO     = 0x6c247b1F6182318877311737BaC0844bAa518F5e;
    address constant AAVE_POOL  = 0x794a61358D6845594F94dc1DB02A252b5b4814aD;
    address constant COMPOUND_COMET = 0xd98Be00b5D27fc98112BdE293e487f8D4cA57d07;

    // ── Full multicall calldata from the failed estimateGas ───────────────────
    // Paste the "data" field from the error object below.
    bytes constant CALLDATA = hex"ac9650d80000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000700000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000220000000000000000000000000000000000000000000000000000000000000036000000000000000000000000000000000000000000000000000000000000004c00000000000000000000000000000000000000000000000000000000000000560000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000006a00000000000000000000000000000000000000000000000000000000000000104d339056d000000000000000000000000e50fa9b3c56ffb159cb0fca61f5c9d750e8128c8000000000000000000000000334d52e24d452fa20489f07bd943b7cf943cb8810000000000000000000000002fa48f02923a0c93326a68aa26e3a0b836d5685fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0000000000000000000000000000000000000000000000000000000069be6d17000000000000000000000000000000000000000000000000000000000000001b9e36baadc014169659a9494a52d7857fb26efd62239d82a847fd839d2285eeef5dcc70292afe32c6825385a1e6073cf16734f2f197fbedc8b8ba71b28758fa88000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000104db7611dd000000000000000000000000fb00ac187a8eb5afae4eace434f493eb62672df7000000000000000000000000334d52e24d452fa20489f07bd943b7cf943cb8810000000000000000000000002fa48f02923a0c93326a68aa26e3a0b836d5685fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0000000000000000000000000000000000000000000000000000000069be6d17000000000000000000000000000000000000000000000000000000000000001c2408c8237e0cba6b88887b970a936eb784501e19594c5e7e5fa4b9de4b424f5c5f73cc4dfcd5ea12c7c5153975215865ae8f16005f8c6397a75aeaeec882b307000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000124cd89835b000000000000000000000000d98be00b5d27fc98112bde293e487f8d4ca57d07000000000000000000000000334d52e24d452fa20489f07bd943b7cf943cb8810000000000000000000000002fa48f02923a0c93326a68aa26e3a0b836d5685f000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000069be6d17000000000000000000000000000000000000000000000000000000000000001bba2e367e3043f9b56c5136aa21d47b1f16173eb1a5e325517933356647ea5b936b9b0ac01417e9bedd7aafceb847d5f56a8e4eb18c4d693d2fc39e760498824f000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000064da3e3397000000000000000000000000fd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9000000000000000000000000d98be00b5d27fc98112bde293e487f8d4ca57d07ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000064da3e339700000000000000000000000082af49447d8a07e3bd95bd0d56f35241523fbab1000000000000000000000000794a61358d6845594f94dc1db02a252b5b4814adffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000064da3e3397000000000000000000000000fd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb90000000000000000000000006c247b1f6182318877311737bac0844baa518f5e00000000000000000000000000000000000000000000000000000000000f42e80000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006247d123f36000000000000000000000000fd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb900000000000000000000000000000000000000000000000000000000000f42e80000000000000000000000006c247b1f6182318877311737bac0844baa518f5e0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000138800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000069be6d21000000000000000000000000000000000000000000000000000000000000016000000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000280000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000418418e6e3a497cd5c43c432d1aaa267d062285f0b1665a04824aa01d07664e0004cd84ddd3b8b2eb5c043ea892010c793e54c7e3d29373b02496d1789716626701c00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006e33f75017397fd442ad830971b687080300a968a47cf9799ff0086e8e0ff3b13b004c00020000794a61358d6845594f94dc1db02a252b5b4814ad00000000000010a741a46278000007d0d98be00b5d27fc98112bde293e487f8d4ca57d07ffff00000000000010a741a462780000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000035802025344b32f3713bfdd690571170594cee5569b7812fd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9ffffffffffffffffffffffffffff334d52e24d452fa20489f07bd943b7cf943cb8810207d00014d98be00b5d27fc98112bde293e487f8d4ca57d0704a83f652e0cf731534dfa6dbf7d9faafa4d73b5f1aeb2bc119404d8233685438d8c4b910f50702543f88355b7a7d4e7e4b04e6a82dc387e488079dcf7050ba2b2167a18ccaa63ac0575e7165e287caa1113ea35f1bd5e3a79cb0738c12cdb82e4c0b3e5f6094d614a1d6745bfb366a7d9541e7dbfccce42f4c5c7e8595b13f99a82af49447d8a07e3bd95bd0d56f35241523fbab1ffffffffffffffffffffffffffff2fa48f02923a0c93326a68aa26e3a0b836d5685f0307d0001500d98be00b5d27fc98112bde293e487f8d4ca57d07049f6de61031889bd77a88b418ac333f9ec466f34af3b3762e8021366c0cc703d88c4b910f50702543f88355b7a7d4e7e4b04e6a82dc387e488079dcf7050ba2b2167a18ccaa63ac0575e7165e287caa1113ea35f1bd5e3a79cb0738c12cdb82e4c0b3e5f6094d614a1d6745bfb366a7d9541e7dbfccce42f4c5c7e8595b13f99a82af49447d8a07e3bd95bd0d56f35241523fbab10000000000000000000000000000334d52e24d452fa20489f07bd943b7cf943cb8810000000014794a61358d6845594f94dc1db02a252b5b4814ad04a05733d454a5541c56613a6e340ad4e5b1979f6251287d296e7fd76003f5237edbf3776ab8fe0c6016718b2676b9d779735758b64f7d59fa606264fbdd22fa83a84fb1be1c214d75288ff1fd428c3b35c2dfc01328aa4cc7aad9d22fce1421b3c0b3e5f6094d614a1d6745bfb366a7d9541e7dbfccce42f4c5c7e8595b13f99afd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb900000000000000000000000f44772fa48f02923a0c93326a68aa26e3a0b836d5685f010000001502794a61358d6845594f94dc1db02a252b5b4814ad04fad9c09d778911b00695ad8dfd40b3a75080187674534f00a40142c5086f14aadbf3776ab8fe0c6016718b2676b9d779735758b64f7d59fa606264fbdd22fa83a84fb1be1c214d75288ff1fd428c3b35c2dfc01328aa4cc7aad9d22fce1421b3c0b3e5f6094d614a1d6745bfb366a7d9541e7dbfccce42f4c5c7e8595b13f99a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

    function setUp() public {
        // Fork Arbitrum at latest (or pass --fork-block-number to pin a block)
        try vm.envString("ARBITRUM_RPC_URL") returns (string memory rpcUrl) {
            vm.createSelectFork(rpcUrl);
        } catch {
            // No RPC → skip
        }
    }

    // ── Replay the exact failing transaction ──────────────────────────────────

    function test_replayFailedSettlement() public {
        if (block.chainid != 42161) {
            console.log("Skipping: not on Arbitrum fork (chainid=%d)", block.chainid);
            return;
        }

        console.log("=== Pre-flight state ===");
        console.log("Block:        ", block.number);
        console.log("Block.ts:     ", block.timestamp);

        // Print allowances from settlement contract before execution
        _printUsdtAllowance("USDT->comet   ", SETTLEMENT, COMPOUND_COMET);
        _printUsdtAllowance("USDT->morpho  ", SETTLEMENT, MORPHO);
        _printUsdtAllowance("WETH->aavePool", SETTLEMENT, AAVE_POOL);

        // Print user's USDT debt on Compound V3
        (bool ok, bytes memory data) = COMPOUND_COMET.staticcall(
            abi.encodeWithSignature("borrowBalanceOf(address)", USER)
        );
        if (ok && data.length >= 32) {
            console.log("User USDT borrow on Compound: ", abi.decode(data, (uint256)));
        }

        // Print Morpho USDT balance (flash loan liquidity)
        (ok, data) = USDT.staticcall(abi.encodeWithSignature("balanceOf(address)", MORPHO));
        if (ok && data.length >= 32) {
            console.log("Morpho USDT balance:          ", abi.decode(data, (uint256)));
        }

        console.log("\n=== Replaying multicall as solver ===");
        vm.prank(SOLVER);
        (bool success, bytes memory result) = SETTLEMENT.call(CALLDATA);

        if (success) {
            console.log("SUCCESS - tx would have gone through");
        } else {
            console.log("REVERTED");
            if (result.length >= 4) {
                bytes4 selector;
                assembly { selector := mload(add(result, 0x20)) }
                console.logBytes4(selector);
            }
            if (result.length > 0) {
                console.logBytes(result);
            } else {
                console.log("No revert data (require(false) or OOG)");
            }
        }

        // Force the test to fail so forge prints the full --vvvv trace
        assertEq(success, true, "Settlement multicall reverted - see trace above (-vvvv)");
    }

    // ── Bisect: replay each multicall sub-call individually ──────────────────
    // Useful to find which of the 7 sub-calls is the culprit.

    function test_bisectMulticall() public {
        if (block.chainid != 42161) return;

        // Sub-call selectors (for labeling)
        string[7] memory labels = [
            "aaveDelegWithSig (vWETH?)",
            "aaveDelegWithSig (vUSDT?)",
            "compoundV3AllowBySig",
            "approveToken USDT->comet",
            "approveToken WETH->aavePool",
            "approveToken USDT->morpho",
            "settleWithFlashLoan"
        ];

        // Build individual calls from the raw calldata by decoding bytes[]
        // ABI: multicall(bytes[]) — skip the 4-byte selector and decode the rest
        bytes memory payload = CALLDATA;
        bytes[] memory calls = abi.decode(
            _slice(payload, 4, payload.length - 4),
            (bytes[])
        );

        console.log("=== Bisecting %d sub-calls ===", calls.length);

        for (uint256 i = 0; i < calls.length; i++) {
            string memory label = i < 7 ? labels[i] : "unknown";

            // Use a snapshot so each call starts from the same state
            uint256 snap = vm.snapshot();

            vm.prank(SOLVER);
            (bool success, bytes memory result) = SETTLEMENT.call(
                abi.encodeWithSignature("multicall(bytes[])", _singleElementArray(calls[i]))
            );

            if (success) {
                console.log("[%d] OK   - %s", i, label);
            } else {
                console.log("[%d] FAIL - %s", i, label);
                if (result.length >= 4) {
                    bytes4 sel;
                    assembly { sel := mload(add(result, 0x20)) }
                    console.logBytes4(sel);
                } else {
                    console.log("     (no revert data)");
                }
            }

            vm.revertTo(snap);
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _printUsdtAllowance(string memory label, address owner, address spender) internal view {
        (bool ok, bytes memory data) = USDT.staticcall(
            abi.encodeWithSignature("allowance(address,address)", owner, spender)
        );
        if (ok && data.length >= 32) {
            console.log(label, abi.decode(data, (uint256)));
        }
    }

    function _slice(bytes memory b, uint256 start, uint256 len) internal pure returns (bytes memory) {
        bytes memory result = new bytes(len);
        for (uint256 i = 0; i < len; i++) {
            result[i] = b[start + i];
        }
        return result;
    }

    function _singleElementArray(bytes memory element) internal pure returns (bytes[] memory arr) {
        arr = new bytes[](1);
        arr[0] = element;
    }
}
