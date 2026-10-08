import { describe, expect, it } from "vitest";

import {
  addressBlockReason,
  BlockedTargetError,
  InvalidTargetError,
  outgoingHeaders,
  sandboxRunnerPath,
  UnresolvedHostError,
  vetTarget,
  type Resolver,
} from "./ssrf-guard.js";

/** A fake DNS that answers from a table, so no test touches the network. */
const dns =
  (table: Record<string, string[]>): Resolver =>
  async (host) =>
    (table[host] ?? []).map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

const noDns: Resolver = async () => {
  throw new Error("DNS must not be asked for an IP literal");
};

describe("addressBlockReason", () => {
  it.each([
    ["127.0.0.1", /loopback/],
    ["127.255.1.2", /loopback/],
    ["10.1.2.3", /private/],
    ["172.16.0.1", /private/],
    ["172.31.255.255", /private/],
    ["192.168.1.10", /private/],
    ["100.64.0.1", /carrier-grade NAT/],
    ["169.254.1.1", /link-local/],
    ["169.254.169.254", /metadata/],
    ["168.63.129.16", /metadata/],
    ["100.100.100.200", /metadata/],
    ["0.0.0.0", /this network/],
    ["224.0.0.1", /multicast/],
    ["239.255.255.250", /multicast/],
    ["255.255.255.255", /reserved/],
    ["198.18.0.1", /benchmarking/],
    ["192.0.2.5", /documentation/],
    ["::", /unspecified/],
    ["::1", /loopback/],
    ["[::1]", /loopback/],
    ["fe80::1", /link-local/],
    ["fe80::1%eth0", /link-local/],
    ["fc00::1", /unique local/],
    ["fd12:3456::1", /unique local/],
    ["fd00:ec2::254", /metadata/],
    ["ff02::1", /multicast/],
    ["fec0::1", /site-local/],
    ["2001:db8::1", /documentation/],
    ["2001::1", /Teredo/],
    ["100::1", /discard/],
    ["64:ff9b:1::1", /local NAT64/],
    ["::ffff:127.0.0.1", /loopback.*IPv4-mapped/],
    ["::ffff:7f00:1", /loopback.*IPv4-mapped/],
    ["::ffff:a9fe:a9fe", /metadata.*169\.254\.169\.254/],
    ["::ffff:10.0.0.1", /private/],
    ["::127.0.0.1", /loopback.*IPv4-compatible/],
    ["::8.8.8.8", /IPv4-compatible/],
    ["64:ff9b::7f00:1", /loopback.*NAT64/],
    ["64:ff9b::192.168.0.1", /private.*NAT64/],
    ["2002:7f00:1::", /loopback.*6to4/],
    ["2002:c0a8:101::1", /private.*6to4/],
    ["4000::1", /reserved/],
    ["not-an-ip", /not an IP/],
    ["1.2.3", /not an IP/],
  ])("blocks %s", (address, reason) => {
    expect(addressBlockReason(address)).toMatch(reason);
  });

  it.each(["8.8.8.8", "1.1.1.1", "93.184.215.14", "172.15.255.255", "172.32.0.1", "100.63.255.255", "100.128.0.1", "2606:4700:4700::1111", "2a00:1450:4001::200e", "::ffff:8.8.8.8", "64:ff9b::808:808", "2002:808:808::1"])(
    "allows the public address %s",
    (address) => {
      expect(addressBlockReason(address)).toBeNull();
    },
  );
});

describe("vetTarget", () => {
  it("connects to the address it checked", async () => {
    const target = await vetTarget("https://api.example.com/v1?x=1", dns({ "api.example.com": ["93.184.215.14", "2606:2800:21f:cb07:6820:80da:af6b:8b2c"] }));
    expect(target.address).toBe("93.184.215.14");
    expect(target.family).toBe(4);
    expect(target.url.hostname).toBe("api.example.com");
  });

  it("allows public IP literals without asking DNS", async () => {
    await expect(vetTarget("http://8.8.8.8/", noDns)).resolves.toMatchObject({ address: "8.8.8.8", family: 4 });
    await expect(vetTarget("http://[2606:4700:4700::1111]:8443/", noDns)).resolves.toMatchObject({ address: "2606:4700:4700::1111", family: 6 });
  });

  it.each([
    "http://127.0.0.1:8080/api/healthz",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:a9fe:a9fe]/",
    "http://[fd00:ec2::254]/",
    "http://0.0.0.0:4000/",
    // Decimal, hex, octal and short forms of 127.0.0.1 and 169.254.169.254.
    "http://2130706433/",
    "http://0x7f000001/",
    "http://0x7f.0.0.1/",
    "http://0177.0.0.1/",
    "http://127.1/",
    "http://2852039166/",
    "http://0xa9.0xfe.0xa9.0xfe/",
    "http://10.0.0.1./",
  ])("refuses %s", async (url) => {
    await expect(vetTarget(url, noDns)).rejects.toThrow(BlockedTargetError);
  });

  it("refuses a name when any DNS answer is internal", async () => {
    const resolver = dns({ "rebind.example": ["93.184.215.14", "10.0.0.5"], "evil.example": ["127.0.0.1"], "v6.example": ["::ffff:169.254.169.254"] });
    await expect(vetTarget("https://rebind.example/", resolver)).rejects.toThrow(/rebind\.example points to 10\.0\.0\.5, a private network address/);
    await expect(vetTarget("https://evil.example/", resolver)).rejects.toThrow(/loopback/);
    await expect(vetTarget("https://v6.example/", resolver)).rejects.toThrow(/metadata/);
  });

  it("refuses internal names without trusting DNS", async () => {
    const resolver = dns({ "metadata.google.internal": ["8.8.8.8"], "app.localhost": ["8.8.8.8"] });
    await expect(vetTarget("http://metadata.google.internal/computeMetadata/v1/", resolver)).rejects.toThrow(BlockedTargetError);
    await expect(vetTarget("http://app.localhost/", resolver)).rejects.toThrow(BlockedTargetError);
  });

  it("explains how to reach the sandbox instead", async () => {
    await expect(vetTarget("http://127.0.0.1:3000/", noDns)).rejects.toThrow(/Blocked: 127\.0\.0\.1 is a loopback address.*http:\/\/localhost:<port>/);
  });

  it("rejects other schemes, credentials and garbage", async () => {
    await expect(vetTarget("file:///etc/passwd", noDns)).rejects.toThrow(InvalidTargetError);
    await expect(vetTarget("gopher://example.com/", noDns)).rejects.toThrow(/Only http and https/);
    await expect(vetTarget("https://user:pass@example.com/", noDns)).rejects.toThrow(/Auth tab/);
    await expect(vetTarget("not a url", noDns)).rejects.toThrow(InvalidTargetError);
  });

  it("reports names that don't resolve", async () => {
    await expect(vetTarget("https://nope.invalid/", dns({}))).rejects.toThrow(UnresolvedHostError);
    const failing: Resolver = async () => {
      throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    };
    await expect(vetTarget("https://nope.invalid/", failing)).rejects.toThrow(/Couldn't find nope\.invalid/);
  });
});

describe("sandboxRunnerPath", () => {
  it("keeps the request inside the room's preview route", () => {
    expect(sandboxRunnerPath("TEAM22", 3000, "/api/notes?x=1&y=../..")).toBe("/rooms/TEAM22/preview/3000/api/notes?x=1&y=../..");
    expect(sandboxRunnerPath("TEAM22", 80, "/")).toBe("/rooms/TEAM22/preview/80/");
  });

  it.each(["/../sandbox/restart", "/a/%2e%2e/%2E%2e/runs", "/./x", "relative", ""])("refuses %s", (path) => {
    expect(() => sandboxRunnerPath("TEAM22", 3000, path)).toThrow(InvalidTargetError);
  });

  it("refuses impossible ports", () => {
    expect(() => sandboxRunnerPath("TEAM22", 0, "/")).toThrow(/port/);
    expect(() => sandboxRunnerPath("TEAM22", 70000, "/")).toThrow(/port/);
  });
});

describe("outgoingHeaders", () => {
  it("drops framing headers, merges repeats and fills defaults", () => {
    const headers = outgoingHeaders(
      [
        { name: "Host", value: "internal" },
        { name: "Content-Length", value: "999" },
        { name: "Transfer-Encoding", value: "chunked" },
        { name: "X-Tag", value: "a" },
        { name: "x-tag", value: "b" },
      ],
      32 * 1024,
    );
    expect(headers).toEqual({ "X-Tag": ["a", "b"], "User-Agent": "CodeChatter-API-Studio/1.0", Accept: "*/*" });
  });

  it("keeps the person's own User-Agent and Accept", () => {
    expect(outgoingHeaders([{ name: "accept", value: "application/json" }, { name: "user-agent", value: "me" }], 1024)).toEqual({
      accept: "application/json",
      "user-agent": "me",
    });
  });

  it("caps the total header size", () => {
    expect(() => outgoingHeaders([{ name: "X-Big", value: "x".repeat(2000) }], 1024)).toThrow(/more than 1 KB/);
  });
});
