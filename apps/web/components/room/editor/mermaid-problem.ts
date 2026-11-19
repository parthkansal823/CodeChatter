/** Turn Mermaid parse failures into short messages and block-local, bounded source lines. */
import { mermaidErrorLine } from "./preview-kind";

export type Problem = { message: string; line: number | null };

/** The line already belongs to the supplied source, rather than Mermaid's preprocessed parser input. */
export class MermaidSourceError extends Error {
  constructor(readonly sourceLine: number) {
    super("HTML tags are not supported in diagram labels.");
    this.name = "MermaidSourceError";
  }
}

/** Stop HTML before Mermaid constructs its temporary DOM, including commonly encoded tag spellings. */
export function assertNoMermaidHtml(text: string): void {
  if (!/[<&]|#[a-z\d]/i.test(text)) return;
  let code = text;
  let positions = Array.from({ length: code.length }, (_, index) => index);
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", tab: "\t", newline: "\n" };
  for (let pass = 0; pass < 2; pass++) {
    const pattern = /&(?:amp;)*(?:(?:amp|lt|gt|tab|newline);?|#(?:x[0-9a-f]+|\d+);?)|#(?:amp|lt|gt|tab|newline|x[0-9a-f]+|\d+);/gi;
    const parts: string[] = [];
    const kept: number[][] = [];
    let from = 0;
    for (const match of code.matchAll(pattern)) {
      parts.push(code.slice(from, match.index));
      kept.push(positions.slice(from, match.index));
      const token = match[0].replace(/^&(?:amp;)*/i, "").replace(/;$/, "");
      const numeric = /^#(x[0-9a-f]+|\d+)$/i.exec(token)?.[1];
      const point = numeric ? parseInt(numeric.replace(/^x/i, ""), /^x/i.test(numeric) ? 16 : 10) : NaN;
      const replacement = entities[token.replace(/^#/, "").toLowerCase()] ?? (Number.isSafeInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match[0]);
      parts.push(replacement);
      kept.push(Array.from({ length: replacement.length }, () => positions[match.index]!));
      from = match.index + match[0].length;
    }
    parts.push(code.slice(from));
    kept.push(positions.slice(from));
    const next = parts.join("");
    if (next === code) break;
    code = next;
    positions = kept.flat();
  }
  // Mermaid's inheritance/arrow markers start with punctuation, so <| and <-- remain valid.
  const tag = /<\/?[a-z]/i.exec(code);
  if (tag) throw new MermaidSourceError(text.slice(0, positions[tag.index] ?? 0).split(/\r\n?|\n/).length);
}

/** Match Mermaid 11.17.2's removed metadata/comments while retaining each surviving character's source position. */
export function mermaidSourceLine(reported: number | null, text: string): number | null {
  if (reported === null || !Number.isSafeInteger(reported) || reported < 1) return null;
  const source = text.replace(/\r\n?/g, "\n");
  let code = source;
  let positions = Array.from({ length: code.length }, (_, index) => index);
  const remove = (pattern: RegExp) => {
    const parts: string[] = [];
    const kept: number[][] = [];
    let from = 0;
    for (const match of code.matchAll(pattern)) {
      parts.push(code.slice(from, match.index));
      kept.push(positions.slice(from, match.index));
      from = match.index + match[0].length;
    }
    parts.push(code.slice(from));
    kept.push(positions.slice(from));
    code = parts.join("");
    positions = kept.flat();
  };
  // Front matter and directives are removed before comment cleanup in Mermaid's preprocessor.
  remove(/^([^\S\n\r]*)-{3}\s*[\n\r](.*?)[\n\r]\1-{3}\s*[\n\r]+/sg);
  remove(/%{2}{\s*(?:(\w+)\s*:|(\w+))\s*(?:(\w+)|((?:(?!}%{2}).|\r?\n)*))?\s*(?:}%{2})?/gi);
  remove(/^\s*%%(?!{)[^\n]+\n?/gm);
  const trimmed = code.length - code.trimStart().length;
  code = code.slice(trimmed);
  positions = positions.slice(trimmed);
  if (!code) return null;
  let offset = 0;
  for (let line = 1; line < reported; line++) {
    const next = code.indexOf("\n", offset);
    // Diagram.fromText adds a newline; an EOF error can point just past the supplied block.
    if (next === -1) return source.split("\n").length;
    offset = next + 1;
  }
  const original = positions[offset];
  return original === undefined ? source.split("\n").length : source.slice(0, original).split("\n").length;
}

export function problemOf(error: unknown, text: string): Problem {
  if (error instanceof MermaidSourceError) return { message: error.message, line: error.sourceLine };
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const message = typeof record.message === "string" ? record.message : typeof record.str === "string" ? record.str : String(error);
  const hash = record.hash && typeof record.hash === "object" ? record.hash as Record<string, unknown> : {};
  const location = hash.loc && typeof hash.loc === "object" ? hash.loc as Record<string, unknown> : {};
  const reported = mermaidErrorLine(message) ?? (typeof location.first_line === "number" ? location.first_line : typeof hash.line === "number" ? hash.line + 1 : null);
  const line = mermaidSourceLine(reported, text);
  if (/No diagram type|UnknownDiagram/i.test(message)) return { line: line ?? mermaidSourceLine(1, text) ?? 1, message: "Start with a diagram type, for example graph TD." };
  if (/max(?:imum)?.*(?:size|edges)|too (?:large|many)/i.test(message)) return { line, message: "This diagram is too large to draw. Try fewer nodes and arrows." };
  const expected = /Expecting ([\s\S]+?),\s*got\b/i.exec(message)?.[1] ?? "";
  if (/ARROW|LINK/.test(expected)) return { line, message: "Mermaid expected an arrow or a node label here." };
  if (/SQE|PE|STOP/.test(expected)) return { line, message: "Mermaid expected a closing bracket or a node label here." };
  return { line, message: "Mermaid couldn't draw this yet. Check the diagram type, arrows and brackets." };
}

