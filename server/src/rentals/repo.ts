// Row-level access for rentals, scans, inspections and txs. All IDs and addresses lowercase.
import type { Phase, RentalState } from "@evenhand/shared";
import type { Db } from "../db.js";

export type RentalRow = {
  id: string;
  item: string;
  owner: string;
  renter: string | null;
  deposit: string;
  returnBy: string;
  scheduleBps: [number, number, number, number];
  termsHash: string;
  nonce: string;
  state: RentalState;
  onchain: boolean;
  proposedAt: number | null;
  createdAt: string;
};

export type Confirmation = { address: string; signature: string };

export type ScanRow = {
  rentalId: string;
  phase: Phase;
  deviceKeyId: string;
  manifestJson: string;
  manifestHash: string;
  signatureB64: string;
  capturedAt: string;
  bundleRoot: string | null;
  confirmations: Confirmation[];
  recordedTx: string | null;
};

export type InspectionStatus = "running" | "paused" | "done" | "needs_human";

export type InspectionRow = {
  rentalId: string;
  status: InspectionStatus;
  model: string | null;
  provider: string | null;
  requestId: string | null;
  chatId: string | null;
  teeVerified: boolean | null;
  rawOutput: string | null;
  verdictJson: string | null;
  decisionJson: string | null;
  billingJson: string | null;
  /** Every model pass: [{ model, requestId, rawOutput }]. */
  passesJson: string | null;
  capture: string | null;
  needsArbiter: boolean | null;
  inspectionRoot: string | null;
  costUsd: number | null;
  txHash: string | null;
  reason: string | null;
  attempts: number;
  nextAttemptAt: number | null;
  startedAt: string;
  finishedAt: string | null;
};

const now = () => new Date().toISOString();
const lc = (s: string) => s.toLowerCase();
const bool = (v: unknown) => (v === null || v === undefined ? null : Boolean(v));

const rentalFrom = (r: any): RentalRow => ({
  id: r.id,
  item: r.item,
  owner: r.owner,
  renter: r.renter,
  deposit: r.deposit,
  returnBy: r.return_by,
  scheduleBps: JSON.parse(r.schedule_bps),
  termsHash: r.terms_hash,
  nonce: r.nonce,
  state: r.state,
  onchain: Boolean(r.onchain),
  proposedAt: r.proposed_at,
  createdAt: r.created_at,
});

const scanFrom = (r: any): ScanRow => ({
  rentalId: r.rental_id,
  phase: r.phase,
  deviceKeyId: r.device_key_id,
  manifestJson: r.manifest_json,
  manifestHash: r.manifest_hash,
  signatureB64: r.signature_b64,
  capturedAt: r.captured_at,
  bundleRoot: r.bundle_root,
  confirmations: JSON.parse(r.confirmations),
  recordedTx: r.recorded_tx,
});

const inspectionFrom = (r: any): InspectionRow => ({
  rentalId: r.rental_id,
  status: r.status,
  model: r.model,
  provider: r.provider,
  requestId: r.request_id,
  chatId: r.chat_id,
  teeVerified: bool(r.tee_verified),
  rawOutput: r.raw_output,
  verdictJson: r.verdict_json,
  decisionJson: r.decision_json,
  billingJson: r.billing_json,
  passesJson: r.passes_json,
  capture: r.capture,
  needsArbiter: bool(r.needs_arbiter),
  inspectionRoot: r.inspection_root,
  costUsd: r.cost_usd,
  txHash: r.tx_hash,
  reason: r.reason,
  attempts: r.attempts,
  nextAttemptAt: r.next_attempt_at,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
});

const INSPECTION_COLUMNS: Record<keyof Omit<InspectionRow, "rentalId">, string> = {
  status: "status",
  model: "model",
  provider: "provider",
  requestId: "request_id",
  chatId: "chat_id",
  teeVerified: "tee_verified",
  rawOutput: "raw_output",
  verdictJson: "verdict_json",
  decisionJson: "decision_json",
  billingJson: "billing_json",
  passesJson: "passes_json",
  capture: "capture",
  needsArbiter: "needs_arbiter",
  inspectionRoot: "inspection_root",
  costUsd: "cost_usd",
  txHash: "tx_hash",
  reason: "reason",
  attempts: "attempts",
  nextAttemptAt: "next_attempt_at",
  startedAt: "started_at",
  finishedAt: "finished_at",
};

const sqlValue = (v: unknown) => (typeof v === "boolean" ? Number(v) : v);

export class Repo {
  constructor(readonly db: Db) {}

  insertRental(r: Omit<RentalRow, "state" | "onchain" | "proposedAt" | "createdAt">, termsJson: string): void {
    this.db
      .prepare(
        `INSERT INTO rentals (id, item, owner, renter, deposit, return_by, schedule_bps, terms_json, terms_hash, nonce, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(lc(r.id), r.item, lc(r.owner), r.renter ? lc(r.renter) : null, r.deposit, r.returnBy, JSON.stringify(r.scheduleBps), termsJson, r.termsHash, r.nonce, now());
  }

  getRental(id: string): RentalRow | undefined {
    const row = this.db.prepare("SELECT * FROM rentals WHERE id = ?").get(lc(id));
    return row ? rentalFrom(row) : undefined;
  }

  listRentals(filter: { owner?: string; states?: RentalState[] } = {}): RentalRow[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (filter.owner) {
      where.push("owner = ?");
      args.push(lc(filter.owner));
    }
    if (filter.states?.length) {
      where.push(`state IN (${filter.states.map(() => "?").join(",")})`);
      args.push(...filter.states);
    }
    const sql = `SELECT * FROM rentals ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC`;
    return this.db.prepare(sql).all(...args).map(rentalFrom);
  }

  setRenter(id: string, renter: string): void {
    this.db.prepare("UPDATE rentals SET renter = ? WHERE id = ?").run(lc(renter), lc(id));
  }

  markOnchain(id: string): void {
    this.db.prepare("UPDATE rentals SET onchain = 1 WHERE id = ?").run(lc(id));
  }

  setState(id: string, state: RentalState, proposedAt?: number): void {
    if (proposedAt === undefined) this.db.prepare("UPDATE rentals SET state = ? WHERE id = ?").run(state, lc(id));
    else this.db.prepare("UPDATE rentals SET state = ?, proposed_at = ? WHERE id = ?").run(state, proposedAt, lc(id));
  }

  /** Inserts or replaces the scan for (rental, phase); confirmations and recording start empty. */
  putScan(s: Omit<ScanRow, "bundleRoot" | "confirmations" | "recordedTx">): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO scans (rental_id, phase, device_key_id, manifest_json, manifest_hash, signature_b64, captured_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(lc(s.rentalId), s.phase, s.deviceKeyId, s.manifestJson, s.manifestHash, s.signatureB64, s.capturedAt, now());
  }

  getScan(rentalId: string, phase: Phase): ScanRow | undefined {
    const row = this.db.prepare("SELECT * FROM scans WHERE rental_id = ? AND phase = ?").get(lc(rentalId), phase);
    return row ? scanFrom(row) : undefined;
  }

  setScanBundleRoot(rentalId: string, phase: Phase, root: string): void {
    this.db.prepare("UPDATE scans SET bundle_root = ? WHERE rental_id = ? AND phase = ?").run(root, lc(rentalId), phase);
  }

  addConfirmation(rentalId: string, phase: Phase, c: Confirmation): void {
    const scan = this.getScan(rentalId, phase);
    if (!scan || scan.confirmations.some((x) => x.address === lc(c.address))) return;
    const next = [...scan.confirmations, { address: lc(c.address), signature: c.signature }];
    this.db.prepare("UPDATE scans SET confirmations = ? WHERE rental_id = ? AND phase = ?").run(JSON.stringify(next), lc(rentalId), phase);
  }

  setScanRecorded(rentalId: string, phase: Phase, tx: string): void {
    this.db.prepare("UPDATE scans SET recorded_tx = ? WHERE rental_id = ? AND phase = ?").run(tx, lc(rentalId), phase);
  }

  getInspection(rentalId: string): InspectionRow | undefined {
    const row = this.db.prepare("SELECT * FROM inspections WHERE rental_id = ?").get(lc(rentalId));
    return row ? inspectionFrom(row) : undefined;
  }

  /** Creates the inspection row if missing, then applies `patch`. */
  updateInspection(rentalId: string, patch: Partial<Omit<InspectionRow, "rentalId">>): InspectionRow {
    this.db
      .prepare("INSERT OR IGNORE INTO inspections (rental_id, status, started_at) VALUES (?, 'running', ?)")
      .run(lc(rentalId), now());
    const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
    if (entries.length) {
      const sets = entries.map(([k]) => `${INSPECTION_COLUMNS[k as keyof typeof INSPECTION_COLUMNS]} = ?`).join(", ");
      this.db.prepare(`UPDATE inspections SET ${sets} WHERE rental_id = ?`).run(...entries.map(([, v]) => sqlValue(v)), lc(rentalId));
    }
    return this.getInspection(rentalId)!;
  }

  listInspections(status: InspectionStatus): InspectionRow[] {
    return this.db.prepare("SELECT * FROM inspections WHERE status = ?").all(status).map(inspectionFrom);
  }

  addTx(rentalId: string, label: string, hash: string): void {
    this.db.prepare("INSERT INTO txs (rental_id, label, hash, created_at) VALUES (?, ?, ?, ?)").run(lc(rentalId), label, hash, now());
  }

  listTxs(rentalId: string): { label: string; hash: string }[] {
    return this.db.prepare("SELECT label, hash FROM txs WHERE rental_id = ? ORDER BY id").all(lc(rentalId)) as { label: string; hash: string }[];
  }
}
