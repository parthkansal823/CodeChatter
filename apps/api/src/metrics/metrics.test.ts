/** Verify private metrics access and bounded HTTP labels without starting or changing the shared dev stack. */
import { EventEmitter } from "node:events";
import { once } from "node:events";
import { createServer, type IncomingMessage } from "node:http";
import express, { type Request, type Response } from "express";
import request from "supertest";
import { Server } from "socket.io";
import { beforeEach, describe, expect, it } from "vitest";

import { bindSocketMetrics, httpDuration, httpMetrics, httpRequests, metricsAccess, metricsHandler, metricsRegistry, socketConnections } from "./metrics.js";

const env = { NODE_ENV: "development" as const, METRICS_TOKEN: "fixture-token" };
function peer(address: string, headers: IncomingMessage["headers"] = {}) {
  return { socket: { remoteAddress: address }, headers } as Pick<IncomingMessage, "socket" | "headers">;
}

describe("metrics access", () => {
  it("requires the exact bearer token even from loopback", () => {
    expect(metricsAccess(peer("127.0.0.1"), env)).toBe(401);
    expect(metricsAccess(peer("127.0.0.1", { authorization: "Bearer wrong" }), env)).toBe(401);
    expect(metricsAccess(peer("172.17.0.1", { authorization: "Bearer fixture-token" }), env)).toBe(200);
  });

  it("rejects proxy headers even with a valid token", () => {
    for (const header of ["forwarded", "x-forwarded-for", "x-forwarded-proto", "x-forwarded-host", "x-forwarded-port"]) {
      expect(metricsAccess(peer("127.0.0.1", { authorization: "Bearer fixture-token", [header]: "127.0.0.1" }), env)).toBe(403);
    }
  });

  it("allows only TCP loopback without a token and fails closed in production", () => {
    for (const address of ["127.0.0.1", "::ffff:127.0.0.1", "::1"]) {
      expect(metricsAccess(peer(address), { NODE_ENV: "development" })).toBe(200);
      expect(metricsAccess(peer(address), { NODE_ENV: "production" })).toBe(401);
    }
    expect(metricsAccess(peer("172.17.0.1"), { NODE_ENV: "development" })).toBe(401);
  });
});

describe("Socket.IO metrics", () => {
  it("tracks accepted sockets and disconnects from the actual server namespace", async () => {
    const http = createServer();
    const io = new Server(http);
    bindSocketMetrics(io);
    http.listen(0, "127.0.0.1");
    await once(http, "listening");
    const port = (http.address() as { port: number }).port;
    const client = new WebSocket(`ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`);
    try {
      await new Promise<void>((resolve, reject) => {
        client.addEventListener("error", () => reject(new Error("Fixture websocket failed")), { once: true });
        client.addEventListener("message", (event) => {
          if (String(event.data).startsWith("0")) client.send("40");
          if (String(event.data).startsWith("40")) resolve();
        });
      });
      await metricsRegistry.metrics();
      expect((await socketConnections.get()).values[0]?.value).toBe(1);
      const disconnected = once(io.of("/").sockets.values().next().value!, "disconnect");
      client.close();
      await disconnected;
      await metricsRegistry.metrics();
      expect((await socketConnections.get()).values[0]?.value).toBe(0);
    } finally {
      client.close();
      await new Promise<void>((resolve) => { io.close(() => resolve()); });
    }
  });
});

describe("HTTP metrics", () => {
  beforeEach(() => { httpRequests.reset(); httpDuration.reset(); });

  function app() {
    const app = express();
    app.set("trust proxy", 1);
    app.all("/metrics", metricsHandler(env));
    app.use(httpMetrics);
    app.get("/api/rooms/:id", (_req, res) => { res.sendStatus(200); });
    app.get("/api/broken", (_req, res) => { res.sendStatus(503); });
    app.use((_req, res) => { res.sendStatus(404); });
    return app;
  }

  it("merges different ids and queries into the registered pattern and counts each response once", async () => {
    const server = app();
    await request(server).get("/api/rooms/private-room-one?email=private@example.test").expect(200);
    await request(server).get("/api/rooms/private-room-two").expect(200);
    await request(server).get("/unknown-private-path").expect(404);
    await request(server).get("/api/broken").expect(503);
    const values = (await httpRequests.get()).values;
    expect(values.find((v) => v.labels.route === "/api/rooms/:id")?.value).toBe(2);
    expect(values.find((v) => v.labels.route === "unmatched" && v.labels.status === "404")?.value).toBe(1);
    expect(values.find((v) => v.labels.status === "503")?.value).toBe(1);
    const text = await metricsRegistry.metrics();
    for (const privateValue of ["private-room-one", "private-room-two", "private@example.test", "unknown-private-path"]) expect(text).not.toContain(privateValue);
    expect(text).toContain('le="0.005"');
    expect(text).toContain('le="10"');
    expect(text).toContain("codechatter_process_cpu_seconds_total");
    expect(text).toContain("codechatter_nodejs_heap_size_used_bytes");
  });

  it("serves direct GET/HEAD outside app auth, excludes scrapes, and refuses writes and forwarding", async () => {
    const server = app();
    await request(server).get("/metrics").expect(401);
    const scrape = await request(server).get("/metrics").set("Authorization", "Bearer fixture-token").expect(200);
    expect(scrape.text).toContain("codechatter_socketio_connections");
    expect(scrape.text).not.toContain("fixture-token");
    const head = await request(server).head("/metrics").set("Authorization", "Bearer fixture-token").expect(200);
    expect(head.text).toBeUndefined();
    await request(server).post("/metrics").set("Authorization", "Bearer fixture-token").expect(405);
    await request(server).get("/metrics").set("Authorization", "Bearer fixture-token").set("X-Forwarded-For", "127.0.0.1").expect(403);
    expect((await httpRequests.get()).values).toHaveLength(0);
  });

  it("records an aborted response once without using its URL", async () => {
    const response = Object.assign(new EventEmitter(), { writableFinished: false, statusCode: 200 });
    httpMetrics({ method: "UNBOUNDED-METHOD", route: { path: "/api/slow/:id" }, url: "/api/slow/private" } as Request, response as unknown as Response, () => {});
    response.emit("close");
    response.emit("finish");
    const values = (await httpRequests.get()).values;
    expect(values).toHaveLength(1);
    expect(values[0]).toMatchObject({ value: 1, labels: { method: "OTHER", route: "/api/slow/:id", status: "aborted" } });
  });
});
