// POST /rentals/:id/scans/:phase (multipart), POST .../confirm, GET /rentals/:id/photos/:phase/:angle.
import { createHash } from "node:crypto";
import { ANGLES, Angle, ConfirmBody, Phase, ScanUploadFields, confirmMessage, type Manifest } from "@evenhand/shared";
import type { Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import sharp from "sharp";
import { recoverMessageAddress } from "viem";
import type { RouteDeps } from "../app.js";
import type { Hex } from "../config.js";
import { getDevice } from "../devices.js";
import { parseJson } from "../http.js";
import { canonicalBytes, manifestHash, verifyManifestSignature } from "../manifest.js";
import { openBundlePhoto, sealBundle } from "../photos/bundle.js";
import { looksLikeJpeg } from "../photos/store.js";
import type { RentalRow } from "../rentals/repo.js";
import { JSON_LIMIT, SCAN_LIMIT, mustRental, rentalIdParam } from "./common.js";

const MAX_MANIFEST_AGE_MS = 30 * 60_000;
const FUTURE_SKEW_MS = 5 * 60_000;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

const bad = (message: string) => new HTTPException(400, { message });

function phaseParam(c: Context): Phase {
  const p = Phase.safeParse(c.req.param("phase"));
  if (!p.success) throw bad("phase must be pickup or return");
  return p.data;
}

async function readPhotos(form: Record<string, unknown>, manifest: Manifest): Promise<{ angle: Angle; jpeg: Buffer }[]> {
  return Promise.all(
    manifest.shots.map(async (shot) => {
      const file = form[shot.angle];
      if (!(file instanceof File)) throw bad(`missing photo ${shot.angle}`);
      if (file.size > MAX_PHOTO_BYTES) throw bad(`photo ${shot.angle} is larger than 10 MB`);
      const jpeg = Buffer.from(await file.arrayBuffer());
      if (!looksLikeJpeg(jpeg)) throw bad(`photo ${shot.angle} is not a JPEG`);
      if (createHash("sha256").update(jpeg).digest("hex") !== shot.sha256) throw bad(`photo ${shot.angle} does not match its manifest hash`);
      const meta = await sharp(jpeg)
        .metadata()
        .catch(() => undefined);
      if (meta?.format !== "jpeg" || !meta.width || !meta.height) throw bad(`photo ${shot.angle} is not a decodable JPEG`);
      return { angle: shot.angle, jpeg };
    }),
  );
}

export function scanRoutes(app: Hono, deps: RouteDeps): void {
  const { repo, chain } = deps;
  const clock = deps.clock ?? Date.now;

  function checkTiming(rental: RentalRow, phase: Phase, capturedAt: string): void {
    const t = new Date(capturedAt).getTime();
    const now = clock();
    if (t > now + FUTURE_SKEW_MS) throw bad("capturedAt is in the future");
    if (t < now - MAX_MANIFEST_AGE_MS) throw bad("manifest is stale (captured more than 30 minutes ago)");
    if (t < new Date(rental.createdAt).getTime() - FUTURE_SKEW_MS) throw bad("capturedAt is before the rental was created");
    if (phase === "return") {
      const pickup = repo.getScan(rental.id, "pickup");
      if (pickup && t <= new Date(pickup.capturedAt).getTime()) throw bad("return capture must be after the pickup capture");
    }
  }

  function checkState(rental: RentalRow, phase: Phase): void {
    const existing = repo.getScan(rental.id, phase);
    if (existing?.recordedTx) throw new HTTPException(409, { message: `${phase} scan is already recorded onchain` });
    if (phase === "pickup" && rental.state !== "Funded") throw new HTTPException(409, { message: "pickup needs a funded rental" });
    if (phase === "return" && rental.state !== "PickedUp") throw new HTTPException(409, { message: "return needs a recorded pickup" });
  }

  /** Only the rental's owner device may scan: set at creation, or bound by the first accepted pickup scan. */
  function checkDevice(rental: RentalRow, deviceKeyId: string, phase: Phase): void {
    if (rental.ownerDevice && rental.ownerDevice !== deviceKeyId) throw new HTTPException(403, { message: "this device is not the rental's owner device" });
    if (!rental.ownerDevice && phase === "return") throw new HTTPException(403, { message: "no owner device is bound to this rental" });
  }

  app.post("/rentals/:id/scans/:phase", SCAN_LIMIT, async (c) => {
    const id = rentalIdParam(c);
    const phase = phaseParam(c);
    mustRental(repo, id);
    const form = await c.req.parseBody();
    let manifestJson: unknown;
    try {
      manifestJson = JSON.parse(String(form.manifest ?? ""));
    } catch {
      throw bad("manifest field must be JSON");
    }
    const fields = ScanUploadFields.safeParse({ manifest: manifestJson, signature: form.signature });
    if (!fields.success) throw bad(`invalid manifest: ${fields.error.issues[0]?.message ?? "schema"}`);
    const { manifest, signature } = fields.data;

    if (manifest.rentalId.toLowerCase() !== id) throw bad("manifest is for another rental");
    if (manifest.phase !== phase) throw bad("manifest phase does not match the URL");
    if (manifest.role !== "owner") throw bad("only the owner's device uploads scans");
    const device = getDevice(repo.db, manifest.deviceKeyId);
    if (!device || device.role !== "owner") throw new HTTPException(403, { message: "device is not a registered owner device" });
    const bytes = canonicalBytes(manifest);
    if (!verifyManifestSignature(bytes, Buffer.from(device.publicKeySpkiB64, "base64"), Buffer.from(signature, "base64"))) {
      throw new HTTPException(403, { message: "manifest signature does not verify" });
    }
    if (!deps.limiter(`dev:${device.id}`)) throw new HTTPException(429, { message: "rate limit: 30 requests per minute" });
    const photos = await readPhotos(form, manifest);
    const hash = manifestHash(bytes);

    return deps.lock(id, async () => {
      const rental = mustRental(repo, id);
      checkState(rental, phase);
      checkDevice(rental, device.id, phase);
      checkTiming(rental, phase, manifest.capturedAt);
      if (!rental.ownerDevice && !repo.bindOwnerDevice(id, device.id)) throw new HTTPException(403, { message: "another device is bound to this rental" });

      deps.bundles.write(id, phase, sealBundle(deps.photoKey, id, phase, photos));
      repo.putScan({ rentalId: id, phase, deviceKeyId: device.id, manifestJson: bytes.toString("utf8"), manifestHash: hash, signatureB64: signature, capturedAt: manifest.capturedAt });
      deps.ensureBundleRoot(id, phase).catch((err: Error) => console.log(`bundle upload ${id}/${phase} deferred: ${err.message}`));

      if (phase === "pickup") return c.json({ manifestHash: hash });
      const txHash = await chain.recordReturn(id as Hex, hash as Hex);
      repo.addTx(id, "recordReturn", txHash);
      repo.setScanRecorded(id, phase, txHash);
      repo.setState(id, "Returned");
      deps.inspector.start(id);
      return c.json({ manifestHash: hash, txHash });
    });
  });

  app.post("/rentals/:id/scans/:phase/confirm", JSON_LIMIT, async (c) => {
    const id = rentalIdParam(c);
    const phase = phaseParam(c);
    const body = await parseJson(c, ConfirmBody);
    return deps.lock(id, async () => {
      const rental = mustRental(repo, id);
      const scan = repo.getScan(id, phase);
      if (!scan) throw new HTTPException(404, { message: `no ${phase} scan to confirm` });
      const address = body.address.toLowerCase();
      if (!rental.renter || rental.renter !== address) throw new HTTPException(403, { message: "only this rental's renter can confirm" });
      let signer: string;
      try {
        signer = await recoverMessageAddress({ message: confirmMessage(id, phase, scan.manifestHash), signature: body.signature as Hex });
      } catch {
        throw new HTTPException(400, { message: "confirmation signature is malformed" });
      }
      if (signer.toLowerCase() !== address) throw new HTTPException(403, { message: "confirmation signature does not match address" });
      repo.addConfirmation(id, phase, { address, signature: body.signature });

      if (phase === "return" || scan.recordedTx) return c.json({ ok: true, ...(scan.recordedTx && phase === "pickup" && { txHash: scan.recordedTx }) });
      if (rental.state !== "Funded") throw new HTTPException(409, { message: "pickup needs a funded rental" });
      const txHash = await chain.recordPickup(id as Hex, scan.manifestHash as Hex);
      repo.addTx(id, "recordPickup", txHash);
      repo.setScanRecorded(id, phase, txHash);
      repo.setState(id, "PickedUp");
      return c.json({ ok: true, txHash });
    });
  });

  // Decrypting proxy: needs the per-scan token that only RentalView hands out (not just the rental ID).
  app.get("/rentals/:id/photos/:phase/:angle", (c) => {
    const id = rentalIdParam(c);
    const phase = phaseParam(c);
    const angle = Angle.safeParse(c.req.param("angle"));
    if (!angle.success) throw bad(`angle must be one of ${ANGLES.join(", ")}`);
    if (!deps.photoTokens.check(id, phase, c.req.query("t"))) throw new HTTPException(403, { message: "photo link is invalid" });
    const bundle = deps.bundles.read(id, phase);
    if (!bundle) throw new HTTPException(404, { message: "no photos for this scan" });
    const jpeg = openBundlePhoto(deps.photoKey, bundle, id, phase, angle.data);
    if (!jpeg) throw new HTTPException(404, { message: "no photo for this angle" });
    return c.body(new Uint8Array(jpeg), 200, { "content-type": "image/jpeg", "cache-control": "private, max-age=300" });
  });
}
