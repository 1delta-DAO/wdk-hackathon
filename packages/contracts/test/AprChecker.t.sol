// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {AaveV3AprChecker} from "../src/core/settlement/apr/AaveV3AprChecker.sol";
import {IAaveV3Pool} from "../src/core/settlement/apr/IAaveV3Pool.sol";

contract MockAaveV3Pool {
    uint128 public borrowRate;

    constructor(uint128 _borrowRate) {
        borrowRate = _borrowRate;
    }

    function setBorrowRate(uint128 _borrowRate) external {
        borrowRate = _borrowRate;
    }

    function getReserveData(address) external view returns (IAaveV3Pool.ReserveDataLegacy memory data) {
        data.currentVariableBorrowRate = borrowRate;
    }
}

/// @dev Concrete harness that exposes the internal _requireBorrowRateImproved
contract AprCheckerHarness is AaveV3AprChecker {
    function requireBorrowRateImproved(
        address sourcePool,
        address destPool,
        address asset
    ) external view {
        _requireBorrowRateImproved(sourcePool, destPool, asset);
    }
}

contract AprCheckerTest is Test {
    AprCheckerHarness checker;
    MockAaveV3Pool sourcePool;
    MockAaveV3Pool destPool;
    address constant ASSET = address(0xA55E7);

    function setUp() public {
        checker = new AprCheckerHarness();
        sourcePool = new MockAaveV3Pool(0);
        destPool = new MockAaveV3Pool(0);
    }

    function test_borrowRateImproved_passes() public {
        sourcePool.setBorrowRate(5e25); // 5% in ray
        destPool.setBorrowRate(3e25);   // 3% in ray

        checker.requireBorrowRateImproved(address(sourcePool), address(destPool), ASSET);
    }

    function test_borrowRateImproved_reverts_worse() public {
        sourcePool.setBorrowRate(3e25);
        destPool.setBorrowRate(5e25);

        vm.expectRevert(AaveV3AprChecker.DestinationRateNotBetter.selector);
        checker.requireBorrowRateImproved(address(sourcePool), address(destPool), ASSET);
    }

    function test_borrowRateImproved_reverts_equal() public {
        sourcePool.setBorrowRate(4e25);
        destPool.setBorrowRate(4e25);

        vm.expectRevert(AaveV3AprChecker.DestinationRateNotBetter.selector);
        checker.requireBorrowRateImproved(address(sourcePool), address(destPool), ASSET);
    }
}
