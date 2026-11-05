/** Calculate CVSS v3 base scores locally so OSV vectors need no scoring dependency. */
import type { DependencySeverity } from "@codechatter/contracts";

const WEIGHTS: Record<string, Record<string, number>> = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }, AC: { L: 0.77, H: 0.44 },
  UI: { N: 0.85, R: 0.62 }, C: { H: 0.56, L: 0.22, N: 0 },
  I: { H: 0.56, L: 0.22, N: 0 }, A: { H: 0.56, L: 0.22, N: 0 },
};
const OPTIONAL = new Set(["E", "RL", "RC", "CR", "IR", "AR", "MAV", "MAC", "MPR", "MUI", "MS", "MC", "MI", "MA"]);

/** Return null for malformed base vectors; temporal metrics do not change the base score. */
export function cvssBaseScore(vector: string): number | null {
  const parts = vector.split("/");
  const version = parts.shift();
  if (version !== "CVSS:3.1" && version !== "CVSS:3.0") return null;
  const metrics: Record<string, string> = {};
  for (const part of parts) {
    const match = /^([A-Z]{1,3}):([A-Z])$/.exec(part);
    if (!match) return null;
    const key = match[1]!;
    if (Object.hasOwn(metrics, key)) return null;
    if (!Object.hasOwn(WEIGHTS, key) && key !== "PR" && key !== "S" && !OPTIONAL.has(key)) return null;
    metrics[key] = match[2]!;
  }
  if (!["U", "C"].includes(metrics.S ?? "") || !["N", "L", "H"].includes(metrics.PR ?? "")) return null;
  const values: Record<string, number> = {};
  for (const [name, weights] of Object.entries(WEIGHTS)) {
    const value = weights[metrics[name] ?? ""];
    if (value === undefined) return null;
    values[name] = value;
  }
  const changed = metrics.S === "C";
  const pr = metrics.PR === "N" ? 0.85 : metrics.PR === "L" ? (changed ? 0.68 : 0.62) : (changed ? 0.5 : 0.27);
  const iss = 1 - (1 - values.C!) * (1 - values.I!) * (1 - values.A!);
  const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15 : 6.42 * iss;
  if (impact <= 0) return 0;
  const exploitability = 8.22 * values.AV! * values.AC! * pr * values.UI!;
  const score = Math.min(changed ? 1.08 * (impact + exploitability) : impact + exploitability, 10);
  // FIRST's five-decimal integer method avoids floating-point ceil surprises.
  const integer = Math.round(score * 100_000);
  return integer % 10_000 === 0 ? integer / 100_000 : (Math.floor(integer / 10_000) + 1) / 10;
}

export function scoreSeverity(score: number | null): DependencySeverity {
  if (score === null || !Number.isFinite(score) || score < 0 || score > 10) return "unknown";
  return score >= 9 ? "critical" : score >= 7 ? "high" : score >= 4 ? "moderate" : "low";
}
