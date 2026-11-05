import { describe, expect, it } from "vitest";
import type { ModelVerdict } from "@evenhand/shared";
import { captureFor, decide, ehString, parseVerdict, wantsSecondPass } from "../src/inspector/rules.js";

const ID = `0x${"ab".repeat(32)}`;
const ANGLES = ["front", "back", "left", "right", "top", "detail"] as const;

function verdict(over: Partial<ModelVerdict> = {}, severity = [0, 0, 0, 0, 2, 0]): ModelVerdict {
  return {
    rental_id: ID,
    angles: ANGLES.map((angle, i) => ({
      angle,
      usable: true,
      new_damage: severity[i]! > 0,
      severity: severity[i] as 0 | 1 | 2 | 3,
      location: "",
      description: "",
      confidence: 0.9,
    })),
    overall_confidence: 0.87,
    text_in_image_ignored: false,
    eh: ehString(ID, severity, 8700),
    ...over,
  };
}

describe("parseVerdict", () => {
  it("accepts valid JSON for this rental", () => {
    expect(parseVerdict(JSON.stringify(verdict()), ID.toUpperCase().replace("0X", "0x"))?.overall_confidence).toBe(0.87);
  });

  it("rejects non-JSON, schema failures and another rental's verdict", () => {
    expect(parseVerdict("not json", ID)).toBeNull();
    expect(parseVerdict(JSON.stringify({ ...verdict(), angles: verdict().angles.slice(0, 5) }), ID)).toBeNull();
    expect(parseVerdict(JSON.stringify({ ...verdict(), overall_confidence: 1.5 }), ID)).toBeNull();
    expect(parseVerdict(JSON.stringify(verdict({ rental_id: `0x${"cd".repeat(32)}` })), ID)).toBeNull();
  });
});

describe("RULES_V1 decide", () => {
  it("proposes automatically when every angle is usable and confidence >= 0.75", () => {
    expect(decide(verdict())).toEqual({ route: "auto", severity: [0, 0, 0, 0, 2, 0], confidenceBps: 8700 });
  });

  it("routes to needs_human on schema failure twice", () => {
    expect(decide(null)).toMatchObject({ route: "needs_human", reason: "model output failed the schema twice" });
  });

  it("routes to needs_human on any unusable angle", () => {
    const v = verdict();
    v.angles[2]!.usable = false;
    expect(decide(v)).toMatchObject({ route: "needs_human", reason: "unusable angle: left" });
    expect(wantsSecondPass(v)).toBe(false);
  });

  it("routes to needs_human when text was seen in an image", () => {
    expect(decide(verdict({ text_in_image_ignored: true }))).toMatchObject({ route: "needs_human", reason: "text seen in an image" });
  });

  it("routes low confidence to needs_human when there is no stronger model", () => {
    const low = verdict({ overall_confidence: 0.6 });
    expect(wantsSecondPass(low)).toBe(true);
    expect(decide(low)).toMatchObject({ route: "needs_human", confidenceBps: 6000 });
  });

  it("uses a confident second pass, and needs_human when the second pass is also unsure or broken", () => {
    const low = verdict({ overall_confidence: 0.6 });
    expect(decide(low, verdict({ overall_confidence: 0.8 }, [0, 0, 0, 0, 1, 0]))).toEqual({
      route: "auto",
      severity: [0, 0, 0, 0, 1, 0],
      confidenceBps: 8000,
    });
    expect(decide(low, verdict({ overall_confidence: 0.7 }))).toMatchObject({ route: "needs_human", confidenceBps: 7000 });
    expect(decide(low, null)).toMatchObject({ route: "needs_human", reason: "second-pass output failed the schema twice" });
  });
});

describe("capture and eh", () => {
  it("captures deposit x scheduleBps[max severity]", () => {
    expect(captureFor(200_000_000n, [0, 1000, 3500, 10000], [0, 0, 0, 0, 2, 1])).toBe(70_000_000n);
    expect(captureFor(200_000_000n, [0, 1000, 3500, 10000], [0, 0, 0, 0, 0, 0])).toBe(0n);
  });

  it("builds the canonical eh string with a lowercase ID", () => {
    expect(ehString(ID.toUpperCase().replace("0X", "0x"), [0, 0, 2, 0, 0, 0], 8700)).toBe(`EH1;${ID};0,0,2,0,0,0;8700`);
  });
});
