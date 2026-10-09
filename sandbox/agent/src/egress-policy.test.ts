import { describe, expect, it } from "vitest";

import { isPublicAddress, parseTarget, refusal } from "./egress-policy.js";

const allow = new Set(["registry.npmjs.org", "pypi.org"]);

describe("refusal", () => {
  it("lets listed registries through on 443", () => {
    expect(refusal("registry.npmjs.org:443", allow)).toBeNull();
    expect(refusal("PyPI.org:443", allow)).toBeNull();
    expect(refusal("pypi.org.:443", allow)).toBeNull();
  });

  it("refuses other hosts, with a reason people can read", () => {
    expect(refusal("example.com:443", allow)).toBe("example.com isn't a package registry this room may reach");
    // No wildcards: a subdomain or a look-alike isn't the registry.
    expect(refusal("evil.registry.npmjs.org:443", allow)).toMatch(/isn't a package registry/);
    expect(refusal("registry.npmjs.org.evil.com:443", allow)).toMatch(/isn't a package registry/);
  });

  it("refuses other ports", () => {
    expect(refusal("registry.npmjs.org:80", allow)).toMatch(/Only HTTPS/);
    expect(refusal("registry.npmjs.org:22", allow)).toMatch(/Only HTTPS/);
  });

  it("refuses addresses and malformed targets", () => {
    expect(refusal("104.16.0.35:443", allow)).toMatch(/isn't a package registry/);
    expect(refusal("[::1]:443", allow)).toMatch(/by name/);
    expect(refusal("registry.npmjs.org", allow)).toMatch(/by name/);
    expect(refusal("registry.npmjs.org:443\r\nX: y", allow)).toMatch(/by name/);
  });
});

describe("parseTarget", () => {
  it("reads host and port", () => {
    expect(parseTarget("Registry.NPMJS.org:443")).toEqual({ host: "registry.npmjs.org", port: 443 });
    expect(parseTarget("a b:443")).toBeNull();
  });
});

describe("isPublicAddress", () => {
  it("accepts public addresses", () => {
    expect(isPublicAddress("104.16.0.35")).toBe(true);
    expect(isPublicAddress("151.101.0.223")).toBe(true);
    expect(isPublicAddress("2606:4700::6810:84e5")).toBe(true);
  });

  it("refuses private, loopback, link-local, CGNAT and reserved ranges", () => {
    for (const ip of ["10.213.0.2", "172.17.0.1", "192.168.65.254", "127.0.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });

  it("refuses IPv6 forms that can hide an IPv4 address, and local IPv6", () => {
    for (const ip of ["::1", "::", "::ffff:10.0.0.1", "64:ff9b::a00:1", "2002:a00:1::", "fd00::1", "fe80::1"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });

  it("refuses what isn't an address", () => {
    expect(isPublicAddress("registry.npmjs.org")).toBe(false);
  });
});
