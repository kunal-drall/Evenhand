// Whitechain access for the rest of the server. Routes depend on ChainPort, tests use a fake.
import { RENTAL_STATES, evenhandDepositsAbi, usdtAbi, type PaymentConfig, type RentalState } from "@evenhand/shared";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  http,
  keccak256,
  pad,
  parseAbiParameters,
  parseEventLogs,
  toHex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Config, Hex } from "../config.js";
import { createSendTx, type SignerRole } from "./sendTx.js";

export type CreateRentalArgs = {
  id: Hex;
  owner: Hex;
  renter: Hex;
  deposit: bigint;
  returnBy: number;
  scheduleBps: readonly [number, number, number, number];
  termsHash: Hex;
};
export type FundAuth = { validAfter: bigint; validBefore: bigint; nonce: Hex; v: number; r: Hex; s: Hex };
export type OnchainRental = {
  owner: Hex;
  renter: Hex;
  deposit: bigint;
  returnBy: number;
  proposedAt: number;
  state: RentalState;
  proposedCapture: bigint;
  confidenceBps: number;
  inspectionRoot: Hex;
};

export interface ChainPort {
  /** Contract address and both keys are configured. */
  readonly ready: boolean;
  createRental(a: CreateRentalArgs): Promise<Hex>;
  fund(id: Hex, auth: FundAuth): Promise<Hex>;
  recordPickup(id: Hex, manifestHash: Hex): Promise<Hex>;
  recordReturn(id: Hex, manifestHash: Hex): Promise<Hex>;
  proposeVerdict(id: Hex, severity: number[], confidenceBps: number, inspectionRoot: Hex): Promise<{ hash: Hex; capture: bigint; needsArbiter: boolean }>;
  /** Returned -> Appealed (needs_human) or PickedUp past the deadline -> Appealed. Inspector key. */
  escalate(id: Hex): Promise<Hex>;
  finalize(id: Hex): Promise<Hex>;
  refundOnTimeout(id: Hex): Promise<Hex>;
  getRental(id: Hex): Promise<OnchainRental>;
  paymentConfig(): Promise<PaymentConfig>;
  usdtBalance(address: Hex): Promise<bigint>;
  /** EIP-3009 authorizationState: true once a nonce has been used (or cancelled). */
  authorizationUsed(from: Hex, nonce: Hex): Promise<boolean>;
  gasBalances(): Promise<Partial<Record<SignerRole, bigint>>>;
  /** appealWindow and grace as deployed (seconds). */
  timing(): Promise<{ appealWindowS: number; graceS: number }>;
}

export class ChainUnavailableError extends Error {
  constructor(message = "contract not deployed or relayer keys missing") {
    super(message);
    this.name = "ChainUnavailableError";
  }
}

const DOMAIN_TYPE = "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)";
const DOMAIN_TYPE_SALT = "EIP712Domain(string name,string version,address verifyingContract,bytes32 salt)";
const str = (s: string) => keccak256(toHex(s));

/** Finds the EIP-712 domain whose hash equals the token's DOMAIN_SEPARATOR (version "1" first). */
export function matchDomain(name: string, separator: Hex, chainId: number, token: Hex): PaymentConfig["domain"] | undefined {
  for (const version of ["1", "2"]) {
    const plain = keccak256(
      encodeAbiParameters(parseAbiParameters("bytes32, bytes32, bytes32, uint256, address"), [str(DOMAIN_TYPE), str(name), str(version), BigInt(chainId), token]),
    );
    if (plain === separator) return { name, version, chainId, verifyingContract: token };
    const salt = pad(toHex(chainId), { size: 32 });
    const salted = keccak256(
      encodeAbiParameters(parseAbiParameters("bytes32, bytes32, bytes32, address, bytes32"), [str(DOMAIN_TYPE_SALT), str(name), str(version), token, salt]),
    );
    if (salted === separator) return { name, version, verifyingContract: token, salt };
  }
  return undefined;
}

export function createViemChain(cfg: Config["chain"]): ChainPort {
  const chain = defineChain({
    id: cfg.chainId,
    name: "Whitechain Testnet",
    nativeCurrency: { name: "WhiteBIT Coin", symbol: "WBT", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  });
  const transport = http(cfg.rpcUrl, { timeout: 15_000, retryCount: 2 });
  const publicClient = createPublicClient({ chain, transport }) as PublicClient;
  const wallet = (key: Hex | undefined) => (key ? createWalletClient({ chain, transport, account: privateKeyToAccount(key) }) : undefined);
  const wallets = { inspector: wallet(cfg.inspectorKey), relayer: wallet(cfg.relayerKey) };
  const deposits = cfg.deposits;
  const ready = Boolean(deposits && wallets.inspector && wallets.relayer);
  const sendTx = deposits ? createSendTx(publicClient, wallets, deposits) : undefined;
  let paymentConfigCache: PaymentConfig | undefined;

  const send = async (role: SignerRole, fn: Parameters<NonNullable<typeof sendTx>>[1], args: readonly unknown[]) => {
    if (!ready || !sendTx) throw new ChainUnavailableError();
    return sendTx(role, fn, args);
  };
  const need = (): Hex => {
    if (!deposits) throw new ChainUnavailableError("DEPOSITS_ADDRESS is not set");
    return deposits;
  };

  return {
    ready,
    async createRental(a) {
      return (await send("inspector", "createRental", [a.id, a.owner, a.renter, a.deposit, a.returnBy, a.scheduleBps, a.termsHash])).hash;
    },
    async fund(id, x) {
      return (await send("relayer", "fundWithAuthorization", [id, x.validAfter, x.validBefore, x.nonce, x.v, x.r, x.s])).hash;
    },
    async recordPickup(id, manifestHash) {
      return (await send("inspector", "recordPickup", [id, manifestHash])).hash;
    },
    async recordReturn(id, manifestHash) {
      return (await send("inspector", "recordReturn", [id, manifestHash])).hash;
    },
    async proposeVerdict(id, severity, confidenceBps, inspectionRoot) {
      const { hash, receipt } = await send("inspector", "proposeVerdict", [id, severity, confidenceBps, inspectionRoot, "0x", "0x"]);
      const [event] = parseEventLogs({ abi: evenhandDepositsAbi, logs: receipt.logs, eventName: "VerdictProposed" });
      if (!event) throw new Error(`proposeVerdict ${hash} emitted no VerdictProposed event`);
      return { hash, capture: event.args.capture, needsArbiter: event.args.needsArbiter };
    },
    async escalate(id) {
      return (await send("inspector", "escalate", [id])).hash;
    },
    async finalize(id) {
      return (await send("relayer", "finalize", [id])).hash;
    },
    async refundOnTimeout(id) {
      return (await send("relayer", "refundOnTimeout", [id])).hash;
    },
    async getRental(id) {
      const r = await publicClient.readContract({ address: need(), abi: evenhandDepositsAbi, functionName: "getRental", args: [id] });
      return {
        owner: r.owner,
        renter: r.renter,
        deposit: r.deposit,
        returnBy: Number(r.returnBy),
        proposedAt: Number(r.proposedAt),
        state: RENTAL_STATES[r.state] ?? "None",
        proposedCapture: r.proposedCapture,
        confidenceBps: r.confidenceBps,
        inspectionRoot: r.inspectionRoot,
      };
    },
    async paymentConfig() {
      if (paymentConfigCache) return paymentConfigCache;
      const read = <F extends "name" | "decimals" | "DOMAIN_SEPARATOR">(functionName: F) =>
        publicClient.readContract({ address: cfg.usdt, abi: usdtAbi, functionName });
      const [name, decimals, separator] = await Promise.all([read("name"), read("decimals"), read("DOMAIN_SEPARATOR")]);
      const domain = matchDomain(name as string, separator as Hex, cfg.chainId, cfg.usdt);
      if (!domain) throw new Error("USDT DOMAIN_SEPARATOR matches no known EIP-712 domain layout");
      paymentConfigCache = { chainId: cfg.chainId, depositsAddress: need(), usdt: { address: cfg.usdt, decimals: Number(decimals) }, domain };
      return paymentConfigCache;
    },
    async authorizationUsed(from, nonce) {
      return publicClient.readContract({ address: cfg.usdt, abi: usdtAbi, functionName: "authorizationState", args: [from, nonce] });
    },
    async usdtBalance(address) {
      return publicClient.readContract({ address: cfg.usdt, abi: usdtAbi, functionName: "balanceOf", args: [address] });
    },
    async timing() {
      const read = (functionName: "appealWindow" | "grace") => publicClient.readContract({ address: need(), abi: evenhandDepositsAbi, functionName });
      const [appealWindow, grace] = await Promise.all([read("appealWindow"), read("grace")]);
      return { appealWindowS: Number(appealWindow), graceS: Number(grace) };
    },
    async gasBalances() {
      const out: Partial<Record<SignerRole, bigint>> = {};
      for (const role of ["inspector", "relayer"] as const) {
        const w = wallets[role];
        if (w) out[role] = await publicClient.getBalance({ address: w.account.address });
      }
      return out;
    },
  };
}
