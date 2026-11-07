/**
 * Reads .bib files for the References tool and \cite completion, so people can see and search what's in them. latexmk and biber do the real work in a
 * build; this only has to show entries, and to never throw or hang on a file that's half-typed or came from someone else.
 */

export type BibEntry = { key: string; type: string; line: number; fields: Record<string, string> };

const MOST_CHARS = 2 * 1024 * 1024;
const MOST_ENTRIES = 5000;
const NOT_ENTRIES = new Set(["comment", "preamble", "string"]);
const NAME = /[A-Za-z0-9_:.+/-]/;

/** Braces and common accents out, as a title reads. */
export function plainBibText(text: string): string {
  return text
    .replace(/\\&/g, "&")
    .replace(/\\%/g, "%")
    .replace(/\\_/g, "_")
    .replace(/\\\$/g, "$")
    .replace(/\\#/g, "#")
    .replace(/---/g, "—")
    .replace(/--/g, "–")
    .replace(/\\[`'"^~=.]\{?([A-Za-z])\}?/g, "$1")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseBibtex(source: string): BibEntry[] {
  const text = source.slice(0, MOST_CHARS);
  const entries: BibEntry[] = [];
  const strings = new Map<string, string>();
  let at = 0;

  const spaces = () => {
    while (at < text.length && /\s/.test(text[at]!)) at++;
  };
  const word = () => {
    const from = at;
    while (at < text.length && NAME.test(text[at]!)) at++;
    return text.slice(from, at);
  };
  /** A whole {...} from its opening brace: braces can hold braces, and an unfinished one ends with the file. */
  const braces = () => {
    const from = ++at;
    for (let depth = 1; at < text.length; at++) {
      if (text[at] === "\\") at++;
      else if (text[at] === "{") depth++;
      else if (text[at] === "}" && --depth === 0) return text.slice(from, at++);
    }
    return text.slice(from);
  };
  const quoted = () => {
    const from = ++at;
    for (let depth = 0; at < text.length; at++) {
      if (text[at] === "\\") at++;
      else if (text[at] === "{") depth++;
      else if (text[at] === "}") depth--;
      else if (text[at] === '"' && depth <= 0) return text.slice(from, at++);
    }
    return text.slice(from);
  };
  /** A value: pieces in braces or quotes, numbers and @string names, joined by #. */
  const value = () => {
    let out = "";
    for (;;) {
      spaces();
      if (text[at] === "{") out += braces();
      else if (text[at] === '"') out += quoted();
      else {
        const name = word();
        if (!name) return out;
        out += strings.get(name.toLowerCase()) ?? name;
      }
      spaces();
      if (text[at] !== "#") return out;
      at++;
    }
  };

  while (entries.length < MOST_ENTRIES) {
    at = text.indexOf("@", at);
    if (at < 0) break;
    const start = at++;
    const type = word().toLowerCase();
    spaces();
    const open = text[at];
    if (!type || (open !== "{" && open !== "(")) continue;
    if (type === "comment" || type === "preamble") {
      if (open === "{") braces();
      continue;
    }
    at++;
    if (type === "string") {
      spaces();
      const name = word().toLowerCase();
      spaces();
      if (name && text[at] === "=") {
        at++;
        strings.set(name, value());
      }
      continue;
    }
    if (NOT_ENTRIES.has(type)) continue;
    spaces();
    const key = word();
    spaces();
    if (!key || text[at] !== ",") continue;
    at++;
    // No prototype to change, whatever a file calls its fields.
    const fields = Object.create(null) as Record<string, string>;
    for (;;) {
      spaces();
      if (at >= text.length || text[at] === "}" || text[at] === ")" || text[at] === "@") break;
      const name = word().toLowerCase();
      spaces();
      if (!name || text[at] !== "=") {
        // Not a field: on to the next comma or the entry's end, so a typo costs one field.
        while (at < text.length && !",}@".includes(text[at]!)) at++;
        if (text[at] === ",") at++;
        continue;
      }
      at++;
      fields[name] = plainBibText(value());
      spaces();
      if (text[at] === ",") at++;
    }
    let line = 1;
    for (let index = 0; index < start; index++) if (text[index] === "\n") line++;
    entries.push({ key, type, line, fields });
  }
  return entries;
}

/** Names as people cite them: Knuth; Vaswani and Shazeer; LeCun et al. */
export function shortAuthors(entry: Pick<BibEntry, "fields">): string {
  const list = entry.fields.author ?? entry.fields.editor;
  if (!list) return "";
  const lastNames = list.split(/\s+and\s+/i).map((name) => {
    const comma = name.indexOf(",");
    if (comma >= 0) return name.slice(0, comma).trim();
    return name.trim().split(/\s+/).at(-1) ?? name;
  });
  if (lastNames.length > 2) return `${lastNames[0]} et al.`;
  return lastNames.join(" and ");
}

export const placeOf = (entry: Pick<BibEntry, "fields">) => entry.fields.journal ?? entry.fields.journaltitle ?? entry.fields.booktitle ?? entry.fields.publisher ?? entry.fields.howpublished ?? "";

/** Whether an entry matches what's been typed: every word somewhere in it. */
export function matchesSearch(entry: BibEntry, search: string): boolean {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = [entry.key, entry.fields.title, entry.fields.author, entry.fields.year, placeOf(entry), entry.fields.doi].join(" ").toLowerCase();
  return words.every((word) => text.includes(word));
}

/** A DOI however it's written: arXiv gives them as links, and case doesn't count. */
const plainDoi = (doi: string | undefined) => doi?.trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "");

/** A new entry's text with a key nothing else has, and whether it's already there under its DOI. */
export function entryToAdd(bibtex: string, existing: readonly BibEntry[]): { text: string; key: string } | { duplicateOf: string } | { error: string } {
  const entry = parseBibtex(bibtex)[0];
  if (!entry) return { error: "What came back wasn't a reference." };
  const doi = plainDoi(entry.fields.doi);
  const same = doi ? existing.find((item) => plainDoi(item.fields.doi) === doi) : undefined;
  if (same) return { duplicateOf: same.key };
  const taken = new Set(existing.map((item) => item.key));
  let key = entry.key;
  for (let suffix = 2; taken.has(key); suffix++) key = `${entry.key}_${suffix}`;
  const text = key === entry.key ? bibtex.trim() : bibtex.trim().replace(entry.key, key);
  return { text, key };
}
