/** Compare supported ecosystem version forms without pretending arbitrary labels are semantic versions. */
import type { DependencyEcosystem } from "@codechatter/contracts";

const number = (a: bigint, b: bigint) => a < b ? -1 : a > b ? 1 : 0;
function release(a: bigint[], b: bigint[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const order = number(a[i] ?? 0n, b[i] ?? 0n);
    if (order) return order;
  }
  return 0;
}
function identifiers(a: string[], b: string[], numericHigher: boolean): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined || b[i] === undefined) return a[i] === undefined ? -1 : 1;
    const x = a[i]!;
    const y = b[i]!;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    const order = xn && yn ? number(BigInt(x), BigInt(y)) : xn !== yn ? (xn === numericHigher ? 1 : -1) : x < y ? -1 : x > y ? 1 : 0;
    if (order) return order;
  }
  return 0;
}

function semver(raw: string) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(raw);
  return m ? { release: m.slice(1, 4).map((v) => BigInt(v!)), pre: m[4]?.split(".") } : null;
}

function pep440(raw: string) {
  const m = /^v?(?:(\d+)!)?(\d+(?:\.\d+)*)(?:[._-]?(a|b|rc|alpha|beta|c|pre|preview)[._-]?(\d+)?)?(?:[._-]?(post|rev|r)[._-]?(\d+)?)?(?:[._-]?(dev)[._-]?(\d+)?)?(?:\+([a-z0-9]+(?:[._-][a-z0-9]+)*))?$/i.exec(raw);
  if (!m) return null;
  const pre = m[3]?.toLowerCase();
  return {
    epoch: BigInt(m[1] ?? 0), release: m[2]!.split(".").map(BigInt),
    stage: pre ? ["a", "alpha"].includes(pre) ? 0 : ["b", "beta"].includes(pre) ? 1 : 2 : m[7] && !m[5] ? -1 : 3,
    pre: BigInt(m[4] ?? 0), post: m[5] ? BigInt(m[6] ?? 0) : -1n,
    dev: m[7] ? BigInt(m[8] ?? 0) : null, local: m[9]?.toLowerCase().split(/[._-]/),
  };
}

function qualified(raw: string, ecosystem: "Maven" | "Packagist") {
  const m = /^(?:v)?(\d+(?:\.\d+)*)(?:[-.]?([a-z]+)(?:[-.]?(\d+))?)?$/i.exec(raw);
  if (!m) return null;
  const label = (m[2] ?? "").toLowerCase();
  const order: Record<string, number> = ecosystem === "Maven"
    ? { alpha: 0, a: 0, beta: 1, b: 1, milestone: 2, m: 2, rc: 3, cr: 3, snapshot: 4, "": 5, ga: 5, final: 5, release: 5, sp: 6 }
    : { dev: -1, alpha: 0, a: 0, beta: 1, b: 1, rc: 2, "": 3, stable: 3, pl: 4, p: 4 };
  if (!Object.hasOwn(order, label)) return null;
  return { release: m[1]!.split(".").map(BigInt), stage: order[label]!, qualifier: BigInt(m[3] ?? 0) };
}

/** Null means these versions need a package-manager-specific comparator we do not implement. */
export function compareVersions(ecosystem: DependencyEcosystem, a: string, b: string): number | null {
  if (a === b) return 0;
  if (ecosystem === "PyPI") {
    const x = pep440(a); const y = pep440(b);
    if (!x || !y) return null;
    const order = number(x.epoch, y.epoch) || release(x.release, y.release) || x.stage - y.stage || number(x.pre, y.pre) || number(x.post, y.post);
    if (order) return Math.sign(order);
    if (x.dev !== y.dev) return x.dev === null ? 1 : y.dev === null ? -1 : number(x.dev, y.dev);
    if (!x.local || !y.local) return x.local ? 1 : y.local ? -1 : 0;
    return identifiers(x.local, y.local, true);
  }
  if (ecosystem === "Maven" || ecosystem === "Packagist") {
    const x = qualified(a, ecosystem); const y = qualified(b, ecosystem);
    return x && y ? Math.sign(release(x.release, y.release) || x.stage - y.stage || number(x.qualifier, y.qualifier)) : null;
  }
  const x = semver(a); const y = semver(b);
  if (!x || !y) return null;
  const order = release(x.release, y.release);
  if (order) return order;
  if (!x.pre || !y.pre) return x.pre ? -1 : y.pre ? 1 : 0;
  return identifiers(x.pre, y.pre, false);
}

export function lowestFixed(ecosystem: DependencyEcosystem, versions: string[]): string | null {
  const unique = [...new Set(versions)];
  if (!unique.length) return null;
  let lowest = unique[0]!;
  for (const next of unique.slice(1)) {
    const order = compareVersions(ecosystem, next, lowest);
    if (order === null) return null;
    if (order < 0) lowest = next;
  }
  return lowest;
}
