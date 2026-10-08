/**
 * Fractional indexing for stacking order: every shape has a string key `z`,
 * and a key can always be made between any two others, so reordering one
 * shape writes one key instead of renumbering its siblings (which would
 * conflict when two people reorder at once). Keys compare as plain strings.
 *
 * This is the algorithm from David Greenspan's "Implementing Fractional
 * Indexing" (as in the fractional-indexing package): an integer part whose
 * length is encoded in its first character, so appending keeps keys short,
 * then a base-62 fraction for insertions in between.
 */
const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const SMALLEST_INTEGER = "A" + "0".repeat(26);

function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new Error(`order: ${a} >= ${b}`);
  if (a.endsWith("0") || (b && b.endsWith("0"))) throw new Error("order: trailing zero");
  if (b) {
    let n = 0;
    while ((a[n] ?? "0") === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? DIGITS.indexOf(a[0]!) : 0;
  const digitB = b !== null ? DIGITS.indexOf(b[0]!) : DIGITS.length;
  if (digitB - digitA > 1) return DIGITS[Math.round(0.5 * (digitA + digitB))]!;
  if (b && b.length > 1) return b.slice(0, 1);
  return DIGITS[digitA]! + midpoint(a.slice(1), null);
}

function integerLength(head: string): number {
  if (head >= "a" && head <= "z") return head.charCodeAt(0) - 97 + 2;
  if (head >= "A" && head <= "Z") return 90 - head.charCodeAt(0) + 2;
  throw new Error(`order: invalid key head ${head}`);
}

function integerPart(key: string): string {
  const length = integerLength(key[0]!);
  if (length > key.length) throw new Error(`order: invalid key ${key}`);
  return key.slice(0, length);
}

function validate(key: string) {
  if (key === SMALLEST_INTEGER) throw new Error(`order: invalid key ${key}`);
  const i = integerPart(key);
  if (key.slice(i.length).endsWith("0")) throw new Error(`order: invalid key ${key}`);
}

function incrementInteger(x: string): string | null {
  const [head, ...digits] = x.split("") as [string, ...string[]];
  let carry = true;
  for (let i = digits.length - 1; carry && i >= 0; i--) {
    const d = DIGITS.indexOf(digits[i]!) + 1;
    if (d === DIGITS.length) digits[i] = "0";
    else {
      digits[i] = DIGITS[d]!;
      carry = false;
    }
  }
  if (!carry) return head + digits.join("");
  if (head === "Z") return "a0";
  if (head === "z") return null;
  const next = String.fromCharCode(head.charCodeAt(0) + 1);
  if (next > "a") digits.push("0");
  else digits.pop();
  return next + digits.join("");
}

function decrementInteger(x: string): string | null {
  const [head, ...digits] = x.split("") as [string, ...string[]];
  let borrow = true;
  for (let i = digits.length - 1; borrow && i >= 0; i--) {
    const d = DIGITS.indexOf(digits[i]!) - 1;
    if (d === -1) digits[i] = "z";
    else {
      digits[i] = DIGITS[d]!;
      borrow = false;
    }
  }
  if (!borrow) return head + digits.join("");
  if (head === "a") return "Zz";
  if (head === "A") return null;
  const next = String.fromCharCode(head.charCodeAt(0) - 1);
  if (next < "Z") digits.push("z");
  else digits.pop();
  return next + digits.join("");
}

/** A key that sorts after `a` and before `b` (null means "no bound"). */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null) validate(a);
  if (b !== null) validate(b);
  if (a !== null && b !== null && a >= b) throw new Error(`order: ${a} >= ${b}`);
  if (a === null) {
    if (b === null) return "a0";
    const ib = integerPart(b);
    const fb = b.slice(ib.length);
    if (ib === SMALLEST_INTEGER) return ib + midpoint("", fb);
    if (ib < b) return ib;
    const decremented = decrementInteger(ib);
    if (decremented === null) throw new Error("order: cannot go lower");
    return decremented;
  }
  if (b === null) {
    const ia = integerPart(a);
    const fa = a.slice(ia.length);
    const incremented = incrementInteger(ia);
    return incremented === null ? ia + midpoint(fa, null) : incremented;
  }
  const ia = integerPart(a);
  const fa = a.slice(ia.length);
  const ib = integerPart(b);
  const fb = b.slice(ib.length);
  if (ia === ib) return ia + midpoint(fa, fb);
  const incremented = incrementInteger(ia);
  if (incremented === null) throw new Error("order: cannot go higher");
  if (incremented < b) return incremented;
  return ia + midpoint(fa, null);
}

/** `n` ascending keys between a and b, for inserting several shapes at once. */
export function keysBetween(a: string | null, b: string | null, n: number): string[] {
  const keys: string[] = [];
  let previous = a;
  for (let i = 0; i < n; i++) {
    previous = keyBetween(previous, b);
    keys.push(previous);
  }
  return keys;
}

/**
 * Stacking order. Two people can make the same key at the same moment, so
 * ties fall back to the id: everyone still sees the same order.
 */
export function compareOrder(a: { z: string; id: string }, b: { z: string; id: string }): number {
  if (a.z !== b.z) return a.z < b.z ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** A valid key, or null for garbage from an older client (sorted first). */
export function isValidKey(key: string): boolean {
  try {
    validate(key);
    return true;
  } catch {
    return false;
  }
}
