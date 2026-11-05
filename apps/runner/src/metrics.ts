/** Private runner metrics count completed Run executions and current sandbox/terminal resources without user labels. */
import { runnableLanguage, type RunExit } from "@codechatter/contracts";
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "prom-client";

import type { Env } from "./env.js";
import { LANGUAGES } from "./plans.js";

export const registry = new Registry();
registry.setDefaultLabels({ service: "runner" });
collectDefaultMetrics({ register: registry, prefix: "codechatter_" });

export const runsTotal = new Counter({
  name: "codechatter_runner_runs_total", help: "Completed started Run executions, by supported language and final outcome.",
  labelNames: ["language", "outcome"] as const, registers: [registry],
});
export const runDuration = new Histogram({
  name: "codechatter_runner_run_duration_seconds", help: "Execution duration of started Runs, excluding preparation and sandbox startup.",
  labelNames: ["language"] as const, buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 300, 1800], registers: [registry],
});

let collectors = { sandboxes: async () => Number.NaN, terminals: () => 0 };
let sandboxRead: Promise<number> | null = null;

export const sandboxes = new Gauge({
  name: "codechatter_runner_sandboxes", help: "Running room sandbox containers, excluding database, egress and warm-cache containers; NaN if unavailable.", registers: [registry],
  async collect() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Share a slow inventory request between scrapes instead of piling up Docker calls.
    sandboxRead ??= Promise.resolve().then(() => collectors.sandboxes()).finally(() => { sandboxRead = null; });
    try {
      this.set(await Promise.race([sandboxRead, new Promise<number>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Sandbox inventory timed out")), 5000);
        timer.unref();
      })]));
    } catch { this.set(Number.NaN); }
    finally { clearTimeout(timer); }
  },
});
export const terminals = new Gauge({
  name: "codechatter_runner_terminals", help: "Attached terminal WebSocket clients, including startup; detached tmux shells are not counted.", registers: [registry],
  collect() { this.set(collectors.terminals()); },
});

export function configureRunnerCollectors(next: typeof collectors): void { collectors = next; }

/** The caller supplies a file path only to select a bounded language label; the path is never exposed. */
export function recordRun(path: string, exit: Pick<RunExit, "code" | "reason" | "durationMs">): void {
  const found = runnableLanguage(path)?.language;
  const language = found && LANGUAGES.includes(found) ? found : "unknown";
  const outcome = exit.reason === "exit" ? exit.code === 0 ? "success" : "error"
    : ["error", "timeout", "stopped", "output-limit", "reset"].includes(exit.reason) ? exit.reason : "error";
  runsTotal.inc({ language, outcome });
  runDuration.observe({ language }, Math.max(0, exit.durationMs) / 1000);
}

/** Socket addresses are authoritative; proxy headers cannot turn a public proxy into a metrics ingress. */
export function metricsAccess(req: Pick<IncomingMessage, "headers" | "socket">, env: Pick<Env, "NODE_ENV" | "METRICS_TOKEN">): 200 | 401 | 403 {
  if (["forwarded", "x-forwarded-for", "x-forwarded-proto", "x-forwarded-host"].some((name) => Object.hasOwn(req.headers, name))) return 403;
  const token = env.METRICS_TOKEN;
  if (token) {
    const header = req.headers.authorization;
    if (typeof header !== "string") return 401;
    const actual = Buffer.from(header);
    const expected = Buffer.from(`Bearer ${token}`);
    return actual.length === expected.length && timingSafeEqual(actual, expected) ? 200 : 401;
  }
  if (env.NODE_ENV === "production") return 401;
  return ["127.0.0.1", "::ffff:127.0.0.1", "::1"].includes(req.socket.remoteAddress ?? "") ? 200 : 401;
}

export async function serveMetrics(req: IncomingMessage, res: ServerResponse, env: Pick<Env, "NODE_ENV" | "METRICS_TOKEN">): Promise<void> {
  const access = metricsAccess(req, env);
  res.setHeader("Cache-Control", "no-store");
  if (access !== 200) { res.writeHead(access, { "Content-Type": "text/plain; charset=utf-8" }); res.end("Not allowed.\n"); return; }
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { Allow: "GET, HEAD" }); res.end(); return; }
  try {
    const body = req.method === "HEAD" ? "" : await registry.metrics();
    res.writeHead(200, { "Content-Type": registry.contentType });
    res.end(body);
  } catch { res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }); res.end("Runner metrics could not be collected.\n"); }
}
