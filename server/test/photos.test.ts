import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { openBundle, sealBundle } from "../src/photos/bundle.js";
import { open, seal } from "../src/photos/crypto.js";
import { looksLikeJpeg, prepareForModel } from "../src/photos/store.js";

const key = randomBytes(32);

describe("AES-256-GCM", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const plain = Buffer.from("jpeg bytes");
    const a = seal(key, plain, "ctx");
    expect(open(key, a, "ctx")).toEqual(plain);
    expect(seal(key, plain, "ctx").equals(a)).toBe(false);
  });

  it("fails on a wrong key, wrong context or tampered bytes", () => {
    const sealed = seal(key, Buffer.from("x"), "ctx");
    expect(() => open(randomBytes(32), sealed, "ctx")).toThrow();
    expect(() => open(key, sealed, "other")).toThrow();
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1]! ^= 1;
    expect(() => open(key, tampered, "ctx")).toThrow();
    expect(() => seal(Buffer.alloc(16), Buffer.from("x"), "ctx")).toThrow(/32 bytes/);
  });
});

describe("photo bundle", () => {
  const rentalId = `0x${"aa".repeat(32)}`;
  const photos = [
    { angle: "front" as const, jpeg: Buffer.from("front-jpeg") },
    { angle: "back" as const, jpeg: Buffer.from("back-jpeg") },
  ];

  it("round-trips every photo", () => {
    const opened = openBundle(key, sealBundle(key, rentalId, "pickup", photos), rentalId, "pickup");
    expect(opened.get("front")?.toString()).toBe("front-jpeg");
    expect(opened.get("back")?.toString()).toBe("back-jpeg");
  });

  it("refuses a bundle from another scan", () => {
    const bundle = sealBundle(key, rentalId, "pickup", photos);
    expect(() => openBundle(key, bundle, rentalId, "return")).toThrow(/another scan/);
    expect(() => openBundle(key, Buffer.from("nope0000"), rentalId, "pickup")).toThrow(/not an Evenhand/);
  });
});

describe("model image preparation", () => {
  it("shrinks to a 1024 px long side and strips metadata", async () => {
    const big = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#888" } })
      .withMetadata({ exif: { IFD0: { Copyright: "secret" } } })
      .jpeg()
      .toBuffer();
    const out = await prepareForModel(big);
    const meta = await sharp(out).metadata();
    expect(looksLikeJpeg(out)).toBe(true);
    expect([meta.width, meta.height]).toEqual([1024, 683]);
    expect(meta.exif).toBeUndefined();
  });
});
