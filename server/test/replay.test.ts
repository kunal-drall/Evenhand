import { beforeEach, describe, expect, it } from "vitest";
import { InspectionLog } from "@evenhand/shared";
import { replay } from "../src/inspector/replay.js";
import { driveToReturned, makeHarness, verdictJson, type Harness } from "./harness.js";

let h: Harness;
let id: string;
beforeEach(async () => {
  h = makeHarness();
  id = await driveToReturned(h);
});

const loggedAfter = async (outputs: string[]) => {
  h.zg.outputs = outputs;
  await h.inspector.run(id);
  return InspectionLog.parse(JSON.parse(h.storage.uploads.at(-1)!.toString()));
};

describe("replay from the 0G Storage log", () => {
  it("reproduces an automatic verdict", async () => {
    const r = replay(await loggedAfter([verdictJson(id)]));
    expect(r).toMatchObject({ matches: true, checks: { rubric: true, rules: true }, decision: { route: "auto", severity: [0, 0, 0, 0, 2, 0], confidenceBps: 8700 } });
  });

  it("reproduces a confident second pass", async () => {
    const log = await loggedAfter([verdictJson(id, undefined, 0.6), verdictJson(id, [0, 0, 0, 0, 1, 0], 0.82)]);
    expect(log.passes?.map((p) => p.model)).toEqual(["cheap", "strong"]);
    expect(replay(log)).toMatchObject({ matches: true, decision: { route: "auto", confidenceBps: 8200 } });
  });

  it("reproduces needs_human for text in an image and for schema failures", async () => {
    expect(replay(await loggedAfter([verdictJson(id, undefined, 0.9, { text_in_image_ignored: true })])).matches).toBe(true);
    h = makeHarness();
    id = await driveToReturned(h);
    expect(replay(await loggedAfter(["nope", "still nope"]))).toMatchObject({ matches: true, decision: { route: "needs_human" } });
  });

  it("detects a log whose decision was altered", async () => {
    const log = await loggedAfter([verdictJson(id)]);
    expect(replay({ ...log, decision: { ...log.decision, severity: [0, 0, 0, 0, 3, 0] } }).matches).toBe(false);
    expect(replay({ ...log, rubricSha256: "0".repeat(64) }).checks.rubric).toBe(false);
  });
});
