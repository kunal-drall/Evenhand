import { useEffect, useState } from "react";
import { confirmMessage, type RentalView } from "@evenhand/shared";
import { api } from "../api";
import { Notice, Photos, Receipts, Shell, Steps, Verdict } from "../components";
import { usd, when } from "../format";
import { usePolling } from "../usePolling";
import { renterAccount } from "../wallet";

function InspectionStatus({ rental }: { rental: RentalView }) {
  const ins = rental.inspection;
  if (!ins) return null;
  if (ins.status === "running") return <Notice tone="info">Checking the return photos against pickup…</Notice>;
  if (ins.status === "paused")
    return (
      <Notice tone="warn">
        <strong>Inspection paused.</strong> Nothing is charged while it is paused; the deposit stays held until the inspector answers.
      </Notice>
    );
  if (ins.status === "needs_human")
    return (
      <Notice tone="warn">
        <strong>A human arbiter will review this return.</strong> {ins.reason ? `Reason: ${ins.reason}.` : ""}
      </Notice>
    );
  if (rental.state === "Appealed") return <Notice tone="warn">The charge is above the automatic limit, so the arbiter decides.</Notice>;
  if (rental.state === "Proposed") return <Notice tone="info">Final after the appeal window unless either side appeals.</Notice>;
  return null;
}

/** Renter (and owner) status page: confirm the pickup photos, watch the return and the verdict. */
export function RentalPage({ rentalId }: { rentalId: string }) {
  const { data: rental, error, refresh } = usePolling(() => api.rental(rentalId), 3000);
  const [decimals, setDecimals] = useState(6);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  useEffect(() => {
    api.paymentConfig().then((c) => setDecimals(c.usdt.decimals)).catch(() => undefined);
  }, []);

  if (!rental) return <Shell>{error ? <Notice tone="error">{error}</Notice> : <p>Loading…</p>}</Shell>;
  const me = renterAccount().address.toLowerCase();
  const isRenter = rental.renter === me;
  const pickup = rental.scans.pickup;
  const ret = rental.scans.return;
  const flagged = rental.inspection?.verdict?.angles.filter((a) => a.severity > 0).map((a) => a.angle) ?? [];

  async function confirm(phase: "pickup" | "return", manifestHash: string) {
    setBusy(true);
    setActionError(undefined);
    try {
      const account = renterAccount();
      const signature = await account.signMessage({ message: confirmMessage(rentalId, phase, manifestHash) });
      await api.confirm(rentalId, phase, { address: account.address, signature });
      await refresh();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const needsPickupConfirm = isRenter && pickup && !pickup.confirmedBy.includes(me) && rental.state === "Funded";
  return (
    <Shell>
      <section className="card">
        <p className="eyebrow">{usd(rental.deposit, decimals)} deposit · return by {when(rental.returnBy)}</p>
        <h1>{rental.item}</h1>
        <Steps rental={rental} />
      </section>

      <InspectionStatus rental={rental} />
      {rental.state === "Refunded" && <Notice tone="ok">The full deposit went back to the renter.</Notice>}
      <Verdict rental={rental} decimals={decimals} />

      {pickup && (
        <section className="card">
          <h2>Pickup photos</h2>
          <Photos scan={pickup} />
          {needsPickupConfirm ? (
            <button className="primary" disabled={busy} onClick={() => void confirm("pickup", pickup.manifestHash)}>
              {busy ? "Confirming…" : "These photos match the item"}
            </button>
          ) : pickup.confirmedBy.length > 0 ? (
            <p className="meta">Confirmed by the renter.</p>
          ) : (
            <p className="meta">Waiting for the renter to confirm.</p>
          )}
        </section>
      )}

      {ret && (
        <section className="card">
          <h2>Return photos</h2>
          <Photos scan={ret} highlight={flagged} />
          {isRenter && !ret.confirmedBy.includes(me) && (
            <button className="secondary" disabled={busy} onClick={() => void confirm("return", ret.manifestHash)}>
              I saw these photos taken
            </button>
          )}
        </section>
      )}
      {actionError && <Notice tone="error">{actionError}</Notice>}
      <Receipts rental={rental} />
    </Shell>
  );
}
