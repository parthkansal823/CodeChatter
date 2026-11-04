// Files in and out of a room (roadmap §5), in E2ETST. Download as zip hands over the room's code (README.md in it).
// Import a zip (deflated, its files in one top folder, a PNG among them) adds the text files where you'd expect, says
// the PNG was skipped. Upload files adds a file, after a "Before importing" checkpoint of the files as they were;
// dropping a file from the computer on a folder puts it in that folder. Everything the test added is deleted.
//   node test/files.e2e.mjs        (from apps/web, with the dev stack running)
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";

import { check, finish, launch } from "./browser.mjs";

const stamp = Date.now().toString(36);
const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A deflated zip (as most tools make them), built here so the test needs no zip tool. */
function makeZip(files) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (bytes) => {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { path, data } of files) {
    const name = Buffer.from(path);
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const packed = deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(0x0800, 8);
    head.writeUInt16LE(8, 10);
    head.writeUInt32LE(crc32(raw), 16);
    head.writeUInt32LE(packed.length, 20);
    head.writeUInt32LE(raw.length, 24);
    head.writeUInt16LE(name.length, 28);
    head.writeUInt32LE(offset, 42);
    central.push(head, name);
    parts.push(local, name, packed);
    offset += local.length + name.length + packed.length;
  }
  const size = central.reduce((sum, b) => sum + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}

const { browser, errors, signIn } = await launch();
const { page: a } = await signIn("test1@codechatter.local");
const tree = a.getByRole("tree", { name: "Files" });
const row = (path) => tree.getByRole("treeitem", { name: new RegExp(`^${escape(path)}`) });
const made = [`zipped_${stamp}.py`, `ziplib_${stamp}`, `up_${stamp}.txt`, `drop_${stamp}`];

try {
  // Download as zip.
  await a.getByRole("button", { name: "More file actions" }).click();
  const [download] = await Promise.all([a.waitForEvent("download"), a.getByRole("menuitem", { name: "Download as zip" }).click()]);
  const saved = join(tmpdir(), `room-${stamp}.zip`);
  await download.saveAs(saved);
  const bytes = await readFile(saved);
  check("downloadsAZip", /E2ETST\.zip$/.test(download.suggestedFilename()) && bytes.subarray(0, 4).toString("latin1") === "PK\u0003\u0004" && bytes.includes(Buffer.from("README.md")), download.suggestedFilename());

  // Import a zip: one top folder, a PNG among the files.
  const archive = makeZip([
    { path: `proj/zipped_${stamp}.py`, data: `print("from a zip ${stamp}")\n` },
    { path: `proj/ziplib_${stamp}/helper.py`, data: "def helper():\n    return 1\n" },
    { path: "proj/logo.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 13, 0, 1, 2]) },
  ]);
  await a.getByLabel("Zip to import").setInputFiles({ name: "proj.zip", mimeType: "application/zip", buffer: archive });
  check("zipImported", await ok(row(`zipped_${stamp}.py`).waitFor({ timeout: 15_000 })) && (await ok(row(`ziplib_${stamp}`).waitFor({ timeout: 5_000 }))));
  check("binarySkippedAndSaid", await ok(a.getByText(/Imported 2 files\. Skipped 1: logo\.png, because it isn't text/).waitFor({ timeout: 5_000 })));
  await a.screenshot({ path: join(process.env.SHOT_DIR ?? tmpdir(), "files-import.png") });

  // Upload a file. The files changed (the zip), so a checkpoint of them comes first. (Had nothing changed since the
  // newest checkpoint, that one would already hold them, and no other is made.)
  await a.getByLabel("Files to upload").setInputFiles({ name: `up_${stamp}.txt`, mimeType: "text/plain", buffer: Buffer.from("uploaded\n") });
  check("fileUploaded", await ok(row(`up_${stamp}.txt`).waitFor({ timeout: 15_000 })));
  const checkpoints = await a.evaluate(() => fetch("/api/rooms/E2ETST/checkpoints").then((r) => r.json()));
  check("checkpointFirst", checkpoints.checkpoints?.some((c) => c.label === `Before importing up_${stamp}.txt` && c.kind === "import"), JSON.stringify(checkpoints.checkpoints?.slice(0, 2)));

  // A file dropped from the computer onto a folder goes into it.
  await a.getByRole("button", { name: "New folder" }).click();
  await a.getByPlaceholder("folder").fill(`drop_${stamp}`);
  await a.getByPlaceholder("folder").press("Enter");
  await row(`drop_${stamp}`).waitFor({ timeout: 10_000 });
  const dataTransfer = await a.evaluateHandle((name) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["dropped\n"], name, { type: "text/plain" }));
    return transfer;
  }, `dropped_${stamp}.txt`);
  await row(`drop_${stamp}`).dispatchEvent("dragover", { dataTransfer });
  await row(`drop_${stamp}`).dispatchEvent("drop", { dataTransfer });
  check("dropIntoFolder", await ok(row(`dropped_${stamp}.txt`).waitFor({ timeout: 15_000 })), await tree.innerText());
} catch (error) {
  const shot = join(tmpdir(), "files-failed.png");
  await a.screenshot({ path: shot }).catch(() => {});
  check("flowCompletes", false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`);
} finally {
  try {
    for (const path of made) {
      const item = row(path);
      if (!(await item.count())) continue;
      await item.focus();
      await item.press("Delete");
      await item.waitFor({ state: "detached", timeout: 10_000 });
    }
    check("cleanedUp", true, made.join(", "));
  } catch (error) {
    check("cleanedUp", false, error instanceof Error ? error.message.split("\n")[0] : String(error));
  }
  await browser.close();
}
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
