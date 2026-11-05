// Contract ABIs. EvenhandDeposits matches contracts/src/EvenhandDeposits.sol (docs/interfaces.md section 3),
// including its custom errors so reverts decode by name.
import { parseAbi } from "viem";

export const evenhandDepositsAbi = parseAbi([
  "struct Rental { address owner; address renter; uint96 deposit; uint40 returnBy; uint40 proposedAt; uint8 state; uint16[4] scheduleBps; bytes32 termsHash; bytes32 pickupManifest; bytes32 returnManifest; bytes32 inspectionRoot; uint96 proposedCapture; uint16 confidenceBps; }",
  "function createRental(bytes32 id, address owner, address renter, uint96 deposit, uint40 returnBy, uint16[4] scheduleBps, bytes32 termsHash)",
  "function fundWithAuthorization(bytes32 id, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
  "function recordPickup(bytes32 id, bytes32 manifestHash)",
  "function recordReturn(bytes32 id, bytes32 manifestHash)",
  "function proposeVerdict(bytes32 id, uint8[6] severity, uint16 confidenceBps, bytes32 inspectionRoot, bytes teeText, bytes teeSig)",
  "function appeal(bytes32 id)",
  "function resolveAppeal(bytes32 id, uint96 capture)",
  "function finalize(bytes32 id)",
  "function waive(bytes32 id)",
  "function refundOnTimeout(bytes32 id)",
  "function setTeeSigner(address signer)",
  "function getRental(bytes32 id) view returns (Rental)",
  "event RentalCreated(bytes32 indexed id, address indexed owner, address indexed renter, uint96 deposit, uint40 returnBy, bytes32 termsHash)",
  "event Funded(bytes32 indexed id, uint96 amount)",
  "event PickupRecorded(bytes32 indexed id, bytes32 manifestHash)",
  "event ReturnRecorded(bytes32 indexed id, bytes32 manifestHash)",
  "event VerdictProposed(bytes32 indexed id, uint96 capture, uint16 confidenceBps, bytes32 inspectionRoot, bool needsArbiter)",
  "event Appealed(bytes32 indexed id, address by)",
  "event Settled(bytes32 indexed id, uint96 toOwner, uint96 toRenter)",
  "event Refunded(bytes32 indexed id, uint96 amount, bytes32 reason)",
  "event TeeSignerSet(address signer)",
  "function teeSigner() view returns (address)",
  "function appealWindow() view returns (uint40)",
  "function grace() view returns (uint40)",
  "function teeSuffix(bytes32 id, uint8[6] severity, uint16 confidenceBps) pure returns (bytes)",
  "error ZeroAddress()",
  "error InvalidParams()",
  "error NotInspector()",
  "error NotArbiter()",
  "error NotOwner()",
  "error NotParty()",
  "error AlreadyCreated()",
  "error NotCreated()",
  "error WrongState(uint8 current)",
  "error TooEarly()",
  "error WindowClosed()",
  "error CaptureTooHigh()",
  "error DepositMismatch()",
  "error BadTeeSignature()",
  "error BadTeeText()",
]);

/** The subset of TetherTokenV2 that Evenhand reads or signs for (EIP-3009 + EIP-712 domain). */
export const usdtAbi = parseAbi([
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function balanceOf(address) view returns (uint256)",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
]);

/** EIP-712 types for the renter's deposit authorization (docs/interfaces.md section 6). */
export const receiveWithAuthorizationTypes = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;
