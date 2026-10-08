import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

import { encodeBody } from "./response-body.js";
import { transport, TransportError, type TransportRequest } from "./transport.js";

let server: Server | null = null;

async function serve(handler: RequestListener): Promise<number> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

afterEach(async () => {
  server?.closeAllConnections();
  await new Promise((resolve) => server?.close(resolve) ?? resolve(null));
  server = null;
});

const base = (url: string, patch: Partial<TransportRequest> = {}): TransportRequest => ({
  url: new URL(url),
  method: "GET",
  headers: {},
  body: null,
  timeoutMs: 5000,
  maxBytes: 1024 * 1024,
  ...patch,
});

describe("transport", () => {
  it("connects to the pinned address while keeping the name in Host", async () => {
    let host: string | undefined;
    const port = await serve((req, res) => {
      host = req.headers.host;
      res.end("pinned");
    });
    const response = await transport(base(`http://api.example.test:${port}/x`, { address: { address: "127.0.0.1", family: 4 } }));
    expect(host).toBe(`api.example.test:${port}`);
    expect(response.body.toString()).toBe("pinned");
  });

  it("sends the body with its length and returns raw headers in order", async () => {
    const port = await serve((req, res) => {
      let received = "";
      req.on("data", (c: Buffer) => (received += c.toString()));
      req.on("end", () => {
        res.setHeader("X-Echo-Length", String(req.headers["content-length"]));
        res.setHeader("Set-Cookie", ["a=1", "b=2"]);
        res.end(received);
      });
    });
    const response = await transport(base(`http://127.0.0.1:${port}/`, { method: "POST", body: Buffer.from("héllo") }));
    expect(response.body.toString()).toBe("héllo");
    expect(response.headers).toContainEqual(["X-Echo-Length", "6"]);
    expect(response.headers.filter(([n]) => n === "Set-Cookie")).toEqual([
      ["Set-Cookie", "a=1"],
      ["Set-Cookie", "b=2"],
    ]);
  });

  it("never follows redirects", async () => {
    const port = await serve((_req, res) => {
      res.writeHead(302, { Location: "http://169.254.169.254/" });
      res.end();
    });
    const response = await transport(base(`http://127.0.0.1:${port}/`));
    expect(response.status).toBe(302);
    expect(response.headers).toContainEqual(["Location", "http://169.254.169.254/"]);
  });

  it("cuts the body at the cap", async () => {
    const port = await serve((_req, res) => res.end("x".repeat(10_000)));
    const response = await transport(base(`http://127.0.0.1:${port}/`, { maxBytes: 4096 }));
    expect(response.truncated).toBe(true);
    expect(response.body.length).toBe(4096);
  });

  it("applies the cap after decompression", async () => {
    const port = await serve((_req, res) => {
      res.writeHead(200, { "Content-Encoding": "gzip" });
      res.end(gzipSync(Buffer.alloc(200_000, "a")));
    });
    const response = await transport(base(`http://127.0.0.1:${port}/`, { maxBytes: 10_000 }));
    expect(response.truncated).toBe(true);
    expect(response.body.toString()).toBe("a".repeat(10_000));
  });

  it("gives up after the timeout", async () => {
    const port = await serve(() => {
      // Never answers.
    });
    await expect(transport(base(`http://127.0.0.1:${port}/`, { timeoutMs: 150 }))).rejects.toMatchObject({ code: "timeout" });
  });

  it("explains a refused connection", async () => {
    const port = await serve(() => {});
    await new Promise((resolve) => server!.close(resolve));
    server = null;
    const error = await transport(base(`http://127.0.0.1:${port}/`)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransportError);
    expect(error).toMatchObject({ code: "refused" });
  });
});

describe("encodeBody", () => {
  it("keeps text as text", () => {
    expect(encodeBody(Buffer.from('{"a":1}'), "application/json; charset=utf-8")).toEqual({ body: '{"a":1}', bodyEncoding: "text" });
    expect(encodeBody(Buffer.from("<p>hi</p>"), "")).toEqual({ body: "<p>hi</p>", bodyEncoding: "text" });
    expect(encodeBody(Buffer.from([0x63, 0x61, 0x66, 0xe9]), "text/plain; charset=iso-8859-1")).toEqual({ body: "café", bodyEncoding: "text" });
  });

  it("sends binary as base64", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(encodeBody(png, "image/png")).toEqual({ body: png.toString("base64"), bodyEncoding: "base64" });
    expect(encodeBody(Buffer.from([0x00, 0xff, 0x10]), "")).toMatchObject({ bodyEncoding: "base64" });
    expect(encodeBody(Buffer.from("plain"), "application/octet-stream")).toMatchObject({ bodyEncoding: "base64" });
  });
});
