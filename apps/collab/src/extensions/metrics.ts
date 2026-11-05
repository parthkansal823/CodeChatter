/** Expose private Prometheus metrics for the collab process without labelling room or document names. */
import type { Extension, Hocuspocus } from "@hocuspocus/server";
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "prom-client";

import type { Env } from "../env.js";

export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry, prefix: "codechatter_" });

let currentInstance: Hocuspocus | null = null;

export const collabConnections = new Gauge({
  name: "codechatter_collab_connections",
  help: "Active collab sockets, deduplicated across documents, plus direct connections.",
  registers: [metricsRegistry],
  collect() { this.set(currentInstance?.getConnectionsCount() ?? 0); },
});
export const collabDocumentsLoaded = new Gauge({
  name: "codechatter_collab_documents_loaded",
  help: "Fully loaded documents currently held by this collab process.",
  registers: [metricsRegistry],
  collect() { this.set(currentInstance?.getDocumentsCount() ?? 0); },
});
export const collabUpdatesTotal = new Counter({
  name: "codechatter_collab_updates_total",
  help: "Yjs updates applied by this process, including updates received from other replicas.",
  registers: [metricsRegistry],
});
export const collabUpdateBytesTotal = new Counter({
  name: "codechatter_collab_update_bytes_total",
  help: "Bytes in Yjs updates applied by this process, including replica updates.",
  registers: [metricsRegistry],
});
export const collabStoreDurationSeconds = new Histogram({
  name: "codechatter_collab_store_duration_seconds",
  help: "Time in successful onStoreDocument hook chains, including Redis and persistence work.",
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

/** Direct scrapes only: Caddy adds forwarding headers when proxying /collab/metrics. */
export function hasForwardingHeaders(request: IncomingMessage): boolean {
  return Object.keys(request.headers).some((name) => {
    const lower = name.toLowerCase();
    return lower === "forwarded" || lower.startsWith("x-forwarded-");
  });
}

/** A configured token is always required; only development may fall back to the TCP loopback peer. */
export function authorizeMetrics(request: IncomingMessage, token: string, nodeEnv: string): boolean {
  if (hasForwardingHeaders(request)) return false;
  if (token) {
    const supplied = Buffer.from(request.headers.authorization ?? "", "utf8");
    const expected = Buffer.from(`Bearer ${token}`, "utf8");
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }
  if (nodeEnv === "production") return false;
  return ["127.0.0.1", "::ffff:127.0.0.1", "::1"].includes(request.socket.remoteAddress ?? "");
}

/** Hocuspocus runs high-priority store hooks first and afterStoreDocument only after a successful chain. */
export function metricsExtension(env: Pick<Env, "METRICS_TOKEN" | "NODE_ENV">): Extension {
  const stores = new WeakMap<object, () => number>();
  return {
    extensionName: "prometheus-metrics",
    // Redis uses priority 1000; start before its lock acquisition and persistence hooks.
    priority: 2000,

    async onConfigure({ instance }) { currentInstance = instance; },

    async onChange({ update }) {
      collabUpdatesTotal.inc();
      collabUpdateBytesTotal.inc(update.byteLength);
    },

    async onStoreDocument({ document }) {
      stores.set(document, collabStoreDurationSeconds.startTimer());
    },

    async afterStoreDocument({ document }) {
      const finish = stores.get(document);
      if (!finish) return;
      finish();
      stores.delete(document);
      // Failed/skipped chains never reach this hook and are deliberately not latency samples.
    },

    async onRequest({ request, response, instance }) {
      if (request.url?.split("?", 1)[0] !== "/metrics") return;
      response.setHeader("Cache-Control", "no-store");
      if (hasForwardingHeaders(request)) {
        response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Metrics are available only on the direct service port.\n");
      } else if (!authorizeMetrics(request, env.METRICS_TOKEN, env.NODE_ENV)) {
        response.writeHead(401, { "Content-Type": "text/plain; charset=utf-8", "WWW-Authenticate": "Bearer" });
        response.end("Metrics access is not authorised.\n");
      } else if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { "Content-Type": "text/plain; charset=utf-8", Allow: "GET, HEAD" });
        response.end("Use GET or HEAD for metrics.\n");
      } else {
        currentInstance = instance;
        try {
          const body = await metricsRegistry.metrics();
          response.writeHead(200, { "Content-Type": metricsRegistry.contentType });
          response.end(request.method === "HEAD" ? undefined : body);
        } catch {
          response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
          response.end("Metrics are unavailable.\n");
        }
      }
      // Hocuspocus 4 expects an empty rejection after a response was handled.
      // Resolving here would make its default HTTP handler write a second response.
      return Promise.reject();
    },

    async onDestroy() { currentInstance = null; },
  };
}
