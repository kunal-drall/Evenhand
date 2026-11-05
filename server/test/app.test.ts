import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { DebugManifest } from "@evenhand/shared";
import { createApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import { canonicalBytes } from "../src/manifest.js";
import { fixtureManifest, p256Device, readFixture } from "./helpers.js";

let app: ReturnType<typeof createApp>;
beforeEach(() => {
  app = createApp(openDb(":memory:"));
});

const post = (path: string, body: unknown) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function register(spkiB64: string, role = "owner") {
  const res = await post("/devices", { role, publicKeySpkiB64: spkiB64, label: "test phone" });
  return { status: res.status, body: (await res.json()) as { deviceKeyId?: string; error?: string } };
}

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await app.request("/health");
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("POST /devices", () => {
  it("registers a P-256 key and is idempotent for the same key", async () => {
    const { spkiB64 } = p256Device();
    const first = await register(spkiB64);
    expect(first.status).toBe(200);
    expect(first.body.deviceKeyId).toMatch(/^dk_[0-9a-f]{32}$/);
    expect((await register(spkiB64)).body.deviceKeyId).toBe(first.body.deviceKeyId);
  });

  it("refuses the same key under another role", async () => {
    const { spkiB64 } = p256Device();
    await register(spkiB64, "owner");
    expect((await register(spkiB64, "renter")).status).toBe(409);
  });

  it("rejects non-P-256 keys and invalid bodies", async () => {
    const ed = generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }).toString("base64");
    expect((await register(ed)).status).toBe(400);
    expect((await post("/devices", { role: "admin", publicKeySpkiB64: "x", label: "" })).status).toBe(400);
  });
});

describe("POST /debug/verify-manifest", () => {
  async function signedManifest(shots?: number) {
    const device = p256Device();
    const { body } = await register(device.spkiB64);
    const raw = fixtureManifest();
    const manifest = DebugManifest.parse({
      ...raw,
      deviceKeyId: body.deviceKeyId,
      shots: shots ? raw.shots.slice(0, shots) : raw.shots,
    });
    return { manifest, signature: device.signB64(canonicalBytes(manifest)) };
  }

  it("returns ok and the manifest hash for a valid signature", async () => {
    const body = await signedManifest();
    const res = await post("/debug/verify-manifest", body);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; manifestHash: string };
    expect(json.ok).toBe(true);
    expect(json.manifestHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("accepts a one-shot manifest (capture spike)", async () => {
    const res = await post("/debug/verify-manifest", await signedManifest(1));
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });

  it("rejects a signature over different bytes", async () => {
    const body = await signedManifest();
    const res = await post("/debug/verify-manifest", { ...body, manifest: { ...body.manifest, phase: "return" } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "signature does not verify" });
  });

  it("returns 404 for an unregistered device", async () => {
    const res = await post("/debug/verify-manifest", { manifest: fixtureManifest(), signature: "AAAA" });
    expect(res.status).toBe(404);
  });

  it("uses the fixture's canonical bytes as the signed payload", async () => {
    expect(canonicalBytes(DebugManifest.parse(fixtureManifest())).toString()).toBe(readFixture("manifest.canonical.txt"));
  });
});
