// C2 spike: 0G Router model list, one vision call, one 0G Storage round trip.
// Run: pnpm -C server spike:0g   (reads the repo-root .env; skips steps whose keys are missing)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ZG_GALILEO, ZG_ROUTER_URL } from "@evenhand/shared";
import { loadDotEnv } from "../src/env-file.js";
import { listVisionModels, pickModels } from "../src/zg/models.js";
import { buildInspectionRequest, callRouter } from "../src/zg/router.js";
import { downloadBytes, storageRoot, uploadBytes } from "../src/zg/storage.js";

loadDotEnv();
const env = process.env;
const routerUrl = env.ZG_ROUTER_URL || ZG_ROUTER_URL;
const perMillion = (usdPerToken: number) => `$${(usdPerToken * 1e6).toFixed(3)}/M`;

async function step1Models() {
  console.log("\n== 1. vision models (image in, text out), cheapest first");
  const models = await listVisionModels(routerUrl);
  for (const m of models.slice(0, 12)) {
    console.log(`  ${m.id.padEnd(34)} in ${perMillion(m.promptUsdPerToken)}  out ${perMillion(m.completionUsdPerToken)}  json=${m.jsonMode}`);
  }
  const picked = pickModels(models, { first: env.ZG_VISION_MODEL, strong: env.ZG_VISION_MODEL_STRONG });
  console.log(`  -> first pass: ${picked.first.id}; second pass: ${picked.strong?.id ?? "none"}`);
  return picked.first.id;
}

async function step2Inspect(model: string) {
  console.log("\n== 2. one inspection call (front pair only)");
  if (!env.ZG_API_KEY) return console.log("  skipped: ZG_API_KEY not set");
  const dir = fileURLToPath(new URL("../fixtures/pair/", import.meta.url));
  const pair = { angle: "front" as const, pickupJpeg: readFileSync(`${dir}front-pickup.jpg`), returnJpeg: readFileSync(`${dir}front-return.jpg`) };
  const rentalId = `0x${"ab".repeat(32)}`;
  const result = await callRouter(
    { routerUrl, apiKey: env.ZG_API_KEY, trustMode: env.ZG_TRUST_MODE || "verified" },
    buildInspectionRequest(model, rentalId, [pair]),
  );
  console.log("  raw output:", result.rawOutput);
  console.log("  request_id:", result.requestId, " provider:", result.provider, " tee_verified:", result.teeVerified);
  console.log("  ZG-Res-Key (chat id):", result.chatId);
  console.log("  billing:", JSON.stringify(result.billing));
  console.log("  usage:", JSON.stringify(result.usage));
}

function step3ComputeSdk() {
  console.log("\n== 3. compute SDK processResponse");
  console.log("  skipped: needs a funded 0G compute ledger and direct provider access, not the Router key (see docs/spikes/0g.md)");
}

async function step4Storage() {
  console.log("\n== 4. 0G Storage round trip");
  if (!env.ZG_STORAGE_PRIVATE_KEY) return console.log("  skipped: ZG_STORAGE_PRIVATE_KEY not set");
  const cfg = {
    rpcUrl: env.ZG_STORAGE_RPC || ZG_GALILEO.rpcUrl,
    indexerUrl: env.ZG_STORAGE_INDEXER || ZG_GALILEO.indexerUrl,
    privateKey: env.ZG_STORAGE_PRIVATE_KEY,
  };
  const payload = Buffer.from(JSON.stringify({ v: 1, spike: "evenhand-c2", at: new Date().toISOString() }));
  console.log("  local root:", await storageRoot(payload));
  const { rootHash, txHash } = await uploadBytes(cfg, payload);
  console.log("  uploaded root:", rootHash, " tx:", txHash);
  const back = await downloadBytes(cfg.indexerUrl, rootHash);
  console.log("  download matches:", back.equals(payload));
}

const model = await step1Models();
await step2Inspect(model).catch((err: Error) => console.log("  FAILED:", err.message));
step3ComputeSdk();
await step4Storage().catch((err: Error) => console.log("  FAILED:", err.message));
