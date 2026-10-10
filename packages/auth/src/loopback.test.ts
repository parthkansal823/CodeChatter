import { describe, expect, it } from "vitest";

import { isLoopback } from "./index.js";

describe("isLoopback (plain http allowed in production only for this machine)", () => {
  it("takes localhost and the loopback addresses over http", () => {
    expect(isLoopback("http://localhost:8090")).toBe(true);
    expect(isLoopback("http://localhost")).toBe(true);
    expect(isLoopback("http://127.0.0.1:3000")).toBe(true);
    expect(isLoopback("http://[::1]:8080")).toBe(true);
  });

  it("refuses anything else, look-alikes included", () => {
    expect(isLoopback("http://localhost.evil.example")).toBe(false);
    expect(isLoopback("http://127.0.0.1.nip.io")).toBe(false);
    expect(isLoopback("http://codechatter.example.com")).toBe(false);
    expect(isLoopback("http://192.168.1.10")).toBe(false);
    expect(isLoopback("not a url")).toBe(false);
  });
});
