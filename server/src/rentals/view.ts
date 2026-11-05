import { ANGLES, ModelVerdict, explorerTxUrl, type Phase, type RentalView, type ScanView } from "@evenhand/shared";
import type { Repo, ScanRow } from "./repo.js";

export type PhotoTokenFor = (rentalId: string, phase: Phase) => string;

function scanView(base: string, scan: ScanRow, tokenFor: PhotoTokenFor): ScanView {
  const t = tokenFor(scan.rentalId, scan.phase);
  return {
    manifestHash: scan.manifestHash,
    capturedAt: scan.capturedAt,
    photoUrls: ANGLES.map((angle) => `${base}/rentals/${scan.rentalId}/photos/${scan.phase}/${angle}?t=${t}`),
    confirmedBy: scan.confirmations.map((c) => c.address),
  };
}

/** RentalView (docs/interfaces.md section 7) from the local rows. */
export function buildRentalView(repo: Repo, base: string, id: string, tokenFor: PhotoTokenFor): RentalView | undefined {
  const r = repo.getRental(id);
  if (!r) return undefined;
  const scans: RentalView["scans"] = {};
  for (const phase of ["pickup", "return"] as Phase[]) {
    const scan = repo.getScan(r.id, phase);
    if (scan) scans[phase] = scanView(base, scan, tokenFor);
  }
  const ins = repo.getInspection(r.id);
  const verdict = ins?.verdictJson ? ModelVerdict.safeParse(JSON.parse(ins.verdictJson)) : undefined;
  return {
    rentalId: r.id,
    item: r.item,
    owner: r.owner,
    renter: r.renter,
    deposit: r.deposit,
    returnBy: r.returnBy,
    scheduleBps: [0, r.scheduleBps[1], r.scheduleBps[2], r.scheduleBps[3]],
    state: r.state,
    scans,
    ...(ins && {
      inspection: {
        status: ins.status,
        ...(verdict?.success && { verdict: verdict.data }),
        ...(ins.capture !== null && { capture: ins.capture }),
        ...(ins.requestId !== null && { requestId: ins.requestId }),
        teeVerified: ins.teeVerified,
        ...(ins.inspectionRoot !== null && { inspectionRoot: ins.inspectionRoot }),
        ...(ins.costUsd !== null && { costUsd: ins.costUsd }),
        ...(ins.reason !== null && { reason: ins.reason }),
        ...(ins.needsArbiter !== null && { needsArbiter: ins.needsArbiter }),
      },
    }),
    txs: repo.listTxs(r.id).map((t) => ({ label: t.label, hash: t.hash, url: explorerTxUrl(t.hash) })),
  };
}
