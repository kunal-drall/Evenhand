// GET /export.csv?owner=0x.. (docs/interfaces.md section 7, P1): one row per rental for an accountant.
import { Address } from "@evenhand/shared";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { formatUnits } from "viem";
import type { RouteDeps } from "../app.js";
import type { RentalRow, Repo } from "../rentals/repo.js";

const COLUMNS = ["rentalId", "item", "deposit", "capture", "refund", "state", "fundTx", "settleTx", "inspectionRoot", "requestId"];
const SETTLE_LABELS = ["finalize", "refundOnTimeout", "resolveAppeal", "waive"];

/** RFC 4180 field: quote when needed, and defuse spreadsheet formulas. */
export function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function row(repo: Repo, r: RentalRow, decimals: number): string[] {
  const ins = repo.getInspection(r.id);
  const txs = repo.listTxs(r.id);
  const deposit = BigInt(r.deposit);
  let capture: bigint | undefined;
  if (r.state === "Refunded") capture = 0n;
  else if (ins?.capture) capture = BigInt(ins.capture);
  const settled = r.state === "Settled" || r.state === "Refunded";
  const units = (v: bigint | undefined) => (v === undefined ? "" : formatUnits(v, decimals));
  return [
    r.id,
    r.item,
    units(deposit),
    units(capture),
    settled && capture !== undefined ? units(deposit - capture) : "",
    r.state,
    txs.find((t) => t.label === "fundWithAuthorization")?.hash ?? "",
    txs.find((t) => SETTLE_LABELS.includes(t.label))?.hash ?? "",
    ins?.inspectionRoot ?? "",
    ins?.requestId ?? "",
  ];
}

export function exportRoutes(app: Hono, deps: RouteDeps): void {
  app.get("/export.csv", async (c) => {
    const owner = Address.safeParse(c.req.query("owner"));
    if (!owner.success) throw new HTTPException(400, { message: "owner query must be an address" });
    const decimals = await deps.chain
      .paymentConfig()
      .then((p) => p.usdt.decimals)
      .catch(() => 6);
    const lines = [COLUMNS.join(","), ...deps.repo.listRentals({ owner: owner.data }).map((r) => row(deps.repo, r, decimals).map(csvField).join(","))];
    return c.body(`${lines.join("\r\n")}\r\n`, 200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="evenhand-${owner.data.slice(0, 10)}.csv"`,
    });
  });
}
