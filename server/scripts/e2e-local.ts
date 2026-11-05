// C4 end-to-end against a running server on testnet: create, fund, pickup + confirm, return with a scratch,
// then wait for the real 0G verdict and print the tx links. Needs: server running with a full .env, a deployed
// contract, and TEST_RENTER_PRIVATE_KEY holding test USDT. Run: pnpm -C server e2e   (server: pnpm -C server dev)
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import canonicalize from "canonicalize";
import sharp from "sharp";
import { ANGLES, fundingNonce, receiveWithAuthorizationTypes, type PaymentConfig, type RentalView } from "@evenhand/shared";
import { parseSignature } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadDotEnv } from "../src/env-file.js";

loadDotEnv();
const base = (process.env.E2E_BASE_URL || "http://localhost:8787").replace(/\/$/, "");
const renterKey = process.env.TEST_RENTER_PRIVATE_KEY as `0x${string}` | undefined;
const ownerKey = (process.env.E2E_OWNER_PRIVATE_KEY || process.env.INSPECTOR_PRIVATE_KEY) as `0x${string}` | undefined;
if (!renterKey || !ownerKey) throw new Error("set TEST_RENTER_PRIVATE_KEY and E2E_OWNER_PRIVATE_KEY (or INSPECTOR_PRIVATE_KEY) in .env");
const renter = privateKeyToAccount(renterKey);
const ownerAddress = privateKeyToAccount(ownerKey).address;
const deposit = process.env.E2E_DEPOSIT || "1000000"; // base units; 1 USDT at 6 decimals

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(120_000) });
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status}: ${body.error}`);
  return body;
}
const post = <T>(path: string, body: unknown) => api<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** Six distinct textless scenes; the return copy of `top` (the lid) carries one deep scratch. */
async function photos(scratch: boolean): Promise<Buffer[]> {
  const colors = ["#2f3237", "#3a3f46", "#30343a", "#34383e", "#2b2e33", "#41464d"];
  return Promise.all(
    ANGLES.map((angle, i) => {
      const mark = scratch && angle === "top" ? '<path d="M 330 250 L 610 470" stroke="#e6e6e6" stroke-width="6" stroke-linecap="round"/>' : "";
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768"><rect width="1024" height="768" fill="#efe9df"/>
        <rect x="${132 + i * 10}" y="104" width="${760 - i * 20}" height="${560 - i * 30}" rx="34" fill="${colors[i]}"/>
        <circle cx="${300 + i * 80}" cy="384" r="30" fill="#55595f"/>${mark}</svg>`;
      return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
    }),
  );
}

const device = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const spkiB64 = device.publicKey.export({ format: "der", type: "spki" }).toString("base64");

async function scan(rentalId: string, phase: "pickup" | "return", deviceKeyId: string, jpegs: Buffer[]) {
  const manifest = {
    v: 1, rentalId, phase, role: "owner", deviceKeyId, capturedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), appBuild: "e2e/1",
    shots: ANGLES.map((angle, i) => ({ angle, sha256: createHash("sha256").update(jpegs[i]!).digest("hex"), width: 1024, height: 768 })),
  };
  const form = new FormData();
  form.set("manifest", JSON.stringify(manifest));
  form.set("signature", sign("sha256", Buffer.from(canonicalize(manifest)!), { key: device.privateKey, dsaEncoding: "der" }).toString("base64"));
  ANGLES.forEach((a, i) => form.set(a, new File([new Uint8Array(jpegs[i]!)], `${a}.jpg`, { type: "image/jpeg" })));
  return api<{ manifestHash: string; txHash?: string }>(`/rentals/${rentalId}/scans/${phase}`, { method: "POST", body: form });
}

console.log("0G health:", await api("/health/0g"));
const { deviceKeyId } = await post<{ deviceKeyId: string }>("/devices", { role: "owner", publicKeySpkiB64: spkiB64, label: "e2e" });
const created = await post<{ rentalId: string; payUrl: string; txHash?: string }>("/rentals", {
  ownerAddress, renterAddress: renter.address, depositUsdt: deposit,
  returnBy: new Date(Date.now() + 2 * 3600_000).toISOString(), scheduleBps: [0, 1000, 3500, 10000], item: "e2e laptop", ownerDeviceKeyId: deviceKeyId,
});
const id = created.rentalId;
console.log("rental", id, "createRental", created.txHash);

const cfg = await api<PaymentConfig>("/payment-config");
const message = { from: renter.address, to: cfg.depositsAddress as `0x${string}`, value: BigInt(deposit), validAfter: 0n, validBefore: BigInt(Math.floor(Date.now() / 1000) + 3600), nonce: fundingNonce(cfg.depositsAddress as `0x${string}`, id as `0x${string}`) };
const sig = parseSignature(await renter.signTypedData({ domain: cfg.domain as never, types: receiveWithAuthorizationTypes, primaryType: "ReceiveWithAuthorization", message }));
const fund = await post<{ txHash: string }>(`/rentals/${id}/fund`, { from: renter.address, validAfter: "0", validBefore: message.validBefore.toString(), nonce: message.nonce, v: Number(sig.v), r: sig.r, s: sig.s });
console.log("funded", fund.txHash);

const pickup = await scan(id, "pickup", deviceKeyId, await photos(false));
const confirmSig = await renter.signMessage({ message: `EVENHAND-CONFIRM:${id}:pickup:${pickup.manifestHash}` });
console.log("pickup", await post(`/rentals/${id}/scans/pickup/confirm`, { address: renter.address, signature: confirmSig }));
await new Promise((r) => setTimeout(r, 1500));
console.log("return", await scan(id, "return", deviceKeyId, await photos(true)));

for (let i = 0; i < 60; i++) {
  const view = await api<RentalView>(`/rentals/${id}`);
  const s = view.inspection?.status;
  if (s && s !== "running") {
    console.log(JSON.stringify({ state: view.state, inspection: { ...view.inspection, verdict: view.inspection?.verdict?.angles.map((a) => `${a.angle}:${a.severity}`) } }, null, 2));
    for (const tx of view.txs) console.log(`${tx.label.padEnd(22)} ${tx.url}`);
    process.exit(s === "done" ? 0 : 1);
  }
  await new Promise((r) => setTimeout(r, 5000));
}
throw new Error("inspection did not finish within 5 minutes");
