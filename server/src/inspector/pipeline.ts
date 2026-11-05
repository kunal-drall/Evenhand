// Inspector: prepare -> 0G -> RULES_V1 -> 0G Storage log -> proposeVerdict (docs/interfaces.md sections 8, 9).
// Safe stop: any failure leaves the inspection "paused" with a reason and a retry time; nothing is guessed.
// Each stage persists its result, so a retry resumes where it stopped and never re-runs inference.
import { ANGLES, InspectionLog, type Angle, type ModelVerdict } from "@evenhand/shared";
import type { ChainPort } from "../chain/port.js";
import type { Hex } from "../config.js";
import { withRetry } from "../net.js";
import { openBundle } from "../photos/bundle.js";
import { prepareForModel, type BundleStore } from "../photos/store.js";
import type { EnsureBundleRoot } from "../photos/uploader.js";
import type { RentalRow, Repo } from "../rentals/repo.js";
import { pickModels, type VisionModel } from "../zg/models.js";
import type { ZgPort, StoragePort } from "../zg/ports.js";
import { buildInspectionRequest, ZgRouterError, type ImagePair, type ZgCallResult } from "../zg/router.js";
import { RUBRIC_V1, RUBRIC_V1_SHA256 } from "../zg/rubric.js";
import { RULES_VERSION, captureFor, decide, parseVerdict, wantsSecondPass, type Decision } from "./rules.js";

export type InspectorDeps = {
  repo: Repo;
  chain: ChainPort;
  zg: ZgPort;
  storage: StoragePort | undefined;
  bundles: BundleStore;
  ensureBundleRoot: EnsureBundleRoot;
  photoKey: Buffer;
  models: { first?: string | undefined; strong?: string | undefined };
  maxCostUsd: number;
  routerBackoffMs?: number;
  clock?: () => number;
  log?: (msg: string) => void;
};

export class PausedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PausedError";
  }
}

const ROUTER_RETRIES = 2;
/** Until the C2 spike measures it: assumed input tokens for one 1024 px image. */
export const TOKENS_PER_IMAGE_ESTIMATE = 1_300;
const RETRY_BASE_S = 30;
const RETRY_MAX_S = 300;

/** Worst-case cost of one call: rubric + 12 images in, 700 tokens out. */
export function estimateCostUsd(model: VisionModel): number {
  const inputTokens = Math.ceil(RUBRIC_V1.length / 4) + 12 * TOKENS_PER_IMAGE_ESTIMATE + 300;
  return inputTokens * model.promptUsdPerToken + 700 * model.completionUsdPerToken;
}

function callCostUsd(call: ZgCallResult, model: VisionModel | undefined): number {
  const usage = call.usage as { prompt_tokens?: number; completion_tokens?: number } | null;
  if (!model || !usage) return 0;
  return (usage.prompt_tokens ?? 0) * model.promptUsdPerToken + (usage.completion_tokens ?? 0) * model.completionUsdPerToken;
}

type Pass = { verdict: ModelVerdict | null; call: ZgCallResult; model: VisionModel };

export function createInspector(deps: InspectorDeps) {
  const { repo, chain } = deps;
  const clock = deps.clock ?? Date.now;
  const log = deps.log ?? ((m: string) => console.log(m));
  const running = new Set<string>();

  async function loadPairs(rental: RentalRow): Promise<ImagePair[]> {
    const open = (phase: "pickup" | "return") => {
      const bundle = deps.bundles.read(rental.id, phase);
      if (!bundle) throw new PausedError(`local ${phase} photos are missing`);
      return openBundle(deps.photoKey, bundle, rental.id, phase);
    };
    const pickup = open("pickup");
    const ret = open("return");
    const photo = (m: Map<Angle, Buffer>, angle: Angle) => {
      const jpeg = m.get(angle);
      if (!jpeg) throw new PausedError(`photo ${angle} is missing`);
      return prepareForModel(jpeg);
    };
    return Promise.all(ANGLES.map(async (angle) => ({ angle, pickupJpeg: await photo(pickup, angle), returnJpeg: await photo(ret, angle) })));
  }

  /** One model pass: up to 2 router retries per call, and one extra call if the output fails the schema. */
  async function pass(rentalId: string, pairs: ImagePair[], model: VisionModel): Promise<Pass> {
    const request = buildInspectionRequest(model.id, rentalId, pairs);
    let last: ZgCallResult | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const call = await withRetry(() => deps.zg.call(request), ROUTER_RETRIES, deps.routerBackoffMs ?? 2_000, (e) => !(e instanceof ZgRouterError) || e.retryable);
      if (!call.requestId) throw new PausedError("0G response carried no x_0g_trace.request_id");
      last = call;
      const verdict = parseVerdict(call.rawOutput, rentalId);
      if (verdict) return { verdict, call, model };
    }
    return { verdict: null, call: last!, model };
  }

  async function infer(rental: RentalRow): Promise<void> {
    let models: ReturnType<typeof pickModels>;
    try {
      models = pickModels(await deps.zg.listModels(), deps.models);
    } catch (err) {
      throw new PausedError(`0G model list unavailable: ${(err as Error).message}`);
    }
    if (estimateCostUsd(models.first) > deps.maxCostUsd) {
      repo.updateInspection(rental.id, {
        model: models.first.id,
        decisionJson: JSON.stringify({ route: "needs_human", severity: [0, 0, 0, 0, 0, 0], confidenceBps: 0, reason: "estimated cost above MAX_INSPECTION_COST_USD" } satisfies Decision),
      });
      return;
    }
    const strong = models.strong && estimateCostUsd(models.strong) <= deps.maxCostUsd ? models.strong : undefined;

    const pairs = await loadPairs(rental);
    const first = await pass(rental.id, pairs, models.first);
    const second = strong && wantsSecondPass(first.verdict) ? await pass(rental.id, pairs, strong) : undefined;
    const decision = decide(first.verdict, second ? second.verdict : undefined);
    const decisive = second ?? first;

    repo.updateInspection(rental.id, {
      model: decisive.model.id,
      provider: decisive.call.provider,
      requestId: decisive.call.requestId,
      chatId: decisive.call.chatId,
      teeVerified: decisive.call.teeVerified,
      rawOutput: decisive.call.rawOutput,
      verdictJson: decisive.verdict ? JSON.stringify(decisive.verdict) : null,
      decisionJson: JSON.stringify(decision),
      billingJson: JSON.stringify(decisive.call.billing ?? null),
      passesJson: JSON.stringify([first, ...(second ? [second] : [])].map((p) => ({ model: p.model.id, requestId: p.call.requestId, rawOutput: p.call.rawOutput }))),
      costUsd: callCostUsd(first.call, first.model) + (second ? callCostUsd(second.call, second.model) : 0),
      capture: decision.route === "auto" ? captureFor(BigInt(rental.deposit), rental.scheduleBps, decision.severity).toString() : null,
    });
  }

  async function writeLog(rental: RentalRow): Promise<void> {
    if (!deps.storage) throw new PausedError("0G Storage key (ZG_STORAGE_PRIVATE_KEY) is not configured");
    const ins = repo.getInspection(rental.id)!;
    const pickup = repo.getScan(rental.id, "pickup");
    const ret = repo.getScan(rental.id, "return");
    if (!pickup || !ret) throw new PausedError("pickup or return scan is missing");
    let roots: [string, string];
    try {
      roots = await Promise.all([deps.ensureBundleRoot(rental.id, "pickup"), deps.ensureBundleRoot(rental.id, "return")]);
    } catch (err) {
      throw new PausedError(`photo upload to 0G Storage failed: ${(err as Error).message}`);
    }
    const decision = JSON.parse(ins.decisionJson!) as Decision;
    const entry = InspectionLog.parse({
      v: 1,
      rentalId: rental.id,
      rulesVersion: RULES_VERSION,
      rubricSha256: RUBRIC_V1_SHA256,
      model: ins.model ?? "none",
      provider: ins.provider ?? "unknown",
      requestId: ins.requestId ?? "none",
      chatId: ins.chatId ?? "",
      teeVerified: ins.teeVerified,
      pickupManifestHash: pickup.manifestHash,
      returnManifestHash: ret.manifestHash,
      photoRoots: { pickup: [roots[0]], return: [roots[1]] },
      rawOutput: ins.rawOutput ?? "",
      parsed: ins.verdictJson ? JSON.parse(ins.verdictJson) : null,
      decision,
      billing: ins.billingJson ? JSON.parse(ins.billingJson) : null,
      passes: ins.passesJson ? JSON.parse(ins.passesJson) : [],
      startedAt: ins.startedAt,
      finishedAt: new Date(clock()).toISOString(),
    });
    try {
      const { rootHash } = await deps.storage.upload(Buffer.from(JSON.stringify(entry)));
      repo.updateInspection(rental.id, { inspectionRoot: rootHash });
    } catch (err) {
      throw new PausedError(`inspection log upload to 0G Storage failed: ${(err as Error).message}`);
    }
  }

  async function propose(rental: RentalRow, decision: Decision, inspectionRoot: string): Promise<void> {
    try {
      const r = await chain.proposeVerdict(rental.id as Hex, decision.severity, decision.confidenceBps, inspectionRoot as Hex);
      repo.addTx(rental.id, "proposeVerdict", r.hash);
      repo.setState(rental.id, r.needsArbiter ? "Appealed" : "Proposed", Math.floor(clock() / 1000));
      repo.updateInspection(rental.id, { txHash: r.hash, needsArbiter: r.needsArbiter, capture: r.capture.toString() });
    } catch (err) {
      throw new PausedError(`proposeVerdict failed: ${(err as Error).message}`);
    }
  }

  async function run(rentalId: string): Promise<void> {
    const prev = repo.getInspection(rentalId);
    repo.updateInspection(rentalId, { status: "running", reason: null, attempts: (prev?.attempts ?? 0) + 1 });
    try {
      const rental = repo.getRental(rentalId);
      if (!rental) throw new PausedError("rental not found");
      if (!repo.getInspection(rentalId)!.decisionJson) await infer(rental);
      if (!repo.getInspection(rentalId)!.inspectionRoot) await writeLog(rental);
      const ins = repo.getInspection(rentalId)!;
      const decision = JSON.parse(ins.decisionJson!) as Decision;
      if (decision.route === "needs_human") {
        repo.updateInspection(rentalId, { status: "needs_human", reason: decision.reason ?? null, finishedAt: new Date(clock()).toISOString() });
        return;
      }
      if (!ins.txHash) await propose(rental, decision, ins.inspectionRoot!);
      repo.updateInspection(rentalId, { status: "done", finishedAt: new Date(clock()).toISOString(), nextAttemptAt: null });
    } catch (err) {
      const attempts = repo.getInspection(rentalId)!.attempts;
      const delayS = Math.min(RETRY_BASE_S * 2 ** (attempts - 1), RETRY_MAX_S);
      const reason = err instanceof PausedError || err instanceof ZgRouterError ? err.message : `unexpected: ${(err as Error).message}`;
      repo.updateInspection(rentalId, { status: "paused", reason, nextAttemptAt: clock() + delayS * 1000 });
      log(`inspection ${rentalId} paused: ${reason}`);
    }
  }

  return {
    /** Runs (or resumes) the inspection; awaitable for tests and scripts. One run per rental at a time. */
    async run(rentalId: string): Promise<void> {
      if (running.has(rentalId)) return;
      running.add(rentalId);
      try {
        await run(rentalId);
      } finally {
        running.delete(rentalId);
      }
    },
    start(rentalId: string): void {
      void this.run(rentalId);
    },
  };
}

export type Inspector = ReturnType<typeof createInspector>;
