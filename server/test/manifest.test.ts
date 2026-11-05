import { describe, expect, it } from "vitest";
import { DebugManifest, Manifest } from "@evenhand/shared";
import { canonicalBytes, isP256Spki, manifestHash, verifyManifestSignature } from "../src/manifest.js";
import { fixtureManifest, p256Device, readFixture } from "./helpers.js";

describe("shared manifest fixture", () => {
  const manifest = Manifest.parse(fixtureManifest());

  it("canonicalizes to the fixture's canonical string byte for byte", () => {
    expect(canonicalBytes(manifest).toString("utf8")).toBe(readFixture("manifest.canonical.txt"));
  });

  it("hashes to the fixture's manifest hash", () => {
    expect(manifestHash(canonicalBytes(manifest))).toBe(readFixture("manifest.sha256.txt"));
  });
});

describe("manifest signature", () => {
  const manifest = Manifest.parse(fixtureManifest());
  const bytes = canonicalBytes(manifest);
  const device = p256Device();
  const spki = Buffer.from(device.spkiB64, "base64");
  const sig = Buffer.from(device.signB64(bytes), "base64");

  it("verifies a P-256 DER signature over the canonical bytes", () => {
    expect(isP256Spki(spki)).toBe(true);
    expect(verifyManifestSignature(bytes, spki, sig)).toBe(true);
  });

  it("rejects a tampered manifest", () => {
    const tampered = canonicalBytes({ ...manifest, phase: "return" });
    expect(verifyManifestSignature(tampered, spki, sig)).toBe(false);
  });

  it("rejects another device's key and garbage input without throwing", () => {
    const other = Buffer.from(p256Device().spkiB64, "base64");
    expect(verifyManifestSignature(bytes, other, sig)).toBe(false);
    expect(verifyManifestSignature(bytes, Buffer.from("nope"), sig)).toBe(false);
    expect(isP256Spki(Buffer.from("nope"))).toBe(false);
  });
});

describe("manifest schema", () => {
  it("requires exactly six shots in angle order", () => {
    const m = fixtureManifest();
    expect(Manifest.safeParse({ ...m, shots: m.shots.slice(0, 5) }).success).toBe(false);
    expect(Manifest.safeParse({ ...m, shots: [...m.shots].reverse() }).success).toBe(false);
  });

  it("rejects unknown keys, which would change the signed bytes", () => {
    expect(Manifest.safeParse({ ...fixtureManifest(), extra: 1 }).success).toBe(false);
  });

  it("allows 1-6 ordered shots only on the debug schema", () => {
    const m = fixtureManifest();
    expect(DebugManifest.safeParse({ ...m, shots: m.shots.slice(0, 1) }).success).toBe(true);
    expect(DebugManifest.safeParse({ ...m, shots: [] }).success).toBe(false);
  });
});
