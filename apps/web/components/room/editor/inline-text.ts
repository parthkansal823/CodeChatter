import { AI_COMPLETE_LIMITS } from "@codechatter/contracts";

/** How far the start of the text sent moves at a time (see completionWindow). */
const STEP = 1_000;

/**
 * The text before and after the cursor to send for a suggestion: whole lines
 * within the API's limits, always with the rest of the current line. In a long
 * file the start moves in steps rather than with every key, so a local model's
 * prompt cache keeps matching while you type.
 */
export function completionWindow(text: string, offset: number): { prefix: string; suffix: string } {
  let start = 0;
  if (offset > AI_COMPLETE_LIMITS.prefixChars) {
    const step = Math.ceil((offset - AI_COMPLETE_LIMITS.prefixChars) / STEP) * STEP;
    const lineBreak = text.indexOf("\n", step - 1);
    start = lineBreak === -1 || lineBreak >= offset ? step : lineBreak + 1;
  }
  const lineEnd = text.includes("\n", offset) ? text.indexOf("\n", offset) : text.length;
  let end = Math.min(text.length, offset + AI_COMPLETE_LIMITS.suffixChars);
  if (end < text.length) {
    const lastBreak = text.lastIndexOf("\n", end);
    if (lastBreak >= lineEnd) end = lastBreak;
  }
  return { prefix: text.slice(start, offset), suffix: text.slice(offset, end) };
}

/**
 * The part of the file (absolute offsets) that completionWindow needs around
 * `offset`, so a long file isn't copied at every key. It starts on a step
 * boundary, which keeps the window's steps where they would be in the whole file.
 */
export function windowRange(offset: number): { start: number; end: number } {
  const start = Math.max(0, Math.floor((offset - AI_COMPLETE_LIMITS.prefixChars - STEP) / STEP) * STEP);
  return { start, end: offset + AI_COMPLETE_LIMITS.suffixChars + 1 };
}

/**
 * Whether a suggestion could fit here: there is code before the cursor, and
 * the rest of the line (`after`) is empty or only closing brackets, quotes and
 * punctuation. Not in the middle of a word or an expression.
 */
export function worthAsking(prefix: string, after: string): boolean {
  return prefix.trim() !== "" && /^[\s)\]}>"'`;:,.]*$/.test(after);
}

/** The editor's language id as the API accepts it, or "" (the server then goes by the file name). */
export function languageId(id: string): string {
  return id.length <= 40 && /^[\w.+#-]*$/.test(id) ? id : "";
}
