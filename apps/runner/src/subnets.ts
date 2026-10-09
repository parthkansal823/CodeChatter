/** IPv4 range arithmetic for room networks, which each take one block of SANDBOX_SUBNET. */

type Range = { start: number; size: number };

const toInt = (ip: string) => ip.split(".").reduce((n, part) => n * 256 + Number(part), 0);
const toIp = (n: number) => [24, 16, 8, 0].map((shift) => (n >>> shift) & 255).join(".");

/** "10.213.0.0/16" as numbers, or null for anything else (IPv6, a bare address, garbage). */
export function parseCidr(cidr: string): Range | null {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(cidr);
  if (!match) return null;
  const [, ip, bits] = match;
  if (Number(bits) > 32 || ip!.split(".").some((part) => Number(part) > 255)) return null;
  const size = 2 ** (32 - Number(bits));
  return { start: toInt(ip!) - (toInt(ip!) % size), size };
}

/** Each /`bits` block of `base` that overlaps none of the `taken` ranges, lowest first. */
export function* freeSubnets(base: string, bits: number, taken: string[]): Generator<string> {
  const range = parseCidr(base);
  if (!range) throw new Error(`Not an IPv4 range: ${base}`);
  const size = 2 ** (32 - bits);
  const used = taken.map(parseCidr).filter((r): r is Range => r !== null);
  for (let start = range.start; start + size <= range.start + range.size; start += size) {
    if (!used.some((u) => start < u.start + u.size && u.start < start + size)) yield `${toIp(start)}/${bits}`;
  }
}
