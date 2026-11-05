import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";

const FIXTURES = new URL("../../packages/shared/fixtures/", import.meta.url);

export function readFixture(name: string): string {
  return readFileSync(new URL(name, FIXTURES), "utf8");
}

export function fixtureManifest(): Record<string, unknown> & { shots: unknown[] } {
  return JSON.parse(readFixture("manifest.json"));
}

/** A P-256 key standing in for a phone's Secure Enclave key. */
export function p256Device() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const spkiB64 = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const signB64 = (bytes: Buffer) => sign("sha256", bytes, { key: privateKey, dsaEncoding: "der" }).toString("base64");
  return { spkiB64, signB64 };
}
