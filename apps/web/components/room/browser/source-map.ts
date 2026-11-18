/**
 * Click to code: from what a page in the room's browser says about the element clicked (the bridge, apps/api/src/preview/preview-bridge.ts) to a place in
 * the room's files. React, Vue and Svelte's development builds give a file and often a line; a dev server gives it as a module's address, a build's
 * file name or a path in the sandbox, so it's matched to the room's files by how its path ends. Pages that say nothing (plain HTML, server templates) are
 * found by what the element shows: its text, then its id, then a class.
 */

export type PageSource = { framework?: string | null; component?: string | null; file?: string; line?: number; column?: number };
export type InspectedElement = {
  tag: string;
  id: string | null;
  classes: string[];
  text: string;
  selector: string;
  size: { width: number; height: number };
  styles: Record<string, string>;
  attributes: Array<[string, string]>;
  page: string;
  source: PageSource | null;
};
export type RoomFileRef = { id: string; path: string };
export type CodePlace = { fileId: string; path: string; line: number; column: number; by: "source" | "text" | "id" | "class" };

/** A path as a page gives it (`http://p5173-room.preview…/src/App.tsx?t=1`, `webpack-internal:///(app-pages-browser)/./app/page.tsx`, `/home/you/app/src/App.vue`), ready to compare with the room's. */
export function normalSourcePath(file: string): string {
  let path = file.trim().replace(/^webpack-internal:\/\/\//, "").replace(/^file:\/\//, "");
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      // Not an address after all.
    }
  }
  path = path.split("?")[0]!.split("#")[0]!;
  try {
    path = decodeURIComponent(path);
  } catch {
    // Left as it is.
  }
  return path
    .replace(/\\/g, "/")
    .replace(/^\([^)]*\)\//, "")
    .replace(/^\/@fs\//, "/")
    .replace(/^(\.\/)+/, "");
}

/**
 * The room's file a page's path is: one whose whole path the page's ends with (it's the sandbox's absolute path), or that ends with the whole of the
 * page's (a path from the project's root, as Vue gives). The closest match wins; between equals, the shorter path.
 */
export function roomFileOf(file: string, files: RoomFileRef[]): RoomFileRef | null {
  const parts = normalSourcePath(file).split("/").filter(Boolean);
  if (!parts.length) return null;
  let best: RoomFileRef | null = null;
  let bestScore = 0;
  for (const candidate of files) {
    const own = candidate.path.split("/").filter(Boolean);
    let score = 0;
    while (score < own.length && score < parts.length && own[own.length - 1 - score] === parts[parts.length - 1 - score]) score += 1;
    if (score === 0 || (score !== own.length && score !== parts.length)) continue;
    if (score > bestScore || (score === bestScore && best && candidate.path.length < best.path.length)) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/** Files a page's markup can come from. */
const MARKUP = /\.(html?|jsx|tsx|js|ts|mjs|vue|svelte|astro|mdx|php|erb|ejs|hbs|handlebars|njk|jinja2?|j2|twig|liquid|py|rb|go|cs|cshtml|razor|java|kt)$/i;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function placeOf(text: string, index: number) {
  const before = text.slice(0, index);
  const line = before.split("\n").length;
  return { line, column: index - before.lastIndexOf("\n") };
}

/**
 * An element the page didn't say the source of, found in the room's files by what it shows: the start of its text, then its id as an attribute, then
 * its first class in a class or className. The first file that has it, in the order given (markup files only).
 */
export function findElementInFiles(element: Pick<InspectedElement, "id" | "classes" | "text">, files: Array<RoomFileRef & { text: string }>): CodePlace | null {
  const markup = files.filter((file) => MARKUP.test(file.path));
  const words = element.text.split(/\s+/).filter(Boolean).slice(0, 6).join(" ");
  const searches: Array<[CodePlace["by"], RegExp | null]> = [
    ["text", words.length >= 3 ? new RegExp(escape(words).replace(/ /g, "\\s+")) : null],
    ["id", element.id ? new RegExp(`\\bid\\s*=\\s*(?:"|'|\\{\\s*["'\`])${escape(element.id)}["'\`]`) : null],
    ["class", element.classes[0] ? new RegExp(`\\bclass(?:Name)?\\s*=\\s*(?:"|'|\\{\\s*["'\`])[^"'\`]*\\b${escape(element.classes[0])}\\b`) : null],
  ];
  for (const [by, pattern] of searches) {
    if (!pattern) continue;
    for (const file of markup) {
      const match = pattern.exec(file.text);
      if (match) return { fileId: file.id, path: file.path, ...placeOf(file.text, match.index), by };
    }
  }
  return null;
}

/** Where in the room's code an element comes from, by what the page said, or failing that by what it shows. */
export function codePlaceOf(element: InspectedElement, files: Array<RoomFileRef & { text: string }>): CodePlace | null {
  const source = element.source;
  if (source?.file) {
    const file = roomFileOf(source.file, files);
    if (file) return { fileId: file.id, path: file.path, line: Math.max(1, source.line ?? 1), column: Math.max(1, source.column ?? 1), by: "source" };
  }
  return findElementInFiles(element, files);
}
