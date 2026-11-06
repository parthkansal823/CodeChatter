/**
 * Which candidates' code looks alike. Renaming variables or changing the spacing doesn't hide it:
 * the code is reduced to its shape (every name the same word, every number and string alike),
 * and compared by fingerprints of its overlapping runs of tokens, the way MOSS does. What the
 * room started with doesn't count, or everyone would match on the starter code.
 *
 * It's a pointer for a person to look at, not proof: short solutions to the same small problem
 * do look alike.
 */

const KGRAM = 12;
const WINDOW = 4;
/** Below this there's too little of their own code to compare fairly. */
const LEAST_FINGERPRINTS = 12;

const KEYWORDS = new Set(
  "if else elif for while do return def function class import from export const let var public private static void int long float double bool string char new try catch except finally throw raise switch case break continue print printf println in of not and or true false null none self this struct enum fn func package using namespace".split(" "),
);

/** The code's shape, token by token. */
export function shapeOf(code: string): string[] {
  // Strings come first in the pattern, so a "#" or "//" inside one isn't taken for a comment.
  const tokens = code.match(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`[^`]*`|\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*|[A-Za-z_$][\w$]*|\d[\w.]*|[^\s\w]/g) ?? [];
  return tokens.filter((token) => !/^(\/\*|\/\/|#)/.test(token)).map((token) => {
    if (/^["'`]/.test(token)) return "S";
    if (/^\d/.test(token)) return "0";
    if (/^[A-Za-z_$]/.test(token)) return KEYWORDS.has(token.toLowerCase()) ? token.toLowerCase() : "v";
    return token;
  });
}

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

/** Winnowing: the smallest hash in each window, so any long enough shared run leaves a shared fingerprint. */
export function fingerprints(code: string): Set<number> {
  const tokens = shapeOf(code);
  const hashes: number[] = [];
  for (let i = 0; i + KGRAM <= tokens.length; i++) hashes.push(hash(tokens.slice(i, i + KGRAM).join(" ")));
  const picked = new Set<number>();
  if (hashes.length && hashes.length < WINDOW) picked.add(Math.min(...hashes));
  for (let i = 0; i + WINDOW <= hashes.length; i++) picked.add(Math.min(...hashes.slice(i, i + WINDOW)));
  return picked;
}

export type CodeEntry = {
  id: string;
  name: string;
  /** What they ended with, and what the room started with. */
  code: string;
  starter: string;
};
export type SimilarPair = { a: string; b: string; names: [string, string]; overlap: number };

/**
 * Pairs that share at least `least` of the smaller one's own code, most alike first. A
 * fingerprint most of the group has is boilerplate, or the only way to write it.
 */
export function similarPairs(entries: readonly CodeEntry[], least = 0.5): SimilarPair[] {
  const own = entries.map((entry) => {
    const starter = fingerprints(entry.starter);
    return { entry, prints: new Set([...fingerprints(entry.code)].filter((print) => !starter.has(print))) };
  });
  const seen = new Map<number, number>();
  for (const { prints } of own) for (const print of prints) seen.set(print, (seen.get(print) ?? 0) + 1);
  const common = own.length >= 4 ? Math.ceil(own.length * 0.6) : Infinity;
  const usable = own.map(({ entry, prints }) => ({ entry, prints: new Set([...prints].filter((print) => (seen.get(print) ?? 0) < common)) }));

  const pairs: SimilarPair[] = [];
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      const a = usable[i]!;
      const b = usable[j]!;
      const smaller = Math.min(a.prints.size, b.prints.size);
      if (smaller < LEAST_FINGERPRINTS) continue;
      let shared = 0;
      for (const print of a.prints) if (b.prints.has(print)) shared += 1;
      const overlap = shared / smaller;
      if (overlap >= least) pairs.push({ a: a.entry.id, b: b.entry.id, names: [a.entry.name, b.entry.name], overlap });
    }
  }
  return pairs.sort((x, y) => y.overlap - x.overlap);
}
