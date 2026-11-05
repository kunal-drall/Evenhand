// RULES_V1 (docs/interfaces.md section 8, "Decision rules"). Pure functions: no I/O.
import { ModelVerdict } from "@evenhand/shared";

export const RULES_VERSION = "RULES_V1";
export const MIN_CONFIDENCE = 0.75;

export type Decision = {
  route: "auto" | "needs_human";
  severity: number[];
  confidenceBps: number;
  reason?: string;
};

type Judgement = { route: "auto" } | { route: "low_confidence" } | { route: "needs_human"; reason: string };

/** Model output to a verdict, or null on bad JSON, schema failure or another rental's ID. */
export function parseVerdict(raw: string, rentalId: string): ModelVerdict | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = ModelVerdict.safeParse(json);
  if (!parsed.success) return null;
  return parsed.data.rental_id.toLowerCase() === rentalId.toLowerCase() ? parsed.data : null;
}

export function judge(v: ModelVerdict): Judgement {
  const unusable = v.angles.filter((a) => !a.usable).map((a) => a.angle);
  if (unusable.length) return { route: "needs_human", reason: `unusable angle: ${unusable.join(", ")}` };
  if (v.text_in_image_ignored) return { route: "needs_human", reason: "text seen in an image" };
  if (v.overall_confidence < MIN_CONFIDENCE) return { route: "low_confidence" };
  return { route: "auto" };
}

/** A second pass on a stronger model is run only for a first pass that is merely low-confidence. */
export function wantsSecondPass(first: ModelVerdict | null): boolean {
  return first !== null && judge(first).route === "low_confidence";
}

const toBps = (confidence: number) => Math.round(confidence * 10_000);
const from = (v: ModelVerdict, route: Decision["route"], reason?: string): Decision => ({
  route,
  severity: v.angles.map((a) => a.severity),
  confidenceBps: toBps(v.overall_confidence),
  ...(reason ? { reason } : {}),
});

/**
 * @param first  first-pass verdict; null if its output failed the schema twice
 * @param second second-pass verdict; undefined if no second pass ran, null if it failed the schema twice
 */
export function decide(first: ModelVerdict | null, second?: ModelVerdict | null): Decision {
  if (!first) return { route: "needs_human", severity: [0, 0, 0, 0, 0, 0], confidenceBps: 0, reason: "model output failed the schema twice" };
  const j1 = judge(first);
  if (j1.route === "auto") return from(first, "auto");
  if (j1.route === "needs_human") return from(first, "needs_human", j1.reason);
  if (second === undefined) return from(first, "needs_human", `overall_confidence below ${MIN_CONFIDENCE}, no stronger model`);
  if (second === null) return from(first, "needs_human", "second-pass output failed the schema twice");
  const j2 = judge(second);
  if (j2.route === "auto") return from(second, "auto");
  return from(second, "needs_human", j2.route === "needs_human" ? j2.reason : `overall_confidence below ${MIN_CONFIDENCE} on the second pass`);
}

/** Mirrors the contract: deposit * scheduleBps[max(severity)] / 10_000. */
export function captureFor(deposit: bigint, scheduleBps: readonly number[], severity: readonly number[]): bigint {
  const worst = Math.max(0, ...severity);
  return (deposit * BigInt(scheduleBps[worst] ?? 0)) / 10_000n;
}

/** Canonical "eh" field the contract rebuilds in P1 TEE mode. */
export function ehString(rentalId: string, severity: readonly number[], confidenceBps: number): string {
  return `EH1;${rentalId.toLowerCase()};${severity.join(",")};${confidenceBps}`;
}
