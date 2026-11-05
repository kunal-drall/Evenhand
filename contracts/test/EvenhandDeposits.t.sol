// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EvenhandDeposits} from "../src/EvenhandDeposits.sol";

/// Scaffold smoke test: proves forge-std and OpenZeppelin remappings resolve.
/// C1 replaces this with the full state-machine tests.
contract EvenhandDepositsTest is Test {
    function test_deploys() public {
        EvenhandDeposits d = new EvenhandDeposits();
        assertTrue(address(d).code.length > 0);
        assertEq(type(IERC20).interfaceId, IERC20.totalSupply.selector ^ IERC20.balanceOf.selector
            ^ IERC20.transfer.selector ^ IERC20.allowance.selector ^ IERC20.approve.selector
            ^ IERC20.transferFrom.selector);
    }
}
