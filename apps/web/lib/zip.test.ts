// node:test, run with tsx (see CLAUDE.md "Unit tests").
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deflateRawSync } from "node:zlib";

import { crc32, safeZipPath, unzip, UNZIP_LIMITS, zip, ZipError } from "./zip";

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** A zip with deflated entries (as most tools make them), built by hand for the test. */
function deflatedZip(files: Array<{ path: string; text: string }>, options: { utf8?: boolean; claimedSize?: number } = {}): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const { path, text } of files) {
    const name = encode(path);
    const raw = encode(text);
    const data = deflateRawSync(raw);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(6, options.utf8 === false ? 0 : 0x0800, true);
    local.setUint16(8, 8, true);
    local.setUint32(14, crc32(raw), true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, options.claimedSize ?? raw.length, true);
    local.setUint16(26, name.length, true);
    const head = new DataView(new ArrayBuffer(46));
    head.setUint32(0, 0x02014b50, true);
    head.setUint16(8, options.utf8 === false ? 0 : 0x0800, true);
    head.setUint16(10, 8, true);
    head.setUint32(16, crc32(raw), true);
    head.setUint32(20, data.length, true);
    head.setUint32(24, options.claimedSize ?? raw.length, true);
    head.setUint16(28, name.length, true);
    head.setUint32(42, offset, true);
    central.push(new Uint8Array(head.buffer), name);
    for (const chunk of [new Uint8Array(local.buffer), name, data]) {
      parts.push(chunk);
      offset += chunk.length;
    }
  }
  const size = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of all) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

describe("unzip", () => {
  it("reads back what zip writes, folders included", async () => {
    const bytes = zip([
      { path: "README.md", data: "# Hi\n" },
      { path: "src/app.py", data: "print('ü')\n" },
    ]);
    const { entries, skipped } = await unzip(bytes);
    assert.deepEqual(
      entries.map((e) => [e.path, decode(e.data)]),
      [
        ["README.md", "# Hi\n"],
        ["src/app.py", "print('ü')\n"],
      ],
    );
    assert.deepEqual(skipped, []);
  });

  it("inflates deflated entries", async () => {
    const text = "x = 1\n".repeat(500);
    const { entries } = await unzip(deflatedZip([{ path: "big.py", text }]));
    assert.equal(decode(entries[0]!.data), text);
  });

  it("skips paths that would leave the folder", async () => {
    const { entries, skipped } = await unzip(deflatedZip([{ path: "../../etc/passwd", text: "root" }, { path: "ok.txt", text: "ok" }]));
    assert.deepEqual(entries.map((e) => e.path), ["ok.txt"]);
    assert.equal(skipped[0]!.reason, "its path leaves the folder");
  });

  it("stops a zip bomb at the limit, whatever its header claims", async () => {
    const bomb = deflatedZip([{ path: "zeros.txt", text: "0".repeat(UNZIP_LIMITS.totalBytes + 1024) }], { claimedSize: 10 });
    await assert.rejects(unzip(bomb), ZipError);
  });

  it("says when it isn't a zip", async () => {
    await assert.rejects(unzip(encode("not a zip at all, just text that is long enough")), /isn't a zip file/);
  });
});

describe("safeZipPath", () => {
  it("normalises separators and drops '.' parts; refuses '..'", () => {
    assert.equal(safeZipPath("./src\\app.py"), "src/app.py");
    assert.equal(safeZipPath("/abs/x"), "abs/x");
    assert.equal(safeZipPath("a/../b"), null);
    assert.equal(safeZipPath(""), null);
  });
});
