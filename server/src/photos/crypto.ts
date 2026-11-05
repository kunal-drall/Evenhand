import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const IV_BYTES = 12;
const TAG_BYTES = 16;

function checkKey(key: Buffer): void {
  if (key.length !== 32) throw new Error("AES-256-GCM key must be 32 bytes");
}

/** AES-256-GCM: returns iv || tag || ciphertext. `aad` binds the blob to its context (rental, phase, angle). */
export function seal(key: Buffer, plaintext: Buffer, aad: string): Buffer {
  checkKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]);
}

/** Inverse of seal; throws if the key, aad or bytes do not match. */
export function open(key: Buffer, sealed: Buffer, aad: string): Buffer {
  checkKey(key);
  if (sealed.length < IV_BYTES + TAG_BYTES) throw new Error("sealed blob too short");
  const decipher = createDecipheriv("aes-256-gcm", key, sealed.subarray(0, IV_BYTES));
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(sealed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([decipher.update(sealed.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
}
