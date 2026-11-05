import { useEffect, useState } from "react";
import { receiveWithAuthorizationTypes, type PaymentConfig } from "@evenhand/shared";
import { parseSignature, toHex } from "viem";
import { api } from "../api";
import { Notice, Shell } from "../components";
import { pct, usd, when } from "../format";
import { usePolling } from "../usePolling";
import { renterAccount } from "../wallet";

type Status = { kind: "idle" } | { kind: "busy"; label: string } | { kind: "error"; message: string };

function friendly(message: string): string {
  if (/balance is below/i.test(message)) return "This phone doesn't have enough funds set up for the deposit yet.";
  if (/another phone|not this rental's renter/i.test(message)) return "This payment link belongs to another phone.";
  return message;
}

/** Renter pays the deposit with one tap: one signature, no gas, nothing to install. */
export function PayPage({ rentalId }: { rentalId: string }) {
  const { data: rental, error, refresh } = usePolling(() => api.rental(rentalId), 5000);
  const [cfg, setCfg] = useState<PaymentConfig>();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  useEffect(() => {
    api.paymentConfig().then(setCfg).catch(() => undefined);
  }, []);

  if (!rental) return <Shell>{error ? <Notice tone="error">{error}</Notice> : <p>Loading…</p>}</Shell>;
  const decimals = cfg?.usdt.decimals ?? 6;
  const me = renterAccount().address.toLowerCase();
  const otherPhone = rental.renter !== null && rental.renter !== me;
  const [, minor, moderate, major] = rental.scheduleBps ?? [0, 0, 0, 0];

  async function pay() {
    try {
      setStatus({ kind: "busy", label: "Authorising…" });
      const config = cfg ?? (await api.paymentConfig());
      const account = renterAccount();
      const message = {
        from: account.address,
        to: config.depositsAddress as `0x${string}`,
        value: BigInt(rental!.deposit),
        validAfter: 0n,
        validBefore: BigInt(Math.floor(Date.now() / 1000) + 3600),
        nonce: toHex(crypto.getRandomValues(new Uint8Array(32))),
      };
      const sig = parseSignature(
        await account.signTypedData({ domain: config.domain as never, types: receiveWithAuthorizationTypes, primaryType: "ReceiveWithAuthorization", message }),
      );
      setStatus({ kind: "busy", label: "Holding your deposit…" });
      await api.fund(rentalId, { from: account.address, validAfter: "0", validBefore: message.validBefore.toString(), nonce: message.nonce, v: Number(sig.v), r: sig.r, s: sig.s });
      setStatus({ kind: "idle" });
      await refresh();
    } catch (err) {
      setStatus({ kind: "error", message: friendly((err as Error).message) });
    }
  }

  const paid = rental.state !== "None";
  return (
    <Shell>
      <section className="card hero">
        <p className="eyebrow">Refundable deposit</p>
        <h1>{rental.item}</h1>
        <p className="amount">{usd(rental.deposit, decimals)}</p>
        <ul className="terms">
          <li>Return by {when(rental.returnBy)}</li>
          <li>
            New damage keeps part of it: minor {pct(minor)}, moderate {pct(moderate)}, major {pct(major)}
          </li>
          <li>A neutral inspector compares pickup and return photos. No damage, full refund.</li>
        </ul>
        {paid ? (
          <Notice tone="ok">Deposit held. You'll get back whatever the inspection doesn't keep.</Notice>
        ) : otherPhone ? (
          <Notice tone="warn">This payment link belongs to another phone.</Notice>
        ) : (
          <button className="primary" disabled={status.kind === "busy"} onClick={() => void pay()}>
            {status.kind === "busy" ? status.label : `Pay ${usd(rental.deposit, decimals)} deposit`}
          </button>
        )}
        {status.kind === "error" && <Notice tone="error">{status.message}</Notice>}
      </section>
      {paid && (
        <a className="link-button" href={`/r/${rentalId}`}>
          Track this rental
        </a>
      )}
    </Shell>
  );
}
