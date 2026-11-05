import { describe, expect, it } from "vitest";
import { pickModels, toVisionModels } from "../src/zg/models.js";
import { buildInspectionRequest } from "../src/zg/router.js";
import { RUBRIC_V1, RUBRIC_V1_SHA256 } from "../src/zg/rubric.js";
import { storageRoot } from "../src/zg/storage.js";

describe("0G Storage root", () => {
  it("is a deterministic 32-byte hex root computed offline", async () => {
    const bytes = Buffer.from('{"v":1}');
    const root = await storageRoot(bytes);
    expect(root).toMatch(/^0x[0-9a-f]{64}$/);
    expect(await storageRoot(bytes)).toBe(root);
    expect(await storageRoot(Buffer.from('{"v":2}'))).not.toBe(root);
  });
});

const entry = (id: string, prompt: string, inputs = ["text", "image"], params = ["response_format"]) => ({
  id,
  architecture: { input_modalities: inputs, output_modalities: ["text"] },
  supported_parameters: params,
  pricing_usd: { prompt, completion: "0.000001" },
});

describe("vision model selection", () => {
  const models = toVisionModels({
    data: [
      entry("big", "0.000002"),
      entry("text-only", "0.00000001", ["text"]),
      entry("cheap-no-json", "0.00000002", ["text", "image"], []),
      entry("cheap", "0.00000005"),
      entry("mid", "0.0000001"),
    ],
  });

  it("keeps image-capable models, cheapest first", () => {
    expect(models.map((m) => m.id)).toEqual(["cheap-no-json", "cheap", "mid", "big"]);
  });

  it("picks the cheapest JSON-mode model, and a stronger one at least 5x its price", () => {
    const picked = pickModels(models);
    expect(picked.first.id).toBe("cheap");
    expect(picked.strong?.id).toBe("big");
  });

  it("honours env overrides and rejects unknown IDs", () => {
    expect(pickModels(models, { first: "mid", strong: "big" }).first.id).toBe("mid");
    expect(() => pickModels(models, { first: "nope" })).toThrow(/not an image-capable model/);
  });
});

describe("inspection request", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff]);
  const angles = ["front", "back", "left", "right", "top", "detail"] as const;
  const pairs = angles.map((angle) => ({ angle, pickupJpeg: jpeg, returnJpeg: jpeg }));
  const req = buildInspectionRequest("m", `0x${"11".repeat(32)}`, pairs);

  it("matches the section 8 envelope", () => {
    expect(req).toMatchObject({ model: "m", temperature: 0, max_tokens: 700, response_format: { type: "json_object" }, verify_tee: true });
    expect(req.messages[0]).toEqual({ role: "system", content: RUBRIC_V1 });
  });

  it("puts the rental ID first, then 12 labelled images in angle order", () => {
    const content = req.messages[1].content;
    expect(content[0]).toEqual({
      type: "text",
      text: `rental_id: 0x${"11".repeat(32)}\nPairs follow in order front, back, left, right, top, detail. For each angle: first image = PICKUP, second = RETURN.`,
    });
    expect(content.filter((p) => p.type === "image_url")).toHaveLength(12);
    expect(content[1]).toEqual({ type: "text", text: "front PICKUP" });
    expect(content[3]).toEqual({ type: "text", text: "front RETURN" });
    expect(content[23]).toEqual({ type: "text", text: "detail RETURN" });
  });

  it("keeps the rubric static", () => {
    expect(RUBRIC_V1).not.toContain("${");
    expect(RUBRIC_V1_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });
});
