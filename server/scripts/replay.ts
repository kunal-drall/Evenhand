// R16: replay a verdict from its 0G Storage log.
//   pnpm -C server replay <inspectionRoot | rentalId> [--rerun]
// Downloads the InspectionLog by root (with Merkle proofs), checks the rubric hash, re-applies RULES_V1 to
// the logged model output and prints whether it reproduces the same decision. With a deployed contract it
// also checks the root against the chain. --rerun also re-sends the stored photos to 0G (a fresh model run,
// which can differ; needs ZG_API_KEY and this server's photo key).
import { ANGLES, InspectionLog, type Angle } from "@evenhand/shared";
import { createViemChain } from "../src/chain/port.js";
import { loadConfig, type Hex } from "../src/config.js";
import { openDb } from "../src/db.js";
import { loadDotEnv } from "../src/env-file.js";
import { replay } from "../src/inspector/replay.js";
import { decide, parseVerdict } from "../src/inspector/rules.js";
import { openBundle } from "../src/photos/bundle.js";
import { loadPhotoKey, prepareForModel } from "../src/photos/store.js";
import { Repo } from "../src/rentals/repo.js";
import { buildInspectionRequest, callRouter } from "../src/zg/router.js";
import { downloadBytes } from "../src/zg/storage.js";

loadDotEnv();
const config = loadConfig();
const [arg, flag] = process.argv.slice(2);
if (!arg || !/^0x[0-9a-fA-F]{64}$/.test(arg)) throw new Error("usage: pnpm -C server replay <inspectionRoot | rentalId> [--rerun]");

const local = new Repo(openDb(config.dbPath)).getInspection(arg.toLowerCase());
const root = local?.inspectionRoot ?? arg;
console.log(`log root: ${root}${local ? ` (from rental ${arg})` : ""}`);

const log = InspectionLog.parse(JSON.parse((await downloadBytes(config.storage.indexerUrl, root)).toString("utf8")));
console.log(`rental ${log.rentalId}\nmodel ${log.model} via ${log.provider}, request_id ${log.requestId}, tee_verified ${log.teeVerified}`);
console.log(`photo roots: pickup ${log.photoRoots.pickup.join(",")} return ${log.photoRoots.return.join(",")}`);
console.log("logged decision:", JSON.stringify(log.decision));

const result = replay(log);
console.log("replayed decision:", JSON.stringify(result.decision));
console.log(`rubric hash ${result.checks.rubric ? "matches RUBRIC_V1" : "DIFFERS"}, rules ${result.checks.rules ? "RULES_V1" : "UNKNOWN"}`);
console.log(result.matches ? "REPLAY MATCHES the logged decision" : "REPLAY MISMATCH");
if (result.note) console.log(result.note);

const chain = createViemChain(config.chain);
if (config.chain.deposits) {
  const onchain = await chain.getRental(log.rentalId as Hex).catch(() => undefined);
  if (onchain) console.log(`onchain inspectionRoot ${onchain.inspectionRoot.toLowerCase() === root.toLowerCase() ? "matches" : `differs (${onchain.inspectionRoot})`}`);
}

if (flag === "--rerun") {
  if (!config.zg.apiKey) throw new Error("--rerun needs ZG_API_KEY");
  const key = loadPhotoKey(config.dataDir, config.photoKeyHex);
  const photos = async (phase: "pickup" | "return") =>
    openBundle(key, await downloadBytes(config.storage.indexerUrl, log.photoRoots[phase][0]!), log.rentalId, phase);
  const [pickup, ret] = await Promise.all([photos("pickup"), photos("return")]);
  const pairs = await Promise.all(
    ANGLES.map(async (angle: Angle) => ({ angle, pickupJpeg: await prepareForModel(pickup.get(angle)!), returnJpeg: await prepareForModel(ret.get(angle)!) })),
  );
  const call = await callRouter({ routerUrl: config.zg.routerUrl, apiKey: config.zg.apiKey, trustMode: config.zg.trustMode }, buildInspectionRequest(log.model, log.rentalId, pairs));
  console.log(`fresh 0G run: request_id ${call.requestId}, tee_verified ${call.teeVerified}`);
  console.log("fresh decision (first pass only):", JSON.stringify(decide(parseVerdict(call.rawOutput, log.rentalId))));
}
