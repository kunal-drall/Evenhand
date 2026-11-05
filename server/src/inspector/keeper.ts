// Background duties: (re)start inspections, finalize after the appeal window, escalate items never returned,
// refund when Evenhand fails to act, sync state changed by others, and warn when relayer gas runs low.
import type { RentalState } from "@evenhand/shared";
import type { ChainPort } from "../chain/port.js";
import type { Config, Hex } from "../config.js";
import { unixSeconds } from "../rentals/terms.js";
import type { RentalRow, Repo } from "../rentals/repo.js";
import type { Inspector } from "./pipeline.js";

const OPEN: RentalState[] = ["Funded", "PickedUp", "Returned", "Proposed", "Appealed"];
const MARGIN_S = 5;
const ONE_WBT = 10n ** 18n;

export function createKeeper(deps: {
  repo: Repo;
  chain: ChainPort;
  inspector: Pick<Inspector, "start" | "isRunning">;
  timing: Config["timing"];
  clock?: () => number;
  log?: (msg: string) => void;
}) {
  const { repo, chain, inspector, timing } = deps;
  const clock = deps.clock ?? Date.now;
  const log = deps.log ?? ((m: string) => console.log(m));

  async function act(id: string, label: string, send: () => Promise<Hex>, next: RentalState) {
    try {
      const hash = await send();
      repo.addTx(id, label, hash);
      repo.setState(id, next);
      log(`${label} ${id}: ${hash}`);
    } catch (err) {
      log(`${label} ${id} not sent yet: ${(err as Error).message.split("\n")[0]}`);
    }
  }

  /** A returned item's inspection must be running: start it if missing, stale after a crash, or due for retry. */
  function driveInspection(r: RentalRow, now: number): void {
    if (r.state !== "Returned" || inspector.isRunning(r.id)) return;
    const ins = repo.getInspection(r.id);
    const due = !ins || ins.status === "running" || (ins.status === "paused" && (!ins.nextAttemptAt || ins.nextAttemptAt <= now));
    if (due || (ins?.status === "needs_human" && !ins.txHash)) inspector.start(r.id);
  }

  /** No-verdict deadline for a returned item: grace after the later of returnBy and the return. */
  function returnedDeadline(r: RentalRow): number {
    const ret = repo.getScan(r.id, "return");
    return Math.max(unixSeconds(r.returnBy), ret ? unixSeconds(ret.capturedAt) : 0) + timing.graceS;
  }

  return {
    async tick(): Promise<void> {
      const now = clock();
      const nowS = Math.floor(now / 1000);
      for (const r of repo.listRentals({ states: OPEN })) {
        if (chain.ready && r.onchain) {
          try {
            const onchain = await chain.getRental(r.id as Hex);
            if (onchain.state !== r.state && onchain.state !== "None") {
              repo.setState(r.id, onchain.state, onchain.proposedAt || undefined);
              continue;
            }
          } catch {
            // RPC hiccup: act on local state
          }
        }
        driveInspection(r, now);
        if (!chain.ready) continue;
        const pastReturnBy = nowS > unixSeconds(r.returnBy) + timing.graceS + MARGIN_S;
        if (r.state === "Proposed" && r.proposedAt && nowS > r.proposedAt + timing.appealWindowS + MARGIN_S) {
          await act(r.id, "finalize", () => chain.finalize(r.id as Hex), "Settled");
        } else if (r.state === "PickedUp" && pastReturnBy) {
          await act(r.id, "escalate", () => chain.escalate(r.id as Hex), "Appealed"); // item never returned: the arbiter decides
        } else if (r.state === "Funded" && pastReturnBy) {
          await act(r.id, "refundOnTimeout", () => chain.refundOnTimeout(r.id as Hex), "Refunded");
        } else if (r.state === "Returned" && nowS > returnedDeadline(r) + MARGIN_S) {
          await act(r.id, "refundOnTimeout", () => chain.refundOnTimeout(r.id as Hex), "Refunded");
        }
      }
    },

    async checkGas(): Promise<void> {
      if (!chain.ready) return;
      try {
        for (const [role, balance] of Object.entries(await chain.gasBalances())) {
          if (balance < ONE_WBT) log(`RELAYER_LOW: ${role} key holds ${Number(balance) / 1e18} WBT (< 1)`);
        }
      } catch (err) {
        log(`gas balance check failed: ${(err as Error).message}`);
      }
    },
  };
}
