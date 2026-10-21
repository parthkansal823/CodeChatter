/** One entry of a tar archive; `data` is a view into the archive, not a copy. */
export type TarEntry = { path: string; type: "file" | "directory" | "link" | "other"; data: Buffer };

const BLOCK = 512;

/**
 * Read a (gunzipped) tar archive: ustar headers, with pax and GNU long names, as GitHub's
 * tarballs use. `comment` is the archive's global pax comment, where GitHub puts the commit.
 * Stops at the end blocks or at a header that doesn't check out.
 */
export function readTar(archive: Buffer): { entries: TarEntry[]; comment: string | null } {
  const entries: TarEntry[] = [];
  let comment: string | null = null;
  let longName: string | null = null;
  let pax: Record<string, string> = {};
  let offset = 0;
  while (offset + BLOCK <= archive.length) {
    const header = archive.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    if (!checksumOk(header)) break;
    const size = readSize(header.subarray(124, 136));
    const flag = String.fromCharCode(header[156]!);
    const start = offset + BLOCK;
    const data = archive.subarray(start, Math.min(start + size, archive.length));
    offset = start + Math.ceil(size / BLOCK) * BLOCK;

    if (flag === "g") {
      comment = readPax(data).comment ?? comment;
      continue;
    }
    if (flag === "x") {
      pax = readPax(data);
      continue;
    }
    if (flag === "L") {
      longName = text(data);
      continue;
    }
    if (flag === "K") continue;

    const prefix = text(header.subarray(345, 500));
    const name = text(header.subarray(0, 100));
    const path = pax.path ?? longName ?? (prefix ? `${prefix}/${name}` : name);
    pax = {};
    longName = null;
    const type = flag === "0" || flag === "\0" || flag === "7" ? "file" : flag === "5" ? "directory" : flag === "1" || flag === "2" ? "link" : "other";
    entries.push({ path, type, data });
  }
  return { entries, comment };
}

/** A NUL-terminated field. */
const text = (field: Buffer) => {
  const end = field.indexOf(0);
  return field.subarray(0, end === -1 ? field.length : end).toString("utf8");
};

/** Octal, or base-256 (high bit set) for sizes over 8 GB. */
function readSize(field: Buffer): number {
  if (field[0]! & 0x80) {
    let value = 0;
    for (let i = 1; i < field.length; i++) value = value * 256 + field[i]!;
    return value;
  }
  return parseInt(text(field).trim() || "0", 8);
}

/** The header's bytes summed with its checksum field read as spaces. */
function checksumOk(header: Buffer): boolean {
  const stored = parseInt(text(header.subarray(148, 156)).trim(), 8);
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : header[i]!;
  return stored === sum;
}

/** Pax records: "<length> <key>=<value>\n", the length counting the whole record. */
function readPax(data: Buffer): Record<string, string> {
  const records: Record<string, string> = {};
  let at = 0;
  while (at < data.length) {
    const space = data.indexOf(0x20, at);
    if (space === -1) break;
    const length = parseInt(data.subarray(at, space).toString("ascii"), 10);
    if (!length || at + length > data.length) break;
    const record = data.subarray(space + 1, at + length - 1).toString("utf8");
    const equals = record.indexOf("=");
    if (equals > 0) records[record.slice(0, equals)] = record.slice(equals + 1);
    at += length;
  }
  return records;
}
