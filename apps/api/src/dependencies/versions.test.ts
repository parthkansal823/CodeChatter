/** Verify fixed releases are ordered numerically and unsupported release labels stay unknown. */
import { describe, expect, it } from "vitest";
import { compareVersions, lowestFixed } from "./versions.js";

describe("fixed version ordering", () => {
  it("orders SemVer numerically and handles prereleases", () => {
    expect(lowestFixed("npm", ["10.0.0", "2.0.0", "2.0.0-rc.10", "2.0.0-rc.2"])).toBe("2.0.0-rc.2");
    expect(lowestFixed("Go", ["v1.20.0", "v1.9.0"])).toBe("v1.9.0");
    expect(compareVersions("crates.io", "1.0.0+build", "1.0.0")).toBe(0);
  });
  it("uses Python epochs, release, pre, dev, post and local ordering", () => {
    expect(lowestFixed("PyPI", ["1!1.0", "9.0", "2.0rc1", "2.0b2", "2.0a1", "2.0.dev1"])).toBe("2.0.dev1");
    expect(compareVersions("PyPI", "1.0.post1", "1.0")).toBe(1);
    expect(compareVersions("PyPI", "1.0+1", "1.0+abc")).toBe(1);
    expect(compareVersions("PyPI", "1.0.0", "1.0")).toBe(0);
  });
  it("supports common Maven and Composer qualifiers", () => {
    expect(lowestFixed("Maven", ["2.0", "2.0-RC1", "2.0-beta2"])).toBe("2.0-beta2");
    expect(lowestFixed("Packagist", ["v2.10.0", "2.9.0", "2.9.0-beta1"])).toBe("2.9.0-beta1");
  });
  it("does not invent an ordering for arbitrary ecosystem strings", () => {
    expect(lowestFixed("Maven", ["2.0-redhat-1", "2.0"])).toBeNull();
    expect(lowestFixed("Maven", ["2.0-redhat-1"])).toBe("2.0-redhat-1");
    expect(lowestFixed("npm", [])).toBeNull();
  });
});
