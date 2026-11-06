/** Private API metrics use bounded route labels and the TCP peer for access checks, independently of application auth. */
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { RequestHandler } from "express";
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "prom-client";
import type { Server } from "socket.io";

import type { Env } from "../config/env.js";

export const metricsRegistry = new Registry();
metricsRegistry.setDefaultLabels({ service: "api" });
collectDefaultMetrics({ register: metricsRegistry, prefix: "codechatter_" });

export const httpRequests = new Counter({
  name: "codechatter_http_requests_total",
  help: "Completed API HTTP requests by matched route pattern; unmatched middleware uses a fixed label.",
  labelNames: ["method", "route", "status"] as const,
  registers: [metricsRegistry],
});
export const httpDuration = new Histogram({
  name: "codechatter_http_request_duration_seconds",
  help: "Time until an HTTP response finishes or its connection closes, excluding metrics scrapes.",
  labelNames: ["method", "route"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

let socketServer: Server | undefined;
export const socketConnections = new Gauge({
  name: "codechatter_socketio_connections",
  help: "Accepted Socket.IO connections in this API process's default namespace.",
  registers: [metricsRegistry],
  collect() { this.set(socketServer?.of("/").sockets.size ?? 0); },
});
export const chatMessages = new Counter({
  name: "codechatter_chat_messages_total",
  help: "Accepted Socket.IO chat sends after persistence, including accepted idempotent retries.",
  registers: [metricsRegistry],
});

export function bindSocketMetrics(server: Server): void { socketServer = server; }

/** A proxy must not expose this handler, even if the caller knows the metrics token. */
export function metricsAccess(
  request: Pick<IncomingMessage, "headers" | "socket">,
  env: Pick<Env, "METRICS_TOKEN" | "NODE_ENV">,
): 200 | 401 | 403 {
  if (Object.keys(request.headers).some((name) => name.toLowerCase() === "forwarded" || name.toLowerCase().startsWith("x-forwarded-"))) return 403;
  if (env.METRICS_TOKEN) {
    const actual = Buffer.from(request.headers.authorization ?? "");
    const expected = Buffer.from(`Bearer ${env.METRICS_TOKEN}`);
    return actual.length === expected.length && timingSafeEqual(actual, expected) ? 200 : 401;
  }
  if (env.NODE_ENV === "production") return 401;
  return ["127.0.0.1", "::ffff:127.0.0.1", "::1"].includes(request.socket.remoteAddress ?? "") ? 200 : 401;
}

export function metricsHandler(env: Pick<Env, "METRICS_TOKEN" | "NODE_ENV">): RequestHandler {
  return async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const access = metricsAccess(request, env);
    if (access !== 200) {
      if (access === 401) response.setHeader("WWW-Authenticate", "Bearer");
      response.status(access).type("text/plain").send("Metrics access is not authorised.\n");
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      response.status(405).type("text/plain").send("Use GET or HEAD for metrics.\n");
      return;
    }
    try {
      const body = await metricsRegistry.metrics();
      response.setHeader("Content-Type", metricsRegistry.contentType);
      response.status(200).end(request.method === "HEAD" ? undefined : body);
    } catch {
      response.status(500).type("text/plain").send("Metrics are unavailable.\n");
    }
  };
}

const methods = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "CONNECT", "TRACE"]);

/** Read the matched pattern after routing; neither the URL nor resolved baseUrl is a label. */
export const httpMetrics: RequestHandler = (request, response, next) => {
  const started = process.hrtime.bigint();
  let recorded = false;
  const record = () => {
    if (recorded) return;
    recorded = true;
    const method = methods.has(request.method) ? request.method : "OTHER";
    const route = typeof request.route?.path === "string" ? request.route.path : "unmatched";
    const status = response.writableFinished ? String(response.statusCode) : "aborted";
    httpRequests.inc({ method, route, status });
    httpDuration.observe({ method, route }, Number(process.hrtime.bigint() - started) / 1e9);
  };
  response.once("finish", record);
  response.once("close", record);
  next();
};
