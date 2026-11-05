import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { RegisterDeviceBody, VerifyManifestBody, type VerifyManifestResponse } from "@evenhand/shared";
import type { Db } from "./db.js";
import { deviceKeyIdFor, getDevice, insertDevice } from "./devices.js";
import { parseJson } from "./http.js";
import { canonicalBytes, isP256Spki, manifestHash, verifyManifestSignature } from "./manifest.js";

const JSON_LIMIT = bodyLimit({
  maxSize: 64 * 1024,
  onError: (c) => c.json({ error: "body too large" }, 413),
});

export function createApp(db: Db): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/devices", JSON_LIMIT, async (c) => {
    const body = await parseJson(c, RegisterDeviceBody);
    const spkiDer = Buffer.from(body.publicKeySpkiB64, "base64");
    if (!isP256Spki(spkiDer)) throw new HTTPException(400, { message: "publicKeySpkiB64 must be a P-256 SPKI key" });

    const id = deviceKeyIdFor(spkiDer);
    const existing = getDevice(db, id);
    if (existing && existing.role !== body.role) throw new HTTPException(409, { message: "key already registered with another role" });
    if (!existing) insertDevice(db, { id, role: body.role, publicKeySpkiB64: spkiDer.toString("base64"), label: body.label });
    return c.json({ deviceKeyId: id });
  });

  // Capture spike (C3a): checks a phone-signed manifest against its registered key. Accepts 1-6 shots.
  app.post("/debug/verify-manifest", JSON_LIMIT, async (c) => {
    const { manifest, signature } = await parseJson(c, VerifyManifestBody);
    const device = getDevice(db, manifest.deviceKeyId);
    if (!device) return c.json<VerifyManifestResponse>({ ok: false, error: "unknown deviceKeyId" }, 404);
    if (device.role !== manifest.role) return c.json<VerifyManifestResponse>({ ok: false, error: "role does not match device" }, 400);

    const bytes = canonicalBytes(manifest);
    const spkiDer = Buffer.from(device.publicKeySpkiB64, "base64");
    if (!verifyManifestSignature(bytes, spkiDer, Buffer.from(signature, "base64"))) {
      return c.json<VerifyManifestResponse>({ ok: false, error: "signature does not verify" }, 400);
    }
    return c.json<VerifyManifestResponse>({ ok: true, manifestHash: manifestHash(bytes) });
  });

  app.notFound((c) => c.json({ error: "not found" }, 404));
  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    console.error("unhandled error:", err.message);
    return c.json({ error: "internal error" }, 500);
  });

  return app;
}
