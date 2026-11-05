// Local simulator: the real server and web app with a FAKE chain and FAKE 0G Storage (no testnet, no keys).
// EVENHAND_SIM_CHAIN=real uses the configured chain instead (e.g. a local anvil with the real contract).
// 0G Router: real if ZG_API_KEY is set, else a scripted verdict (moderate scratch on the lid).
// For UI work and the iOS app before the contract is deployed. Never use it for the recorded demo's proof.
// Run: pnpm -C web build && pnpm -C server dev:fake
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { ANGLES } from "@evenhand/shared";
import { createApp } from "../src/app.js";
import { createViemChain } from "../src/chain/port.js";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import { loadDotEnv } from "../src/env-file.js";
import { createKeeper } from "../src/inspector/keeper.js";
import { createInspector } from "../src/inspector/pipeline.js";
import { BundleStore, loadPhotoKey } from "../src/photos/store.js";
import { createBundleUploader } from "../src/photos/uploader.js";
import { Repo } from "../src/rentals/repo.js";
import { createZgPort, type ZgPort } from "../src/zg/ports.js";
import type { InspectionRequest } from "../src/zg/router.js";
import { FakeChain, FakeStorage, MODELS } from "../test/harness.js";

loadDotEnv();
const config = loadConfig({ ...process.env, DATA_DIR: process.env.DATA_DIR || "data-fake" });
const repo = new Repo(openDb(config.dbPath));
const realChain = process.env.EVENHAND_SIM_CHAIN === "real";
const chain = realChain ? createViemChain(config.chain) : new FakeChain();
const storage = new FakeStorage();
const bundles = new BundleStore(config.dataDir);
const photoKey = loadPhotoKey(config.dataDir, config.photoKeyHex);
const ensureBundleRoot = createBundleUploader(repo, bundles, storage);

function scriptedZg(): ZgPort {
  let n = 0;
  return {
    listModels: async () => MODELS,
    async call(request: InspectionRequest) {
      n += 1;
      const intro = request.messages[1].content[0];
      const rentalId = intro?.type === "text" ? (/rental_id: (0x[0-9a-f]{64})/i.exec(intro.text)?.[1] ?? "") : "";
      const severity = ANGLES.map((a) => (a === "top" ? 2 : 0));
      const verdict = {
        rental_id: rentalId,
        angles: ANGLES.map((angle, i) => ({
          angle, usable: true, new_damage: severity[i]! > 0, severity: severity[i],
          location: severity[i] ? "lid, upper left" : "", description: severity[i] ? "deep scratch across the skin" : "", confidence: 0.9,
        })),
        overall_confidence: 0.88, text_in_image_ignored: false, eh: `EH1;${rentalId};${severity.join(",")};8800`,
      };
      return { model: request.model, rawOutput: JSON.stringify(verdict), requestId: `sim-${n}`, provider: "simulator", teeVerified: null, billing: null, chatId: null, usage: null };
    },
  };
}

const zg = config.zg.apiKey ? createZgPort(config.zg) : scriptedZg();
const inspector = createInspector({ repo, chain, zg, storage, bundles, ensureBundleRoot, photoKey, models: { first: config.zg.model, strong: config.zg.modelStrong }, maxCostUsd: config.zg.maxCostUsd });
const timing = realChain ? await chain.timing() : { appealWindowS: 60, graceS: config.timing.graceS };
const keeper = createKeeper({ repo, chain, inspector, timing });
const app = createApp({
  repo, chain, inspector, bundles, ensureBundleRoot, photoKey,
  zgHealth: async () => ({ router: true, storage: true }),
  publicBaseUrl: config.publicBaseUrl,
  webDist: fileURLToPath(new URL("../../web/dist", import.meta.url)),
});
setInterval(() => void keeper.tick(), 5_000).unref();

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`SIMULATOR on :${info.port}: ${realChain ? "REAL chain" : "fake chain"} + fake storage, 0G ${config.zg.apiKey ? "REAL" : "scripted"}, appeal window ${timing.appealWindowS} s, data in ${config.dataDir}/`);
});
