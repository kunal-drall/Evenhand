import { useEffect, useState, type FormEvent } from "react";
import type { RentalView } from "@evenhand/shared";
import { isAddress, parseUnits } from "viem";
import { createEvenhand } from "../../sdk/evenhand";
import { api } from "../api";
import { Notice, Shell } from "../components";
import { usd, when } from "../format";
import { usePolling } from "../usePolling";

const OWNER_KEY = "evenhand.ownerAddress.v1";
const sdk = createEvenhand();
const STATE_LABEL: Record<string, string> = {
  None: "Awaiting deposit",
  Funded: "Deposit held",
  PickedUp: "Out on rental",
  Returned: "Inspecting",
  Proposed: "Verdict (appeal window)",
  Appealed: "With arbiter",
  Settled: "Settled",
  Refunded: "Refunded",
};

function readOwner(): string {
  try {
    return localStorage.getItem(OWNER_KEY) ?? "";
  } catch {
    return "";
  }
}

function inspectionText(r: RentalView, decimals: number): string {
  const ins = r.inspection;
  if (!ins) return "";
  if (ins.status === "paused") return "Inspection paused";
  if (ins.status === "needs_human") return "Needs a human";
  if (ins.status === "running") return "Inspecting…";
  return ins.capture ? `Keeps ${usd(ins.capture, decimals)}` : "";
}

function CreateRental({ owner, decimals, onCreated }: { owner: string; decimals: number; onCreated: () => void }) {
  const [created, setCreated] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const bps = (name: string) => Math.round(Number(f.get(name)) * 100);
    const renter = String(f.get("renter") ?? "").trim();
    setBusy(true);
    setError(undefined);
    try {
      const res = await api.createRental({
        ownerAddress: owner,
        ...(renter && { renterAddress: renter }),
        depositUsdt: parseUnits(String(f.get("deposit")), decimals).toString(),
        returnBy: new Date(String(f.get("returnBy"))).toISOString(),
        scheduleBps: [0, bps("minor"), bps("moderate"), bps("major")],
        item: String(f.get("item")),
      });
      setCreated(res.payUrl);
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const tomorrow = new Date(Date.now() + 86_400_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  return (
    <section className="card">
      <h2>New rental</h2>
      <form className="form" onSubmit={(e) => void submit(e)}>
        <label>
          Item <input name="item" required maxLength={120} defaultValue="Laptop" />
        </label>
        <label>
          Deposit (USD) <input name="deposit" required inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,6})?" defaultValue="200" />
        </label>
        <label>
          Return by <input name="returnBy" type="datetime-local" required defaultValue={tomorrow} />
        </label>
        <fieldset className="row">
          <legend>Kept for new damage (%)</legend>
          <label>
            Minor <input name="minor" type="number" min="0" max="100" step="0.1" defaultValue="10" />
          </label>
          <label>
            Moderate <input name="moderate" type="number" min="0" max="100" step="0.1" defaultValue="35" />
          </label>
          <label>
            Major <input name="major" type="number" min="0" max="100" step="0.1" defaultValue="100" />
          </label>
        </fieldset>
        <label>
          Renter address (optional) <input name="renter" placeholder="filled in when the renter pays" />
        </label>
        <button className="primary" disabled={busy}>
          {busy ? "Creating…" : "Create rental and payment link"}
        </button>
      </form>
      {error && <Notice tone="error">{error}</Notice>}
      {created && (
        <Notice tone="ok">
          <div className="qr" dangerouslySetInnerHTML={{ __html: sdk.qrSvg(created) }} />
          Renter scans this, or open the <a href={created}>payment link</a>{" "}
          <button className="secondary small" onClick={() => void navigator.clipboard?.writeText(created)}>
            Copy
          </button>
        </Notice>
      )}
    </section>
  );
}

/** Operator dashboard: create rentals, see every deposit, verdict and settlement. */
export function OwnerPage() {
  const [owner, setOwner] = useState(readOwner);
  const [decimals, setDecimals] = useState(6);
  const valid = isAddress(owner);
  const { data: rentals, error, refresh } = usePolling(() => (valid ? api.rentals(owner) : Promise.resolve([])), 4000);
  const { data: health } = usePolling(() => api.health0g(), 15000);
  useEffect(() => {
    api.paymentConfig().then((c) => setDecimals(c.usdt.decimals)).catch(() => undefined);
  }, []);
  useEffect(() => {
    try {
      if (valid) localStorage.setItem(OWNER_KEY, owner);
    } catch {
      // ignore
    }
  }, [owner, valid]);

  return (
    <Shell wide>
      <section className="card">
        <h1>Owner dashboard</h1>
        <label className="form">
          Payout address <input value={owner} onChange={(e) => setOwner(e.target.value.trim())} placeholder="0x…" />
        </label>
        {valid && (
          <p className="meta">
            <a href={`/export.csv?owner=${owner}`}>Export settlements (CSV)</a> · <a href="/arbiter">Arbiter queue</a>
          </p>
        )}
        {health && (
          <p className="meta">
            Inspector {health.router && health.storage ? "online" : "unavailable: new inspections will pause"}
          </p>
        )}
      </section>
      {valid && <CreateRental owner={owner} decimals={decimals} onCreated={() => void refresh()} />}
      {error && <Notice tone="error">{error}</Notice>}
      {valid && rentals && (
        <section className="card">
          <h2>Rentals</h2>
          {rentals.length === 0 ? (
            <p className="meta">No rentals yet.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Deposit</th>
                  <th>Return by</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rentals.map((r) => (
                  <tr key={r.rentalId}>
                    <td>{r.item}</td>
                    <td>{usd(r.deposit, decimals)}</td>
                    <td>{when(r.returnBy)}</td>
                    <td>
                      {STATE_LABEL[r.state] ?? r.state}
                      <small>{inspectionText(r, decimals)}</small>
                    </td>
                    <td>
                      <a href={`/r/${r.rentalId}`}>Open</a> · <a href={`/pay/${r.rentalId}`}>Pay link</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </Shell>
  );
}
