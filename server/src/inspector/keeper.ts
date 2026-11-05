// Background duties: resume paused inspections, finalize after the appeal window,
// refund after returnBy + grace, sync state changed by others, and warn when relayer gas runs low.
import type { RentalState } from "@evenhand/shared";
import type { ChainPort } from "../chain/port.js";
import type { Config, Hex } from "../config.js";
import { unixSeconds } from "../rentals/terms.js";
import type { Repo } from "../rentals/repo.js";
import type { Inspector } from "./pipeline.js";

const OPEN: RentalState[] = ["Funded", "PickedUp", "Returned", "Proposed", "Appealed"];
const MARGIN_S = 5;
const ONE_WBT = 10n ** 18n;

export function createKeeper(deps: {
  repo: Repo;
  chain: ChainPort;
  inspector: Inspector;
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

  return {
    async tick(): Promise<void> {
      const now = clock();
      for (const ins of repo.listInspections("paused")) {
        if (!ins.nextAttemptAt || ins.nextAttemptAt <= now) inspector.start(ins.rentalId);
      }
      if (!chain.ready) return;
      const nowS = Math.floor(now / 1000);
      for (const r of repo.listRentals({ states: OPEN })) {
        if (!r.onchain) continue;
        try {
          const onchain = await chain.getRental(r.id as Hex);
          if (onchain.state !== r.state && onchain.state !== "None") {
            repo.setState(r.id, onchain.state, onchain.proposedAt || undefined);
            continue;
          }
        } catch {
          // RPC hiccup: act on local state
        }
        if (r.state === "Proposed" && r.proposedAt && nowS > r.proposedAt + timing.appealWindowS + MARGIN_S) {
          await act(r.id, "finalize", () => chain.finalize(r.id as Hex), "Settled");
        } else if (["Funded", "PickedUp", "Returned"].includes(r.state) && nowS > unixSeconds(r.returnBy) + timing.graceS + MARGIN_S) {
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
