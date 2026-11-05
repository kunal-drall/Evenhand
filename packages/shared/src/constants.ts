// docs/interfaces.md sections 1 and 4.

export const WHITECHAIN_TESTNET = {
  chainId: 1874,
  rpcUrl: "https://rpc.testnet.whitechain.io",
  explorerUrl: "https://explorer.testnet.whitechain.io",
  explorerApiUrl: "https://explorer.testnet.whitechain.io/api",
  faucetUrl: "https://faucet.testnet.whitechain.io",
} as const;

/** Official test USDT (EIP-1967 proxy to TetherTokenV2). Not the bridged USDT.e. Read decimals at runtime. */
export const USDT_ADDRESS = "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7" as const;

export const ZG_ROUTER_URL = "https://router-api.0g.ai/v1";

export const ZG_GALILEO = {
  chainId: 16602,
  rpcUrl: "https://evmrpc-testnet.0g.ai",
  indexerUrl: "https://indexer-storage-testnet-turbo.0g.ai",
  faucetUrl: "https://faucet.0g.ai",
} as const;

/** Capture angles, in this order everywhere (manifest shots, 0G pairs, severity arrays). */
export const ANGLES = ["front", "back", "left", "right", "top", "detail"] as const;

export const PHASES = ["pickup", "return"] as const;
export const ROLES = ["owner", "renter"] as const;

/** Index equals the onchain `State` enum value. */
export const RENTAL_STATES = [
  "None",
  "Funded",
  "PickedUp",
  "Returned",
  "Proposed",
  "Appealed",
  "Settled",
  "Refunded",
] as const;

export const INSPECTION_STATUSES = ["running", "paused", "done", "needs_human"] as const;

/** EIP-191 message the renter's burner key signs to co-sign a scan (section 5). */
export function confirmMessage(rentalId: string, phase: (typeof PHASES)[number], manifestHash: string): string {
  return `EVENHAND-CONFIRM:${rentalId}:${phase}:${manifestHash}`;
}

export function explorerTxUrl(hash: string): string {
  return `${WHITECHAIN_TESTNET.explorerUrl}/tx/${hash}`;
}
