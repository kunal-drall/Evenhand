// R16 replay: re-derive a verdict's decision from its 0G Storage InspectionLog alone.
import type { InspectionLog } from "@evenhand/shared";
import { RUBRIC_V1_SHA256 } from "../zg/rubric.js";
import { RULES_VERSION, decide, parseVerdict, type Decision } from "./rules.js";

export type ReplayResult = {
  decision: Decision;
  /** Route, severity and confidence equal the logged decision. */
  matches: boolean;
  checks: { rubric: boolean; rules: boolean };
  note?: string;
};

const same = (a: Decision, b: InspectionLog["decision"]) =>
  a.route === b.route && a.confidenceBps === b.confidenceBps && a.severity.join(",") === b.severity.join(",");

/** Re-applies RULES_V1 to the logged model outputs (every pass, in order). Deterministic: no network. */
export function replay(log: InspectionLog): ReplayResult {
  const checks = { rubric: log.rubricSha256 === RUBRIC_V1_SHA256, rules: log.rulesVersion === RULES_VERSION };
  const passes = log.passes?.length
    ? log.passes
    : log.requestId !== "none"
      ? [{ model: log.model, requestId: log.requestId, rawOutput: log.rawOutput }]
      : [];
  if (!passes.length) {
    return { decision: log.decision, matches: true, checks, note: "no model call was made (cost cap), so there is nothing to replay" };
  }
  const [first, second] = passes.map((p) => parseVerdict(p.rawOutput, log.rentalId));
  const decision = decide(first ?? null, passes.length > 1 ? (second ?? null) : undefined);
  return { decision, matches: same(decision, log.decision), checks };
}
