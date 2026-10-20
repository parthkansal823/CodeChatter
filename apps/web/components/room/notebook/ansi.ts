/**
 * Text with ANSI colour codes (IPython colours its tracebacks) as runs of plain text
 * and a colour name, which the view maps to the terminal tokens (--term-*). Bold and
 * dim are kept; cursor moves and every other escape are dropped.
 */
export type AnsiColor = "black" | "red" | "green" | "yellow" | "blue" | "magenta" | "cyan" | "white" | "bright-black";
export type AnsiRun = { text: string; color: AnsiColor | null; bold: boolean; dim: boolean };

const COLORS: AnsiColor[] = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];

const ESCAPE = /\x1b\[([0-9;]*)([A-Za-z])|\x1b\][^\x07]*\x07|\x1b[@-_]/g;

export function parseAnsi(input: string): AnsiRun[] {
  const runs: AnsiRun[] = [];
  let color: AnsiColor | null = null;
  let bold = false;
  let dim = false;
  let last = 0;
  const push = (text: string) => {
    if (!text) return;
    const prev = runs[runs.length - 1];
    if (prev && prev.color === color && prev.bold === bold && prev.dim === dim) prev.text += text;
    else runs.push({ text, color, bold, dim });
  };
  for (const match of input.matchAll(ESCAPE)) {
    push(input.slice(last, match.index));
    last = match.index + match[0].length;
    // Only "select graphic rendition" (…m) changes how text looks.
    if (match[2] !== "m") continue;
    const codes = (match[1] || "0").split(";").map((c) => Number(c || 0));
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i]!;
      if (code === 0) {
        color = null;
        bold = false;
        dim = false;
      } else if (code === 1) bold = true;
      else if (code === 2) dim = true;
      else if (code === 22) {
        bold = false;
        dim = false;
      } else if (code >= 30 && code <= 37) color = COLORS[code - 30]!;
      else if (code === 39) color = null;
      else if (code === 90) color = "bright-black";
      else if (code >= 91 && code <= 97) color = COLORS[code - 90]!;
      // 256-colour and true-colour codes carry their arguments: skip them.
      else if (code === 38 || code === 48) i += codes[i + 1] === 5 ? 2 : codes[i + 1] === 2 ? 4 : 0;
    }
  }
  push(input.slice(last));
  return runs;
}

/** The text without any escapes, for copying and for screen readers. */
export const stripAnsi = (input: string) => input.replace(ESCAPE, "");
