/**
 * ZIP files without a dependency. The writer stores files uncompressed with UTF-8 names
 * (Docs exports pages with it; the Files view, the room's code). The reader takes what
 * people upload: stored or deflated entries (inflated with the browser's own
 * DecompressionStream), with paths made safe and sizes capped, so a zip bomb or a path
 * like "../../x" can't get through.
 */
export type ZipEntry = { path: string; data: string | Uint8Array; modified?: Date };

const encoder = new TextEncoder();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS time and date fields (local time, two-second resolution, from 1980). */
function dosTime(date: Date): { time: number; day: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export function zip(entries: ZipEntry[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const push = (chunk: Uint8Array) => {
    chunks.push(chunk);
    offset += chunk.length;
  };
  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const data = typeof entry.data === "string" ? encoder.encode(entry.data) : entry.data;
    const { time, day } = dosTime(entry.modified ?? new Date());
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);

    const header = new DataView(new ArrayBuffer(46));
    header.setUint32(0, 0x02014b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 20, true);
    header.setUint16(8, 0x0800, true);
    header.setUint16(12, time, true);
    header.setUint16(14, day, true);
    header.setUint32(16, crc, true);
    header.setUint32(20, data.length, true);
    header.setUint32(24, data.length, true);
    header.setUint16(28, name.length, true);
    header.setUint32(42, offset, true);

    central.push(new Uint8Array(header.buffer), name);
    push(new Uint8Array(local.buffer));
    push(name);
    push(data);
  }
  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  const out = new Uint8Array(offset + centralSize + 22);
  let at = 0;
  for (const chunk of [...chunks, ...central, new Uint8Array(end.buffer)]) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** What the reader will take: more entries, or more bytes once inflated, and it stops. */
export const UNZIP_LIMITS = { entries: 5000, totalBytes: 100 * 1024 * 1024 } as const;

export type UnzipEntry = { path: string; data: Uint8Array };
export type UnzipResult = { entries: UnzipEntry[]; skipped: Array<{ path: string; reason: string }> };

export class ZipError extends Error {}

/** A path inside the archive made safe: forward slashes, no leading "./" or "/", no "..". Null when it can't be. */
export function safeZipPath(raw: string): string | null {
  const parts = raw.replace(/\\/g, "/").split("/").filter((part) => part && part !== ".");
  if (!parts.length || parts.some((part) => part === ".." || part.includes("\0"))) return null;
  return parts.join("/");
}

const latin1 = new TextDecoder("latin1");
const utf8 = new TextDecoder("utf-8");

async function inflate(data: Uint8Array, budget: number): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    // A zip bomb: stop at the budget whatever the header claimed.
    if (size > budget) {
      await reader.cancel();
      throw new ZipError("The zip holds more than can be imported at once (100 MB once unpacked).");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/**
 * The files in a ZIP archive (folders aren't entries of their own). Entries that can't be
 * read (encrypted, an unknown compression, an unsafe path) are listed as skipped, with why.
 */
export async function unzip(bytes: Uint8Array): Promise<UnzipResult> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end record is in the last 22 bytes plus an optional comment of up to 64 KB.
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end === -1) throw new ZipError("That isn't a zip file.");
  const count = view.getUint16(end + 10, true);
  const centralOffset = view.getUint32(end + 16, true);
  if (count === 0xffff || centralOffset === 0xffffffff) throw new ZipError("Zip64 archives (over 4 GB or 65,535 files) can't be imported.");
  if (count > UNZIP_LIMITS.entries) throw new ZipError(`The zip has ${count} entries; at most ${UNZIP_LIMITS.entries} can be imported at once.`);

  const entries: UnzipEntry[] = [];
  const skipped: UnzipResult["skipped"] = [];
  let total = 0;
  let at = centralOffset;
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) throw new ZipError("The zip is damaged: its list of files doesn't read.");
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    const nameBytes = bytes.subarray(at + 46, at + 46 + nameLength);
    // Bit 11: the name is UTF-8; otherwise it's the old DOS code page, read here as Latin-1.
    const rawName = (flags & 0x0800 ? utf8 : latin1).decode(nameBytes);
    at += 46 + nameLength + extraLength + commentLength;

    if (rawName.endsWith("/")) continue;
    const path = safeZipPath(rawName);
    if (!path) {
      skipped.push({ path: rawName, reason: "its path leaves the folder" });
      continue;
    }
    if (flags & 0x0001) {
      skipped.push({ path, reason: "it's encrypted" });
      continue;
    }
    if (method !== 0 && method !== 8) {
      skipped.push({ path, reason: "it's compressed in a way the browser can't unpack" });
      continue;
    }
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) throw new ZipError(`The zip is damaged at ${path}.`);
    const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    const raw = bytes.subarray(start, start + compressed);
    const data = method === 0 ? raw : await inflate(raw, UNZIP_LIMITS.totalBytes - total);
    total += data.length;
    if (total > UNZIP_LIMITS.totalBytes) throw new ZipError("The zip holds more than can be imported at once (100 MB once unpacked).");
    entries.push({ path, data });
  }
  return { entries, skipped };
}
