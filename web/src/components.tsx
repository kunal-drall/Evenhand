import type { ReactNode } from "react";
import type { RentalView, ScanView } from "@evenhand/shared";
import { ANGLE_LABEL, SEVERITY, short, usd } from "./format";

export function Shell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "shell wide" : "shell"}>
      <header className="brand">Evenhand</header>
      <main>{children}</main>
      <footer className="foot">A neutral inspector holds the deposit. Neither side controls it.</footer>
    </div>
  );
}

export function Notice({ tone, children }: { tone: "info" | "warn" | "ok" | "error"; children: ReactNode }) {
  return <div className={`notice ${tone}`}>{children}</div>;
}

const ANGLE_ORDER = ["front", "back", "left", "right", "top", "detail"];

export function Photos({ scan, highlight = [] }: { scan: ScanView; highlight?: string[] }) {
  return (
    <div className="photos">
      {scan.photoUrls.map((url, i) => {
        const angle = ANGLE_ORDER[i]!;
        return (
          <figure key={url} className={highlight.includes(angle) ? "flagged" : undefined}>
            <img src={url} alt={ANGLE_LABEL[angle]} loading="lazy" />
            <figcaption>{ANGLE_LABEL[angle]}</figcaption>
          </figure>
        );
      })}
    </div>
  );
}

const STEPS: { label: string; reached: (r: RentalView) => boolean }[] = [
  { label: "Deposit held", reached: (r) => r.state !== "None" },
  { label: "Pickup photos sealed", reached: (r) => ["PickedUp", "Returned", "Proposed", "Appealed", "Settled"].includes(r.state) },
  { label: "Returned", reached: (r) => ["Returned", "Proposed", "Appealed", "Settled"].includes(r.state) },
  { label: "Verdict", reached: (r) => ["Proposed", "Appealed", "Settled"].includes(r.state) },
  { label: "Settled", reached: (r) => r.state === "Settled" || r.state === "Refunded" },
];

export function Steps({ rental }: { rental: RentalView }) {
  return (
    <ol className="steps">
      {STEPS.map((s) => (
        <li key={s.label} className={s.reached(rental) ? "done" : undefined}>
          {s.label}
        </li>
      ))}
    </ol>
  );
}

export function Verdict({ rental, decimals }: { rental: RentalView; decimals: number }) {
  const ins = rental.inspection;
  if (!ins?.verdict) return null;
  const capture = ins.capture ? BigInt(ins.capture) : 0n;
  const refund = BigInt(rental.deposit) - capture;
  return (
    <section className="card">
      <h2>Verdict</h2>
      <ul className="angles">
        {ins.verdict.angles.map((a) => (
          <li key={a.angle} className={a.severity > 0 ? "damaged" : undefined}>
            <strong>{ANGLE_LABEL[a.angle]}</strong>
            <span>{SEVERITY[a.severity]}</span>
            {a.severity > 0 && <small>{[a.location, a.description].filter(Boolean).join(": ")}</small>}
          </li>
        ))}
      </ul>
      <dl className="split">
        <div>
          <dt>Kept for damage</dt>
          <dd>{usd(capture, decimals)}</dd>
        </div>
        <div>
          <dt>Back to renter</dt>
          <dd>{usd(refund, decimals)}</dd>
        </div>
      </dl>
      <p className="meta">
        Confidence {Math.round(ins.verdict.overall_confidence * 100)}%{ins.teeVerified ? " · sealed model verified" : ""}
        {ins.requestId && <> · inspection {short(ins.requestId)}</>}
      </p>
    </section>
  );
}

const TX_LABEL: Record<string, string> = {
  createRental: "Rental opened",
  fundWithAuthorization: "Deposit received",
  recordPickup: "Pickup photos sealed",
  recordReturn: "Return photos sealed",
  proposeVerdict: "Verdict recorded",
  finalize: "Deposit settled",
  refundOnTimeout: "Deposit refunded",
};

export function Receipts({ rental }: { rental: RentalView }) {
  if (!rental.txs.length) return null;
  return (
    <section className="card receipts">
      <h2>Receipts</h2>
      <ul>
        {rental.txs.map((t) => (
          <li key={t.hash}>
            <a href={t.url} target="_blank" rel="noreferrer">
              {TX_LABEL[t.label] ?? t.label}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
