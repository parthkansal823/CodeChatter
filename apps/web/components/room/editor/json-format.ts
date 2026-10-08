/**
 * Re-indents valid JSON without touching its values: strings, numbers and
 * literals are copied as written (so 1.0 stays 1.0 and big numbers keep their
 * digits), only the whitespace between them changes. Returns null when the
 * text isn't valid JSON, so a half-typed file is never "fixed" into something else.
 * Monaco's own JSON language service isn't installed in this build; this
 * stands in for it.
 */
export function formatJson(text: string, indent: string): string | null {
  try {
    JSON.parse(text);
  } catch {
    return null;
  }
  const WHITESPACE = " \t\r\n";
  const n = text.length;
  const nextSignificant = (from: number) => {
    let i = from;
    while (i < n && WHITESPACE.includes(text[i]!)) i++;
    return i;
  };
  let out = "";
  let depth = 0;
  let i = 0;
  while (i < n) {
    const c = text[i]!;
    if (WHITESPACE.includes(c)) {
      i++;
    } else if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === "{" || c === "[") {
      const close = c === "{" ? "}" : "]";
      const next = nextSignificant(i + 1);
      if (text[next] === close) {
        out += c + close; // empty containers stay on one line
        i = next + 1;
      } else {
        depth++;
        out += `${c}\n${indent.repeat(depth)}`;
        i++;
      }
    } else if (c === "}" || c === "]") {
      depth--;
      out += `\n${indent.repeat(depth)}${c}`;
      i++;
    } else if (c === ",") {
      out += `,\n${indent.repeat(depth)}`;
      i++;
    } else if (c === ":") {
      out += ": ";
      i++;
    } else {
      let j = i;
      while (j < n && !`,]}:${WHITESPACE}`.includes(text[j]!)) j++;
      out += text.slice(i, j);
      i = j;
    }
  }
  return text.endsWith("\n") ? `${out}\n` : out;
}
