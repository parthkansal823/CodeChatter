/** Read existing API/runner checks and exact Prometheus gauges through bounded private requests, returning no service credentials or room contents. */
import type { AdminHealth } from "@codechatter/contracts";
import type { DbHandle } from "@codechatter/db";
import { Inject, Injectable } from "@nestjs/common";
import type { Redis } from "ioredis";

import type { Env } from "../config/env.js";
import { DB, ENV, VALKEY } from "../infra/tokens.js";

type Check = AdminHealth["checks"][number];

/** These current gauges are unlabelled; never interpret missing/NaN as zero. */
export function readPrometheusGauge(text: string, name: string): number | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`^${escaped}\\s+([^\\s]+)(?:\\s+[^\\s]+)?\\s*$`, "m"));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export async function deadline<T>(operation: Promise<T>, ms = 3_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("ProbeTimeout")), ms); })]); }
  finally { clearTimeout(timer); }
}

async function responseText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "", bytes = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) return text + decoder.decode();
    bytes += part.value.byteLength;
    if (bytes > 2_000_000) { await reader.cancel(); throw new Error("ProbeTooLarge"); }
    text += decoder.decode(part.value, { stream: true });
  }
}

@Injectable()
export class AdminHealthService {
  constructor(@Inject(DB) private readonly handle: DbHandle, @Inject(VALKEY) private readonly redis: Redis, @Inject(ENV) private readonly env: Env) {}

  private check(id: string, label: string, status: Check["status"], detail: string | null = null, value: number | null = null): Check {
    return { id, label, status, checkedAt: new Date().toISOString(), detail, value };
  }

  private async probe(id: string, label: string, operation: () => Promise<unknown>): Promise<Check> {
    try { await deadline(operation()); return this.check(id, label, "up"); }
    catch { return this.check(id, label, "down", "The check did not complete successfully."); }
  }

  private async metrics(base: string | undefined, definitions: Array<[string, string, string]>): Promise<Check[]> {
    if (!base) return definitions.map(([id, label]) => this.check(id, label, "unknown", "The service metrics address is not configured."));
    try {
      const response = await fetch(new URL("/metrics", base), { headers: this.env.METRICS_TOKEN ? { authorization: `Bearer ${this.env.METRICS_TOKEN}` } : {}, signal: AbortSignal.timeout(3_000), redirect: "error" });
      if (!response.ok) return definitions.map(([id, label]) => this.check(id, label, "unknown", "Metrics could not be read."));
      const body = await responseText(response);
      return definitions.map(([id, label, metric]) => {
        const value = readPrometheusGauge(body, metric);
        return this.check(id, label, value === null ? "unknown" : "up", value === null ? "No current value was exposed." : "Reported by this service instance.", value);
      });
    } catch { return definitions.map(([id, label]) => this.check(id, label, "down", "The metrics endpoint could not be reached.")); }
  }

  private async runner(): Promise<Check> {
    try {
      const response = await fetch(new URL("/healthz", this.env.RUNNER_URL), { signal: AbortSignal.timeout(3_000), redirect: "error" });
      const body = JSON.parse(await responseText(response)) as { driver?: unknown };
      const driver = body.driver === "docker" || body.driver === "kubernetes" ? body.driver : "unknown";
      return this.check("runner", "Runner", response.ok ? "up" : "down", `Driver: ${driver}`);
    } catch { return this.check("runner", "Runner", "down", "The runner health check could not be reached."); }
  }

  async read(): Promise<AdminHealth> {
    // COLLAB_INTERNAL_URL already exists in the runner configuration. Operators
    // may supply it to the API too; never invent a production service hostname.
    const collab = process.env.COLLAB_INTERNAL_URL || (this.env.NODE_ENV !== "production" ? "http://127.0.0.1:4100" : undefined);
    const [database, valkey, runner, runnerMetrics, collabMetrics] = await Promise.all([
      this.probe("database", "Database", () => this.handle.sql`select 1`),
      this.probe("valkey", "Valkey", () => this.redis.ping()),
      this.runner(),
      this.metrics(this.env.RUNNER_URL, [["sandboxes", "Sandboxes running", "codechatter_runner_sandboxes"]]),
      this.metrics(collab, [["documents", "Documents open", "codechatter_collab_documents_loaded"], ["connections", "Live connections", "codechatter_collab_connections"]]),
    ]);
    return { checkedAt: new Date().toISOString(), checks: [this.check("api", "API", "up", "Serving this request."), database, valkey, runner, ...runnerMetrics, ...collabMetrics] };
  }
}
