import { describe, expect, it } from "vitest";
import { createKeeper } from "../src/inspector/keeper.js";
import { csvField } from "../src/routes/export.js";
import { OWNER, driveToReturned, makeHarness, verdictJson } from "./harness.js";

describe("GET /export.csv", () => {
  it("lists each rental with deposit, capture, refund and tx links", async () => {
    const h = makeHarness();
    const id = await driveToReturned(h);
    h.zg.outputs = [verdictJson(id)];
    await h.inspector.run(id);
    await createKeeper({ repo: h.repo, chain: h.chain, inspector: h.inspector, timing: { appealWindowS: 600, graceS: 3600 }, clock: () => Date.now() + 700_000, log: () => {} }).tick();

    const res = await h.app.request(`/export.csv?owner=${OWNER}`);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const [header, line] = (await res.text()).trim().split("\r\n");
    expect(header).toBe("rentalId,item,deposit,capture,refund,state,fundTx,settleTx,inspectionRoot,requestId");
    const cells = line!.split(",");
    expect(cells.slice(0, 6)).toEqual([id, "Laptop with vinyl lid skin", "200", "70", "130", "Settled"]);
    expect(cells[6]).toMatch(/^0x/);
    expect(cells[7]).toMatch(/^0x/);
    expect(cells[8]).toBe(h.repo.getInspection(id)!.inspectionRoot);
    expect(cells[9]).toBe("req-1");
  });

  it("requires an owner address", async () => {
    expect((await makeHarness().app.request("/export.csv")).status).toBe(400);
  });

  it("quotes commas and quotes, and defuses formulas", () => {
    expect(csvField('Laptop, "pro"')).toBe('"Laptop, ""pro"""');
    expect(csvField("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
  });
});

describe("GET /rentals?queue=arbiter", () => {
  it("lists rentals waiting on a human", async () => {
    const h = makeHarness();
    const id = await driveToReturned(h);
    h.zg.outputs = [verdictJson(id, undefined, 0.87, { text_in_image_ignored: true })];
    await h.inspector.run(id);
    const queue = (await (await h.app.request("/rentals?queue=arbiter")).json()) as { rentalId: string; inspection: { status: string } }[];
    expect(queue.map((r) => [r.rentalId, r.inspection.status])).toEqual([[id, "needs_human"]]);
  });
});
