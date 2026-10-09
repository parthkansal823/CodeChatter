import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { imagesToPdf } from "./pdf";

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");
const fakeJpeg = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 37) % 256);

describe("imagesToPdf", () => {
  const pdf = latin1(
    imagesToPdf([
      { jpeg: fakeJpeg(300), pixelWidth: 200, pixelHeight: 100, width: 75, height: 37.5 },
      { jpeg: fakeJpeg(120), pixelWidth: 40, pixelHeight: 40, width: 15, height: 15 },
    ]),
  );

  it("is a PDF with one page per picture, sized in points", () => {
    assert.ok(pdf.startsWith("%PDF-1.4\n"));
    assert.ok(pdf.trimEnd().endsWith("%%EOF"));
    assert.match(pdf, /\/Count 2 /);
    assert.match(pdf, /\/MediaBox \[0 0 75 37\.5\]/);
    assert.match(pdf, /\/Width 200 \/Height 100 .*\/Filter \/DCTDecode \/Length 300/);
  });

  it("indexes every object at its exact byte offset", () => {
    const startxref = Number(/startxref\n(\d+)\n/.exec(pdf)![1]);
    assert.ok(pdf.startsWith("xref\n", startxref));
    const [, first, count] = /xref\n(\d+) (\d+)\n/.exec(pdf.slice(startxref))!.map(Number);
    assert.equal(first, 0);
    const entries = pdf.slice(startxref).split("\n").slice(2, 2 + count!);
    entries.slice(1).forEach((entry, i) => {
      assert.equal(entry.length + 1, 20, "each entry is 20 bytes with its end-of-line");
      const offset = Number(entry.slice(0, 10));
      assert.ok(pdf.startsWith(`${i + 1} 0 obj\n`, offset), `object ${i + 1} at ${offset}`);
    });
  });

  it("keeps image bytes intact", () => {
    const at = pdf.indexOf("stream\n", pdf.indexOf("/DCTDecode")) + "stream\n".length;
    assert.equal(pdf.slice(at, at + 300), latin1(fakeJpeg(300)));
  });
});
