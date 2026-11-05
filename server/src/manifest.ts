// Manifest canonicalization and device-signature checks (docs/interfaces.md section 5).
import { createHash, createPublicKey, verify } from "node:crypto";
import canonicalize from "canonicalize";
import type { DebugManifest } from "@evenhand/shared";

/** RFC 8785 canonical UTF-8 bytes of a validated manifest: exactly what the phone signs. */
export function canonicalBytes(manifest: DebugManifest): Buffer {
  const text = canonicalize(manifest);
  if (text === undefined) throw new Error("manifest is not canonicalizable");
  return Buffer.from(text, "utf8");
}

/** Onchain manifest hash: sha256(canonical bytes) as 0x-prefixed bytes32. */
export function manifestHash(bytes: Buffer): `0x${string}` {
  return `0x${createHash("sha256").update(bytes).digest("hex")}`;
}

/** True if `spkiDer` is an EC P-256 public key (the Secure Enclave key type). */
export function isP256Spki(spkiDer: Buffer): boolean {
  try {
    const key = createPublicKey({ key: spkiDer, format: "der", type: "spki" });
    return key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1";
  } catch {
    return false;
  }
}

/** Verifies a DER-encoded ECDSA P-256/SHA-256 signature over the canonical bytes. Never throws. */
export function verifyManifestSignature(bytes: Buffer, spkiDer: Buffer, signatureDer: Buffer): boolean {
  try {
    return verify("sha256", bytes, { key: spkiDer, format: "der", type: "spki", dsaEncoding: "der" }, signatureDer);
  } catch {
    return false;
  }
}
