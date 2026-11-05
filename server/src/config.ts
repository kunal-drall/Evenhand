import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { USDT_ADDRESS, WHITECHAIN_TESTNET, ZG_GALILEO, ZG_ROUTER_URL } from "@evenhand/shared";
import { z } from "zod";

// .env leaves unset values as "" (inline comments are stripped); treat those as missing.
const blank = (v: unknown) => (v === "" ? undefined : v);
const opt = <T extends z.ZodType>(s: T) => z.preprocess(blank, s.optional());
const def = <T extends z.ZodType>(s: T) => z.preprocess(blank, s);

const PrivateKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected 0x + 64 hex chars");
const Addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected 0x address");

const Env = z.object({
  PORT: def(z.coerce.number().int().min(1).max(65_535).default(8787)),
  // Loopback by default: phones reach the server through the cloudflared tunnel, which connects locally.
  HOST: def(z.string().default("127.0.0.1")),
  OPERATOR_TOKEN: opt(z.string().min(16, "OPERATOR_TOKEN must be at least 16 characters")),
  DATA_DIR: def(z.string().default("data")),
  DB_PATH: opt(z.string()),
  PUBLIC_BASE_URL: def(z.url().default("http://localhost:8787")),
  ZG_API_KEY: opt(z.string().startsWith("sk-", "ZG_API_KEY must be an sk- inference key")),
  ZG_ROUTER_URL: def(z.url().default(ZG_ROUTER_URL)),
  ZG_TRUST_MODE: def(z.string().default("verified")),
  ZG_VISION_MODEL: opt(z.string()),
  ZG_VISION_MODEL_STRONG: opt(z.string()),
  ZG_STORAGE_RPC: def(z.url().default(ZG_GALILEO.rpcUrl)),
  ZG_STORAGE_INDEXER: def(z.url().default(ZG_GALILEO.indexerUrl)),
  ZG_STORAGE_PRIVATE_KEY: opt(PrivateKey),
  WC_RPC_URL: def(z.url().default(WHITECHAIN_TESTNET.rpcUrl)),
  WC_CHAIN_ID: def(z.coerce.number().int().default(WHITECHAIN_TESTNET.chainId)),
  USDT_ADDRESS: def(Addr.default(USDT_ADDRESS)),
  DEPOSITS_ADDRESS: opt(Addr),
  INSPECTOR_PRIVATE_KEY: opt(PrivateKey),
  RELAYER_PRIVATE_KEY: opt(PrivateKey),
  ARBITER_ADDRESS: opt(Addr),
  MAX_INSPECTION_COST_USD: def(z.coerce.number().positive().default(0.05)),
  // Must match the deployed contract (docs/ai/BUILD_PROMPT.md C1: 600 s window, 3600 s grace).
  APPEAL_WINDOW_SECONDS: def(z.coerce.number().int().positive().default(600)),
  GRACE_SECONDS: def(z.coerce.number().int().positive().default(3600)),
  PHOTO_ENCRYPTION_KEY: opt(z.string().regex(/^[0-9a-fA-F]{64}$/, "expected 64 hex chars (32 bytes)")),
});

export type Hex = `0x${string}`;

export type Config = {
  port: number;
  host: string;
  operatorToken: string | undefined;
  dataDir: string;
  dbPath: string;
  publicBaseUrl: string;
  zg: {
    routerUrl: string;
    apiKey: string | undefined;
    trustMode: string;
    model: string | undefined;
    modelStrong: string | undefined;
    maxCostUsd: number;
  };
  storage: { rpcUrl: string; indexerUrl: string; privateKey: string | undefined };
  chain: {
    rpcUrl: string;
    chainId: number;
    usdt: Hex;
    deposits: Hex | undefined;
    inspectorKey: Hex | undefined;
    relayerKey: Hex | undefined;
    arbiter: Hex | undefined;
  };
  timing: { appealWindowS: number; graceS: number };
  photoKeyHex: string | undefined;
};

const DEPLOYMENTS = fileURLToPath(new URL("../../packages/shared/deployments.json", import.meta.url));

/** EvenhandDeposits address written by contracts/script/Deploy.s.sol, if any. */
function deployedAddress(chainId: number): Hex | undefined {
  if (!existsSync(DEPLOYMENTS)) return undefined;
  const d = JSON.parse(readFileSync(DEPLOYMENTS, "utf8")) as { chainId?: number; EvenhandDeposits?: string };
  return d.chainId === chainId && d.EvenhandDeposits && /^0x[0-9a-fA-F]{40}$/.test(d.EvenhandDeposits) ? (d.EvenhandDeposits as Hex) : undefined;
}

/** Reads and validates server env. Secrets stay in this object; never log it. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = Env.parse(env);
  return {
    port: e.PORT,
    host: e.HOST,
    operatorToken: e.OPERATOR_TOKEN,
    dataDir: e.DATA_DIR,
    dbPath: e.DB_PATH ?? join(e.DATA_DIR, "evenhand.sqlite"),
    publicBaseUrl: e.PUBLIC_BASE_URL.replace(/\/$/, ""),
    zg: {
      routerUrl: e.ZG_ROUTER_URL.replace(/\/$/, ""),
      apiKey: e.ZG_API_KEY,
      trustMode: e.ZG_TRUST_MODE,
      model: e.ZG_VISION_MODEL,
      modelStrong: e.ZG_VISION_MODEL_STRONG,
      maxCostUsd: e.MAX_INSPECTION_COST_USD,
    },
    storage: { rpcUrl: e.ZG_STORAGE_RPC, indexerUrl: e.ZG_STORAGE_INDEXER, privateKey: e.ZG_STORAGE_PRIVATE_KEY },
    chain: {
      rpcUrl: e.WC_RPC_URL,
      chainId: e.WC_CHAIN_ID,
      usdt: e.USDT_ADDRESS as Hex,
      deposits: (e.DEPOSITS_ADDRESS as Hex | undefined) ?? deployedAddress(e.WC_CHAIN_ID),
      inspectorKey: e.INSPECTOR_PRIVATE_KEY as Hex | undefined,
      relayerKey: e.RELAYER_PRIVATE_KEY as Hex | undefined,
      arbiter: e.ARBITER_ADDRESS as Hex | undefined,
    },
    timing: { appealWindowS: e.APPEAL_WINDOW_SECONDS, graceS: e.GRACE_SECONDS },
    photoKeyHex: e.PHOTO_ENCRYPTION_KEY,
  };
}
