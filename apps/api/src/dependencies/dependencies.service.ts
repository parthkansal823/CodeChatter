/** Check package versions against OSV, sharing bounded caches and limiting upstream work across rooms. */
import type { DependencyCheckResponse, DependencyPackage, DependencyResult, DependencySeverity, DependencyVulnerability } from "@codechatter/contracts";
import { BadGatewayException, Injectable } from "@nestjs/common";
import { z } from "zod";

import { cvssBaseScore, scoreSeverity } from "./cvss.js";
import { lowestFixed } from "./versions.js";

const ERROR = "Couldn't reach the vulnerability database (osv.dev). Try again in a minute.";
const TTL = 6 * 60 * 60_000;
const MAX_CACHE = 20_000;
const Id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9:_.-]*$/).max(300);
const Severity = z.object({ type: z.string(), score: z.string() }).passthrough();
const Affected = z.object({
  package: z.object({ ecosystem: z.string(), name: z.string() }).passthrough().optional(),
  severity: z.array(Severity).optional(),
  database_specific: z.record(z.string(), z.unknown()).optional(),
  ranges: z.array(z.object({
    type: z.string(),
    events: z.array(z.object({ fixed: z.string().optional() }).passthrough()).optional(),
  }).passthrough()).optional(),
}).passthrough();
const Advisory = z.object({
  id: Id, aliases: z.array(z.string()).optional(), withdrawn: z.string().optional(),
  summary: z.string().optional(), details: z.string().optional(),
  severity: z.array(Severity).optional(), database_specific: z.record(z.string(), z.unknown()).optional(),
  affected: z.array(Affected).optional(),
}).passthrough();
const Batch = z.object({ results: z.array(z.object({
  vulns: z.array(z.object({ id: Id }).passthrough()).optional(),
  next_page_token: z.string().optional(), error: z.never().optional(),
}).passthrough()) }).passthrough();
type Advisory = z.infer<typeof Advisory>;
type Exact = DependencyPackage & { version: string };
type CacheEntry<T> = { value: T; expires: number };
type Work = { key: string; pkg: Exact; resolve: (ids: string[]) => void; reject: (error: unknown) => void };

/** FIFO slots cap detail requests across simultaneous checks, not just within one room. */
class Slots {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  constructor(private readonly maximum: number) {}
  async run<T>(action: () => Promise<T>): Promise<T> {
    if (this.active >= this.maximum) await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.active++;
    try { return await action(); }
    finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}

const canonicalName = (pkg: DependencyPackage) => pkg.ecosystem === "PyPI" ? pkg.name.toLowerCase().replace(/[-_.]+/g, "-") : pkg.name;
const keyFor = (pkg: DependencyPackage) => JSON.stringify([pkg.ecosystem, canonicalName(pkg), pkg.version]);

function cached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expires <= Date.now()) { cache.delete(key); return undefined; }
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}
function remember<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T) {
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
  cache.set(key, { value, expires: Date.now() + TTL });
}

@Injectable()
export class DependenciesService {
  private readonly batches = new Map<string, CacheEntry<string[]>>();
  private readonly details = new Map<string, CacheEntry<Advisory>>();
  private readonly batchFlight = new Map<string, Promise<string[]>>();
  private readonly detailFlight = new Map<string, Promise<Advisory>>();
  private readonly detailSlots = new Slots(8);
  private readonly batchSlots = new Slots(2);

  async check(packages: DependencyPackage[]): Promise<DependencyCheckResponse> {
    const unchecked = packages.filter((pkg) => pkg.version === null);
    const exact = packages.filter((pkg): pkg is Exact => pkg.version !== null);
    try {
      const owned: Work[] = [];
      const pending = exact.map((pkg) => {
        const key = keyFor(pkg);
        const hit = cached(this.batches, key);
        if (hit !== undefined) return Promise.resolve(hit);
        const inFlight = this.batchFlight.get(key);
        if (inFlight) return inFlight;
        const promise = new Promise<string[]>((resolve, reject) => owned.push({ key, pkg, resolve, reject }));
        this.batchFlight.set(key, promise);
        return promise;
      });
      // Attach rejection handlers before starting any upstream requests.
      const all = Promise.all(pending);
      if (owned.length) void this.fill(owned);
      const matched = await all;
      const ids = [...new Set(matched.flat())];
      const advisories = new Map(await Promise.all(ids.map(async (id) => [id, await this.detail(id)] as const)));
      const results: DependencyResult[] = exact.map((pkg, index) => ({
        ...pkg, vulns: matched[index]!.flatMap((id) => {
          const advisory = advisories.get(id)!;
          return advisory.withdrawn ? [] : [this.result(pkg, advisory)];
        }),
      }));
      return { results, unchecked };
    } catch { throw new BadGatewayException(ERROR); }
  }

  private async fill(owned: Work[]): Promise<void> {
    try {
      for (let start = 0; start < owned.length; start += 1000) {
        const chunk = owned.slice(start, start + 1000);
        const ids = await this.query(chunk.map((work) => work.pkg));
        for (let i = 0; i < chunk.length; i++) {
          const work = chunk[i]!;
          remember(this.batches, work.key, ids[i]!);
          work.resolve(ids[i]!);
        }
      }
    } catch (error) { for (const work of owned) work.reject(error); }
    finally { for (const work of owned) this.batchFlight.delete(work.key); }
  }

  private async query(packages: Exact[]): Promise<string[][]> {
    const found = packages.map(() => new Set<string>());
    let pending = packages.map((pkg, index) => ({ pkg, index, token: "", seen: new Set<string>() }));
    while (pending.length) {
      const response = Batch.parse(await this.batchSlots.run(() => this.request("/v1/querybatch", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ queries: pending.map(({ pkg, token }) => ({
          package: { ecosystem: pkg.ecosystem, name: canonicalName(pkg) }, version: pkg.version,
          ...(token && { page_token: token }),
        })) }),
      })));
      if (response.results.length !== pending.length) throw new Error("OSV returned a mismatched result count.");
      const next: typeof pending = [];
      for (let i = 0; i < pending.length; i++) {
        const item = pending[i]!;
        const result = response.results[i]!;
        for (const vuln of result.vulns ?? []) found[item.index]!.add(vuln.id);
        if (result.next_page_token) {
          if (item.seen.has(result.next_page_token)) throw new Error("OSV repeated a page token.");
          item.seen.add(result.next_page_token);
          next.push({ ...item, token: result.next_page_token });
        }
      }
      pending = next;
    }
    return found.map((ids) => [...ids]);
  }

  private async detail(id: string): Promise<Advisory> {
    const hit = cached(this.details, id);
    if (hit !== undefined) return hit;
    const inFlight = this.detailFlight.get(id);
    if (inFlight) return inFlight;
    const promise = this.detailSlots.run(async () => {
      const advisory = Advisory.parse(await this.request(`/v1/vulns/${encodeURIComponent(id)}`));
      if (advisory.id !== id) throw new Error("OSV returned a different advisory ID.");
      remember(this.details, id, advisory);
      return advisory;
    });
    this.detailFlight.set(id, promise);
    try { return await promise; }
    finally { this.detailFlight.delete(id); }
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetch(`https://api.osv.dev${path}`, {
      ...init, redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { accept: "application/json", ...init.headers },
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error("OSV request failed."); }
    return response.json();
  }

  private result(pkg: Exact, advisory: Advisory): DependencyVulnerability {
    const relevant = (advisory.affected ?? []).filter((affected) => affected.package &&
      affected.package.ecosystem === pkg.ecosystem && canonicalName({ ...pkg, name: affected.package.name }) === canonicalName(pkg));
    const severity = this.severity(advisory, relevant);
    const versions = relevant.flatMap((affected) => (affected.ranges ?? []).filter((range) => range.type !== "GIT")
      .flatMap((range) => (range.events ?? []).flatMap((event) => event.fixed ? [event.fixed] : [])));
    return {
      id: advisory.id, aliases: advisory.aliases ?? [],
      summary: (advisory.summary || advisory.details || "No summary was provided by OSV.").trim().slice(0, 2000),
      severity, fixed: lowestFixed(pkg.ecosystem, versions), url: `https://osv.dev/vulnerability/${encodeURIComponent(advisory.id)}`,
    };
  }

  private severity(advisory: Advisory, relevant: z.infer<typeof Affected>[]): DependencySeverity {
    const names: Record<string, DependencySeverity> = { CRITICAL: "critical", HIGH: "high", MODERATE: "moderate", MEDIUM: "moderate", LOW: "low", UNKNOWN: "unknown" };
    const explicit = [advisory.database_specific?.severity, ...relevant.map((affected) => affected.database_specific?.severity)]
      .filter((value): value is string => typeof value === "string")
      .flatMap((value) => Object.hasOwn(names, value.toUpperCase()) ? [names[value.toUpperCase()]!] : []);
    const order: DependencySeverity[] = ["critical", "high", "moderate", "low", "unknown"];
    if (explicit.length) return explicit.sort((a, b) => order.indexOf(a) - order.indexOf(b))[0]!;
    const scores = [...(advisory.severity ?? []), ...relevant.flatMap((affected) => affected.severity ?? [])]
      .filter((severity) => severity.type === "CVSS_V3")
      .map((severity) => cvssBaseScore(severity.score)).filter((score): score is number => score !== null);
    return scoreSeverity(scores.length ? Math.max(...scores) : null);
  }
}
