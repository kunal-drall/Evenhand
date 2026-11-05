// The only way the server sends transactions (docs/interfaces.md section 10).
import { evenhandDepositsAbi } from "@evenhand/shared";
import type { Account, Chain, PublicClient, TransactionReceipt, Transport, WalletClient } from "viem";
import type { Hex } from "../config.js";

export const ALLOWED = {
  inspector: ["createRental", "recordPickup", "recordReturn", "proposeVerdict", "escalate"],
  relayer: ["fundWithAuthorization", "finalize", "refundOnTimeout"],
} as const;

export type SignerRole = keyof typeof ALLOWED;
export type AllowedFn = (typeof ALLOWED)[SignerRole][number];

/** Gas limit cap per transaction. */
export const GAS_CAP = 500_000n;
const RECEIPT_TIMEOUT_MS = 90_000;

export class TxRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TxRefusedError";
  }
}

/** Throws unless `role` may call `fn` (inspector and relayer keys have disjoint allowlists). */
export function assertAllowed(role: string, fn: string): asserts role is SignerRole {
  const allowed = (ALLOWED as Record<string, readonly string[]>)[role];
  if (!allowed) throw new TxRefusedError(`unknown signer role ${role}`);
  if (!allowed.includes(fn)) throw new TxRefusedError(`${role} key may not call ${fn}`);
}

type Wallet = WalletClient<Transport, Chain, Account>;

export type SendTx = (role: SignerRole, fn: AllowedFn, args: readonly unknown[]) => Promise<{ hash: Hex; receipt: TransactionReceipt }>;

/**
 * Builds sendTx bound to one target (the deposits contract): checks the allowlist, simulates,
 * refuses estimates above GAS_CAP, sends one tx per key at a time and waits for a successful receipt.
 */
export function createSendTx(publicClient: PublicClient, wallets: Partial<Record<SignerRole, Wallet>>, target: Hex): SendTx {
  const queues: Record<SignerRole, Promise<unknown>> = { inspector: Promise.resolve(), relayer: Promise.resolve() };

  const send = async (role: SignerRole, fn: AllowedFn, args: readonly unknown[]) => {
    const wallet = wallets[role];
    if (!wallet) throw new TxRefusedError(`${role} key is not configured`);
    const call = { address: target, abi: evenhandDepositsAbi, functionName: fn, args, account: wallet.account } as never;
    await publicClient.simulateContract(call);
    const gas = await publicClient.estimateContractGas(call);
    if (gas > GAS_CAP) throw new TxRefusedError(`${fn} needs ${gas} gas, above the ${GAS_CAP} cap`);
    const withMargin = (gas * 12n) / 10n;
    const hash = await wallet.writeContract({ ...(call as object), gas: withMargin < GAS_CAP ? withMargin : GAS_CAP } as never);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
    if (receipt.status !== "success") throw new Error(`${fn} reverted in ${hash}`);
    return { hash, receipt };
  };

  return (role, fn, args) => {
    assertAllowed(role, fn);
    const run = queues[role].then(() => send(role, fn, args));
    queues[role] = run.catch(() => undefined);
    return run;
  };
}
