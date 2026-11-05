import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createViemChain } from "./chain/port.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { loadDotEnv } from "./env-file.js";
import { createKeeper } from "./inspector/keeper.js";
import { createInspector } from "./inspector/pipeline.js";
import { BundleStore, loadPhotoKey } from "./photos/store.js";
import { createBundleUploader } from "./photos/uploader.js";
import { Repo } from "./rentals/repo.js";
import { createStoragePort, createZgHealth, createZgPort } from "./zg/ports.js";

loadDotEnv();
const config = loadConfig();
const repo = new Repo(openDb(config.dbPath));
const chain = createViemChain(config.chain);
const storage = createStoragePort(config.storage);
const bundles = new BundleStore(config.dataDir);
const photoKey = loadPhotoKey(config.dataDir, config.photoKeyHex);
const ensureBundleRoot = createBundleUploader(repo, bundles, storage);
const inspector = createInspector({
  repo,
  chain,
  zg: createZgPort(config.zg),
  storage,
  bundles,
  ensureBundleRoot,
  photoKey,
  models: { first: config.zg.model, strong: config.zg.modelStrong },
  maxCostUsd: config.zg.maxCostUsd,
});
const keeper = createKeeper({ repo, chain, inspector, timing: config.timing });

const app = createApp({
  repo,
  chain,
  inspector,
  bundles,
  ensureBundleRoot,
  photoKey,
  zgHealth: createZgHealth(config),
  publicBaseUrl: config.publicBaseUrl,
  webDist: fileURLToPath(new URL("../../web/dist", import.meta.url)),
});

setInterval(() => void keeper.tick(), 30_000).unref();
setInterval(() => void keeper.checkGas(), 10 * 60_000).unref();
void keeper.checkGas();

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`evenhand server listening on :${info.port} (chain ${chain.ready ? "ready" : "not configured"}, storage ${storage ? "ready" : "not configured"})`);
});
