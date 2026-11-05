// Ports the inspector depends on, with their real 0G implementations. Tests pass fakes.
import { Indexer } from "@0gfoundation/0g-storage-ts-sdk";
import type { Config } from "../config.js";
import { fetchWithTimeout, withTimeout } from "../net.js";
import { listVisionModels, type VisionModel } from "./models.js";
import { callRouter, type InspectionRequest, type ZgCallResult } from "./router.js";
import { uploadBytes } from "./storage.js";

export interface ZgPort {
  listModels(): Promise<VisionModel[]>;
  call(request: InspectionRequest): Promise<ZgCallResult>;
}

export interface StoragePort {
  upload(bytes: Uint8Array): Promise<{ rootHash: string; txHash: string }>;
}

const MODEL_CACHE_MS = 10 * 60_000;

export function createZgPort(cfg: Config["zg"]): ZgPort {
  let cache: { at: number; models: VisionModel[] } | undefined;
  return {
    async listModels() {
      if (cache && Date.now() - cache.at < MODEL_CACHE_MS) return cache.models;
      const models = await listVisionModels(cfg.routerUrl);
      cache = { at: Date.now(), models };
      return models;
    },
    async call(request) {
      if (!cfg.apiKey) throw new Error("ZG_API_KEY is not set");
      return callRouter({ routerUrl: cfg.routerUrl, apiKey: cfg.apiKey, trustMode: cfg.trustMode }, request);
    },
  };
}

/** One storage signer: uploads run one at a time so Flow-contract txs never race on the nonce. */
export function createStoragePort(cfg: Config["storage"]): StoragePort | undefined {
  const { privateKey } = cfg;
  if (!privateKey) return undefined;
  let queue: Promise<unknown> = Promise.resolve();
  return {
    upload(bytes) {
      const run = queue.then(() => uploadBytes({ rpcUrl: cfg.rpcUrl, indexerUrl: cfg.indexerUrl, privateKey }, bytes));
      queue = run.catch(() => undefined);
      return run;
    },
  };
}

const HEALTH_TTL_MS = 15_000;

/** Reachability of the 0G Router and Storage indexer, cached briefly. Drives the "paused" UI. */
export function createZgHealth(cfg: Config): () => Promise<{ router: boolean; storage: boolean }> {
  let cache: { at: number; value: { router: boolean; storage: boolean } } | undefined;
  return async () => {
    if (cache && Date.now() - cache.at < HEALTH_TTL_MS) return cache.value;
    const [router, storage] = await Promise.all([
      fetchWithTimeout(`${cfg.zg.routerUrl}/models`, { method: "GET" }, 5_000)
        .then((r) => r.ok && Boolean(cfg.zg.apiKey))
        .catch(() => false),
      withTimeout(new Indexer(cfg.storage.indexerUrl).getShardedNodes(), 5_000, "indexer")
        .then(() => Boolean(cfg.storage.privateKey))
        .catch(() => false),
    ]);
    cache = { at: Date.now(), value: { router, storage } };
    return cache.value;
  };
}
