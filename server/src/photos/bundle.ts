// One encrypted bundle per scan: the same bytes are kept locally and uploaded to 0G Storage.
// Layout: "EHB1" | u32 BE header length | header JSON | sealed photo blobs (in header order).
import { createHash } from "node:crypto";
import type { Angle, Phase } from "@evenhand/shared";
import { open, seal } from "./crypto.js";

const MAGIC = Buffer.from("EHB1");

type Entry = { angle: Angle; sha256: string; offset: number; length: number };
type Header = { v: 1; alg: "AES-256-GCM"; rentalId: string; phase: Phase; photos: Entry[] };

export type Photo = { angle: Angle; jpeg: Buffer };

const aadFor = (rentalId: string, phase: Phase, angle: Angle) => `evenhand:${rentalId}:${phase}:${angle}`;
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

export function sealBundle(key: Buffer, rentalId: string, phase: Phase, photos: Photo[]): Buffer {
  const blobs = photos.map((p) => seal(key, p.jpeg, aadFor(rentalId, phase, p.angle)));
  let offset = 0;
  const entries = photos.map((p, i) => {
    const entry = { angle: p.angle, sha256: sha256(p.jpeg), offset, length: blobs[i]!.length };
    offset += entry.length;
    return entry;
  });
  const header = Buffer.from(JSON.stringify({ v: 1, alg: "AES-256-GCM", rentalId, phase, photos: entries } satisfies Header));
  const len = Buffer.alloc(4);
  len.writeUInt32BE(header.length);
  return Buffer.concat([MAGIC, len, header, ...blobs]);
}

/** Decrypts every photo and checks it against the plaintext sha256 recorded in the header. */
export function openBundle(key: Buffer, bundle: Buffer, rentalId: string, phase: Phase): Map<Angle, Buffer> {
  if (!bundle.subarray(0, 4).equals(MAGIC)) throw new Error("not an Evenhand photo bundle");
  const headerLen = bundle.readUInt32BE(4);
  const header = JSON.parse(bundle.subarray(8, 8 + headerLen).toString("utf8")) as Header;
  if (header.rentalId !== rentalId || header.phase !== phase) throw new Error("bundle belongs to another scan");
  const body = bundle.subarray(8 + headerLen);
  const out = new Map<Angle, Buffer>();
  for (const e of header.photos) {
    const jpeg = open(key, body.subarray(e.offset, e.offset + e.length), aadFor(rentalId, phase, e.angle));
    if (sha256(jpeg) !== e.sha256) throw new Error(`photo ${e.angle} does not match its hash`);
    out.set(e.angle, jpeg);
  }
  return out;
}
