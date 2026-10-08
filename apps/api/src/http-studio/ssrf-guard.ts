import type { HttpHeaderInput } from "@codechatter/contracts";
import { isIP } from "node:net";

/**
 * What stops API Studio from being a way into our own network (SSRF). Pure,
 * so every rule is unit-tested; the transport connects only to an address
 * that passed here.
 *
 *   1. http and https only, no credentials in the URL.
 *   2. The host is resolved once, here, and every answer must be a public
 *      unicast address (a name with one private answer is refused whole).
 *   3. The connection goes to that vetted address (Host and SNI keep the name),
 *      so a second DNS answer can't swap in an internal one.
 *   4. Redirects are never followed: a 3xx is shown with its Location.
 *
 * The room's own sandbox is reached separately, through the runner, as
 * http://localhost:<port> (see sandboxTarget in @codechatter/contracts).
 */

export class BlockedTargetError extends Error {}
export class InvalidTargetError extends Error {}
export class UnresolvedHostError extends Error {}

const SANDBOX_HINT = "To call a server running in this room, use http://localhost:<port>.";

// ---------------------------------------------------------------------------
// Addresses

function ipv4ToNumber(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null;
    value = value * 256 + Number(part);
  }
  return value;
}

const numberToIpv4 = (n: number) => [24, 16, 8, 0].map((shift) => (n >>> shift) & 255).join(".");

function ipv6ToBigInt(input: string): bigint | null {
  let address = input.replace(/^\[|\]$/g, "").replace(/%.*$/, "").toLowerCase();
  if (isIP(address) !== 6) return null;
  // A dotted IPv4 tail (::ffff:127.0.0.1) becomes two hextets.
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (tail) {
    const v4 = ipv4ToNumber(tail[1]!);
    if (v4 === null) return null;
    address = `${address.slice(0, tail.index)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const [head = "", rest] = address.split("::");
  const left = head ? head.split(":") : [];
  const right = rest ? rest.split(":") : [];
  const groups = rest === undefined ? left : [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right];
  if (groups.length !== 8) return null;
  return groups.reduce((acc, group) => (acc << 16n) | BigInt(parseInt(group, 16)), 0n);
}

type V4Range = [base: string, prefix: number, reason: string];

const V4_RANGES: V4Range[] = [
  ["0.0.0.0", 8, "a \"this network\" address"],
  ["10.0.0.0", 8, "a private network address"],
  ["100.64.0.0", 10, "a carrier-grade NAT address"],
  ["127.0.0.0", 8, "a loopback address (this machine)"],
  ["169.254.0.0", 16, "a link-local address"],
  ["172.16.0.0", 12, "a private network address"],
  ["192.0.0.0", 24, "a reserved protocol address"],
  ["192.0.2.0", 24, "a documentation address"],
  ["192.88.99.0", 24, "a 6to4 relay address"],
  ["192.168.0.0", 16, "a private network address"],
  ["198.18.0.0", 15, "a benchmarking address"],
  ["198.51.100.0", 24, "a documentation address"],
  ["203.0.113.0", 24, "a documentation address"],
  ["224.0.0.0", 4, "a multicast address"],
  ["240.0.0.0", 4, "a reserved address"],
];

/** Cloud metadata endpoints, named explicitly for a clearer message. */
const METADATA = new Set(["169.254.169.254", "169.254.170.2", "169.254.170.23", "168.63.129.16", "100.100.100.200", "fd00:ec2::254"]);

function inV4(n: number, base: string, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return ((n & mask) >>> 0) === ((ipv4ToNumber(base)! & mask) >>> 0);
}

function v4Reason(n: number): string | null {
  if (METADATA.has(numberToIpv4(n))) return "a cloud metadata address";
  for (const [base, prefix, reason] of V4_RANGES) if (inV4(n, base, prefix)) return reason;
  return null;
}

const inV6 = (x: bigint, base: bigint, prefix: number) => x >> BigInt(128 - prefix) === base >> BigInt(128 - prefix);

function v6Reason(x: bigint, text: string): string | null {
  if (METADATA.has(text)) return "a cloud metadata address";
  if (x === 0n) return "the unspecified address";
  if (x === 1n) return "a loopback address (this machine)";
  const embedded = (v4: bigint, how: string) => {
    const reason = v4Reason(Number(v4));
    return reason ? `${reason} (${numberToIpv4(Number(v4))} ${how})` : null;
  };
  // Forms that carry an IPv4 address inside: judge the IPv4 address.
  if (inV6(x, 0xffffn << 32n, 96)) return embedded(x & 0xffffffffn, "as an IPv4-mapped address");
  if (inV6(x, 0n, 96)) return embedded(x & 0xffffffffn, "as an IPv4-compatible address") ?? "a deprecated IPv4-compatible address";
  if (inV6(x, 0x64ff9bn << 96n, 96)) return embedded(x & 0xffffffffn, "through NAT64");
  if (inV6(x, 0x2002n << 112n, 16)) return embedded((x >> 80n) & 0xffffffffn, "through 6to4");
  if (inV6(x, 0x64ff9b0001n << 80n, 48)) return "a local NAT64 address";
  if (inV6(x, 0x0100n << 112n, 64)) return "a discard-only address";
  if (inV6(x, 0x2001n << 112n, 23)) return "a reserved protocol address (Teredo and others)";
  if (inV6(x, 0x20010db8n << 96n, 32)) return "a documentation address";
  if (inV6(x, 0xfc00n << 112n, 7)) return "a private network address (unique local)";
  if (inV6(x, 0xfe80n << 112n, 10)) return "a link-local address";
  if (inV6(x, 0xfec0n << 112n, 10)) return "a site-local address";
  if (inV6(x, 0xff00n << 112n, 8)) return "a multicast address";
  // Everything public is global unicast, 2000::/3.
  if (!inV6(x, 0x2000n << 112n, 3)) return "a reserved address";
  return null;
}

/** Why an IP address can't be called, or null for a public unicast address. */
export function addressBlockReason(address: string): string | null {
  const bare = address.replace(/^\[|\]$/g, "");
  const v4 = ipv4ToNumber(bare);
  if (v4 !== null) return v4Reason(v4);
  const v6 = ipv6ToBigInt(bare);
  if (v6 !== null) return v6Reason(v6, bare.toLowerCase());
  return "not an IP address";
}

// ---------------------------------------------------------------------------
// URLs and hosts

/** Names that are internal by definition, whatever DNS says about them. */
function internalName(host: string): boolean {
  return host === "localhost" || host.endsWith(".localhost") || host === "metadata" || host === "metadata.google.internal" || host.endsWith(".internal");
}

export function parseInternetUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new InvalidTargetError("That isn't a valid URL. It should look like https://api.example.com/items.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new InvalidTargetError("Only http and https URLs can be sent.");
  if (url.username || url.password) throw new InvalidTargetError("Take the user name and password out of the URL and use the Auth tab instead.");
  if (!url.hostname) throw new InvalidTargetError("The URL has no host.");
  return url;
}

export type Resolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;
export type VettedTarget = { url: URL; address: string; family: 4 | 6 };

/**
 * The URL, checked, with the one address to connect to. The WHATWG parser has
 * already turned decimal, hex, octal and short IPv4 forms (2130706433,
 * 0x7f.1, 0177.0.0.1) into dotted quads, so they meet the same rules.
 */
export async function vetTarget(raw: string, resolve: Resolver): Promise<VettedTarget> {
  const url = parseInternetUrl(raw);
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();

  if (isIP(host)) {
    const reason = addressBlockReason(host);
    if (reason) throw new BlockedTargetError(`Blocked: ${host} is ${reason}. API Studio only calls public internet addresses. ${SANDBOX_HINT}`);
    return { url, address: host, family: isIP(host) as 4 | 6 };
  }
  if (internalName(host)) throw new BlockedTargetError(`Blocked: ${host} is an internal name. API Studio only calls public internet addresses. ${SANDBOX_HINT}`);

  const answers = await resolve(host).catch(() => []);
  if (answers.length === 0) throw new UnresolvedHostError(`Couldn't find ${host}. Check the host name.`);
  for (const answer of answers) {
    const reason = addressBlockReason(answer.address);
    if (reason) {
      throw new BlockedTargetError(`Blocked: ${host} points to ${answer.address}, ${reason}. API Studio only calls public internet addresses. ${SANDBOX_HINT}`);
    }
  }
  const first = answers[0]!;
  return { url, address: first.address, family: first.family === 6 ? 6 : 4 };
}

/**
 * The runner path for a request to the room's sandbox. The path comes from a
 * parsed URL (dot segments already resolved); this refuses anything that
 * could still climb out of /rooms/:id/preview/:port/ on the runner.
 */
export function sandboxRunnerPath(roomId: string, port: number, path: string): string {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new InvalidTargetError("The port must be between 1 and 65535.");
  const pathname = path.split("?")[0]!;
  const climbs = pathname.split("/").some((segment) => /^(\.|%2e){1,2}$/i.test(segment));
  if (!pathname.startsWith("/") || climbs) throw new InvalidTargetError("That path can't be sent to the sandbox. Remove any ./ or ../ segments.");
  return `/rooms/${roomId}/preview/${port}${path}`;
}

// ---------------------------------------------------------------------------
// Headers

/** Framing and connection headers are ours to set; the rest pass through. */
const DROPPED = new Set([
  "host", "content-length", "transfer-encoding", "connection", "keep-alive", "upgrade", "te", "trailer",
  "proxy-connection", "proxy-authorization", "expect", "http2-settings",
]);

export function outgoingHeaders(headers: HttpHeaderInput[], maxBytes: number): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  const names = new Map<string, string>(); // lower-case -> the spelling first used
  let bytes = 0;
  for (const { name, value } of headers) {
    const lower = name.toLowerCase();
    if (DROPPED.has(lower)) continue;
    bytes += name.length + value.length + 4;
    if (bytes > maxBytes) throw new InvalidTargetError(`The headers add up to more than ${Math.round(maxBytes / 1024)} KB. Remove some and try again.`);
    const key = names.get(lower) ?? name;
    names.set(lower, key);
    const existing = out[key];
    out[key] = existing === undefined ? value : [...(Array.isArray(existing) ? existing : [existing]), value];
  }
  if (!names.has("user-agent")) out["User-Agent"] = "CodeChatter-API-Studio/1.0";
  if (!names.has("accept")) out.Accept = "*/*";
  return out;
}
