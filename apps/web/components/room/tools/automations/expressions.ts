/**
 * Expressions without a server: the fields of a step's data, each with the expression that reads it (what the Schema view lists and "Use" puts in a field), and
 * what an expression in a field comes to on the run being looked at. The engine works out the real value when it runs; this only reads paths, so anything
 * more than a path says so rather than guessing.
 */

export type DataField = { path: string; expression: string; type: string; sample: string; depth: number };

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const MOST_FIELDS = 300;
const DEEPEST = 6;

const typeOf = (value: unknown) => (value === null ? "null" : Array.isArray(value) ? "list" : typeof value === "object" ? "object" : typeof value);
const sampleOf = (value: unknown) => {
  if (value === undefined) return "";
  if (value === null || typeof value !== "object") return String(value).slice(0, 80);
  return Array.isArray(value) ? `${value.length} items` : `${Object.keys(value).length} fields`;
};
const segment = (key: string) => (IDENTIFIER.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`);

/** Every field of a value, as paths from `base`, down to a few levels. A list shows its first item's fields, as each item is usually alike. */
export function fieldsOf(value: unknown, base: string): DataField[] {
  const found: DataField[] = [];
  const walk = (current: unknown, path: string, depth: number) => {
    if (found.length >= MOST_FIELDS) return;
    if (depth > 0) found.push({ path, expression: `{{${path}}}`, type: typeOf(current), sample: sampleOf(current), depth });
    if (depth >= DEEPEST || current === null || typeof current !== "object") return;
    if (Array.isArray(current)) {
      if (current.length) walk(current[0], `${path}[0]`, depth + 1);
      return;
    }
    for (const [key, item] of Object.entries(current)) walk(item, `${path}${segment(key)}`, depth + 1);
  };
  walk(value, base, 0);
  return found;
}

/** A path's parts: names and list positions. Null when it isn't only a path. */
export function partsOf(path: string): Array<string | number> | null {
  const parts: Array<string | number> = [];
  const pattern = /^(?:\.?([A-Za-z_$][A-Za-z0-9_$]*)|\[(\d+)\]|\[("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\])/;
  let rest = path.trim();
  if (!rest || rest.startsWith(".")) return null;
  while (rest) {
    const match = pattern.exec(rest);
    if (!match) return null;
    if (match[1] !== undefined) parts.push(match[1]);
    else if (match[2] !== undefined) parts.push(Number(match[2]));
    else {
      const quoted = match[3]!;
      try {
        parts.push(quoted.startsWith("'") ? JSON.parse(`"${quoted.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"')}"`) : JSON.parse(quoted));
      } catch {
        return null;
      }
    }
    rest = rest.slice(match[0].length);
  }
  return parts;
}

const MISSING = Symbol("missing");
function read(data: Record<string, unknown>, parts: Array<string | number>): unknown {
  let current: unknown = data;
  for (const part of parts) {
    if (current === null || typeof current !== "object" || !(part in (current as object))) return MISSING;
    current = (current as Record<string | number, unknown>)[part];
  }
  return current;
}

export type Preview = { kind: "value"; value: unknown } | { kind: "text"; text: string } | { kind: "none"; reason: string };

/**
 * What a field's text comes to, with each {{path}} read from `data` (each step's output by its name: `{ step_1: { output } }`). A field that's one
 * expression gives its value as it is; text around expressions gives text. A step that didn't run, or anything that isn't a plain path, says so.
 */
export function previewOf(text: string, data: Record<string, unknown>): Preview {
  const expressions = [...text.matchAll(/\{\{([\s\S]*?)\}\}/g)];
  if (!expressions.length) return { kind: "none", reason: "No expression in it." };
  const valueOf = (inner: string): unknown => {
    const parts = partsOf(inner);
    if (!parts) return MISSING;
    return read(data, parts);
  };
  const whole = expressions.length === 1 && expressions[0]![0] === text.trim();
  if (whole) {
    const inner = expressions[0]![1]!;
    if (!partsOf(inner)) return { kind: "none", reason: "Only plain paths are shown here; the engine works the rest out when it runs." };
    const value = valueOf(inner);
    return value === MISSING ? { kind: "none", reason: "Nothing there on this run." } : { kind: "value", value };
  }
  let missing = false;
  const out = text.replace(/\{\{([\s\S]*?)\}\}/g, (_, inner: string) => {
    const value = valueOf(inner);
    if (value === MISSING) {
      missing = true;
      return "…";
    }
    return value !== null && typeof value === "object" ? JSON.stringify(value) : String(value);
  });
  return missing ? { kind: "none", reason: "Part of it has nothing there on this run." } : { kind: "text", text: out };
}

/** Puts an expression where the cursor is in a field's text. */
export function insertAt(text: string, start: number, end: number, expression: string): { text: string; cursor: number } {
  const at = Math.max(0, Math.min(start, text.length));
  const to = Math.max(at, Math.min(end, text.length));
  return { text: `${text.slice(0, at)}${expression}${text.slice(to)}`, cursor: at + expression.length };
}
