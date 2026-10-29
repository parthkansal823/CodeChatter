/**
 * The IDE's keyboard shortcuts in one place: each command's default keys (as in VS Code),
 * where they work, and your own keys on top (the editor setting `keybindings`). A key is
 * written "Ctrl+Shift+P" and a chord "Ctrl+K Z"; Ctrl is Cmd on a Mac. shortcuts.ts listens
 * for them, keyboard-shortcuts.tsx edits them, and the palette shows them.
 */

/** Where a key works: anywhere; not while typing in a box (the code editor is fine); only in the code editor; not in a terminal or a box with its own use for it. */
export type KeyWhere = "anywhere" | "notInField" | "editor" | "notOwnKey";

type Default = { keys: string[]; where?: KeyWhere };

/** The default keys, by command id (the palette's ids). Commands without one can be given keys too. */
export const DEFAULT_KEYS: Record<string, Default> = {
  palette: { keys: ["Ctrl+Shift+P", "F1"] },
  "quick-open": { keys: ["Ctrl+P"] },
  "go-symbol": { keys: ["Ctrl+Shift+O"] },
  "go-line": { keys: ["Ctrl+G"], where: "notInField" },
  settings: { keys: ["Ctrl+,"] },
  shortcuts: { keys: ["Ctrl+K Ctrl+S"] },
  split: { keys: ["Ctrl+\\"] },
  save: { keys: ["Ctrl+S"] },
  format: { keys: ["Shift+Alt+F"] },
  "zoom-in": { keys: ["Ctrl+=", "Ctrl+Shift+="], where: "editor" },
  "zoom-out": { keys: ["Ctrl+-", "Ctrl+Shift+-"], where: "editor" },
  "zoom-reset": { keys: ["Ctrl+0"], where: "editor" },
  "preview-side": { keys: ["Ctrl+K V"] },
  "preview-full": { keys: ["Ctrl+Shift+V"], where: "notInField" },
  zen: { keys: ["Ctrl+K Z"] },
  run: { keys: ["Ctrl+Enter"], where: "notOwnKey" },
  terminal: { keys: ["Ctrl+`"] },
  search: { keys: ["Ctrl+Shift+F"], where: "notOwnKey" },
  replace: { keys: ["Ctrl+Shift+H"], where: "notOwnKey" },
  "build-task": { keys: ["Ctrl+Shift+B"] },
  "source-control": { keys: ["Ctrl+Shift+G"], where: "notOwnKey" },
  "debug-continue": { keys: ["F5"] },
  "debug-stop": { keys: ["Shift+F5"] },
  "debug-pause": { keys: ["F6"] },
  "debug-over": { keys: ["F10"] },
  "debug-into": { keys: ["F11"] },
  "debug-out": { keys: ["Shift+F11"] },
};

/** Your keys, by command id: replacing the defaults (an empty list takes them away). */
export type KeyOverrides = Record<string, string[]>;

const MODIFIERS = ["Ctrl", "Shift", "Alt"] as const;
const MODIFIER_NAMES: Record<string, (typeof MODIFIERS)[number]> = {
  ctrl: "Ctrl",
  control: "Ctrl",
  cmd: "Ctrl",
  meta: "Ctrl",
  shift: "Shift",
  alt: "Alt",
  option: "Alt",
};
/** Keys by KeyboardEvent.code, for the ones whose character depends on Shift or the layout. */
const CODES: Record<string, string> = {
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Space: "Space",
  Enter: "Enter",
  NumpadEnter: "Enter",
  NumpadAdd: "=",
  NumpadSubtract: "-",
  Tab: "Tab",
  Escape: "Escape",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
};
const NAMED = new Set(Object.values(CODES));
const PLAIN = /^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4]))$/;

/** One key press as written here ("Ctrl+Shift+P"), or null when it isn't one (a bare modifier, a typo). */
export function normalizeKey(text: string): string | null {
  const parts = text.split("+").map((part) => part.trim());
  // "Ctrl++" was a plus: written "=" here, as the key it's on.
  if (parts.length > 1 && parts.at(-1) === "" && parts.at(-2) === "") parts.splice(-2, 2, "=");
  const mods = new Set<string>();
  let key: string | null = null;
  for (const part of parts) {
    const modifier = MODIFIER_NAMES[part.toLowerCase()];
    if (modifier) mods.add(modifier);
    else if (key !== null || !part) return null;
    else {
      key = keyName(part);
      if (!key) return null;
    }
  }
  if (!key) return null;
  return [...MODIFIERS.filter((m) => mods.has(m)), key].join("+");
}

function keyName(part: string): string | null {
  const upper = part.length === 1 ? part.toUpperCase() : part;
  if (PLAIN.test(upper)) return upper;
  if (part.length === 1 && Object.values(CODES).includes(part)) return part;
  if (part === "+") return "=";
  const named = [...NAMED].find((name) => name.toLowerCase() === part.toLowerCase());
  if (named) return named;
  const arrow = /^arrow(up|down|left|right)$/i.exec(part);
  if (arrow) return arrow[1]![0]!.toUpperCase() + arrow[1]!.slice(1).toLowerCase();
  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(part)) return part.toUpperCase();
  return part.toLowerCase() === "esc" ? "Escape" : null;
}

/** A shortcut as written here: one key, or a chord of two ("Ctrl+K Z"); null when it isn't one. */
export function normalizeBinding(text: string): string | null {
  const presses = text.trim().split(/\s+/).filter(Boolean);
  if (presses.length < 1 || presses.length > 2) return null;
  const keys = presses.map(normalizeKey);
  return keys.every(Boolean) ? keys.join(" ") : null;
}

type KeyEventLike = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">;

/** A key press as written here, or null for a modifier on its own. Letters follow the layout; other keys their place. */
export function eventKey(event: KeyEventLike): string | null {
  if (/^(Control|Shift|Alt|Meta|AltGraph|CapsLock|OS)$/.test(event.key)) return null;
  let key: string | null = null;
  if (/^[a-z]$/i.test(event.key)) key = event.key.toUpperCase();
  else if (/^(Key[A-Z]|Digit\d|Numpad\d)$/.test(event.code)) key = event.code.slice(-1);
  else if (CODES[event.code]) key = CODES[event.code]!;
  else if (/^F\d{1,2}$/.test(event.key)) key = event.key;
  else key = keyName(event.key);
  if (!key) return null;
  const mods = [event.ctrlKey || event.metaKey ? "Ctrl" : null, event.shiftKey ? "Shift" : null, event.altKey ? "Alt" : null];
  return [...mods.filter(Boolean), key].join("+");
}

/** A command's keys: yours, else its defaults. */
export function keysFor(id: string, overrides: KeyOverrides): string[] {
  return overrides[id] ?? DEFAULT_KEYS[id]?.keys ?? [];
}

export const whereOf = (id: string): KeyWhere => DEFAULT_KEYS[id]?.where ?? (id.includes(".") ? "editor" : "anywhere");

/**
 * Every bound key and its command: the defaults of commands you haven't changed, then
 * yours, which win a key both have.
 */
export function keyMap(overrides: KeyOverrides): Map<string, string> {
  const map = new Map<string, string>();
  for (const [id, { keys }] of Object.entries(DEFAULT_KEYS)) {
    if (overrides[id]) continue;
    for (const key of keys) if (!map.has(key)) map.set(key, id);
  }
  for (const [id, keys] of Object.entries(overrides)) for (const key of keys) map.set(key, id);
  return map;
}

/** The first keys of the chords in a key map ("Ctrl+K"). */
export const chordStarts = (map: Map<string, string>): Set<string> =>
  new Set([...map.keys()].filter((key) => key.includes(" ")).map((key) => key.split(" ")[0]!));

/** The command a key runs now. */
export const ownerOf = (key: string, overrides: KeyOverrides): string | undefined => keyMap(overrides).get(key);

/**
 * Give a command a key: added to its keys, and taken from a command that had it (so each key
 * runs one command). Returns the new overrides, and the command it was taken from.
 */
export function assignKey(id: string, key: string, overrides: KeyOverrides): { overrides: KeyOverrides; takenFrom?: string } {
  const takenFrom = ownerOf(key, overrides);
  const next: KeyOverrides = { ...overrides };
  if (takenFrom && takenFrom !== id) next[takenFrom] = keysFor(takenFrom, overrides).filter((k) => k !== key);
  const mine = keysFor(id, overrides);
  next[id] = mine.includes(key) ? mine : [...mine, key];
  return { overrides: tidy(next), ...(takenFrom && takenFrom !== id && { takenFrom }) };
}

/** Take one key away from a command. */
export const removeKey = (id: string, key: string, overrides: KeyOverrides): KeyOverrides =>
  tidy({ ...overrides, [id]: keysFor(id, overrides).filter((k) => k !== key) });

/** A command's default keys back (other commands keep the keys you gave them). */
export function resetKeys(id: string, overrides: KeyOverrides): KeyOverrides {
  const next = { ...overrides };
  delete next[id];
  return tidy(next);
}

/** Overrides equal to the defaults aren't kept, so a later change of default reaches you. */
function tidy(overrides: KeyOverrides): KeyOverrides {
  const out: KeyOverrides = {};
  for (const [id, keys] of Object.entries(overrides)) {
    const defaults = DEFAULT_KEYS[id]?.keys ?? [];
    if (keys.length === defaults.length && keys.every((key, i) => key === defaults[i])) continue;
    out[id] = keys;
  }
  return out;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,119}$/;

/** Stored overrides, checked: known shapes only, keys written as here, at most 4 per command. */
export function sanitizeOverrides(raw: unknown): KeyOverrides {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: KeyOverrides = {};
  for (const [id, keys] of Object.entries(raw).slice(0, 500)) {
    if (!ID.test(id) || !Array.isArray(keys)) continue;
    const valid = keys.map((key) => (typeof key === "string" ? normalizeBinding(key) : null)).filter((key): key is string => key !== null);
    out[id] = [...new Set(valid)].slice(0, 4);
  }
  return out;
}

/** A shortcut for people to read: "Ctrl Shift P", a chord "Ctrl K, Z". */
export const keyLabel = (binding: string): string =>
  binding
    .split(" ")
    .map((press) => press.split("+").join(" "))
    .join(", ");
