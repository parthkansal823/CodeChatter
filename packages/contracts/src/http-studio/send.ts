import { z } from "zod";

// Limits (the API enforces them; the web shows the same numbers)

export const HTTP_STUDIO_LIMITS = {
  timeoutMs: 30_000,
  responseBytes: 5 * 1024 * 1024,
  requestBodyBytes: 512 * 1024,
  headerCount: 64,
  headerBytes: 32 * 1024,
  urlLength: 8 * 1024,
  sendsPerMinute: 60,
} as const;

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

// ---------------------------------------------------------------------------
// Send contract: POST /api/rooms/:roomId/http/send

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export const HttpHeaderInput = z.object({
  name: z.string().min(1).max(256).regex(HEADER_NAME, "Header names can't contain spaces or special characters."),
  value: z
    .string()
    .max(8192)
    .refine((v) => !/[\r\n\0]/.test(v), "Header values can't contain line breaks."),
});
export type HttpHeaderInput = z.infer<typeof HttpHeaderInput>;

export const HttpSendInput = z.object({
  method: z.enum(HTTP_METHODS),
  url: z.string().trim().min(1, "Enter a URL.").max(HTTP_STUDIO_LIMITS.urlLength, "That URL is too long."),
  headers: z.array(HttpHeaderInput).max(HTTP_STUDIO_LIMITS.headerCount, `Send at most ${HTTP_STUDIO_LIMITS.headerCount} headers.`),
  /** Text body (JSON, form, GraphQL and plain text are all text). */
  body: z.string().max(HTTP_STUDIO_LIMITS.requestBodyBytes, "The request body is over 512 KB.").nullable(),
});
export type HttpSendInput = z.infer<typeof HttpSendInput>;

/** Where a request went: the public internet, or a port inside the room's sandbox. */
export type HttpSendTarget = "internet" | "sandbox";

export type HttpSendErrorCode =
  | "invalid_request"
  | "blocked"
  | "dns"
  | "refused"
  | "timeout"
  | "tls"
  | "network"
  | "sandbox_not_listening"
  | "sandbox_unavailable";

export type HttpResponseData = {
  ok: true;
  target: HttpSendTarget;
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  /** UTF-8 text, or base64 when the response isn't text. */
  body: string;
  bodyEncoding: "text" | "base64";
  /** Body size in bytes (after decompression). */
  size: number;
  /** The body was cut at HTTP_STUDIO_LIMITS.responseBytes. */
  truncated: boolean;
  timing: { totalMs: number; firstByteMs: number };
  /** Something about how the request was sent that the person should know. */
  notice?: string;
};

/** The request never produced a response (refused, blocked, timed out). */
export type HttpSendFailure = {
  ok: false;
  target: HttpSendTarget | null;
  code: HttpSendErrorCode;
  message: string;
  timing: { totalMs: number };
};

export type HttpSendResult = HttpResponseData | HttpSendFailure;

/**
 * http://localhost:<port>/… means "port <port> inside this room's sandbox",
 * the dev server people are building, never the API's own machine.
 */
export function sandboxTarget(raw: string): { port: number; path: string; secure: boolean } | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.hostname.toLowerCase().replace(/\.$/, "") !== "localhost") return null;
  const secure = url.protocol === "https:";
  const port = url.port ? Number(url.port) : secure ? 443 : 80;
  return { port, path: `${url.pathname}${url.search}`, secure };
}
