import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Phase } from "@evenhand/shared";
import sharp from "sharp";

/** Photo key: PHOTO_ENCRYPTION_KEY if set, else a random key created once in DATA_DIR/photo.key (mode 600). */
export function loadPhotoKey(dataDir: string, keyHex: string | undefined): Buffer {
  if (keyHex) return Buffer.from(keyHex, "hex");
  const path = join(dataDir, "photo.key");
  if (existsSync(path)) return Buffer.from(readFileSync(path, "utf8").trim(), "hex");
  mkdirSync(dataDir, { recursive: true });
  const key = randomBytes(32);
  writeFileSync(path, key.toString("hex"), { mode: 0o600 });
  return key;
}

export class BundleStore {
  constructor(private readonly dir: string) {}

  private path(rentalId: string, phase: Phase): string {
    return join(this.dir, "photos", rentalId.toLowerCase(), `${phase}.ehb`);
  }

  write(rentalId: string, phase: Phase, bundle: Buffer): void {
    const path = this.path(rentalId, phase);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, bundle);
  }

  read(rentalId: string, phase: Phase): Buffer | undefined {
    const path = this.path(rentalId, phase);
    return existsSync(path) ? readFileSync(path) : undefined;
  }
}

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

export function looksLikeJpeg(bytes: Buffer): boolean {
  return bytes.subarray(0, 3).equals(JPEG_MAGIC);
}

/** Model input: EXIF-rotated, long side at most 1024 px, JPEG quality 80, metadata stripped. */
export async function prepareForModel(jpeg: Buffer): Promise<Buffer> {
  return sharp(jpeg)
    .rotate()
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
}
