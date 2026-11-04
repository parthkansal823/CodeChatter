/** The ZIP writer moved to lib/zip.ts (the Files view uses it too); Docs' own helper for file names stays here. */
export { crc32, zip, type ZipEntry } from "@/lib/zip";

/** A file name that works on every system: no slashes or reserved characters, not too long. */
export function safeName(title: string, fallback = "Untitled"): string {
  const cleaned = title
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 80)
    .trim();
  return cleaned || fallback;
}
