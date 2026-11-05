// Evenhand drop-in SDK: add neutral, self-settling rental deposits to any web shop.
//
//   const evenhand = createEvenhand({ baseUrl: "https://your-evenhand-server" });
//   const { rentalId, payUrl } = await evenhand.createRental({ owner, item, depositUsd: 200, returnBy });
//   const stop = evenhand.watch(rentalId, (r) => console.log(evenhand.describe(r)));
//
// The renter pays with one tap at payUrl (no wallet app, no gas). Photos are checked by a sealed AI
// inspector and the deposit settles itself: damage share to the owner, the rest back to the renter.
import qrcode from "qrcode-generator";

export type Schedule = { minor: number; moderate: number; major: number }; // percent of the deposit kept

export type RentalState = "None" | "Funded" | "PickedUp" | "Returned" | "Proposed" | "Appealed" | "Settled" | "Refunded";

export type Rental = {
  rentalId: string;
  item: string;
  owner: string;
  renter: string | null;
  deposit: string; // USDT base units
  returnBy: string;
  state: RentalState;
  inspection?: { status: "running" | "paused" | "done" | "needs_human"; capture?: string; requestId?: string; reason?: string };
  txs: { label: string; hash: string; url: string }[];
};

export type CreateRentalInput = {
  owner: string; // payout address for damage captures
  item: string;
  depositUsd: number | string;
  returnBy: Date;
  schedule?: Schedule;
  renter?: string; // optional: filled in when the renter pays
};

const DEFAULT_SCHEDULE: Schedule = { minor: 10, moderate: 35, major: 100 };

const STATE_TEXT: Record<RentalState, string> = {
  None: "Waiting for the deposit",
  Funded: "Deposit held",
  PickedUp: "Out on rental",
  Returned: "Returned, inspecting",
  Proposed: "Verdict in, final after the appeal window",
  Appealed: "With the arbiter",
  Settled: "Settled",
  Refunded: "Deposit refunded",
};

/** "200.5" -> base units with `decimals` places, without floating point. */
export function toBaseUnits(amount: number | string, decimals: number): string {
  const [whole = "0", fraction = ""] = String(amount).trim().split(".");
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction) || fraction.length > decimals) throw new Error(`invalid amount: ${amount}`);
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0")).toString();
}

export function createEvenhand(options: { baseUrl?: string } = {}) {
  const base = (options.baseUrl ?? "").replace(/\/$/, "");
  let decimals: Promise<number> | undefined;

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(60_000) });
    const body = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(body.error ?? `Evenhand request failed (${res.status})`);
    return body;
  }

  const tokenDecimals = () =>
    (decimals ??= call<{ usdt: { decimals: number } }>("/payment-config")
      .then((c) => c.usdt.decimals)
      .catch(() => 6));

  return {
    async createRental(input: CreateRentalInput): Promise<{ rentalId: string; payUrl: string }> {
      const s = input.schedule ?? DEFAULT_SCHEDULE;
      const bps = (pct: number) => Math.round(pct * 100);
      return call("/rentals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ownerAddress: input.owner,
          ...(input.renter && { renterAddress: input.renter }),
          depositUsdt: toBaseUnits(input.depositUsd, await tokenDecimals()),
          returnBy: input.returnBy.toISOString(),
          scheduleBps: [0, bps(s.minor), bps(s.moderate), bps(s.major)],
          item: input.item,
        }),
      });
    },

    getRental: (rentalId: string) => call<Rental>(`/rentals/${rentalId}`),

    /** Polls the rental and calls `onChange` whenever its state or inspection changes. Returns stop(). */
    watch(rentalId: string, onChange: (r: Rental) => void, everyMs = 3000): () => void {
      let last = "";
      let stopped = false;
      const tick = async () => {
        try {
          const r = await call<Rental>(`/rentals/${rentalId}`);
          const key = `${r.state}:${r.inspection?.status ?? ""}:${r.inspection?.capture ?? ""}`;
          if (key !== last && !stopped) onChange(r);
          last = key;
        } catch {
          // transient: try again next tick
        }
      };
      void tick();
      const timer = setInterval(() => void tick(), everyMs);
      return () => {
        stopped = true;
        clearInterval(timer);
      };
    },

    describe(r: Rental): string {
      if (r.inspection?.status === "paused") return "Inspection paused, deposit still held";
      if (r.inspection?.status === "needs_human") return "A human is reviewing the return";
      return STATE_TEXT[r.state];
    },

    /** Inline SVG QR code for a pay link, for the renter to scan. */
    qrSvg(text: string, cellSize = 5): string {
      const qr = qrcode(0, "M");
      qr.addData(text);
      qr.make();
      return qr.createSvgTag({ cellSize, margin: 2, scalable: true });
    },

    formatUsd: async (baseUnits: string) =>
      (Number(BigInt(baseUnits)) / 10 ** (await tokenDecimals())).toLocaleString("en-US", { style: "currency", currency: "USD" }),
  };
}
