/**
 * A light outline for languages Monaco has no symbols for in this build (it has them
 * for TypeScript and JavaScript only, from their worker): Python classes and functions,
 * Markdown headings, and the functions and types of Go, Rust and shell scripts, read
 * from the text. Good enough for breadcrumbs, the Outline view and Go to symbol; the
 * language servers in the sandbox (roadmap §14 A) will replace it.
 */
export type SymbolItem = {
  name: string;
  kind: string;
  /** Character offsets of the whole declaration. */
  start: number;
  end: number;
  depth: number;
};

/** The outline of `text` read as `language` (a Monaco language id), or null when there's no reader for it. */
export function outlineFor(language: string, text: string): SymbolItem[] | null {
  switch (language) {
    case "python":
      return python(text);
    case "markdown":
      return markdown(text);
    case "go":
      return braced(text, GO);
    case "rust":
      return braced(text, RUST);
    case "shell":
      return braced(text, SHELL);
    default:
      return null;
  }
}

/** The symbols around an offset, outermost first ("Greeter", then "hello"). */
export function symbolsAt(symbols: SymbolItem[], offset: number): SymbolItem[] {
  const chain: SymbolItem[] = [];
  for (const symbol of symbols) {
    if (symbol.start <= offset && offset <= symbol.end && symbol.depth === chain.length) chain.push(symbol);
  }
  return chain;
}

/** The symbols beside `symbol`: the same parent and depth (for a breadcrumb's menu). */
export function siblingsOf(symbols: SymbolItem[], symbol: SymbolItem): SymbolItem[] {
  const parent = symbolsAt(symbols, symbol.start).find((s) => s.depth === symbol.depth - 1);
  return symbols.filter(
    (s) => s.depth === symbol.depth && (!parent || (s.start >= parent.start && s.end <= parent.end)),
  );
}

type Line = { text: string; start: number };

function linesOf(text: string): Line[] {
  const out: Line[] = [];
  let start = 0;
  for (const part of text.split("\n")) {
    out.push({ text: part.endsWith("\r") ? part.slice(0, -1) : part, start });
    start += part.length + 1;
  }
  return out;
}

const indentOf = (line: string) => {
  let n = 0;
  for (const ch of line) {
    if (ch === " ") n += 1;
    else if (ch === "\t") n += 4;
    else break;
  }
  return n;
};

/** Classes, functions and methods, nested by indentation; a block ends at the next line indented as far or less. */
function python(text: string): SymbolItem[] {
  const out: SymbolItem[] = [];
  const open: { indent: number; item: SymbolItem }[] = [];
  let quote: string | null = null;
  let lastCodeEnd = 0;
  for (const line of linesOf(text)) {
    const code = line.text;
    // Inside a triple-quoted string (a docstring can start at column 0): not code.
    const inString = quote !== null;
    for (const q of ['"""', "'''"]) {
      if (quote !== null && quote !== q) continue;
      if ((code.split(q).length - 1) % 2 === 1) quote = quote === null ? q : null;
    }
    if (inString) continue;
    const trimmed = code.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const indent = indentOf(code);
    while (open.length && indent <= open[open.length - 1]!.indent) open.pop()!.item.end = lastCodeEnd;
    const match = /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)|^\s*class\s+([A-Za-z_]\w*)/.exec(code);
    if (match) {
      const parent = open[open.length - 1]?.item;
      const item: SymbolItem = {
        name: (match[1] ?? match[2])!,
        kind: match[2] ? "class" : parent?.kind === "class" ? "method" : "function",
        start: line.start + indent,
        end: text.length,
        depth: open.length,
      };
      out.push(item);
      open.push({ indent, item });
    }
    lastCodeEnd = line.start + code.length;
  }
  return out;
}

/** ATX headings (# to ######) outside code fences, nested by level; a section runs to the next heading as high or higher. */
function markdown(text: string): SymbolItem[] {
  const out: SymbolItem[] = [];
  const open: { level: number; item: SymbolItem }[] = [];
  let fence: string | null = null;
  for (const line of linesOf(text)) {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line.text);
    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      if (fence === null) fence = marker[0]!.repeat(marker.length);
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line.text);
    if (!heading || !heading[2]) continue;
    const level = heading[1]!.length;
    while (open.length && open[open.length - 1]!.level >= level) open.pop()!.item.end = Math.max(0, line.start - 1);
    const item: SymbolItem = { name: heading[2], kind: `h${level}`, start: line.start, end: text.length, depth: open.length };
    out.push(item);
    open.push({ level, item });
  }
  return out;
}

type Pattern = { re: RegExp; kind: (m: RegExpExecArray) => string; name: (m: RegExpExecArray) => string };
/** How a language writes comments and strings, so braces inside them don't count. */
type Syntax = { patterns: Pattern[]; hashComments: boolean; singleQuoteStrings: boolean };

/** Each pattern is matched at the start of a line (flags gm); its body is the braces that follow it. */
const GO: Syntax = {
  hashComments: false,
  singleQuoteStrings: false,
  patterns: [
    {
      re: /^func\s+(?:\(\s*\w*\s*\*?\s*([A-Za-z_]\w*)[^)]*\)\s*)?([A-Za-z_]\w*)/gm,
      kind: (m) => (m[1] ? "method" : "function"),
      name: (m) => (m[1] ? `(${m[1]}).${m[2]}` : m[2]!),
    },
    {
      re: /^type\s+([A-Za-z_]\w*)(?:\[[^\]]*\])?\s+(struct|interface)?/gm,
      kind: (m) => m[2] ?? "type",
      name: (m) => m[1]!,
    },
  ],
};

const RUST_VIS = String.raw`(?:pub(?:\([^)]*\))?\s+)?`;
const RUST: Syntax = {
  hashComments: false,
  singleQuoteStrings: false,
  patterns: [
    {
      re: new RegExp(String.raw`^[ \t]*${RUST_VIS}(?:(?:async|const|unsafe|extern(?:\s+"[^"]*")?)\s+)*fn\s+([A-Za-z_]\w*)`, "gm"),
      kind: () => "function",
      name: (m) => m[1]!,
    },
    {
      re: new RegExp(String.raw`^[ \t]*${RUST_VIS}(struct|enum|trait|mod|union)\s+([A-Za-z_]\w*)`, "gm"),
      kind: (m) => m[1]!,
      name: (m) => m[2]!,
    },
    {
      re: /^[ \t]*(?:unsafe\s+)?impl(?:<[^>{]*>)?\s+([^{;]+?)\s*(?:where\b[^{]*)?(?=\{)/gm,
      kind: () => "impl",
      name: (m) => `impl ${m[1]!.replace(/\s+/g, " ")}`,
    },
  ],
};

const SHELL: Syntax = {
  hashComments: true,
  singleQuoteStrings: true,
  patterns: [
    {
      re: /^[ \t]*(?:function\s+([A-Za-z_][\w-]*)\s*(?:\(\s*\))?|([A-Za-z_][\w-]*)\s*\(\s*\))[ \t]*(?=\{|\n|$)/gm,
      kind: () => "function",
      name: (m) => (m[1] ?? m[2])!,
    },
  ],
};

type Head = { name: string; kind: string; start: number; headEnd: number };

/**
 * Declarations whose bodies are in braces. Braces in strings and comments don't count,
 * and a body is the first `{` after the declaration's head unless another declaration
 * starts first (Go's `type ID int` has none). A `;` first (Rust's `struct Unit;`, a
 * trait's `fn f();`) ends it there.
 */
function braced(text: string, syntax: Syntax): SymbolItem[] {
  const { events, inCode } = scan(text, syntax);
  const heads: Head[] = [];
  for (const pattern of syntax.patterns) {
    pattern.re.lastIndex = 0;
    for (let m = pattern.re.exec(text); m; m = pattern.re.exec(text)) {
      if (m[0].length === 0) {
        pattern.re.lastIndex += 1;
        continue;
      }
      const start = m.index + (m[0].length - m[0].trimStart().length);
      if (inCode(start)) heads.push({ name: pattern.name(m), kind: pattern.kind(m), start, headEnd: m.index + m[0].length });
    }
  }
  heads.sort((a, b) => a.start - b.start);
  const out: SymbolItem[] = [];
  const open: SymbolItem[] = [];
  heads.forEach((head, i) => {
    const nextStart = heads[i + 1]?.start ?? text.length;
    const end = bodyEnd(text, events, head.headEnd, nextStart);
    // Nesting from the spans: a symbol sits inside every earlier one still open at its start.
    while (open.length && open[open.length - 1]!.end < head.start) open.pop();
    const parent = open[open.length - 1];
    // A Rust fn inside an impl or trait is a method.
    const kind = head.kind === "function" && (parent?.kind === "impl" || parent?.kind === "trait") ? "method" : head.kind;
    const item: SymbolItem = { name: head.name, kind, start: head.start, end, depth: open.length };
    out.push(item);
    open.push(item);
  });
  return out;
}

type BraceEvent = { at: number; ch: "{" | "}" | ";" };

/** Every `{`, `}` and `;` outside strings and comments, and whether an offset is code at all. */
function scan(text: string, syntax: Syntax): { events: BraceEvent[]; inCode: (offset: number) => boolean } {
  const events: BraceEvent[] = [];
  const skipped: [number, number][] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    const next = text[i + 1];
    let to = -1;
    if (ch === "/" && next === "/" && !syntax.hashComments) to = indexOrEnd(text, "\n", i);
    else if (ch === "/" && next === "*" && !syntax.hashComments) to = indexOrEnd(text, "*/", i + 2) + 2;
    // A shell comment starts a word ($# and ${#x} aren't comments).
    else if (ch === "#" && syntax.hashComments && (i === 0 || /\s/.test(text[i - 1]!))) to = indexOrEnd(text, "\n", i);
    else if (ch === '"' || ch === "`") to = closing(text, i, ch);
    // Shell quotes run to the next quote; elsewhere ' is a char literal ('{') or a Rust lifetime ('a).
    else if (ch === "'" && (syntax.singleQuoteStrings || /^'(?:\\.|[^'\\])'/.test(text.slice(i, i + 4)))) to = closing(text, i, "'");
    if (to !== -1) {
      skipped.push([i, to]);
      i = to;
      continue;
    }
    if (ch === "{" || ch === "}" || ch === ";") events.push({ at: i, ch });
    i += 1;
  }
  return { events, inCode: (offset) => !skipped.some(([a, b]) => offset >= a && offset < b) };
}

const indexOrEnd = (text: string, needle: string, from: number) => {
  const at = text.indexOf(needle, from);
  return at === -1 ? text.length : at;
};

/** Past the quote that closes the one at `from` (backslashes escape). */
function closing(text: string, from: number, quote: string): number {
  for (let i = from + 1; i < text.length; i++) {
    if (text[i] === "\\" && quote !== "'") i += 1;
    else if (text[i] === quote) return i + 1;
  }
  return text.length;
}

/** Where a declaration whose head ends at `from` ends: its matching `}`, a `;`, or its own line. */
function bodyEnd(text: string, events: BraceEvent[], from: number, nextStart: number): number {
  const lineEnd = indexOrEnd(text, "\n", from);
  let index = events.findIndex((e) => e.at >= from);
  const first = events[index];
  if (!first || first.at >= nextStart) return lineEnd;
  if (first.ch === ";") return first.at + 1;
  if (first.ch === "}") return lineEnd;
  let depth = 0;
  for (; index < events.length; index++) {
    const e = events[index]!;
    if (e.ch === "{") depth += 1;
    else if (e.ch === "}" && --depth === 0) return e.at + 1;
  }
  return text.length;
}
