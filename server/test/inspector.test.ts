import { beforeEach, describe, expect, it } from "vitest";
import { InspectionLog } from "@evenhand/shared";
import { createKeeper } from "../src/inspector/keeper.js";
import { ZgRouterError } from "../src/zg/router.js";
import { driveToReturned, makeHarness, state, verdictJson, type Harness } from "./harness.js";

let h: Harness;
let id: string;
beforeEach(async () => {
  h = makeHarness();
  id = await driveToReturned(h);
});

const ins = () => h.repo.getInspection(id)!;
const lastLog = () => InspectionLog.parse(JSON.parse(h.storage.uploads.at(-1)!.toString()));

describe("inspector pipeline", () => {
  it("proposes a confident verdict and logs it to 0G Storage", async () => {
    h.zg.outputs = [verdictJson(id)];
    await h.inspector.run(id);
    expect(ins()).toMatchObject({ status: "done", requestId: "req-1", teeVerified: true, capture: "70000000" });
    const propose = h.chain.calls.find((c) => c.fn === "proposeVerdict")!;
    expect(propose.args.slice(1, 3)).toEqual([[0, 0, 0, 0, 2, 0], 8700]);
    expect(propose.args[3]).toBe(ins().inspectionRoot);
    expect(h.storage.uploads).toHaveLength(3); // pickup bundle, return bundle, log
    const log = lastLog();
    expect(log).toMatchObject({ rentalId: id, rulesVersion: "RULES_V1", requestId: "req-1", decision: { route: "auto" } });
    expect(log.photoRoots.pickup).toHaveLength(1);
    expect(state(h, id)).toBe("Proposed");
  });

  it("records an arbiter route chosen by the contract", async () => {
    h.chain.needsArbiter = true;
    h.zg.outputs = [verdictJson(id, [0, 0, 0, 0, 3, 0])];
    await h.inspector.run(id);
    expect(state(h, id)).toBe("Appealed");
    expect(ins().needsArbiter).toBe(true);
  });

  it("pauses when 0G is unreachable, then resumes without guessing", async () => {
    h.zg.outputs = [new ZgRouterError("down", true), new ZgRouterError("down", true), new ZgRouterError("down", true)];
    await h.inspector.run(id);
    expect(ins()).toMatchObject({ status: "paused", reason: "down" });
    expect(h.chain.count("proposeVerdict")).toBe(0);
    expect(state(h, id)).toBe("Returned");
    h.zg.outputs = [verdictJson(id)];
    await h.inspector.run(id);
    expect(ins().status).toBe("done");
  });

  it("does not retry a non-retryable router error", async () => {
    h.zg.outputs = [new ZgRouterError("401 bad key", false, 401), verdictJson(id)];
    await h.inspector.run(id);
    expect(ins().status).toBe("paused");
    expect(h.zg.calls).toHaveLength(1);
  });

  it("pauses when the response has no request_id", async () => {
    h.zg.noRequestId = true;
    h.zg.outputs = [verdictJson(id)];
    await h.inspector.run(id);
    expect(ins()).toMatchObject({ status: "paused", reason: expect.stringContaining("request_id") });
  });

  it("runs one second pass on a stronger model for low confidence", async () => {
    h.zg.outputs = [verdictJson(id, undefined, 0.6), verdictJson(id, [0, 0, 0, 0, 1, 0], 0.82)];
    await h.inspector.run(id);
    expect(h.zg.calls).toEqual(["cheap", "strong"]);
    expect(ins()).toMatchObject({ status: "done", model: "strong", capture: "20000000" });
  });

  it("needs a human for an unusable angle, and still logs the decision", async () => {
    const out = JSON.parse(verdictJson(id));
    out.angles[1].usable = false;
    h.zg.outputs = [JSON.stringify(out)];
    await h.inspector.run(id);
    expect(ins()).toMatchObject({ status: "needs_human", reason: "unusable angle: back" });
    expect(lastLog().decision.route).toBe("needs_human");
    expect(h.chain.count("proposeVerdict")).toBe(0);
  });

  it("needs a human after two schema failures", async () => {
    h.zg.outputs = ["not json", '{"rental_id":"x"}'];
    await h.inspector.run(id);
    expect(ins()).toMatchObject({ status: "needs_human", reason: "model output failed the schema twice" });
    expect(lastLog().parsed).toBeNull();
  });

  it("resumes after a storage failure without calling 0G again", async () => {
    h.storage.failing = true;
    h.zg.outputs = [verdictJson(id)];
    await h.inspector.run(id);
    expect(ins()).toMatchObject({ status: "paused", reason: expect.stringContaining("0G Storage") });
    h.storage.failing = false;
    await h.inspector.run(id);
    expect(ins().status).toBe("done");
    expect(h.zg.calls).toHaveLength(1);
  });

  it("retries only the onchain step after a failed proposeVerdict", async () => {
    h.chain.fail.add("proposeVerdict");
    h.zg.outputs = [verdictJson(id)];
    await h.inspector.run(id);
    expect(ins().status).toBe("paused");
    const uploads = h.storage.uploads.length;
    h.chain.fail.clear();
    await h.inspector.run(id);
    expect(ins().status).toBe("done");
    expect(h.zg.calls).toHaveLength(1);
    expect(h.storage.uploads).toHaveLength(uploads);
  });

  it("refuses to call 0G when the estimated cost is above the cap", async () => {
    h.zg.models = [{ id: "pricey", promptUsdPerToken: 1e-3, completionUsdPerToken: 1e-3, jsonMode: true }];
    await h.inspector.run(id);
    expect(h.zg.calls).toHaveLength(0);
    expect(ins()).toMatchObject({ status: "needs_human", reason: expect.stringContaining("cost") });
  });
});

describe("keeper", () => {
  it("finalizes after the appeal window and refunds after returnBy + grace", async () => {
    h.zg.outputs = [verdictJson(id)];
    await h.inspector.run(id);
    const t0 = Date.now();
    const keeper = (now: number) => createKeeper({ repo: h.repo, chain: h.chain, inspector: h.inspector, timing: { appealWindowS: 600, graceS: 3600 }, clock: () => now, log: () => {} });
    await keeper(t0 + 60_000).tick();
    expect(h.chain.count("finalize")).toBe(0);
    await keeper(t0 + 700_000).tick();
    expect(h.chain.count("finalize")).toBe(1);
    expect(state(h, id)).toBe("Settled");

    const other = await driveToReturned(h);
    await keeper(Date.now() + 2 * 86_400_000).tick();
    expect(h.chain.calls.filter((c) => c.fn === "refundOnTimeout").map((c) => c.args[0])).toEqual([other]);
    expect(state(h, other)).toBe("Refunded");
  });

  it("resumes paused inspections once their retry time has passed", async () => {
    h.zg.outputs = [new ZgRouterError("down", true), new ZgRouterError("down", true), new ZgRouterError("down", true)];
    await h.inspector.run(id);
    h.zg.outputs = [verdictJson(id)];
    const keeper = createKeeper({ repo: h.repo, chain: h.chain, inspector: h.inspector, timing: { appealWindowS: 600, graceS: 3600 }, clock: () => Date.now() + 3_600_000, log: () => {} });
    await keeper.tick();
    await new Promise((r) => setTimeout(r, 50));
    expect(ins().status).toBe("done");
  });
});
