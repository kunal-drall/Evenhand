import { formatUnits } from "viem";

/** USDT base units to "$200.00". Decimals come from the token at runtime; 6 until loaded. */
export function usd(baseUnits: string | bigint | undefined, decimals = 6): string {
  if (baseUnits === undefined) return "—";
  const n = Number(formatUnits(BigInt(baseUnits), decimals));
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export const pct = (bps: number) => `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;

export function when(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export const SEVERITY = ["No new damage", "Minor", "Moderate", "Major"] as const;

/** Laptop labels for the spec's fixed angle IDs (plan.md section 2). */
export const ANGLE_LABEL: Record<string, string> = {
  front: "Screen",
  back: "Base",
  left: "Left side",
  right: "Right side",
  top: "Lid",
  detail: "Keyboard",
};

export const short = (hex: string) => `${hex.slice(0, 6)}…${hex.slice(-4)}`;
