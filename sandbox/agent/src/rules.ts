/**
 * What stays in the sandbox and never syncs back into the room: installed
 * dependencies, caches and build output. Also never deleted by "reconcile",
 * so `npm install` or a virtualenv survives a restart of the container.
 */
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "__pycache__",
  ".venv",
  "venv",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".next",
  ".cache",
  ".npm",
  ".gradle",
  "dist",
  "build",
  "target",
]);

const IGNORED_SUFFIXES = [".pyc", ".class", ".o", ".so", ".swp"];

/** Our own temp files for atomic writes. */
export const TEMP_PREFIX = ".cc-tmp-";

/** Largest file that syncs from the sandbox back into the room; bigger ones stay in the sandbox. */
export const SYNC_MAX_BYTES = 256 * 1024;

/** True if a workspace-relative path (or anything under it) should not sync. */
export function isIgnored(relPath: string): boolean {
  const parts = relPath.split("/");
  const name = parts.at(-1) ?? "";
  if (name.startsWith(TEMP_PREFIX)) return true;
  if (parts.some((part) => IGNORED_DIRS.has(part))) return true;
  return IGNORED_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

export function isIgnoredDirName(name: string): boolean {
  return IGNORED_DIRS.has(name);
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** The file as text, or null if it looks binary (NUL bytes or invalid UTF-8). */
export function asText(bytes: Uint8Array): string | null {
  if (bytes.subarray(0, 8192).includes(0)) return null;
  try {
    return utf8.decode(bytes);
  } catch {
    return null;
  }
}
