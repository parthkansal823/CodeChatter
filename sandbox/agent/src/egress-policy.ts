import { BlockList, isIP } from "node:net";

/**
 * What the egress proxy (egress.ts) may tunnel to: pure checks, so they can be
 * tested without a network.
 */

// Not the public internet: private, loopback, link-local (cloud metadata lives
// there), carrier-grade NAT, documentation, multicast and reserved ranges.
const NOT_PUBLIC_V4 = new BlockList();
for (const [network, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) NOT_PUBLIC_V4.addSubnet(network, bits, "ipv4");
// IPv6, including the forms that can carry an IPv4 address (mapped, NAT64,
// 6to4). A list of its own: BlockList matches IPv4 addresses against IPv6
// rules in their mapped form, so ::ffff:0:0/96 would block all of IPv4.
const NOT_PUBLIC_V6 = new BlockList();
for (const [network, bits] of [
  ["::", 127], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["100::", 64], ["2001:db8::", 32],
  ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) NOT_PUBLIC_V6.addSubnet(network, bits, "ipv6");

/** Whether a resolved address is on the public internet. */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return !NOT_PUBLIC_V4.check(ip, "ipv4");
  if (family === 6) return !NOT_PUBLIC_V6.check(ip, "ipv6");
  return false;
}

/** The host and port of a CONNECT request's "host:port", or null. IPv6 literals and anything odd don't parse. */
export function parseTarget(authority: string): { host: string; port: number } | null {
  const match = /^([a-z0-9.-]{1,253}):(\d{1,5})$/i.exec(authority);
  if (!match) return null;
  return { host: match[1]!.toLowerCase().replace(/\.$/, ""), port: Number(match[2]) };
}

/**
 * Why the proxy won't tunnel to `authority`, or null when it's a listed
 * registry host on 443. Hosts match exactly: no wildcards, and an IP address
 * is never on the list. The reason ends up in an HTTP status line, which
 * package managers show.
 */
export function refusal(authority: string, allow: ReadonlySet<string>): string | null {
  const target = parseTarget(authority);
  if (!target) return "Only package registries, by name";
  if (target.port !== 443) return "Only HTTPS (port 443) to package registries";
  if (!allow.has(target.host)) return `${target.host} isn't a package registry this room may reach`;
  return null;
}
