import { createHash } from "node:crypto";
import type { Role } from "@evenhand/shared";
import type { Db } from "./db.js";

export type Device = { id: string; role: Role; publicKeySpkiB64: string; label: string };

/** Stable ID for a public key, so re-registering the same key returns the same ID. */
export function deviceKeyIdFor(spkiDer: Buffer): string {
  return `dk_${createHash("sha256").update(spkiDer).digest("hex").slice(0, 32)}`;
}

export function getDevice(db: Db, id: string): Device | undefined {
  const row = db
    .prepare("SELECT id, role, public_key_spki_b64 AS publicKeySpkiB64, label FROM devices WHERE id = ?")
    .get(id) as Device | undefined;
  return row;
}

export function insertDevice(db: Db, device: Device): void {
  db.prepare(
    "INSERT INTO devices (id, role, public_key_spki_b64, label, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(device.id, device.role, device.publicKeySpkiB64, device.label, new Date().toISOString());
}
