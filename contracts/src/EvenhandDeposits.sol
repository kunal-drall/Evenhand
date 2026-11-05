// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @dev EIP-3009 pull used by TetherTokenV2: only executes when msg.sender == to.
interface IERC3009Receive {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

/// @title EvenhandDeposits
/// @notice Holds a rental's USDT deposit and settles it by the 0G inspection verdict
///         (docs/interfaces.md section 3). Funds only ever go to a rental's owner or renter.
contract EvenhandDeposits is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum State {
        None,
        Funded,
        PickedUp,
        Returned,
        Proposed,
        Appealed,
        Settled,
        Refunded
    }

    struct Rental {
        address owner;
        address renter;
        uint96 deposit;
        uint40 returnBy;
        uint40 proposedAt;
        State state;
        uint16[4] scheduleBps; // capture share by severity 0..3; [0] must be 0
        bytes32 termsHash;
        bytes32 pickupManifest;
        bytes32 returnManifest;
        bytes32 inspectionRoot;
        uint96 proposedCapture;
        uint16 confidenceBps;
    }

    uint16 private constant BPS = 10_000;

    IERC20 public immutable usdt;
    address public immutable inspector;
    address public immutable arbiter;
    uint40 public immutable appealWindow;
    uint40 public immutable grace;
    uint16 public immutable autoCapBps;
    uint16 public immutable minConfidenceBps;
    /// @notice 0G provider key whose EIP-191 signature must cover the verdict text (P1). Zero = P0 mode.
    address public teeSigner;

    mapping(bytes32 => Rental) private _rentals;

    event RentalCreated(bytes32 indexed id, address indexed owner, address indexed renter, uint96 deposit, uint40 returnBy, bytes32 termsHash);
    event Funded(bytes32 indexed id, uint96 amount);
    event PickupRecorded(bytes32 indexed id, bytes32 manifestHash);
    event ReturnRecorded(bytes32 indexed id, bytes32 manifestHash);
    event VerdictProposed(bytes32 indexed id, uint96 capture, uint16 confidenceBps, bytes32 inspectionRoot, bool needsArbiter);
    event Appealed(bytes32 indexed id, address by);
    event Settled(bytes32 indexed id, uint96 toOwner, uint96 toRenter);
    event Refunded(bytes32 indexed id, uint96 amount, bytes32 reason); // "TIMEOUT" | "WAIVED"
    event TeeSignerSet(address signer);

    error ZeroAddress();
    error InvalidParams();
    error NotInspector();
    error NotArbiter();
    error NotOwner();
    error NotParty();
    error AlreadyCreated();
    error NotCreated();
    error WrongState(State current);
    error TooEarly();
    error WindowClosed();
    error CaptureTooHigh();
    error DepositMismatch();
    error BadTeeSignature();
    error BadTeeText();

    modifier onlyInspector() {
        if (msg.sender != inspector) revert NotInspector();
        _;
    }

    modifier onlyArbiter() {
        if (msg.sender != arbiter) revert NotArbiter();
        _;
    }

    constructor(
        address usdt_,
        address inspector_,
        address arbiter_,
        uint40 appealWindow_,
        uint40 grace_,
        uint16 autoCapBps_,
        uint16 minConfidenceBps_
    ) {
        if (usdt_ == address(0) || inspector_ == address(0) || arbiter_ == address(0)) revert ZeroAddress();
        if (appealWindow_ == 0 || autoCapBps_ > BPS || minConfidenceBps_ > BPS) revert InvalidParams();
        usdt = IERC20(usdt_);
        inspector = inspector_;
        arbiter = arbiter_;
        appealWindow = appealWindow_;
        grace = grace_;
        autoCapBps = autoCapBps_;
        minConfidenceBps = minConfidenceBps_;
    }

    // ------------------------------------------------------------------ lifecycle

    function createRental(
        bytes32 id,
        address owner,
        address renter,
        uint96 deposit,
        uint40 returnBy,
        uint16[4] calldata scheduleBps,
        bytes32 termsHash
    ) external onlyInspector {
        Rental storage r = _rentals[id];
        if (r.owner != address(0)) revert AlreadyCreated();
        if (owner == address(0) || renter == address(0)) revert ZeroAddress();
        if (owner == renter || deposit == 0 || returnBy <= block.timestamp || scheduleBps[0] != 0) revert InvalidParams();
        for (uint256 i = 1; i < 4; i++) {
            if (scheduleBps[i] > BPS) revert InvalidParams();
        }
        r.owner = owner;
        r.renter = renter;
        r.deposit = deposit;
        r.returnBy = returnBy;
        r.scheduleBps = scheduleBps;
        r.termsHash = termsHash;
        emit RentalCreated(id, owner, renter, deposit, returnBy, termsHash);
    }

    /// @notice Pulls the renter's deposit with their EIP-3009 authorization. Anyone may submit it (the relayer pays gas);
    ///         receiveWithAuthorization only executes for msg.sender == to, so the signature cannot be front-run.
    function fundWithAuthorization(bytes32 id, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
    {
        Rental storage rental = _created(id);
        _expect(rental, State.None);
        rental.state = State.Funded;
        uint256 before = usdt.balanceOf(address(this));
        IERC3009Receive(address(usdt)).receiveWithAuthorization(rental.renter, address(this), rental.deposit, validAfter, validBefore, nonce, v, r, s);
        if (usdt.balanceOf(address(this)) - before != rental.deposit) revert DepositMismatch();
        emit Funded(id, rental.deposit);
    }

    function recordPickup(bytes32 id, bytes32 manifestHash) external onlyInspector {
        Rental storage r = _created(id);
        _expect(r, State.Funded);
        if (manifestHash == bytes32(0)) revert InvalidParams();
        r.pickupManifest = manifestHash;
        r.state = State.PickedUp;
        emit PickupRecorded(id, manifestHash);
    }

    function recordReturn(bytes32 id, bytes32 manifestHash) external onlyInspector {
        Rental storage r = _created(id);
        _expect(r, State.PickedUp);
        if (manifestHash == bytes32(0)) revert InvalidParams();
        r.returnManifest = manifestHash;
        r.state = State.Returned;
        emit ReturnRecorded(id, manifestHash);
    }

    /// @notice capture = deposit * scheduleBps[max(severity)] / 10_000. Above the auto cap or below the confidence
    ///         threshold the verdict goes straight to the arbiter (Appealed); otherwise the appeal window opens.
    function proposeVerdict(
        bytes32 id,
        uint8[6] calldata severity,
        uint16 confidenceBps,
        bytes32 inspectionRoot,
        bytes calldata teeText,
        bytes calldata teeSig
    ) external onlyInspector {
        Rental storage r = _created(id);
        _expect(r, State.Returned);
        if (confidenceBps > BPS || inspectionRoot == bytes32(0)) revert InvalidParams();
        uint8 worst;
        for (uint256 i = 0; i < 6; i++) {
            if (severity[i] > 3) revert InvalidParams();
            if (severity[i] > worst) worst = severity[i];
        }
        if (teeSigner != address(0)) _checkTee(id, severity, confidenceBps, teeText, teeSig);

        uint96 capture = uint96((uint256(r.deposit) * r.scheduleBps[worst]) / BPS);
        bool needsArbiter = uint256(capture) * BPS > uint256(r.deposit) * autoCapBps || confidenceBps < minConfidenceBps;
        r.proposedCapture = capture;
        r.confidenceBps = confidenceBps;
        r.inspectionRoot = inspectionRoot;
        if (needsArbiter) {
            r.state = State.Appealed;
        } else {
            r.state = State.Proposed;
            r.proposedAt = uint40(block.timestamp);
        }
        emit VerdictProposed(id, capture, confidenceBps, inspectionRoot, needsArbiter);
    }

    function appeal(bytes32 id) external {
        Rental storage r = _created(id);
        if (msg.sender != r.owner && msg.sender != r.renter) revert NotParty();
        _expect(r, State.Proposed);
        if (block.timestamp > uint256(r.proposedAt) + appealWindow) revert WindowClosed();
        r.state = State.Appealed;
        emit Appealed(id, msg.sender);
    }

    function resolveAppeal(bytes32 id, uint96 capture) external onlyArbiter nonReentrant {
        Rental storage r = _created(id);
        _expect(r, State.Appealed);
        if (capture > r.deposit) revert CaptureTooHigh();
        _settle(id, r, capture);
    }

    function finalize(bytes32 id) external nonReentrant {
        Rental storage r = _created(id);
        _expect(r, State.Proposed);
        if (block.timestamp <= uint256(r.proposedAt) + appealWindow) revert TooEarly();
        _settle(id, r, r.proposedCapture);
    }

    /// @notice The owner releases the full deposit to the renter at any point before settlement.
    ///         On a rental that was never funded this just cancels it.
    function waive(bytes32 id) external nonReentrant {
        Rental storage r = _created(id);
        if (msg.sender != r.owner) revert NotOwner();
        if (r.state == State.Settled || r.state == State.Refunded) revert WrongState(r.state);
        uint96 amount = r.state == State.None ? 0 : r.deposit;
        r.state = State.Refunded;
        if (amount > 0) usdt.safeTransfer(r.renter, amount);
        emit Refunded(id, amount, "WAIVED");
    }

    /// @notice If no verdict arrives by returnBy + grace, anyone can return the full deposit to the renter.
    function refundOnTimeout(bytes32 id) external nonReentrant {
        Rental storage r = _created(id);
        if (r.state != State.Funded && r.state != State.PickedUp && r.state != State.Returned) revert WrongState(r.state);
        if (block.timestamp <= uint256(r.returnBy) + grace) revert TooEarly();
        r.state = State.Refunded;
        usdt.safeTransfer(r.renter, r.deposit);
        emit Refunded(id, r.deposit, "TIMEOUT");
    }

    function setTeeSigner(address signer) external onlyArbiter {
        teeSigner = signer;
        emit TeeSignerSet(signer);
    }

    function getRental(bytes32 id) external view returns (Rental memory) {
        return _rentals[id];
    }

    /// @notice The suffix the verdict text must end with in P1 TEE mode:
    ///         "eh":"EH1;<id lowercase hex>;<s1>,...,<s6>;<confidenceBps>"}
    function teeSuffix(bytes32 id, uint8[6] calldata severity, uint16 confidenceBps) public pure returns (bytes memory) {
        bytes memory sev = new bytes(11);
        for (uint256 i = 0; i < 6; i++) {
            sev[i * 2] = bytes1(uint8(48) + severity[i]);
            if (i < 5) sev[i * 2 + 1] = ",";
        }
        return abi.encodePacked('"eh":"EH1;', Strings.toHexString(uint256(id), 32), ";", sev, ";", Strings.toString(confidenceBps), '"}');
    }

    // ------------------------------------------------------------------ internals

    function _created(bytes32 id) private view returns (Rental storage r) {
        r = _rentals[id];
        if (r.owner == address(0)) revert NotCreated();
    }

    function _expect(Rental storage r, State s) private view {
        if (r.state != s) revert WrongState(r.state);
    }

    /// @dev Effects before interactions; pays only the rental's owner and renter, in one transaction.
    function _settle(bytes32 id, Rental storage r, uint96 capture) private {
        uint96 toRenter = r.deposit - capture;
        r.state = State.Settled;
        if (capture > 0) usdt.safeTransfer(r.owner, capture);
        if (toRenter > 0) usdt.safeTransfer(r.renter, toRenter);
        emit Settled(id, capture, toRenter);
    }

    function _checkTee(bytes32 id, uint8[6] calldata severity, uint16 confidenceBps, bytes calldata teeText, bytes calldata teeSig)
        private
        view
    {
        bytes memory suffix = teeSuffix(id, severity, confidenceBps);
        if (teeText.length < suffix.length) revert BadTeeText();
        uint256 offset = teeText.length - suffix.length;
        for (uint256 i = 0; i < suffix.length; i++) {
            if (teeText[offset + i] != suffix[i]) revert BadTeeText();
        }
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(MessageHashUtils.toEthSignedMessageHash(teeText), teeSig);
        if (err != ECDSA.RecoverError.NoError || signer != teeSigner) revert BadTeeSignature();
    }
}
