import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Phase } from "@evenhand/shared";

/** Unguessable per-scan token for the decrypted-photo proxy; only RentalView hands it out. */
export function createPhotoTokens(photoKey: Buffer) {
  const hmacKey = createHash("sha256").update("evenhand-photo-token-v1").update(photoKey).digest();
  const tokenFor = (rentalId: string, phase: Phase) =>
    createHmac("sha256", hmacKey).update(`${rentalId.toLowerCase()}:${phase}`).digest("hex").slice(0, 32);
  return {
    tokenFor,
    check(rentalId: string, phase: Phase, token: string | undefined): boolean {
      const expected = Buffer.from(tokenFor(rentalId, phase));
      const given = Buffer.from(token ?? "");
      return given.length === expected.length && timingSafeEqual(given, expected);
    },
  };
}

export type PhotoTokens = ReturnType<typeof createPhotoTokens>;
