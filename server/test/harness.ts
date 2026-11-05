// Test harness: the real app, repo and inspector wired to a fake chain, fake 0G Router and fake 0G Storage.
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { ANGLES, receiveWithAuthorizationTypes, type PaymentConfig, type RentalState } from "@evenhand/shared";
import { parseSignature, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createApp } from "../src/app.js";
import type { ChainPort, CreateRentalArgs, FundAuth, OnchainRental } from "../src/chain/port.js";
import type { Hex } from "../src/config.js";
import { openDb } from "../src/db.js";
import { createInspector } from "../src/inspector/pipeline.js";
import { canonicalBytes } from "../src/manifest.js";
import { BundleStore } from "../src/photos/store.js";
import { createBundleUploader } from "../src/photos/uploader.js";
import { Repo } from "../src/rentals/repo.js";
import type { VisionModel } from "../src/zg/models.js";
import type { StoragePort, ZgPort } from "../src/zg/ports.js";
import type { ZgCallResult } from "../src/zg/router.js";
import { p256Device } from "./helpers.js";

export const USDT = "0xcedfb56113143d55b2358b8cfbb0deb5ad2f55a7" as Hex;
export const DEPOSITS = "0x00000000000000000000000000000000000000d1" as Hex;
export const OWNER = "0x00000000000000000000000000000000000000aa" as Hex;

export class FakeChain implements ChainPort {
  ready = true;
  calls: { fn: string; args: unknown[] }[] = [];
  rentals = new Map<string, CreateRentalArgs>();
  needsArbiter = false;
  usdt = 10n ** 12n;
  fail = new Set<string>();
  private n = 0;

  private tx(fn: string, args: unknown[]): Hex {
    this.calls.push({ fn, args });
    if (this.fail.has(fn)) throw new Error(`${fn} reverted`);
    this.n += 1;
    return `0x${this.n.toString(16).padStart(64, "0")}`;
  }
  count(fn: string): number {
    return this.calls.filter((c) => c.fn === fn).length;
  }
  async createRental(a: CreateRentalArgs) {
    const hash = this.tx("createRental", [a]);
    this.rentals.set(a.id, a);
    return hash;
  }
  async fund(id: Hex, auth: FundAuth) {
    return this.tx("fundWithAuthorization", [id, auth]);
  }
  async recordPickup(id: Hex, h: Hex) {
    return this.tx("recordPickup", [id, h]);
  }
  async recordReturn(id: Hex, h: Hex) {
    return this.tx("recordReturn", [id, h]);
  }
  async proposeVerdict(id: Hex, severity: number[], confidenceBps: number, root: Hex) {
    const hash = this.tx("proposeVerdict", [id, severity, confidenceBps, root]);
    const r = this.rentals.get(id)!;
    const capture = (r.deposit * BigInt(r.scheduleBps[Math.max(...severity)]!)) / 10_000n;
    return { hash, capture, needsArbiter: this.needsArbiter };
  }
  async finalize(id: Hex) {
    return this.tx("finalize", [id]);
  }
  async refundOnTimeout(id: Hex) {
    return this.tx("refundOnTimeout", [id]);
  }
  async getRental(): Promise<OnchainRental> {
    throw new Error("not used: keep local state");
  }
  async paymentConfig(): Promise<PaymentConfig> {
    return { chainId: 1874, depositsAddress: DEPOSITS, usdt: { address: USDT, decimals: 6 }, domain: { name: "Tether USD", version: "1", chainId: 1874, verifyingContract: USDT } };
  }
  async usdtBalance() {
    return this.usdt;
  }
  async gasBalances() {
    return {};
  }
}

export const MODELS: VisionModel[] = [
  { id: "cheap", promptUsdPerToken: 1e-8, completionUsdPerToken: 1e-7, jsonMode: true },
  { id: "strong", promptUsdPerToken: 1e-7, completionUsdPerToken: 1e-6, jsonMode: true },
];

/** Router fake: each call consumes the next scripted output (string = model content, Error = failure). */
export class FakeZg implements ZgPort {
  outputs: (string | Error | ((model: string) => string))[] = [];
  models = MODELS;
  calls: string[] = [];
  noRequestId = false;
  async listModels() {
    return this.models;
  }
  async call(request: { model: string }): Promise<ZgCallResult> {
    this.calls.push(request.model);
    const next = this.outputs.shift();
    if (next === undefined) throw new Error("FakeZg: no scripted output left");
    if (next instanceof Error) throw next;
    return {
      model: request.model,
      rawOutput: typeof next === "function" ? next(request.model) : next,
      requestId: this.noRequestId ? null : `req-${this.calls.length}`,
      provider: "0xprovider",
      teeVerified: true,
      billing: { total: "1" },
      chatId: `chat-${this.calls.length}`,
      usage: { prompt_tokens: 1000, completion_tokens: 100 },
    };
  }
}

export class FakeStorage implements StoragePort {
  uploads: Buffer[] = [];
  failing = false;
  async upload(bytes: Uint8Array) {
    if (this.failing) throw new Error("storage node unreachable");
    this.uploads.push(Buffer.from(bytes));
    return { rootHash: `0x${createHash("sha256").update(bytes).digest("hex")}`, txHash: `0x${"ee".repeat(32)}` };
  }
}

export function verdictJson(rentalId: string, severity = [0, 0, 0, 0, 2, 0], confidence = 0.87, over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    rental_id: rentalId,
    angles: ANGLES.map((angle, i) => ({
      angle,
      usable: true,
      new_damage: severity[i]! > 0,
      severity: severity[i],
      location: severity[i] ? "lid, top left" : "",
      description: severity[i] ? "deep scratch" : "",
      confidence: 0.9,
    })),
    overall_confidence: confidence,
    text_in_image_ignored: false,
    eh: `EH1;${rentalId};${severity.join(",")};${Math.round(confidence * 10000)}`,
    ...over,
  });
}

let jpegs: Buffer[] | undefined;
export async function sixJpegs(): Promise<Buffer[]> {
  jpegs ??= await Promise.all(
    ANGLES.map((_, i) => sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 40 * i, g: 90, b: 160 } } }).jpeg().toBuffer()),
  );
  return jpegs;
}

export function makeHarness() {
  const repo = new Repo(openDb(":memory:"));
  const bundles = new BundleStore(mkdtempSync(join(tmpdir(), "evenhand-test-")));
  const photoKey = randomBytes(32);
  const chain = new FakeChain();
  const zg = new FakeZg();
  const storage = new FakeStorage();
  const ensureBundleRoot = createBundleUploader(repo, bundles, storage);
  const inspector = createInspector({ repo, chain, zg, storage, bundles, ensureBundleRoot, photoKey, models: {}, maxCostUsd: 1, routerBackoffMs: 0, log: () => {} });
  const started: string[] = [];
  const app = createApp({
    repo,
    chain,
    inspector: { start: (id) => started.push(id) },
    bundles,
    ensureBundleRoot,
    photoKey,
    zgHealth: async () => ({ router: true, storage: true }),
    publicBaseUrl: "https://evenhand.test",
  });
  const renter = privateKeyToAccount(generatePrivateKey());
  const owner = p256Device();
  return { app, repo, chain, zg, storage, inspector, started, bundles, photoKey, renter, owner };
}

export type Harness = ReturnType<typeof makeHarness>;

export const postJson = (h: Harness, path: string, body: unknown) =>
  h.app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export async function createRental(h: Harness, over: Record<string, unknown> = {}) {
  const res = await postJson(h, "/rentals", {
    ownerAddress: OWNER,
    renterAddress: h.renter.address,
    depositUsdt: "200000000",
    returnBy: new Date(Date.now() + 86_400_000).toISOString(),
    scheduleBps: [0, 1000, 3500, 10000],
    item: "Laptop with vinyl lid skin",
    ...over,
  });
  return { res, body: (await res.json()) as { rentalId: string; payUrl: string; txHash?: string; error?: string } };
}

export async function signFund(h: Harness, rentalId: string, over: { value?: bigint; validBefore?: bigint } = {}) {
  const cfg = await h.chain.paymentConfig();
  const now = BigInt(Math.floor(Date.now() / 1000));
  const message = {
    from: h.renter.address,
    to: cfg.depositsAddress as Hex,
    value: over.value ?? BigInt(h.repo.getRental(rentalId)!.deposit),
    validAfter: 0n,
    validBefore: over.validBefore ?? now + 3600n,
    nonce: toHex(randomBytes(32)),
  };
  const sig = parseSignature(await h.renter.signTypedData({ domain: cfg.domain as never, types: receiveWithAuthorizationTypes, primaryType: "ReceiveWithAuthorization", message }));
  return { from: h.renter.address, validAfter: "0", validBefore: message.validBefore.toString(), nonce: message.nonce, v: Number(sig.v), r: sig.r, s: sig.s };
}

export async function registerOwner(h: Harness): Promise<string> {
  const res = await postJson(h, "/devices", { role: "owner", publicKeySpkiB64: h.owner.spkiB64, label: "owner iPhone" });
  return ((await res.json()) as { deviceKeyId: string }).deviceKeyId;
}

export async function uploadScan(
  h: Harness,
  rentalId: string,
  phase: "pickup" | "return",
  deviceKeyId: string,
  opts: { capturedAt?: string; photos?: Buffer[]; files?: Buffer[]; sign?: (b: Buffer) => string } = {},
) {
  const photos = opts.photos ?? (await sixJpegs());
  const files = opts.files ?? photos;
  const manifest = {
    v: 1,
    rentalId,
    phase,
    role: "owner",
    deviceKeyId,
    capturedAt: opts.capturedAt ?? new Date(Date.now() - (phase === "pickup" ? 2000 : 1000)).toISOString(),
    appBuild: "ios/1.0.0+1",
    shots: ANGLES.map((angle, i) => ({ angle, sha256: createHash("sha256").update(photos[i]!).digest("hex"), width: 64, height: 48 })),
  };
  const form = new FormData();
  form.set("manifest", JSON.stringify(manifest));
  form.set("signature", (opts.sign ?? h.owner.signB64)(canonicalBytes(manifest as never)));
  ANGLES.forEach((angle, i) => form.set(angle, new File([new Uint8Array(files[i]!)], `${angle}.jpg`, { type: "image/jpeg" })));
  const res = await h.app.request(`/rentals/${rentalId}/scans/${phase}`, { method: "POST", body: form });
  return { res, body: (await res.json()) as { manifestHash?: string; txHash?: string; error?: string } };
}

export async function confirm(h: Harness, rentalId: string, phase: "pickup" | "return", manifestHash: string, signer = h.renter) {
  const signature = await signer.signMessage({ message: `EVENHAND-CONFIRM:${rentalId}:${phase}:${manifestHash}` });
  return postJson(h, `/rentals/${rentalId}/scans/${phase}/confirm`, { address: signer.address, signature });
}

/** Create -> fund -> pickup + renter confirm -> return. Leaves the inspection unstarted. */
export async function driveToReturned(h: Harness): Promise<string> {
  const { body } = await createRental(h);
  const id = body.rentalId;
  await postJson(h, `/rentals/${id}/fund`, await signFund(h, id));
  const device = await registerOwner(h);
  const pickup = await uploadScan(h, id, "pickup", device);
  await confirm(h, id, "pickup", pickup.body.manifestHash!);
  await uploadScan(h, id, "return", device);
  return id;
}

export const state = (h: Harness, id: string): RentalState => h.repo.getRental(id)!.state;
