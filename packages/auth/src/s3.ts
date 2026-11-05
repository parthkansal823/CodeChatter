import { createHash, createHmac } from "node:crypto";

/**
 * The S3-compatible object store (SeaweedFS in development; AWS S3, R2, B2 or
 * MinIO in production), for room binary files. Shared by the API, which takes
 * uploads and serves downloads, and the runner, which moves the bytes in and
 * out of sandboxes.
 *
 * Requests are signed with AWS Signature Version 4 using Node's crypto, not
 * the AWS SDK: five operations on one bucket don't need a 3 MB client.
 * Addressing is path-style (`endpoint/bucket/key`), which every S3-compatible
 * store accepts. Import from "@codechatter/auth/s3" (no Better Auth, no database).
 */

export interface ObjectStoreConfig {
  /** Base URL, e.g. http://localhost:8333 or https://s3.eu-west-1.amazonaws.com. */
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

export class ObjectStoreError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ObjectStoreError";
  }
}

export const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export const sha256Hex = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");

const hmac = (key: string | Buffer, data: string): Buffer => createHmac("sha256", key).update(data, "utf8").digest();

/** RFC 3986 encoding, as Signature V4 wants it: everything but A-Z a-z 0-9 - _ . ~ */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** An object key as a URL path: each segment encoded, the slashes kept. */
export function encodeKey(key: string): string {
  return key.split("/").map(encodeRfc3986).join("/");
}

export interface SignInput {
  method: string;
  url: URL;
  /** Headers to send and sign (names in any case). `host`, `x-amz-date` and `x-amz-content-sha256` are added. */
  headers?: Record<string, string>;
  /** Hex SHA-256 of the body, or "UNSIGNED-PAYLOAD". */
  payloadHash: string;
  region: string;
  accessKey: string;
  secretKey: string;
  service?: string;
  now?: Date;
}

/**
 * The headers for one signed request (Authorization included), for the URL as
 * given: its path must already be encoded (see `encodeKey`).
 */
export function signRequest(input: SignInput): Record<string, string> {
  const service = input.service ?? "s3";
  const amzDate = (input.now ?? new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers ?? {})) headers[name.toLowerCase()] = value;
  headers.host = input.url.host;
  headers["x-amz-content-sha256"] = input.payloadHash;
  headers["x-amz-date"] = amzDate;

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]!.trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = names.join(";");
  const query = [...input.url.searchParams]
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)] as const)
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const canonicalRequest = [input.method, input.url.pathname || "/", query, canonicalHeaders, signedHeaders, input.payloadHash].join("\n");
  const scope = `${day}/${input.region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${input.secretKey}`, day), input.region), service), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${input.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return headers;
}

/** The store from environment variables, or null when they aren't all set (binary files are then off). */
export function objectStoreFromEnv(
  env: Partial<Record<"S3_ENDPOINT" | "S3_REGION" | "S3_BUCKET" | "S3_ACCESS_KEY" | "S3_SECRET_KEY", string | undefined>>,
): ObjectStore | null {
  const { S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY } = env;
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY || !S3_SECRET_KEY) return null;
  return new ObjectStore({ endpoint: S3_ENDPOINT, region: S3_REGION || "us-east-1", bucket: S3_BUCKET, accessKey: S3_ACCESS_KEY, secretKey: S3_SECRET_KEY });
}

export interface StoredObject {
  body: Buffer;
  contentType: string;
}

/** One bucket on an S3-compatible store. Missing objects are null, never errors. */
export class ObjectStore {
  private bucketChecked: Promise<void> | null = null;

  constructor(
    private readonly config: ObjectStoreConfig,
    private readonly timeoutMs = 30_000,
  ) {}

  get bucket(): string {
    return this.config.bucket;
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    const send = () => this.request("PUT", key, { body, headers: { "content-type": contentType } });
    let response = await send();
    // A fresh development store has no bucket yet: make it once, then try again.
    if (response.status === 404) {
      const text = await response.text().catch(() => "");
      if (!text.includes("<Code>NoSuchBucket</Code>")) throw storeError(404, text, `store ${key}`);
      await this.ensureBucket();
      response = await send();
    }
    await expectDone(response, `store ${key}`);
  }

  async get(key: string): Promise<StoredObject | null> {
    const response = await this.request("GET", key);
    if (response.status === 404) return null;
    await expectOk(response, `read ${key}`);
    return { body: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get("content-type") ?? "application/octet-stream" };
  }

  async head(key: string): Promise<{ size: number; contentType: string } | null> {
    const response = await this.request("HEAD", key);
    if (response.status === 404) return null;
    await expectDone(response, `check ${key}`);
    return { size: Number(response.headers.get("content-length") ?? 0), contentType: response.headers.get("content-type") ?? "application/octet-stream" };
  }

  /** Copy within the bucket, on the server. False when the source doesn't exist. */
  async copy(fromKey: string, toKey: string): Promise<boolean> {
    const response = await this.request("PUT", toKey, { headers: { "x-amz-copy-source": `/${encodeKey(this.config.bucket)}/${encodeKey(fromKey)}` } });
    if (response.status === 404) return false;
    // CopyObject can fail with a 200 whose body is an <Error>.
    const text = await response.text();
    if (!response.ok || text.includes("<Error>")) throw storeError(response.status, text, `copy ${fromKey}`);
    return true;
  }

  async delete(key: string): Promise<void> {
    const response = await this.request("DELETE", key);
    if (response.status === 404) await response.body?.cancel().catch(() => undefined);
    else await expectDone(response, `delete ${key}`);
  }

  /**
   * Keys under a prefix (ListObjectsV2, every page). With a delimiter, the next level's
   * "folders" come back in `prefixes` instead (e.g. "rooms/" → "rooms/AB12CD/").
   */
  async list(prefix: string, delimiter?: string): Promise<{ keys: string[]; prefixes: string[] }> {
    const keys: string[] = [];
    const prefixes: string[] = [];
    let token: string | undefined;
    do {
      const query = new URLSearchParams({ "list-type": "2", prefix, "max-keys": "1000" });
      if (delimiter) query.set("delimiter", delimiter);
      if (token) query.set("continuation-token", token);
      const response = await this.request("GET", null, { query });
      if (response.status === 404) return { keys, prefixes }; // no bucket yet: nothing stored
      await expectOk(response, `list ${prefix}`);
      const xml = await response.text();
      for (const match of xml.matchAll(/<Contents>[\s\S]*?<Key>([^<]*)<\/Key>[\s\S]*?<\/Contents>/g)) keys.push(unescapeXml(match[1]!));
      for (const match of xml.matchAll(/<CommonPrefixes>\s*<Prefix>([^<]*)<\/Prefix>\s*<\/CommonPrefixes>/g)) prefixes.push(unescapeXml(match[1]!));
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? unescapeXml(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1] ?? "") || undefined : undefined;
    } while (token);
    return { keys, prefixes };
  }

  /** Delete everything under a prefix, eight at a time. Returns how many objects went. */
  async deletePrefix(prefix: string): Promise<number> {
    if (!prefix.endsWith("/")) throw new Error("deletePrefix needs a prefix ending in '/'");
    const { keys } = await this.list(prefix);
    for (let at = 0; at < keys.length; at += 8) await Promise.all(keys.slice(at, at + 8).map((key) => this.delete(key)));
    return keys.length;
  }

  /** Make the bucket if it isn't there (development convenience; production buckets are made by the operator). */
  ensureBucket(): Promise<void> {
    this.bucketChecked ??= (async () => {
      const head = await this.request("HEAD", null);
      await head.body?.cancel().catch(() => undefined);
      if (head.ok) return;
      const made = await this.request("PUT", null);
      const text = await made.text().catch(() => "");
      if (!made.ok && made.status !== 409) throw storeError(made.status, text, `make bucket ${this.config.bucket}`);
    })().catch((error: unknown) => {
      this.bucketChecked = null;
      throw error;
    });
    return this.bucketChecked;
  }

  private request(
    method: string,
    key: string | null,
    options: { body?: Uint8Array; headers?: Record<string, string>; query?: URLSearchParams } = {},
  ): Promise<Response> {
    const base = this.config.endpoint.replace(/\/+$/, "");
    const path = key === null ? `/${encodeKey(this.config.bucket)}` : `/${encodeKey(this.config.bucket)}/${encodeKey(key)}`;
    const url = new URL(base + path);
    // Encoded the way Signature V4 signs it, so the server sees exactly the signed query.
    if (options.query) url.search = [...options.query].map(([name, value]) => `${encodeRfc3986(name)}=${encodeRfc3986(value)}`).join("&");
    const body = options.body;
    const headers = signRequest({
      method,
      url,
      headers: { ...options.headers, ...(body && { "content-length": String(body.byteLength) }) },
      payloadHash: body ? sha256Hex(body) : EMPTY_SHA256,
      region: this.config.region,
      accessKey: this.config.accessKey,
      secretKey: this.config.secretKey,
    });
    delete headers.host; // fetch sets it, and refuses it as a header
    return fetch(url, { method, headers, body: body as BodyInit | undefined, signal: AbortSignal.timeout(this.timeoutMs) });
  }
}

function unescapeXml(text: string): string {
  return text.replace(/&(lt|gt|quot|apos|amp);/g, (_, name: string) => ({ lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" })[name]!);
}

/** Throw the store's own error for a failed response. A successful one is left unread for the caller. */
async function expectOk(response: Response, doing: string): Promise<void> {
  if (!response.ok) throw storeError(response.status, await response.text().catch(() => ""), doing);
}

/** Expect success and discard the body, for answers nobody reads (so the connection can be reused). */
async function expectDone(response: Response, doing: string): Promise<void> {
  await expectOk(response, doing);
  await response.body?.cancel().catch(() => undefined);
}

function storeError(status: number, text: string, doing: string): ObjectStoreError {
  const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1] ?? `HTTP${status}`;
  const message = /<Message>([^<]+)<\/Message>/.exec(text)?.[1] ?? "no details";
  return new ObjectStoreError(status, code, `Object store couldn't ${doing}: ${code} (${message})`);
}
