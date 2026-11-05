// Binary room files (roadmap §5) in E2ETST, for two people: an uploaded PNG opens as an image for both, Replace
// swaps its bytes live, Download hands back the same bytes, a PDF opens in the browser's viewer, a font shows its
// sample text, any other binary gets a hex peek, and Download as zip carries them all. Everything is deleted after.
//   node test/binary-files.e2e.mjs        (from apps/web, with the dev stack running)
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

import { check, finish, launch } from "./browser.mjs";

const stamp = Date.now().toString(36);
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );

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
/** A solid-colour PNG of this size, made here so the test needs no image tool. */
function png(size, rgb) {
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "latin1");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const row = Buffer.concat([Buffer.from([0]), ...Array.from({ length: size }, () => Buffer.from(rgb))]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: size }, () => row)));
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", pixels), chunk("IEND", Buffer.alloc(0))]);
}
const PDF = Buffer.concat([
  Buffer.from("%PDF-1.4\n%"),
  Buffer.from([0xe2, 0xe3, 0xcf, 0xd3]),
  Buffer.from("\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"),
]);
const FONT = join(process.cwd(), "node_modules/@fontsource/monaspace-krypton/files/monaspace-krypton-latin-400-normal.woff2");

const pic = `pic_${stamp}.png`;
const pdf = `doc_${stamp}.pdf`;
const bin = `data_${stamp}.bin`;
const font = `font_${stamp}.woff2`;
const made = [pic, pdf, bin, font];

const { browser, errors, signIn } = await launch();
const { page: a } = await signIn("test1@codechatter.local");
const { page: b } = await signIn("test2@codechatter.local");
const row = (page, path) => page.getByRole("tree", { name: "Files" }).getByRole("treeitem", { name: new RegExp(`^${escape(path)}`) });
const viewer = (page, name) => page.getByRole("region", { name: `Binary file ${name}` });

try {
  // Upload a PNG: it opens as an image, for the uploader and for someone else in the room.
  await a.getByLabel("Files to upload").setInputFiles({ name: pic, mimeType: "image/png", buffer: png(2, [220, 40, 40]) });
  check("uploadedPngInTree", await ok(row(a, pic).waitFor({ timeout: 20_000 })));
  await row(a, pic).click();
  check("opensAsImage", await ok(viewer(a, pic).getByText("2 × 2 px").waitFor({ timeout: 15_000 })));
  await row(b, pic).waitFor({ timeout: 15_000 });
  await row(b, pic).click();
  const image = viewer(b, pic).getByRole("img", { name: pic });
  await image.waitFor({ timeout: 15_000 });
  check("otherPersonSeesImage", await image.evaluate((img) => img.complete && img.naturalWidth === 2));

  // Replace swaps the bytes, live for everyone.
  const bigger = png(3, [40, 40, 220]);
  await viewer(a, pic).getByLabel("Replacement file").setInputFiles({ name: "other.png", mimeType: "image/png", buffer: bigger });
  check("replaceIsLive", await ok(viewer(b, pic).getByText("3 × 3 px").waitFor({ timeout: 15_000 })));

  // Download hands back exactly those bytes.
  const [download] = await Promise.all([a.waitForEvent("download"), viewer(a, pic).getByRole("link", { name: "Download" }).click()]);
  const saved = join(tmpdir(), `${pic}`);
  await download.saveAs(saved);
  check("downloadIsTheSameBytes", download.suggestedFilename() === pic && Buffer.compare(await readFile(saved), bigger) === 0, download.suggestedFilename());

  // A PDF opens in the browser's own viewer, from a local copy (never the API's URL, which downloads).
  await a.getByLabel("Files to upload").setInputFiles({ name: pdf, mimeType: "application/pdf", buffer: PDF });
  await row(a, pdf).waitFor({ timeout: 20_000 });
  await row(a, pdf).click();
  const frame = viewer(a, pdf).locator(`iframe[title="${pdf}"]`);
  check("pdfOpensInViewer", (await ok(frame.waitFor({ timeout: 15_000 }))) && (await frame.getAttribute("src"))?.startsWith("blob:"));

  // A font shows its sample text in that font.
  if (existsSync(FONT)) {
    await a.getByLabel("Files to upload").setInputFiles({ name: font, mimeType: "font/woff2", buffer: await readFile(FONT) });
    await row(a, font).waitFor({ timeout: 20_000 });
    await row(a, font).click();
    const sample = viewer(a, font).getByText(/The quick brown fox/).first();
    check("fontShowsSample", (await ok(sample.waitFor({ timeout: 15_000 }))) && /room-font-/.test(await sample.evaluate((el) => el.style.fontFamily)));
  } else {
    check("fontShowsSample", false, `no font at ${FONT}`);
  }

  // Anything else: a hex peek at its first bytes.
  await a.getByLabel("Files to upload").setInputFiles({ name: bin, mimeType: "application/octet-stream", buffer: Buffer.from([0, 1, 2, 3, 0xfe, 0xff]) });
  await row(a, bin).waitFor({ timeout: 20_000 });
  await row(a, bin).click();
  check("otherBinaryGetsHex", await ok(viewer(a, bin).getByLabel("The file's first bytes").getByText(/00000000 {2}00 01 02 03 fe ff/).waitFor({ timeout: 15_000 })));

  // Download as zip carries the binary files too.
  await a.getByRole("button", { name: "More file actions" }).click();
  const [zipDownload] = await Promise.all([a.waitForEvent("download", { timeout: 30_000 }), a.getByRole("menuitem", { name: "Download as zip" }).click()]);
  const zipPath = join(tmpdir(), `binary-${stamp}.zip`);
  await zipDownload.saveAs(zipPath);
  const zipped = await readFile(zipPath);
  check("zipHasBinaryFiles", [pic, pdf, bin].every((name) => zipped.includes(Buffer.from(name))) && zipped.includes(bigger), `${zipped.length} bytes`);
  await a.screenshot({ path: join(process.env.SHOT_DIR ?? tmpdir(), "binary-files.png") });
} catch (error) {
  const shot = join(tmpdir(), "binary-files-failed.png");
  await a.screenshot({ path: shot }).catch(() => {});
  check("flowCompletes", false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`);
} finally {
  try {
    for (const name of made) {
      const item = row(a, name);
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
