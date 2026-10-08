import type { HttpSendErrorCode } from "@codechatter/contracts";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { performance } from "node:perf_hooks";
import type { Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

export class TransportError extends Error {
  constructor(
    readonly code: HttpSendErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type TransportRequest = {
  url: URL;
  method: string;
  headers: Record<string, string | string[]>;
  body: Buffer | null;
  /** Pins the connection to an address that was already vetted. */
  address?: { address: string; family: 4 | 6 };
  timeoutMs: number;
  maxBytes: number;
};

export type TransportResponse = {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  body: Buffer;
  truncated: boolean;
  firstByteMs: number;
  totalMs: number;
};

/** Answer every DNS question for this connection with the vetted address. */
function pinnedLookup(address: string, family: 4 | 6): LookupFunction {
  return (_hostname, options, callback) => (options.all ? callback(null, [{ address, family }]) : callback(null, address, family));
}

function decoder(encoding: string | undefined): NodeJS.ReadWriteStream | null {
  switch (encoding?.trim().toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return createGunzip();
    case "deflate":
      return createInflate();
    case "br":
      return createBrotliDecompress();
    default:
      return null;
  }
}

function describe(error: NodeJS.ErrnoException, url: URL, timeoutMs: number): TransportError {
  const where = `${url.hostname}:${url.port || (url.protocol === "https:" ? 443 : 80)}`;
  const code = error.code ?? "";
  if (error instanceof TransportError) return error;
  if (code === "ECONNREFUSED") return new TransportError("refused", `${where} refused the connection. Is the server running?`);
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return new TransportError("dns", `Couldn't find ${url.hostname}. Check the host name.`);
  if (code === "ETIMEDOUT") return new TransportError("timeout", `No response from ${where} within ${timeoutMs / 1000} seconds.`);
  if (code === "EHOSTUNREACH" || code === "ENETUNREACH") return new TransportError("network", `${where} isn't reachable from the server.`);
  if (code === "ECONNRESET" || code === "EPIPE") return new TransportError("network", `${where} closed the connection before answering.`);
  if (/^(ERR_TLS|ERR_SSL|CERT_|UNABLE_TO|DEPTH_ZERO|SELF_SIGNED|ERR_OSSL)/.test(code) || /certificate|SSL|TLS/i.test(error.message)) {
    return new TransportError("tls", `The secure connection to ${where} failed: ${error.message}`);
  }
  if (code.startsWith("HPE_")) return new TransportError("network", `${where} sent a response that isn't valid HTTP.`);
  return new TransportError("network", `The request failed: ${error.message}`);
}

/**
 * One HTTP exchange with hard limits: a single timeout for the whole
 * exchange, a response cap (applied after decompression, so a small gzip
 * can't expand past it), no redirects, and a fresh connection every time.
 */
export function transport(req: TransportRequest): Promise<TransportResponse> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (result: TransportResponse | TransportError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (result instanceof TransportError) reject(result);
      else resolve(result);
    };

    const send = req.url.protocol === "https:" ? httpsRequest : httpRequest;
    const outgoing = send(req.url, {
      method: req.method,
      headers: req.body ? { ...req.headers, "Content-Length": String(req.body.length) } : req.headers,
      agent: false,
      ...(req.address && { lookup: pinnedLookup(req.address.address, req.address.family) }),
    });

    const timer = setTimeout(() => {
      finish(new TransportError("timeout", `No response within ${req.timeoutMs / 1000} seconds.`));
      outgoing.destroy();
    }, req.timeoutMs);

    outgoing.on("error", (error: NodeJS.ErrnoException) => finish(describe(error, req.url, req.timeoutMs)));

    outgoing.on("response", (res: IncomingMessage) => {
      const firstByteMs = elapsed();
      const unzip = req.method === "HEAD" ? null : decoder(res.headers["content-encoding"]);
      const stream: Readable = unzip ? (res.pipe(unzip) as unknown as Readable) : res;
      const chunks: Buffer[] = [];
      let size = 0;
      let truncated = false;

      const done = () =>
        finish({
          status: res.statusCode ?? 0,
          statusText: res.statusMessage ?? "",
          headers: pairs(res.rawHeaders),
          body: Buffer.concat(chunks),
          truncated,
          firstByteMs,
          totalMs: elapsed(),
        });

      stream.on("data", (chunk: Buffer) => {
        if (settled) return;
        if (size + chunk.length > req.maxBytes) {
          chunks.push(chunk.subarray(0, req.maxBytes - size));
          truncated = true;
          done();
          outgoing.destroy();
          return;
        }
        chunks.push(chunk);
        size += chunk.length;
      });
      stream.on("end", done);
      stream.on("error", (error: Error) =>
        finish(
          unzip
            ? new TransportError("network", `The response body couldn't be decompressed (${String(res.headers["content-encoding"])}).`)
            : describe(error as NodeJS.ErrnoException, req.url, req.timeoutMs),
        ),
      );
      res.on("close", () => {
        if (!res.complete) finish(new TransportError("network", "The server closed the connection in the middle of the response."));
      });
    });

    outgoing.end(req.body ?? undefined);
  });
}

function pairs(raw: string[]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let i = 0; i + 1 < raw.length; i += 2) out.push([raw[i]!, raw[i + 1]!]);
  return out;
}
