import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

export type Db = Database.Database;

// Amounts are USDT base units stored as TEXT; JSON columns hold arrays/objects as TEXT.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS devices (
  id                  TEXT PRIMARY KEY, -- derived from the SPKI DER bytes
  role                TEXT NOT NULL CHECK (role IN ('owner', 'renter')),
  public_key_spki_b64 TEXT NOT NULL,
  label               TEXT NOT NULL,
  created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rentals (
  id            TEXT PRIMARY KEY,
  item          TEXT NOT NULL,
  owner         TEXT NOT NULL,
  renter        TEXT,
  deposit       TEXT NOT NULL,
  return_by     TEXT NOT NULL,
  schedule_bps  TEXT NOT NULL,
  terms_hash    TEXT NOT NULL,
  nonce         TEXT NOT NULL,
  state         TEXT NOT NULL DEFAULT 'None',
  create_tx     TEXT,
  fund_tx       TEXT,
  settle_tx     TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scans (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  rental_id       TEXT NOT NULL REFERENCES rentals(id),
  phase           TEXT NOT NULL CHECK (phase IN ('pickup', 'return')),
  device_key_id   TEXT NOT NULL REFERENCES devices(id),
  manifest_json   TEXT NOT NULL,
  manifest_hash   TEXT NOT NULL,
  signature_b64   TEXT NOT NULL,
  captured_at     TEXT NOT NULL,
  photo_roots     TEXT NOT NULL DEFAULT '[]',
  confirmations   TEXT NOT NULL DEFAULT '[]',
  tx_hash         TEXT,
  created_at      TEXT NOT NULL,
  UNIQUE (rental_id, phase)
);

CREATE TABLE IF NOT EXISTS inspections (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  rental_id        TEXT NOT NULL REFERENCES rentals(id),
  status           TEXT NOT NULL CHECK (status IN ('running', 'paused', 'done', 'needs_human')),
  model            TEXT,
  provider         TEXT,
  request_id       TEXT,
  chat_id          TEXT,
  tee_verified     INTEGER,
  raw_output       TEXT,
  verdict_json     TEXT,
  severity_json    TEXT,
  confidence_bps   INTEGER,
  capture          TEXT,
  inspection_root  TEXT,
  cost_usd         REAL,
  tx_hash          TEXT,
  error            TEXT,
  started_at       TEXT NOT NULL,
  finished_at      TEXT
);
`;

/** Opens (creating if needed) the SQLite file and applies the schema. Use ":memory:" in tests. */
export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}
