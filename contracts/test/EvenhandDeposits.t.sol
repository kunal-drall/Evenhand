// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {EvenhandDeposits} from "../src/EvenhandDeposits.sol";
import {MockUSDT} from "./mocks/MockUSDT.sol";

contract EvenhandDepositsTest is Test {
    EvenhandDeposits internal d;
    MockUSDT internal usdt;

    address internal inspector = makeAddr("inspector");
    address internal arbiter = makeAddr("arbiter");
    address internal relayer = makeAddr("relayer");
    address internal owner = makeAddr("owner");
    address internal stranger = makeAddr("stranger");
    uint256 internal renterKey = 0xA11CE;
    address internal renter;

    uint96 internal constant DEPOSIT = 200e6;
    uint40 internal constant WINDOW = 600;
    uint40 internal constant GRACE = 3600;
    bytes32 internal constant ID = keccak256("rental-1");
    bytes32 internal constant ROOT = keccak256("inspection-log");
    uint16[4] internal schedule = [uint16(0), 1000, 3500, 10000];

    function setUp() public {
        renter = vm.addr(renterKey);
        usdt = new MockUSDT();
        d = new EvenhandDeposits(address(usdt), inspector, arbiter, WINDOW, GRACE, 5000, 7500);
        usdt.mint(renter, 1000e6);
        vm.warp(1_800_000_000);
    }

    // ---------------------------------------------------------------- helpers

    function _create() internal {
        vm.prank(inspector);
        d.createRental(ID, owner, renter, DEPOSIT, uint40(block.timestamp + 1 days), schedule, keccak256("terms"));
    }

    function _auth(uint256 value, bytes32 nonce) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        (v, r, s) = vm.sign(renterKey, usdt.digest(renter, address(d), value, 0, block.timestamp + 1 hours, nonce));
    }

    function _fund() internal {
        bytes32 nonce = d.fundingNonce(ID);
        (uint8 v, bytes32 r, bytes32 s) = _auth(DEPOSIT, nonce);
        vm.prank(relayer);
        d.fundWithAuthorization(ID, 0, block.timestamp + 1 hours, nonce, v, r, s);
    }

    function _toReturned() internal {
        _create();
        _fund();
        vm.startPrank(inspector);
        d.recordPickup(ID, keccak256("pickup"));
        d.recordReturn(ID, keccak256("return"));
        vm.stopPrank();
    }

    function _sev(uint8 top) internal pure returns (uint8[6] memory s) {
        s[4] = top;
    }

    function _propose(uint8 top, uint16 confidence) internal {
        vm.prank(inspector);
        d.proposeVerdict(ID, _sev(top), confidence, ROOT, "", "");
    }

    function _state() internal view returns (EvenhandDeposits.State) {
        return d.getRental(ID).state;
    }

    // ---------------------------------------------------------------- create

    function test_createRental_storesTerms() public {
        _create();
        EvenhandDeposits.Rental memory r = d.getRental(ID);
        assertEq(r.owner, owner);
        assertEq(r.renter, renter);
        assertEq(r.deposit, DEPOSIT);
        assertEq(r.scheduleBps[2], 3500);
        assertEq(r.termsHash, keccak256("terms"));
        assertEq(uint8(r.state), uint8(EvenhandDeposits.State.None));
    }

    function test_createRental_onlyInspector_onlyOnce() public {
        vm.expectRevert(EvenhandDeposits.NotInspector.selector);
        d.createRental(ID, owner, renter, DEPOSIT, uint40(block.timestamp + 1), schedule, 0);
        _create();
        vm.prank(inspector);
        vm.expectRevert(EvenhandDeposits.AlreadyCreated.selector);
        d.createRental(ID, owner, renter, DEPOSIT, uint40(block.timestamp + 1 days), schedule, 0);
    }

    function test_createRental_validates() public {
        vm.startPrank(inspector);
        vm.expectRevert(EvenhandDeposits.ZeroAddress.selector);
        d.createRental(ID, address(0), renter, DEPOSIT, uint40(block.timestamp + 1), schedule, 0);
        vm.expectRevert(EvenhandDeposits.InvalidParams.selector);
        d.createRental(ID, owner, renter, 0, uint40(block.timestamp + 1), schedule, 0);
        vm.expectRevert(EvenhandDeposits.InvalidParams.selector);
        d.createRental(ID, owner, renter, DEPOSIT, uint40(block.timestamp), schedule, 0);
        vm.expectRevert(EvenhandDeposits.InvalidParams.selector);
        d.createRental(ID, owner, renter, DEPOSIT, uint40(block.timestamp + 1), [uint16(1), 1000, 3500, 10000], 0);
        vm.expectRevert(EvenhandDeposits.InvalidParams.selector);
        d.createRental(ID, owner, renter, DEPOSIT, uint40(block.timestamp + 1), [uint16(0), 1000, 3500, 10001], 0);
        vm.expectRevert(EvenhandDeposits.InvalidParams.selector);
        d.createRental(ID, owner, owner, DEPOSIT, uint40(block.timestamp + 1), schedule, 0);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- fund

    function test_fund_pullsDepositFromRenter_anyoneSubmits() public {
        _create();
        _fund();
        assertEq(uint8(_state()), uint8(EvenhandDeposits.State.Funded));
        assertEq(usdt.balanceOf(address(d)), DEPOSIT);
        assertEq(usdt.balanceOf(renter), 1000e6 - DEPOSIT);
    }

    function test_fund_neverCreatedReverts() public {
        (uint8 v, bytes32 r, bytes32 s) = _auth(DEPOSIT, bytes32(uint256(1)));
        vm.expectRevert(EvenhandDeposits.NotCreated.selector);
        d.fundWithAuthorization(ID, 0, block.timestamp + 1 hours, bytes32(uint256(1)), v, r, s);
    }

    function test_fund_onlyOnce() public {
        _create();
        _fund();
        (uint8 v, bytes32 r, bytes32 s) = _auth(DEPOSIT, bytes32(uint256(2)));
        vm.expectRevert(abi.encodeWithSelector(EvenhandDeposits.WrongState.selector, EvenhandDeposits.State.Funded));
        d.fundWithAuthorization(ID, 0, block.timestamp + 1 hours, bytes32(uint256(2)), v, r, s);
    }

    function test_fund_wrongAmountSignatureReverts() public {
        _create();
        bytes32 nonce = d.fundingNonce(ID);
        (uint8 v, bytes32 r, bytes32 s) = _auth(DEPOSIT - 1, nonce);
        vm.expectRevert("invalid signature");
        d.fundWithAuthorization(ID, 0, block.timestamp + 1 hours, nonce, v, r, s);
    }

    function test_fund_authorizationForAnotherRentalReverts() public {
        _create();
        bytes32 other = keccak256("rental-2");
        vm.prank(inspector);
        d.createRental(other, owner, renter, DEPOSIT, uint40(block.timestamp + 1 days), schedule, 0);
        bytes32 nonceForId = d.fundingNonce(ID);
        (uint8 v, bytes32 r, bytes32 s) = _auth(DEPOSIT, nonceForId);
        vm.expectRevert(EvenhandDeposits.WrongNonce.selector);
        d.fundWithAuthorization(other, 0, block.timestamp + 1 hours, nonceForId, v, r, s);
        d.fundWithAuthorization(ID, 0, block.timestamp + 1 hours, nonceForId, v, r, s);
        assertEq(uint8(_state()), uint8(EvenhandDeposits.State.Funded));
    }

    function test_fund_signatureCannotBeFrontRunAsTransfer() public {
        _create();
        (uint8 v, bytes32 r, bytes32 s) = _auth(DEPOSIT, bytes32(uint256(1)));
        vm.prank(stranger);
        vm.expectRevert("caller must be the payee");
        usdt.receiveWithAuthorization(renter, address(d), DEPOSIT, 0, block.timestamp + 1 hours, bytes32(uint256(1)), v, r, s);
    }

    // ---------------------------------------------------------------- pickup / return

    function test_recordPickupAndReturn_transitions() public {
        _toReturned();
        EvenhandDeposits.Rental memory r = d.getRental(ID);
        assertEq(uint8(r.state), uint8(EvenhandDeposits.State.Returned));
        assertEq(r.pickupManifest, keccak256("pickup"));
        assertEq(r.returnManifest, keccak256("return"));
    }

    function test_recordPickup_requiresFundingAndInspector() public {
        _create();
        vm.prank(inspector);
        vm.expectRevert(abi.encodeWithSelector(EvenhandDeposits.WrongState.selector, EvenhandDeposits.State.None));
        d.recordPickup(ID, keccak256("pickup"));
        _fund();
        vm.expectRevert(EvenhandDeposits.NotInspector.selector);
        d.recordPickup(ID, keccak256("pickup"));
        vm.prank(inspector);
        vm.expectRevert(abi.encodeWithSelector(EvenhandDeposits.WrongState.selector, EvenhandDeposits.State.Funded));
        d.recordReturn(ID, keccak256("return"));
    }

    // ---------------------------------------------------------------- verdict

    function test_propose_moderateScratch_opensAppealWindow() public {
        _toReturned();
        _propose(2, 8700);
        EvenhandDeposits.Rental memory r = d.getRental(ID);
        assertEq(uint8(r.state), uint8(EvenhandDeposits.State.Proposed));
        assertEq(r.proposedCapture, 70e6); // 35% of 200
        assertEq(r.proposedAt, block.timestamp);
        assertEq(r.inspectionRoot, ROOT);
        assertEq(r.confidenceBps, 8700);
    }

    function test_propose_aboveAutoCap_goesToArbiter() public {
        _toReturned();
        vm.expectEmit(address(d));
        emit EvenhandDeposits.VerdictProposed(ID, DEPOSIT, 9000, ROOT, true);
        _propose(3, 9000); // 100% > 50% cap
        assertEq(uint8(_state()), uint8(EvenhandDeposits.State.Appealed));
    }

    function test_propose_lowConfidence_goesToArbiter() public {
        _toReturned();
        _propose(1, 7499);
        assertEq(uint8(_state()), uint8(EvenhandDeposits.State.Appealed));
    }

    function test_propose_validates() public {
        _toReturned();
        uint8[6] memory bad;
        bad[0] = 4;
        vm.startPrank(inspector);
        vm.expectRevert(EvenhandDeposits.InvalidParams.selector);
        d.proposeVerdict(ID, bad, 9000, ROOT, "", "");
        vm.expectRevert(EvenhandDeposits.InvalidParams.selector);
        d.proposeVerdict(ID, _sev(1), 10_001, ROOT, "", "");
        vm.expectRevert(EvenhandDeposits.InvalidParams.selector);
        d.proposeVerdict(ID, _sev(1), 9000, bytes32(0), "", "");
        vm.stopPrank();
        vm.expectRevert(EvenhandDeposits.NotInspector.selector);
        d.proposeVerdict(ID, _sev(1), 9000, ROOT, "", "");
    }

    // ---------------------------------------------------------------- settle

    function test_finalize_afterWindow_paysOwnerAndRenterInOneTx() public {
        _toReturned();
        _propose(2, 8700);
        vm.expectRevert(EvenhandDeposits.TooEarly.selector);
        d.finalize(ID);
        vm.warp(block.timestamp + WINDOW + 1);
        uint256 renterBefore = usdt.balanceOf(renter);
        vm.prank(stranger);
        d.finalize(ID);
        assertEq(usdt.balanceOf(owner), 70e6);
        assertEq(usdt.balanceOf(renter) - renterBefore, 130e6);
        assertEq(usdt.balanceOf(address(d)), 0);
        assertEq(uint8(_state()), uint8(EvenhandDeposits.State.Settled));
    }

    function test_finalize_smudgeOnly_fullRefund() public {
        _toReturned();
        _propose(0, 9500);
        vm.warp(block.timestamp + WINDOW + 1);
        d.finalize(ID);
        assertEq(usdt.balanceOf(owner), 0);
        assertEq(usdt.balanceOf(renter), 1000e6);
    }

    function test_appeal_byPartyInWindow_thenArbiterSettles() public {
        _toReturned();
        _propose(2, 8700);
        vm.prank(stranger);
        vm.expectRevert(EvenhandDeposits.NotParty.selector);
        d.appeal(ID);
        vm.prank(renter);
        d.appeal(ID);
        assertEq(uint8(_state()), uint8(EvenhandDeposits.State.Appealed));
        vm.expectRevert(abi.encodeWithSelector(EvenhandDeposits.WrongState.selector, EvenhandDeposits.State.Appealed));
        d.finalize(ID);

        vm.expectRevert(EvenhandDeposits.NotArbiter.selector);
        d.resolveAppeal(ID, 20e6);
        vm.startPrank(arbiter);
        vm.expectRevert(EvenhandDeposits.CaptureTooHigh.selector);
        d.resolveAppeal(ID, DEPOSIT + 1);
        d.resolveAppeal(ID, 20e6);
        vm.stopPrank();
        assertEq(usdt.balanceOf(owner), 20e6);
        assertEq(usdt.balanceOf(renter), 1000e6 - 20e6);
        assertEq(uint8(_state()), uint8(EvenhandDeposits.State.Settled));
    }

    function test_appeal_afterWindowReverts() public {
        _toReturned();
        _propose(2, 8700);
        vm.warp(block.timestamp + WINDOW + 1);
        vm.prank(owner);
        vm.expectRevert(EvenhandDeposits.WindowClosed.selector);
        d.appeal(ID);
    }

    // ---------------------------------------------------------------- waive / timeout

    function test_waive_ownerReleasesFullDeposit() public {
        _toReturned();
        vm.prank(stranger);
        vm.expectRevert(EvenhandDeposits.NotOwner.selector);
        d.waive(ID);
        vm.prank(owner);
        d.waive(ID);
        assertEq(usdt.balanceOf(renter), 1000e6);
        assertEq(uint8(_state()), uint8(EvenhandDeposits.State.Refunded));
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(EvenhandDeposits.WrongState.selector, EvenhandDeposits.State.Refunded));
        d.waive(ID);
    }

    function test_waive_unfundedCancels() public {
        _create();
        vm.prank(owner);
        d.waive(ID);
        assertEq(uint8(_state()), uint8(EvenhandDeposits.State.Refunded));
        (uint8 v, bytes32 r, bytes32 s) = _auth(DEPOSIT, bytes32(uint256(1)));
        vm.expectRevert(abi.encodeWithSelector(EvenhandDeposits.WrongState.selector, EvenhandDeposits.State.Refunded));
        d.fundWithAuthorization(ID, 0, block.timestamp + 1 hours, bytes32(uint256(1)), v, r, s);
    }

    function test_refundOnTimeout_afterReturnByPlusGrace() public {
        _toReturned();
        uint256 deadline = d.getRental(ID).returnBy + uint256(GRACE);
        vm.warp(deadline);
        vm.expectRevert(EvenhandDeposits.TooEarly.selector);
        d.refundOnTimeout(ID);
        vm.warp(deadline + 1);
        vm.prank(stranger);
        d.refundOnTimeout(ID);
        assertEq(usdt.balanceOf(renter), 1000e6);
        assertEq(uint8(_state()), uint8(EvenhandDeposits.State.Refunded));
    }

    function test_refundOnTimeout_fundedButNeverPickedUp() public {
        _create();
        _fund();
        vm.warp(d.getRental(ID).returnBy + uint256(GRACE) + 1);
        d.refundOnTimeout(ID);
        assertEq(usdt.balanceOf(renter), 1000e6);
    }

    function test_itemNeverReturned_goesToArbiterNotRefund() public {
        _create();
        _fund();
        vm.prank(inspector);
        d.recordPickup(ID, keccak256("pickup"));
        uint256 deadline = d.getRental(ID).returnBy + uint256(GRACE);
        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(EvenhandDeposits.WrongState.selector, EvenhandDeposits.State.PickedUp));
        d.refundOnTimeout(ID);
        vm.prank(stranger);
        d.escalate(ID);
        assertEq(uint8(_state()), uint8(EvenhandDeposits.State.Appealed));
        vm.prank(arbiter);
        d.resolveAppeal(ID, DEPOSIT);
        assertEq(usdt.balanceOf(owner), DEPOSIT);
    }

    function test_escalate_pickedUpOnlyAfterDeadline() public {
        _create();
        _fund();
        vm.prank(inspector);
        d.recordPickup(ID, keccak256("pickup"));
        vm.expectRevert(EvenhandDeposits.TooEarly.selector);
        d.escalate(ID);
    }

    function test_lateReturn_cannotRaceTheVerdict() public {
        _create();
        _fund();
        vm.prank(inspector);
        d.recordPickup(ID, keccak256("pickup"));
        vm.warp(d.getRental(ID).returnBy + uint256(GRACE) + 100);
        vm.prank(inspector);
        d.recordReturn(ID, keccak256("return"));
        vm.expectRevert(EvenhandDeposits.TooEarly.selector);
        d.refundOnTimeout(ID); // the verdict window now runs from the return
        _propose(2, 8700);
        assertEq(uint8(_state()), uint8(EvenhandDeposits.State.Proposed));
    }

    function test_escalate_needsHumanFromReturned_onlyInspector() public {
        _toReturned();
        vm.expectRevert(EvenhandDeposits.NotInspector.selector);
        d.escalate(ID);
        vm.prank(inspector);
        d.escalate(ID);
        assertEq(uint8(_state()), uint8(EvenhandDeposits.State.Appealed));
        vm.prank(arbiter);
        d.resolveAppeal(ID, 0);
        assertEq(usdt.balanceOf(renter), 1000e6);
        vm.prank(inspector);
        vm.expectRevert(abi.encodeWithSelector(EvenhandDeposits.WrongState.selector, EvenhandDeposits.State.Settled));
        d.escalate(ID);
    }

    function test_refundOnTimeout_notAfterVerdict() public {
        _toReturned();
        _propose(2, 8700);
        vm.warp(d.getRental(ID).returnBy + uint256(GRACE) + 1);
        vm.expectRevert(abi.encodeWithSelector(EvenhandDeposits.WrongState.selector, EvenhandDeposits.State.Proposed));
        d.refundOnTimeout(ID);
    }

    // ---------------------------------------------------------------- P1 TEE check

    function _teeText(uint8 top, uint16 confidence) internal view returns (bytes memory) {
        return abi.encodePacked('{"rental_id":"x","angles":[],"overall_confidence":0.87,"text_in_image_ignored":false,', d.teeSuffix(ID, _sev(top), confidence));
    }

    function test_tee_correctSignatureSettles_tamperedSeverityReverts() public {
        uint256 teeKey = 0x7EE;
        vm.prank(arbiter);
        d.setTeeSigner(vm.addr(teeKey));
        _toReturned();

        bytes memory text = _teeText(2, 8700);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(teeKey, MessageHashUtils.toEthSignedMessageHash(text));
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.startPrank(inspector);
        vm.expectRevert(EvenhandDeposits.BadTeeText.selector);
        d.proposeVerdict(ID, _sev(1), 8700, ROOT, text, sig); // inspector claims a lower severity than the model signed
        (v, r, s) = vm.sign(0xBAD, MessageHashUtils.toEthSignedMessageHash(text));
        vm.expectRevert(EvenhandDeposits.BadTeeSignature.selector);
        d.proposeVerdict(ID, _sev(2), 8700, ROOT, text, abi.encodePacked(r, s, v));
        d.proposeVerdict(ID, _sev(2), 8700, ROOT, text, sig);
        vm.stopPrank();
        assertEq(uint8(_state()), uint8(EvenhandDeposits.State.Proposed));
    }

    function test_teeSuffix_format() public view {
        assertEq(
            d.teeSuffix(bytes32(uint256(0xab)), _sev(2), 8700),
            bytes('"eh":"EH1;0x00000000000000000000000000000000000000000000000000000000000000ab;0,0,0,0,2,0;8700"}')
        );
    }

    function test_setTeeSigner_onlyArbiter() public {
        vm.expectRevert(EvenhandDeposits.NotArbiter.selector);
        d.setTeeSigner(stranger);
    }

    // ---------------------------------------------------------------- invariant-style

    function testFuzz_settlementSplitsExactlyTheDeposit(uint96 deposit, uint16 bps) public {
        deposit = uint96(bound(deposit, 1, 1_000_000e6));
        bps = uint16(bound(bps, 0, 10_000));
        usdt.mint(renter, deposit);
        uint16[4] memory sched = [uint16(0), bps, bps, bps];
        vm.prank(inspector);
        d.createRental(ID, owner, renter, deposit, uint40(block.timestamp + 1 days), sched, 0);
        bytes32 nonce = d.fundingNonce(ID);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(renterKey, usdt.digest(renter, address(d), deposit, 0, block.timestamp + 1 hours, nonce));
        d.fundWithAuthorization(ID, 0, block.timestamp + 1 hours, nonce, v, r, s);
        vm.startPrank(inspector);
        d.recordPickup(ID, keccak256("p"));
        d.recordReturn(ID, keccak256("r"));
        d.proposeVerdict(ID, _sev(1), 9000, ROOT, "", "");
        vm.stopPrank();
        uint256 renterBefore = usdt.balanceOf(renter);
        if (_state() == EvenhandDeposits.State.Appealed) {
            uint96 capture = d.getRental(ID).proposedCapture; // read before prank: prank applies to the next call
            vm.prank(arbiter);
            d.resolveAppeal(ID, capture);
        } else {
            vm.warp(block.timestamp + WINDOW + 1);
            d.finalize(ID);
        }
        assertEq(usdt.balanceOf(owner) + (usdt.balanceOf(renter) - renterBefore), deposit);
        assertEq(usdt.balanceOf(address(d)), 0);
    }
}
