import { describe, expect, it } from "vitest";

import { blobResponseHeaders, parseRange } from "./blob-headers.js";

const SHA = "c".repeat(64);

describe("blobResponseHeaders", () => {
  it("shows images inline, sandboxed and unsniffable", () => {
    const h = blobResponseHeaders({ type: "image/svg+xml", sha256: SHA });
    expect(h["Content-Type"]).toBe("image/svg+xml");
    expect(h["Content-Disposition"]).toBe("inline");
    expect(h["Content-Security-Policy"]).toContain("sandbox");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h.ETag).toBe(`"${SHA}"`);
  });

  it("never serves an unknown type as itself", () => {
    const h = blobResponseHeaders({ type: "text/html", sha256: SHA });
    expect(h["Content-Type"]).toBe("application/octet-stream");
    expect(h["Content-Disposition"]).toBe("attachment");
  });

  it("downloads under the file's name, safely quoted", () => {
    const h = blobResponseHeaders({ type: "application/pdf", sha256: SHA, download: 'résumé "final".pdf' });
    expect(h["Content-Type"]).toBe("application/pdf");
    expect(h["Content-Disposition"]).toBe(`attachment; filename="r_sum_ _final_.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9%20_final_.pdf`);
  });
});

describe("parseRange", () => {
  it("reads a start and end, an open end, and a suffix", () => {
    expect(parseRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=50-1000", 100)).toEqual({ start: 50, end: 99 });
  });

  it("refuses what can't be served", () => {
    expect(parseRange("bytes=100-", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=9-3", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=0-1,5-6", 100)).toBeNull();
    expect(parseRange(undefined, 100)).toBeNull();
  });
});
