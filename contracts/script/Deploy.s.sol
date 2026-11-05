// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {EvenhandDeposits} from "../src/EvenhandDeposits.sol";

/// Deploys EvenhandDeposits to Whitechain Sepolia and records it in packages/shared/deployments.json.
///   cd contracts && forge script script/Deploy.s.sol --rpc-url whitechain --broadcast \
///     --verify --verifier blockscout --verifier-url https://explorer.testnet.whitechain.io/api/
/// Env: DEPLOYER_PRIVATE_KEY, INSPECTOR_PRIVATE_KEY (only its address is used), ARBITER_ADDRESS,
///      optional USDT_ADDRESS, APPEAL_WINDOW_SECONDS (600), GRACE_SECONDS (3600).
contract Deploy is Script {
    address internal constant WHITECHAIN_USDT = 0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7;
    uint16 internal constant AUTO_CAP_BPS = 5000;
    uint16 internal constant MIN_CONFIDENCE_BPS = 7500;

    function run() external returns (EvenhandDeposits deposits) {
        address usdt = vm.envOr("USDT_ADDRESS", WHITECHAIN_USDT);
        address inspector = vm.addr(vm.envUint("INSPECTOR_PRIVATE_KEY"));
        address arbiter = vm.envAddress("ARBITER_ADDRESS");
        uint40 appealWindow = uint40(vm.envOr("APPEAL_WINDOW_SECONDS", uint256(600)));
        uint40 grace = uint40(vm.envOr("GRACE_SECONDS", uint256(3600)));

        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        deposits = new EvenhandDeposits(usdt, inspector, arbiter, appealWindow, grace, AUTO_CAP_BPS, MIN_CONFIDENCE_BPS);
        vm.stopBroadcast();
        console.log("EvenhandDeposits", address(deposits));

        if (block.chainid != 1874) return deposits; // dry runs never touch deployments.json
        string memory o = "deployment";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeUint(o, "blockNumber", block.number);
        vm.serializeAddress(o, "usdt", usdt);
        vm.serializeAddress(o, "inspector", inspector);
        vm.serializeAddress(o, "arbiter", arbiter);
        vm.serializeUint(o, "appealWindow", appealWindow);
        vm.serializeUint(o, "grace", grace);
        vm.serializeUint(o, "autoCapBps", AUTO_CAP_BPS);
        vm.serializeUint(o, "minConfidenceBps", MIN_CONFIDENCE_BPS);
        string memory json = vm.serializeAddress(o, "EvenhandDeposits", address(deposits));
        vm.writeJson(json, "../packages/shared/deployments.json");
    }
}
