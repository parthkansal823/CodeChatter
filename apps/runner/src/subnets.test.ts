import { describe, expect, it } from "vitest";

import { freeSubnets, parseCidr } from "./subnets.js";

const take = (base: string, bits: number, taken: string[], n: number) => {
  const out: string[] = [];
  for (const subnet of freeSubnets(base, bits, taken)) {
    out.push(subnet);
    if (out.length === n) break;
  }
  return out;
};

describe("parseCidr", () => {
  it("reads IPv4 ranges and aligns them to their size", () => {
    expect(parseCidr("10.213.0.0/16")).toEqual({ start: 0x0ad50000, size: 65536 });
    expect(parseCidr("10.213.5.7/24")).toEqual({ start: 0x0ad50500, size: 256 });
    expect(parseCidr("255.255.255.255/32")).toEqual({ start: 0xffffffff, size: 1 });
  });

  it("ignores what isn't an IPv4 range (Docker also lists IPv6 subnets)", () => {
    expect(parseCidr("fd00::/64")).toBeNull();
    expect(parseCidr("10.0.0.1")).toBeNull();
    expect(parseCidr("10.0.0.300/24")).toBeNull();
    expect(parseCidr("10.0.0.0/33")).toBeNull();
  });
});

describe("freeSubnets", () => {
  it("hands out /26 blocks from the bottom of the range", () => {
    expect(take("10.213.0.0/16", 26, [], 3)).toEqual(["10.213.0.0/26", "10.213.0.64/26", "10.213.0.128/26"]);
  });

  it("skips blocks other networks use, whatever their size", () => {
    const taken = ["10.213.0.0/26", "10.213.0.128/25", "172.17.0.0/16", "fd00::/64"];
    expect(take("10.213.0.0/16", 26, taken, 2)).toEqual(["10.213.0.64/26", "10.213.1.0/26"]);
  });

  it("finds nothing when a bigger network covers the whole range", () => {
    expect(take("10.213.0.0/16", 26, ["10.0.0.0/8"], 1)).toEqual([]);
  });

  it("stops at the end of the range: a /24 holds four /26 blocks", () => {
    expect([...freeSubnets("192.168.50.0/24", 26, [])]).toHaveLength(4);
    expect([...freeSubnets("10.213.0.0/16", 26, [])]).toHaveLength(1024);
  });

  it("refuses a base that isn't an IPv4 range", () => {
    expect(() => take("fd00::/48", 26, [], 1)).toThrow(/Not an IPv4 range/);
  });
});
