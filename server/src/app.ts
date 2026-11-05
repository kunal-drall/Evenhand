import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { RegisterDeviceBody, VerifyManifestBody, type VerifyManifestResponse } from "@evenhand/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { ChainUnavailableError, type ChainPort } from "./chain/port.js";
import { TxRefusedError } from "./chain/sendTx.js";
import { deviceKeyIdFor, getDevice, insertDevice } from "./devices.js";
import { parseJson } from "./http.js";
import type { Inspector } from "./inspector/pipeline.js";
import { canonicalBytes, isP256Spki, manifestHash, verifyManifestSignature } from "./manifest.js";
import type { BundleStore } from "./photos/store.js";
import type { EnsureBundleRoot } from "./photos/uploader.js";
import { createRateLimiter, ipRateLimit, type RateLimiter } from "./ratelimit.js";
import type { Repo } from "./rentals/repo.js";
import { JSON_LIMIT } from "./routes/common.js";
import { rentalRoutes } from "./routes/rentals.js";
import { scanRoutes } from "./routes/scans.js";

export type AppDeps = {
  repo: Repo;
  chain: ChainPort;
  inspector: Pick<Inspector, "start">;
  bundles: BundleStore;
  ensureBundleRoot: EnsureBundleRoot;
  photoKey: Buffer;
  zgHealth: () => Promise<{ router: boolean; storage: boolean }>;
  publicBaseUrl: string;
  limiter?: RateLimiter;
  clock?: () => number;
  /** Built web app (web/dist) to serve at /pay, /r, /owner, /shop. */
  webDist?: string | undefined;
};

export type RouteDeps = AppDeps & { limiter: RateLimiter };

export function createApp(input: AppDeps): Hono {
  const deps: RouteDeps = { ...input, limiter: input.limiter ?? createRateLimiter() };
  const { repo } = deps;
  const app = new Hono();
  app.use("*", cors());
  app.use("*", ipRateLimit(deps.limiter));

  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/health/0g", async (c) => c.json(await deps.zgHealth()));

  app.post("/devices", JSON_LIMIT, async (c) => {
    const body = await parseJson(c, RegisterDeviceBody);
    const spkiDer = Buffer.from(body.publicKeySpkiB64, "base64");
    if (!isP256Spki(spkiDer)) throw new HTTPException(400, { message: "publicKeySpkiB64 must be a P-256 SPKI key" });

    const id = deviceKeyIdFor(spkiDer);
    const existing = getDevice(repo.db, id);
    if (existing && existing.role !== body.role) throw new HTTPException(409, { message: "key already registered with another role" });
    if (!existing) insertDevice(repo.db, { id, role: body.role, publicKeySpkiB64: spkiDer.toString("base64"), label: body.label });
    return c.json({ deviceKeyId: id });
  });

  // Capture spike (C3a): checks a phone-signed manifest against its registered key. Accepts 1-6 shots.
  app.post("/debug/verify-manifest", JSON_LIMIT, async (c) => {
    const { manifest, signature } = await parseJson(c, VerifyManifestBody);
    const device = getDevice(repo.db, manifest.deviceKeyId);
    if (!device) return c.json<VerifyManifestResponse>({ ok: false, error: "unknown deviceKeyId" }, 404);
    if (device.role !== manifest.role) return c.json<VerifyManifestResponse>({ ok: false, error: "role does not match device" }, 400);

    const bytes = canonicalBytes(manifest);
    const spkiDer = Buffer.from(device.publicKeySpkiB64, "base64");
    if (!verifyManifestSignature(bytes, spkiDer, Buffer.from(signature, "base64"))) {
      return c.json<VerifyManifestResponse>({ ok: false, error: "signature does not verify" }, 400);
    }
    return c.json<VerifyManifestResponse>({ ok: true, manifestHash: manifestHash(bytes) });
  });

  rentalRoutes(app, deps);
  scanRoutes(app, deps);
  serveWeb(app, deps.webDist);

  app.notFound((c) => c.json({ error: "not found" }, 404));
  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    if (err instanceof ChainUnavailableError) return c.json({ error: err.message }, 503);
    if (err instanceof TxRefusedError) return c.json({ error: err.message }, 403);
    console.error("unhandled error:", err.message);
    return c.json({ error: "internal error" }, 500);
  });

  return app;
}

/** Same-origin web app: one tunnel serves the API and the renter pages. */
function serveWeb(app: Hono, webDist: string | undefined): void {
  if (!webDist || !existsSync(join(webDist, "index.html"))) return;
  const index = readFileSync(join(webDist, "index.html"), "utf8");
  for (const path of ["/pay/*", "/r/*", "/owner", "/shop"]) app.get(path, (c) => c.html(index));
  app.get("/assets/*", serveStatic({ root: relative(process.cwd(), webDist) }));
}
