import { describe, expect, it } from "vitest";

import { tarOf } from "./judge-box.js";

/** Read a tar back: the names, types and contents, checking each header's checksum. */
function untar(archive: Buffer) {
  const entries: Array<{ name: string; type: string; data: string; uid: number }> = [];
  for (let at = 0; at + 512 <= archive.length; ) {
    const header = archive.subarray(at, at + 512);
    if (header.every((byte) => byte === 0)) break;
    const text = (from: number, length: number) => header.subarray(from, from + length).toString("utf8").replace(/\0.*$/s, "");
    const stored = Number.parseInt(text(148, 8).trim(), 8);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : header[i]!;
    expect(sum).toBe(stored);
    expect(text(257, 5)).toBe("ustar");
    const size = Number.parseInt(text(124, 12), 8);
    const prefix = text(345, 155);
    const name = prefix ? `${prefix}/${text(0, 100)}` : text(0, 100);
    entries.push({ name, type: text(156, 1), data: archive.subarray(at + 512, at + 512 + size).toString("utf8"), uid: Number.parseInt(text(108, 8), 8) });
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

describe("tarOf", () => {
  it("packs files with their folders, owned by the sandbox user", () => {
    const entries = untar(tarOf([{ path: "src/lib/a.py", data: Buffer.from("print(1)\n") }, { path: "src/b.py", data: Buffer.from("x") }, { path: "top.txt", data: Buffer.alloc(0) }]));
    expect(entries.map((entry) => [entry.name, entry.type])).toEqual([
      ["src/", "5"],
      ["src/lib/", "5"],
      ["src/lib/a.py", "0"],
      ["src/b.py", "0"],
      ["top.txt", "0"],
    ]);
    expect(entries[2]!.data).toBe("print(1)\n");
    expect(entries.every((entry) => entry.uid === 10001)).toBe(true);
  });

  it("keeps bytes exact, past a block boundary", () => {
    const data = Buffer.alloc(1300, 0x41);
    const [entry] = untar(tarOf([{ path: "big.bin", data }]));
    expect(entry!.data.length).toBe(1300);
  });

  it("splits long paths into the prefix field, and leaves out what can't fit", () => {
    const deep = `${"folder/".repeat(20)}file.txt`;
    const entries = untar(tarOf([{ path: deep, data: Buffer.from("deep") }]));
    expect(entries.at(-1)!.name).toBe(deep);
    expect(entries.at(-1)!.data).toBe("deep");
    const tooLong = "x".repeat(300);
    expect(untar(tarOf([{ path: tooLong, data: Buffer.from("no") }]))).toEqual([]);
  });

  it("ends with the two empty blocks tar expects", () => {
    const archive = tarOf([{ path: "a", data: Buffer.from("1") }]);
    expect(archive.length % 512).toBe(0);
    expect(archive.subarray(-1024).every((byte) => byte === 0)).toBe(true);
  });
});
