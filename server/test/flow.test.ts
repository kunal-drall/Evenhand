import { beforeEach, describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { confirm, createRental, makeHarness, postJson, registerOwner, signFund, sixJpegs, state, uploadScan, type Harness } from "./harness.js";
import { p256Device } from "./helpers.js";

let h: Harness;
beforeEach(() => {
  h = makeHarness();
});

describe("POST /rentals", () => {
  it("creates the rental onchain when the renter is known", async () => {
    const { res, body } = await createRental(h);
    expect(res.status).toBe(200);
    expect(body.rentalId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body.payUrl).toBe(`https://evenhand.test/pay/${body.rentalId}`);
    expect(body.txHash).toMatch(/^0x/);
    expect(h.chain.count("createRental")).toBe(1);
    const view = (await (await h.app.request(`/rentals/${body.rentalId}`)).json()) as { state: string; txs: { label: string; url: string }[] };
    expect(view.state).toBe("None");
    expect(view.txs[0]).toMatchObject({ label: "createRental", url: expect.stringContaining("explorer.testnet.whitechain.io/tx/") });
  });

  it("defers createRental to funding when the renter is unknown", async () => {
    const { body } = await createRental(h, { renterAddress: undefined });
    expect(body.txHash).toBeUndefined();
    expect(h.chain.count("createRental")).toBe(0);
    await postJson(h, `/rentals/${body.rentalId}/fund`, await signFund(h, body.rentalId));
    expect(h.chain.calls.map((c) => c.fn)).toEqual(["createRental", "fundWithAuthorization"]);
    expect(h.repo.getRental(body.rentalId)!.renter).toBe(h.renter.address.toLowerCase());
  });

  it("validates input", async () => {
    expect((await createRental(h, { returnBy: new Date(Date.now() + 60_000).toISOString() })).res.status).toBe(400);
    expect((await createRental(h, { scheduleBps: [100, 1000, 3500, 10000] })).res.status).toBe(400);
    expect((await createRental(h, { depositUsdt: "-5" })).res.status).toBe(400);
    expect((await createRental(h, { ownerAddress: "0x123" })).res.status).toBe(400);
  });

  it("lists an owner's rentals", async () => {
    await createRental(h);
    const list = (await (await h.app.request(`/rentals?owner=0x00000000000000000000000000000000000000AA`)).json()) as unknown[];
    expect(list).toHaveLength(1);
  });
});

describe("POST /rentals/:id/fund", () => {
  it("relays one valid authorization, and only one", async () => {
    const { body } = await createRental(h);
    const res = await postJson(h, `/rentals/${body.rentalId}/fund`, await signFund(h, body.rentalId));
    expect(res.status).toBe(200);
    expect(state(h, body.rentalId)).toBe("Funded");
    const again = await postJson(h, `/rentals/${body.rentalId}/fund`, await signFund(h, body.rentalId));
    expect(again.status).toBe(409);
    expect(h.chain.count("fundWithAuthorization")).toBe(1);
  });

  it("rejects a wrong amount, a short validity, another signer and a low balance without spending gas", async () => {
    const { body } = await createRental(h);
    const id = body.rentalId;
    expect((await postJson(h, `/rentals/${id}/fund`, await signFund(h, id, { value: 1n }))).status).toBe(400);
    expect((await postJson(h, `/rentals/${id}/fund`, await signFund(h, id, { validBefore: BigInt(Math.floor(Date.now() / 1000) + 10) }))).status).toBe(400);
    const other = await signFund({ ...h, renter: privateKeyToAccount(generatePrivateKey()) }, id);
    expect((await postJson(h, `/rentals/${id}/fund`, other)).status).toBe(400);
    h.chain.usdt = 1n;
    expect((await postJson(h, `/rentals/${id}/fund`, await signFund(h, id))).status).toBe(400);
    expect(h.chain.count("fundWithAuthorization")).toBe(0);
  });
});

describe("scans", () => {
  async function funded() {
    const { body } = await createRental(h);
    await postJson(h, `/rentals/${body.rentalId}/fund`, await signFund(h, body.rentalId));
    return { id: body.rentalId, device: await registerOwner(h) };
  }

  it("records pickup only after the renter confirms, then return on the owner's scan", async () => {
    const { id, device } = await funded();
    const pickup = await uploadScan(h, id, "pickup", device);
    expect(pickup.res.status).toBe(200);
    expect(pickup.body.txHash).toBeUndefined();
    expect(h.chain.count("recordPickup")).toBe(0);

    const ok = await confirm(h, id, "pickup", pickup.body.manifestHash!);
    expect(await ok.json()).toMatchObject({ ok: true, txHash: expect.stringMatching(/^0x/) });
    expect(state(h, id)).toBe("PickedUp");

    const ret = await uploadScan(h, id, "return", device);
    expect(ret.body.txHash).toMatch(/^0x/);
    expect(state(h, id)).toBe("Returned");
    expect(h.started).toEqual([id]);

    const view = (await (await h.app.request(`/rentals/${id}`)).json()) as { scans: { pickup: { confirmedBy: string[]; photoUrls: string[] } } };
    expect(view.scans.pickup.confirmedBy).toEqual([h.renter.address.toLowerCase()]);
    const photo = await h.app.request(new URL(view.scans.pickup.photoUrls[4]!).pathname);
    expect(photo.headers.get("content-type")).toBe("image/jpeg");
  });

  it("rejects a confirmation from anyone but the renter", async () => {
    const { id, device } = await funded();
    const pickup = await uploadScan(h, id, "pickup", device);
    const stranger = privateKeyToAccount(generatePrivateKey());
    expect((await confirm(h, id, "pickup", pickup.body.manifestHash!, stranger)).status).toBe(403);
    expect((await confirm(h, id, "pickup", `0x${"00".repeat(32)}`)).status).toBe(403);
  });

  it("rejects forged, unregistered, stale, mismatched and out-of-order scans", async () => {
    const { id, device } = await funded();
    const photos = await sixJpegs();
    const swapped = [photos[1]!, photos[0]!, ...photos.slice(2)];
    const forged = await uploadScan(h, id, "pickup", device, { sign: () => p256Device().signB64(Buffer.from("x")) });
    expect(forged.res.status).toBe(403);
    expect((await uploadScan(h, id, "pickup", "dk_unknown")).res.status).toBe(403);
    expect((await uploadScan(h, id, "pickup", device, { capturedAt: new Date(Date.now() - 3_600_000).toISOString() })).res.status).toBe(400);
    const mismatched = await uploadScan(h, id, "pickup", device, { files: swapped });
    expect(mismatched.res.status).toBe(400);
    expect(mismatched.body.error).toMatch(/does not match its manifest hash/);
    expect((await uploadScan(h, id, "return", device)).res.status).toBe(409);
    expect(h.repo.getScan(id, "pickup")).toBeUndefined();
  });

  it("refuses a pickup before funding", async () => {
    const { body } = await createRental(h);
    const device = await registerOwner(h);
    expect((await uploadScan(h, body.rentalId, "pickup", device)).res.status).toBe(409);
  });
});
