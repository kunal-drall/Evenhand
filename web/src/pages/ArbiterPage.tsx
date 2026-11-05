// Arbiter queue: verdicts the contract routed to a human (Appealed) and inspections that need one (needs_human).
// The arbiter resolves with their own wallet: resolveAppeal(id, capture) on the deposits contract.
import { useState } from "react";
import type { RentalView } from "@evenhand/shared";
import { parseUnits } from "viem";
import { api } from "../api";
import { Notice, Photos, Shell, Verdict } from "../components";
import { usd } from "../format";
import { sendFromOperatorWallet } from "../operatorWallet";
import { usePolling } from "../usePolling";

function Case({ rental, decimals, onDone }: { rental: RentalView; decimals: number; onDone: () => void }) {
  const proposed = rental.inspection?.capture ? Number(rental.inspection.capture) / 10 ** decimals : 0;
  const [amount, setAmount] = useState(String(proposed));
  const [result, setResult] = useState<{ tone: "ok" | "error"; text: string }>();
  const appealed = rental.state === "Appealed";

  async function submit() {
    try {
      const capture = parseUnits(amount, decimals);
      if (capture > BigInt(rental.deposit)) throw new Error("Capture cannot exceed the deposit.");
      const hash = await sendFromOperatorWallet({ functionName: "resolveAppeal", args: [rental.rentalId as `0x${string}`, capture] });
      setResult({ tone: "ok", text: `Sent: ${hash}` });
      onDone();
    } catch (err) {
      setResult({ tone: "error", text: (err as Error).message });
    }
  }

  return (
    <section className="card">
      <p className="eyebrow">
        {usd(rental.deposit, decimals)} deposit · {appealed ? "appealed to the arbiter" : "inspection needs a human"}
      </p>
      <h2>{rental.item}</h2>
      {rental.inspection?.reason && <Notice tone="warn">Reason: {rental.inspection.reason}</Notice>}
      <Verdict rental={rental} decimals={decimals} />
      {rental.scans.pickup && (
        <>
          <h3>Pickup</h3>
          <Photos scan={rental.scans.pickup} />
        </>
      )}
      {rental.scans.return && (
        <>
          <h3>Return</h3>
          <Photos scan={rental.scans.return} highlight={rental.inspection?.verdict?.angles.filter((a) => a.severity > 0).map((a) => a.angle)} />
        </>
      )}
      {appealed ? (
        <div className="form">
          <label>
            Capture for the owner (USD) <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
          </label>
          <button className="primary" onClick={() => void submit()}>
            Settle: owner gets {amount || 0}, renter gets the rest
          </button>
        </div>
      ) : (
        <p className="meta">No verdict is onchain for this rental. The owner can waive it, or it is refunded in full after the return deadline plus grace.</p>
      )}
      {result && <Notice tone={result.tone}>{result.text}</Notice>}
    </section>
  );
}

export function ArbiterPage() {
  const { data, error, refresh } = usePolling(() => api.arbiterQueue(), 5000);
  const { data: cfg } = usePolling(() => api.paymentConfig(), 60_000);
  const decimals = cfg?.usdt.decimals ?? 6;
  return (
    <Shell wide>
      <section className="card">
        <h1>Arbiter</h1>
        <p className="meta">Cases the inspector would not settle on its own.</p>
      </section>
      {error && <Notice tone="error">{error}</Notice>}
      {data?.length === 0 && <p className="meta">Nothing waiting.</p>}
      {data?.map((r) => <Case key={r.rentalId} rental={r} decimals={decimals} onDone={() => void refresh()} />)}
    </Shell>
  );
}
