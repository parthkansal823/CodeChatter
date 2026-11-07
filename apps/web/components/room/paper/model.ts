/** Which paper a .tex or .bib file belongs to, worked out the way LaTeX editors do: a chapter is built through the file that has its \documentclass. */

export const isTexName = (name: string) => /\.tex$/i.test(name);
export const isPaperName = (name: string) => /\.(?:tex|bib)$/i.test(name);

const ROOT_COMMENT = /^%\s*!\s*TEX\s+root\s*=\s*(.+?)\s*$/im;
const DOCUMENT_CLASS = /^[^%\n]*\\documentclass\b/m;

const folderOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/** A path relative to a folder, or null when it leaves the room. */
function relativeTo(folder: string, relative: string): string | null {
  const parts = folder ? folder.split("/") : [];
  for (const part of relative.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

function sharedFolders(a: string, b: string): number {
  const left = a ? a.split("/") : [];
  const right = b ? b.split("/") : [];
  let count = 0;
  while (count < left.length && count < right.length && left[count] === right[count]) count++;
  return count;
}

/**
 * The file to build for what's being edited:
 * - `% !TEX root = ../main.tex` says so, as other editors read it;
 * - a file with a \documentclass is its own;
 * - otherwise the nearest one that has one, then one called main.tex, then the shortest path.
 */
export function rootTexOf(files: ReadonlyArray<{ path: string; text: string }>, active: string | null): string | null {
  const tex = files.filter((file) => isTexName(file.path));
  const current = active ? tex.find((file) => file.path === active) : undefined;
  if (current) {
    const named = ROOT_COMMENT.exec(current.text.slice(0, 2000))?.[1];
    const target = named ? relativeTo(folderOf(current.path), named) : null;
    if (target && tex.some((file) => file.path === target)) return target;
    if (DOCUMENT_CLASS.test(current.text)) return current.path;
  }
  const from = active ? folderOf(active) : "";
  const roots = tex.filter((file) => DOCUMENT_CLASS.test(file.text));
  roots.sort((a, b) => {
    const nearer = sharedFolders(folderOf(b.path), from) - sharedFolders(folderOf(a.path), from);
    if (nearer) return nearer;
    const main = Number(/(?:^|\/)main\.tex$/i.test(b.path)) - Number(/(?:^|\/)main\.tex$/i.test(a.path));
    return main || a.path.length - b.path.length || a.path.localeCompare(b.path);
  });
  return roots[0]?.path ?? null;
}

export function base64ToPdf(base64: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: "application/pdf" });
}
