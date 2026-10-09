/**
 * Search and replace across the room's files (Ctrl+Shift+F), on the files
 * document every browser in the room already holds. Pure, so it's tested on
 * its own (search.test.ts); search-view.tsx is the UI.
 */

export type SearchOptions = {
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
  /** Comma-separated globs, like `src/**\/*.ts, *.md`; empty means every file. */
  include: string;
  exclude: string;
};

/** What matches become: the text, and whether it can use the regex's groups ($1, $&, $<name>). */
export type ReplaceOptions = { text: string; regex: boolean };

export type Match = {
  /** 1-based, as the editor counts. */
  line: number;
  column: number;
  /** Characters on that line (a match across lines is shown up to the line's end). */
  length: number;
  /** Where the whole match ends, 1-based: the editor selects up to here. */
  endLine: number;
  endColumn: number;
  before: string;
  text: string;
  after: string;
  /** What the match becomes, when a replacement is being previewed. */
  replacement?: string;
};

export type FileMatches = { id: string; path: string; matches: Match[] };

export type SearchResults = {
  files: FileMatches[];
  /** Matches found, at most the limit. */
  count: number;
  /** The search stopped at the limit: there are more matches than these. */
  capped: boolean;
  /** Files too big to search (over MAX_FILE_CHARS). */
  skipped: number;
};

/** One match, as an edit: where it is in the file's text and what it becomes. */
export type Edit = { index: number; length: number; text: string };

/** A file's text, or a Y.Text: its length is read first, so a big file is skipped before it's copied. */
export type TextSource = { readonly length: number; toString(): string };

/** Most matches shown; past it the results say so. */
export const MAX_MATCHES = 2000;
/** Files bigger than this aren't searched. */
export const MAX_FILE_CHARS = 1_000_000;

const WORD = "[A-Za-z0-9_]";
/** Not inside a word. A whole-word match starts and ends here, so `foo(` still finds `foo(x)`, as in VS Code. */
const EDGE = `(?:(?<!${WORD})|(?!${WORD}))`;
/** The longest match a result row shows; the editor still selects all of it. */
const SHOWN = 200;

export const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The pattern for the options, an error for a regex that doesn't parse, or null when there's nothing to find. */
export function buildPattern(
  options: Pick<SearchOptions, "query" | "matchCase" | "wholeWord" | "regex">,
): RegExp | { error: string } | null {
  if (!options.query) return null;
  const source = options.regex ? options.query : escapeRegExp(options.query);
  const flags = `gm${options.matchCase ? "" : "i"}`;
  let typed: RegExp;
  try {
    // On its own first, so an error is about what was typed (and whole word can't mend a broken one).
    typed = new RegExp(source, flags);
  } catch (error) {
    // "Invalid regular expression: /(/gim: Unterminated group" says only the last part to a person.
    const message = error instanceof Error ? error.message : String(error);
    return { error: message.replace(/^Invalid regular expression: \/[\s\S]*\/[a-z]*: /, "") };
  }
  return options.wholeWord ? new RegExp(`${EDGE}(?:${source})${EDGE}`, flags) : typed;
}

/** One glob as a test on a path: `**` crosses folders, `*` and `?` don't, `{a,b}` is either. */
export function globToRegExp(glob: string): RegExp {
  let source = "";
  let braces = 0;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*" && glob[i + 1] === "*") {
      const folders = glob[i + 2] === "/";
      source += folders ? "(?:.*/)?" : ".*";
      i += folders ? 2 : 1;
    } else if (c === "*") source += "[^/]*";
    else if (c === "?") source += "[^/]";
    else if (c === "{") {
      braces++;
      source += "(?:";
    } else if (c === "}" && braces > 0) {
      braces--;
      source += ")";
    } else if (c === "," && braces > 0) source += "|";
    else source += escapeRegExp(c);
  }
  // A brace still open (someone halfway through typing `*.{ts,tsx}`) closes at the end.
  return new RegExp(`^${source}${")".repeat(braces)}$`);
}

/**
 * Which paths the include and exclude fields let through. A pattern without a
 * folder matches at any depth (`*.md`), one starting with `./` only from the
 * top, and a folder takes what's inside it.
 */
export function pathFilter(include: string, exclude: string): (path: string) => boolean {
  const compile = (list: string) =>
    splitGlobs(list).flatMap((raw) => {
      const glob = raw.replace(/^\.?\//, "").replace(/\/+$/, "");
      if (!glob) return [];
      const rooted = /^\.?\//.test(raw) || glob.includes("/");
      const anchored = rooted ? glob : `**/${glob}`;
      return [globToRegExp(anchored), globToRegExp(`${anchored}/**`)];
    });
  const yes = compile(include);
  const no = compile(exclude);
  return (path) => (yes.length === 0 || yes.some((re) => re.test(path))) && !no.some((re) => re.test(path));
}

/** Comma-separated globs, keeping commas inside braces (`*.{ts,tsx}`). */
function splitGlobs(list: string): string[] {
  const globs: string[] = [];
  let depth = 0;
  let current = "";
  for (const c of list) {
    if (c === "{") depth++;
    if (c === "}") depth = Math.max(0, depth - 1);
    if (c === "," && depth === 0) {
      globs.push(current);
      current = "";
    } else current += c;
  }
  globs.push(current);
  return globs.map((glob) => glob.trim()).filter(Boolean);
}

/** A copy that finds every match from the start, whatever `lastIndex` the caller's pattern was left at. */
const everyMatch = (pattern: RegExp) =>
  new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);

/**
 * The matches in one file's text, at most `limit`, with the text around each
 * for the results list, and what each becomes when `replace` is given.
 */
export function searchText(
  text: string,
  pattern: RegExp,
  limit = MAX_MATCHES,
  replace?: ReplaceOptions,
): Match[] {
  const starts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  const matches: Match[] = [];
  const re = everyMatch(pattern);
  for (let m = re.exec(text); m && matches.length < limit; m = re.exec(text)) {
    if (m[0].length === 0) {
      re.lastIndex++; // an empty match (like ^) would never move on
      continue;
    }
    const index = lineOf(starts, m.index);
    const lineStart = starts[index]!;
    const lineEnd = index + 1 < starts.length ? starts[index + 1]! - 1 : text.length;
    const length = Math.min(m[0].length, lineEnd - m.index);
    const end = m.index + m[0].length;
    const endIndex = lineOf(starts, end);
    const before = text.slice(lineStart, m.index);
    const match: Match = {
      line: index + 1,
      column: m.index - lineStart + 1,
      length,
      endLine: endIndex + 1,
      endColumn: end - starts[endIndex]! + 1,
      before: before.length > 40 ? `…${before.slice(-39).trimStart()}` : before.trimStart(),
      text:
        length > SHOWN ? `${text.slice(m.index, m.index + SHOWN)}…` : text.slice(m.index, m.index + length),
      // A Windows line ending's \r isn't part of what's shown.
      after: text.slice(m.index + length, Math.min(lineEnd, m.index + length + 80)).replace(/\r$/, ""),
    };
    if (replace) match.replacement = replacementFor(replace, m, text);
    matches.push(match);
  }
  return matches;
}

/** The index of the line holding `offset`, from the lines' start offsets (binary search). */
function lineOf(starts: number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid]! <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
}

/**
 * Search the room's files in order, up to `limit` matches in all. Files the
 * include and exclude fields leave out aren't read, and big ones are skipped.
 */
export function searchFiles(
  files: ReadonlyArray<{ id: string; path: string }>,
  read: (id: string) => TextSource | undefined,
  pattern: RegExp,
  options: { filter?: (path: string) => boolean; limit?: number; replace?: ReplaceOptions } = {},
): SearchResults {
  const { filter = () => true, limit = MAX_MATCHES, replace } = options;
  const results: SearchResults = { files: [], count: 0, capped: false, skipped: 0 };
  for (const file of files) {
    if (!filter(file.path)) continue;
    const source = read(file.id);
    if (!source) continue;
    if (source.length > MAX_FILE_CHARS) {
      results.skipped++;
      continue;
    }
    // One more than fits, to know whether there are more than the limit.
    const matches = searchText(source.toString(), pattern, limit - results.count + 1, replace);
    if (results.count + matches.length > limit) {
      results.capped = true;
      matches.length = limit - results.count;
    }
    if (matches.length > 0) {
      results.files.push({ id: file.id, path: file.path, matches });
      results.count += matches.length;
    }
    if (results.capped) break;
  }
  return results;
}

/** Every match in the text as an edit, in order. Empty matches are left alone, as in the results. */
export function replacements(text: string, pattern: RegExp, replace: ReplaceOptions): Edit[] {
  const edits: Edit[] = [];
  const re = everyMatch(pattern);
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    edits.push({ index: m.index, length: m[0].length, text: replacementFor(replace, m, text) });
  }
  return edits;
}

/**
 * The edits a Replace all makes, file by file: every match, past the results'
 * limit too, in the files the search covers (big ones are left alone, as the
 * search leaves them).
 */
export function planReplace(
  files: ReadonlyArray<{ id: string; path: string }>,
  read: (id: string) => TextSource | undefined,
  pattern: RegExp,
  replace: ReplaceOptions,
  filter: (path: string) => boolean = () => true,
): Array<{ id: string; path: string; edits: Edit[] }> {
  return files.flatMap((file) => {
    const source = filter(file.path) ? read(file.id) : undefined;
    if (!source || source.length > MAX_FILE_CHARS) return [];
    const edits = replacements(source.toString(), pattern, replace);
    return edits.length > 0 ? [{ id: file.id, path: file.path, edits }] : [];
  });
}

/** The text with the edits made; they're in order and don't overlap, as replacements() gives them. */
export function applyEdits(text: string, edits: Edit[]): string {
  let out = "";
  let at = 0;
  for (const edit of edits) {
    out += text.slice(at, edit.index) + edit.text;
    at = edit.index + edit.length;
  }
  return out + text.slice(at);
}

/**
 * The file's text with every match replaced, and how many. With regex on, the
 * replacement can use groups ($1, $&); without it, it's taken literally.
 */
export function replaceText(
  text: string,
  pattern: RegExp,
  replacement: string,
  regex: boolean,
): { text: string; count: number } {
  const edits = replacements(text, pattern, { text: replacement, regex });
  return { text: applyEdits(text, edits), count: edits.length };
}

/** What one match becomes: the text as typed, or with regex on, its groups filled in from the real match. */
function replacementFor(replace: ReplaceOptions, match: RegExpExecArray, input: string): string {
  return replace.regex ? expand(replace.text, match, input) : replace.text;
}

/**
 * A replacement's $1, $& (or $0, as VS Code has it), $<name>, $` and $', as
 * String.replace reads them, plus \n, \t and \\ for what a one-line box can't type.
 */
function expand(template: string, match: RegExpExecArray, input: string): string {
  const groups = match.length - 1;
  return template.replace(
    /\$(\$|&|`|'|\d{1,2}|<([^>]*)>)|\\([nt\\])/g,
    (all, token: string | undefined, name: string | undefined, escape: string | undefined) => {
      if (escape) return escape === "n" ? "\n" : escape === "t" ? "\t" : "\\";
      if (token === "$") return "$";
      if (token === "&" || token === "0") return match[0];
      if (token === "`") return input.slice(0, match.index);
      if (token === "'") return input.slice(match.index + match[0].length);
      if (name !== undefined) return match.groups ? (match.groups[name] ?? "") : all;
      const n = Number(token);
      if (n >= 1 && n <= groups) return match[n] ?? "";
      // $12 with one group is $1 then a 2, as String.replace reads it.
      const first = Number(token![0]);
      if (token!.length === 2 && first >= 1 && first <= groups) return (match[first] ?? "") + token![1];
      return all;
    },
  );
}
