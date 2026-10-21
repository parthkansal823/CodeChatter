import { describe, expect, it } from "vitest";

import { pickTextFiles } from "./import-files.js";
import { readTar } from "./tar.js";

/** A ustar header block for `name` (with an optional prefix) and `size` bytes of `flag`. */
function header(name: string, size: number, flag: string, prefix = ""): Buffer {
  const block = Buffer.alloc(512);
  block.write(name, 0, "utf8");
  block.write("0000644\0", 100);
  block.write(`${size.toString(8).padStart(11, "0")}\0`, 124);
  block.write(flag, 156);
  block.write("ustar\0", 257);
  block.write("00", 263);
  block.write(prefix, 345, "utf8");
  block.fill(" ", 148, 156);
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  return block;
}

const padded = (data: Buffer) => Buffer.concat([data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
const pax = (records: Record<string, string>) =>
  Buffer.from(
    Object.entries(records)
      .map(([key, value]) => {
        const body = ` ${key}=${value}\n`;
        let length = body.length + 1;
        while (`${length}${body}`.length !== length) length++;
        return `${length}${body}`;
      })
      .join(""),
  );

type Spec = { name: string; data?: string | Buffer; flag?: string; prefix?: string; pax?: Record<string, string>; global?: Record<string, string> };

function tar(specs: Spec[]): Buffer {
  const blocks: Buffer[] = [];
  for (const spec of specs) {
    if (spec.global) {
      const body = pax(spec.global);
      blocks.push(header("pax_global_header", body.length, "g"), padded(body));
      continue;
    }
    if (spec.pax) {
      const body = pax(spec.pax);
      blocks.push(header("PaxHeader", body.length, "x"), padded(body));
    }
    const data = typeof spec.data === "string" ? Buffer.from(spec.data) : (spec.data ?? Buffer.alloc(0));
    blocks.push(header(spec.name, data.length, spec.flag ?? "0", spec.prefix), padded(data));
  }
  return Buffer.concat([...blocks, Buffer.alloc(1024)]);
}

const sha = "6dcb09b5b57875f334f61aebed695e2e4193db5e";

describe("readTar", () => {
  it("reads files, folders, the global comment, prefixes and pax paths", () => {
    const long = `repo-abc/${"deep/".repeat(30)}file.txt`;
    const { entries, comment } = readTar(
      tar([
        { name: "", global: { comment: sha } },
        { name: "repo-abc/", flag: "5" },
        { name: "repo-abc/README.md", data: "# Hello\n" },
        { name: "main.py", prefix: "repo-abc/src", data: "print(1)\n" },
        { name: "PaxHeader/cut", pax: { path: long }, data: "deep" },
        { name: "repo-abc/link", flag: "2" },
      ]),
    );
    expect(comment).toBe(sha);
    expect(entries.map((e) => [e.path, e.type])).toEqual([
      ["repo-abc/", "directory"],
      ["repo-abc/README.md", "file"],
      ["repo-abc/src/main.py", "file"],
      [long, "file"],
      ["repo-abc/link", "link"],
    ]);
    expect(entries[2]!.data.toString()).toBe("print(1)\n");
    expect(entries[3]!.data.toString()).toBe("deep");
  });

  it("stops at a header whose checksum is wrong", () => {
    const archive = tar([{ name: "r/a.txt", data: "a" }, { name: "r/b.txt", data: "b" }]);
    archive[1024 + 10]! ^= 0xff;
    expect(readTar(archive).entries.map((e) => e.path)).toEqual(["r/a.txt"]);
  });
});

describe("pickTextFiles", () => {
  const entries = (specs: Spec[]) => readTar(tar(specs)).entries;

  it("keeps text files relative to the repository and skips binaries, links and odd names", () => {
    const picked = pickTextFiles(
      entries([
        { name: "r/", flag: "5" },
        { name: "r/index.html", data: "<p>hi</p>" },
        { name: "r/src/app.ts", data: "export {}\n" },
        { name: "r/logo.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]) },
        { name: "r/latin1.txt", data: Buffer.from([0x63, 0x61, 0x66, 0xe9]) },
        { name: "r/ trailing", data: "x" },
        { name: "r/link", flag: "2" },
      ]),
    );
    expect(picked.files).toEqual([
      { path: "index.html", content: "<p>hi</p>" },
      { path: "src/app.ts", content: "export {}\n" },
    ]);
    expect(picked).toMatchObject({ skipped: 4, truncated: false });
  });

  it("skips files over the size limit, and stops at the file and total limits", () => {
    const specs = [{ name: "r/big.txt", data: "x".repeat(50) }, ...Array.from({ length: 5 }, (_, i) => ({ name: `r/f${i}.txt`, data: "1234567890" }))];
    expect(pickTextFiles(entries(specs), { files: 3, fileBytes: 40, totalBytes: 1000 })).toMatchObject({ skipped: 3, truncated: true });
    expect(pickTextFiles(entries(specs), { files: 100, fileBytes: 40, totalBytes: 25 }).files.map((f) => f.path)).toEqual(["f0.txt", "f1.txt"]);
  });
});
