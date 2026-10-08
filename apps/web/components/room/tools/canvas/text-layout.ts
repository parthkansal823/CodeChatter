/**
 * Text layout for SVG, which can't wrap text itself. The live canvas and the
 * SVG/PNG export both lay text out here, so an export wraps exactly like the
 * canvas does. Measuring is injected: the browser measures with a canvas, and
 * tests use a fixed-width stand-in.
 */
export type FontFamily = "sans" | "note";
export type Font = { size: number; weight: number; family: FontFamily };
export type Measure = (text: string, font: Font) => number;
export type TextLayout = { lines: string[]; width: number; height: number };

export const lineHeight = (size: number) => Math.round(size * 1.3);

/** Padding between a sticky note's edge and its text. */
export const STICKY_PADDING = 16;

function breakWord(word: string, maxWidth: number, font: Font, measure: Measure): string[] {
  const pieces: string[] = [];
  let current = "";
  for (const char of word) {
    if (current && measure(current + char, font) > maxWidth) {
      pieces.push(current);
      current = char;
    } else current += char;
  }
  if (current) pieces.push(current);
  return pieces;
}

function wrapParagraph(paragraph: string, maxWidth: number, font: Font, measure: Measure): string[] {
  if (!paragraph) return [""];
  const words = paragraph.split(/(\s+)/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current + word;
    if (!current || measure(candidate.trimEnd(), font) <= maxWidth) {
      if (!current && measure(word, font) > maxWidth && word.trim()) {
        const pieces = breakWord(word, maxWidth, font, measure);
        lines.push(...pieces.slice(0, -1));
        current = pieces[pieces.length - 1] ?? "";
      } else current = candidate;
      continue;
    }
    lines.push(current.trimEnd());
    if (!word.trim()) {
      current = "";
    } else if (measure(word, font) > maxWidth) {
      const pieces = breakWord(word, maxWidth, font, measure);
      lines.push(...pieces.slice(0, -1));
      current = pieces[pieces.length - 1] ?? "";
    } else current = word;
  }
  lines.push(current.trimEnd());
  return lines;
}

/** Lines for `text`, wrapped at maxWidth (null: only at newlines), and the box they need. */
export function layoutText(text: string, maxWidth: number | null, font: Font, measure: Measure): TextLayout {
  const paragraphs = text.split("\n");
  const lines = maxWidth === null ? paragraphs : paragraphs.flatMap((p) => wrapParagraph(p, Math.max(1, maxWidth), font, measure));
  const width = lines.reduce((max, line) => Math.max(max, measure(line, font)), 0);
  return { lines, width: Math.ceil(width), height: lines.length * lineHeight(font.size) };
}

/** Where a line starts for an alignment, and the matching SVG text-anchor. */
export function alignX(align: "left" | "center" | "right", x: number, width: number): { x: number; anchor: "start" | "middle" | "end" } {
  if (align === "center") return { x: x + width / 2, anchor: "middle" };
  if (align === "right") return { x: x + width, anchor: "end" };
  return { x, anchor: "start" };
}
