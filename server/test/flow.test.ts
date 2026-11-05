import { beforeEach, describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { confirm, createRental, makeHarness, postJson, registerOwner, signFund, sixJpegs, state, uploadScan, type Harness } from "./harness.js";
import { p256Device } from "./helpers.js";

let h: Harness;
beforeEach(() => {
  h = makeHarness();
});

describe("POST /rentals", () => {
  it("spends no gas at creation, even when the renter is known", async () => {
    const { res, body } = await createRental(h);
    expect(res.status).toBe(200);
    expect(body.rentalId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body.payUrl).toBe(`https://evenhand.test/pay/${body.rentalId}`);
    expect(body.txHash).toBeUndefined();
    expect(h.chain.calls).toHaveLength(0);
    await postJson(h, `/rentals/${body.rentalId}/fund`, await signFund(h, body.rentalId));
    const view = (await (await h.app.request(`/rentals/${body.rentalId}`)).json()) as { state: string; txs: { label: string; url: string }[] };
    expect(view.state).toBe("Funded");
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

describe("operator endpoints", () => {
  it("require OPERATOR_TOKEN when it is set", async () => {
    const op = makeHarness({ operatorToken: "op-token-0123456789" });
    await createRental(op);
    const owner = "0x00000000000000000000000000000000000000AA";
    expect((await op.app.request(`/rentals?owner=${owner}`)).status).toBe(401);
    expect((await op.app.request("/rentals?queue=arbiter")).status).toBe(401);
    expect((await op.app.request(`/export.csv?owner=${owner}`)).status).toBe(401);
    expect((await op.app.request(`/rentals?owner=${owner}`, { headers: { "x-operator-token": "op-token-0123456789" } })).status).toBe(200);
    expect((await op.app.request(`/export.csv?owner=${owner}&token=op-token-0123456789`)).status).toBe(200);
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

  it("rejects another rental's nonce, a used nonce and a malformed signature without spending gas", async () => {
    const { body } = await createRental(h);
    const id = body.rentalId;
    expect((await postJson(h, `/rentals/${id}/fund`, await signFund(h, id, { nonce: `0x${"12".repeat(32)}` }))).status).toBe(400);
    const good = await signFund(h, id);
    h.chain.usedNonces.add(`${h.renter.address.toLowerCase()}:${good.nonce}`);
    expect((await postJson(h, `/rentals/${id}/fund`, good)).status).toBe(400);
    h.chain.usedNonces.clear();
    expect((await postJson(h, `/rentals/${id}/fund`, { ...good, r: `0x${"00".repeat(32)}`, s: `0x${"00".repeat(32)}` })).status).toBe(400);
    expect(h.chain.calls).toHaveLength(0);
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
    const url = new URL(view.scans.pickup.photoUrls[4]!);
    const photo = await h.app.request(url.pathname + url.search);
    expect(photo.headers.get("content-type")).toBe("image/jpeg");
    expect((await h.app.request(url.pathname)).status).toBe(403);
    expect((await h.app.request(`${url.pathname}?t=${"0".repeat(32)}`)).status).toBe(403);
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

  it("only the rental's owner device may scan it", async () => {
    const { id, device } = await funded();
    const pickup = await uploadScan(h, id, "pickup", device);
    await confirm(h, id, "pickup", pickup.body.manifestHash!);
    const intruder = makeHarness().owner; // a key nobody vouched for, registered as an owner device
    const res = await postJson(h, "/devices", { role: "owner", publicKeySpkiB64: intruder.spkiB64, label: "intruder" });
    const intruderId = ((await res.json()) as { deviceKeyId: string }).deviceKeyId;
    const attack = await uploadScan(h, id, "return", intruderId, { sign: intruder.signB64 });
    expect(attack.res.status).toBe(403);
    expect(h.chain.count("recordReturn")).toBe(0);
    expect((await uploadScan(h, id, "return", device)).res.status).toBe(200);
  });

  it("binds the owner device given at creation", async () => {
    const device = await registerOwner(h);
    const { body } = await createRental(h, { ownerDeviceKeyId: device });
    await postJson(h, `/rentals/${body.rentalId}/fund`, await signFund(h, body.rentalId));
    const other = makeHarness().owner;
    const otherId = ((await (await postJson(h, "/devices", { role: "owner", publicKeySpkiB64: other.spkiB64, label: "x" })).json()) as { deviceKeyId: string }).deviceKeyId;
    expect((await uploadScan(h, body.rentalId, "pickup", otherId, { sign: other.signB64 })).res.status).toBe(403);
    expect((await uploadScan(h, body.rentalId, "pickup", device)).res.status).toBe(200);
    expect((await createRental(h, { ownerDeviceKeyId: "dk_missing" })).res.status).toBe(400);
  });

  it("serialises concurrent return uploads so the recorded hash is the stored scan", async () => {
    const { id, device } = await funded();
    const pickup = await uploadScan(h, id, "pickup", device);
    await confirm(h, id, "pickup", pickup.body.manifestHash!);
    const [a, b] = await Promise.all([
      uploadScan(h, id, "return", device),
      uploadScan(h, id, "return", device, { capturedAt: new Date(Date.now() - 500).toISOString() }),
    ]);
    expect([a.res.status, b.res.status].sort()).toEqual([200, 409]);
    const recorded = h.chain.calls.filter((c) => c.fn === "recordReturn");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.args[1]).toBe(h.repo.getScan(id, "return")!.manifestHash);
  });

  it("rejects photos that are not decodable JPEGs", async () => {
    const { id, device } = await funded();
    const junk = Array.from({ length: 6 }, (_, i) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, i]));
    const res = await uploadScan(h, id, "pickup", device, { photos: junk });
    expect(res.res.status).toBe(400);
    expect(res.body.error).toMatch(/not a decodable JPEG/);
  });

  it("refuses a pickup before funding", async () => {
    const { body } = await createRental(h);
    const device = await registerOwner(h);
    expect((await uploadScan(h, body.rentalId, "pickup", device)).res.status).toBe(409);
  });
});
