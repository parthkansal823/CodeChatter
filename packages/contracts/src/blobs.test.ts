import { describe, expect, it } from "vitest";

import { BlobCopyInput, BlobRef, blobKey, blobView, typeForName } from "./blobs.js";

describe("blobs", () => {
  it("keys each room's blobs apart", () => {
    expect(blobKey("AB12CD", "f".repeat(64))).toBe(`rooms/AB12CD/${"f".repeat(64)}`);
  });

  it("guesses a type from the name, case-insensitively", () => {
    expect(typeForName("Logo.PNG")).toBe("image/png");
    expect(typeForName("doc.pdf")).toBe("application/pdf");
    expect(typeForName("noext")).toBe("application/octet-stream");
    expect(typeForName("archive.tar.gz")).toBe("application/gzip");
  });

  it("picks a view for each type", () => {
    expect(blobView("image/svg+xml")).toBe("image");
    expect(blobView("application/pdf")).toBe("pdf");
    expect(blobView("font/woff2")).toBe("font");
    expect(blobView("video/mp4")).toBe("video");
    expect(blobView("image/tiff")).toBe("other");
    expect(blobView("application/zip")).toBe("other");
  });

  it("validates refs and copy requests", () => {
    expect(BlobRef.safeParse({ sha256: "a".repeat(64), size: 1, type: "image/png" }).success).toBe(true);
    expect(BlobRef.safeParse({ sha256: "a".repeat(63), size: 1, type: "image/png" }).success).toBe(false);
    expect(BlobCopyInput.safeParse({ from: "AB12CD", sha256: [] }).success).toBe(false);
    expect(BlobCopyInput.safeParse({ from: "ab12cd", sha256: ["a".repeat(64)] }).success).toBe(false);
  });
});
