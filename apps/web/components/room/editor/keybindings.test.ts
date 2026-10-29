// node:test, run with tsx (see CLAUDE.md "Unit tests").
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assignKey,
  chordStarts,
  DEFAULT_KEYS,
  eventKey,
  keyLabel,
  keyMap,
  keysFor,
  normalizeBinding,
  removeKey,
  resetKeys,
  sanitizeOverrides,
} from "./keybindings";

const press = (key: string, code: string, mods: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean } = {}) =>
  eventKey({ key, code, ctrlKey: Boolean(mods.ctrl), metaKey: Boolean(mods.meta), shiftKey: Boolean(mods.shift), altKey: Boolean(mods.alt) });

describe("normalizeBinding", () => {
  it("writes keys one way: modifiers in order, letters in capitals", () => {
    assert.equal(normalizeBinding("shift+ctrl+p"), "Ctrl+Shift+P");
    assert.equal(normalizeBinding("cmd+alt+t"), "Ctrl+Alt+T");
    assert.equal(normalizeBinding("ctrl+k  ctrl+s"), "Ctrl+K Ctrl+S");
    assert.equal(normalizeBinding("Ctrl+`"), "Ctrl+`");
    assert.equal(normalizeBinding("ctrl++"), "Ctrl+=");
    assert.equal(normalizeBinding("f5"), "F5");
    assert.equal(normalizeBinding("Ctrl+ArrowUp"), "Ctrl+Up");
    assert.equal(normalizeBinding("ctrl+enter"), "Ctrl+Enter");
  });

  it("refuses what isn't a shortcut", () => {
    for (const text of ["", "Ctrl", "Ctrl+Shift", "Ctrl+A+B", "Ctrl+K Ctrl+S X", "Ctrl+Banana", "Hyper+A"]) {
      assert.equal(normalizeBinding(text), null, text);
    }
  });

  it("every default is written as normalizeBinding writes it", () => {
    for (const [id, { keys }] of Object.entries(DEFAULT_KEYS)) for (const key of keys) assert.equal(normalizeBinding(key), key, id);
  });
});

describe("eventKey", () => {
  it("reads a key press, Cmd as Ctrl", () => {
    assert.equal(press("P", "KeyP", { ctrl: true, shift: true }), "Ctrl+Shift+P");
    assert.equal(press("p", "KeyP", { meta: true }), "Ctrl+P");
    assert.equal(press("F5", "F5", { shift: true }), "Shift+F5");
    assert.equal(press("Enter", "Enter", { ctrl: true }), "Ctrl+Enter");
    assert.equal(press("Control", "ControlLeft", { ctrl: true }), null);
  });

  it("keys whose character Shift or the layout changes go by their place", () => {
    assert.equal(press("~", "Backquote", { ctrl: true, shift: true }), "Ctrl+Shift+`");
    assert.equal(press("+", "Equal", { ctrl: true, shift: true }), "Ctrl+Shift+=");
    assert.equal(press("_", "Minus", { ctrl: true, shift: true }), "Ctrl+Shift+-");
    assert.equal(press("+", "NumpadAdd", { ctrl: true }), "Ctrl+=");
    assert.equal(press("ƒ", "KeyF", { alt: true, shift: true }), "Shift+Alt+F");
    assert.equal(press("!", "Digit1", { ctrl: true, shift: true }), "Ctrl+Shift+1");
  });

  it("letters follow the layout (Dvorak's P is where QWERTY's R is)", () => {
    assert.equal(press("p", "KeyR", { ctrl: true }), "Ctrl+P");
  });
});

describe("keyMap", () => {
  it("maps the defaults, and the chords' first keys", () => {
    const map = keyMap({});
    assert.equal(map.get("Ctrl+Shift+P"), "palette");
    assert.equal(map.get("F1"), "palette");
    assert.equal(map.get("Ctrl+K Z"), "zen");
    assert.deepEqual([...chordStarts(map)], ["Ctrl+K"]);
  });

  it("your keys replace a command's defaults and win a key both have", () => {
    const map = keyMap({ terminal: ["Ctrl+Alt+T"], chat: ["Ctrl+P"] });
    assert.equal(map.get("Ctrl+Alt+T"), "terminal");
    assert.equal(map.get("Ctrl+`"), undefined);
    assert.equal(map.get("Ctrl+P"), "chat");
  });
});

describe("assignKey, removeKey and resetKeys", () => {
  it("a key given to a command is taken from the one that had it", () => {
    const { overrides, takenFrom } = assignKey("chat", "Ctrl+P", {});
    assert.equal(takenFrom, "quick-open");
    assert.deepEqual(overrides, { "quick-open": [], chat: ["Ctrl+P"] });
    assert.equal(keyMap(overrides).get("Ctrl+P"), "chat");
  });

  it("adds to a command's keys, and keeps nothing that equals the defaults", () => {
    const added = assignKey("terminal", "Ctrl+Alt+T", {}).overrides;
    assert.deepEqual(added, { terminal: ["Ctrl+`", "Ctrl+Alt+T"] });
    assert.deepEqual(removeKey("terminal", "Ctrl+Alt+T", added), {});
    assert.deepEqual(removeKey("terminal", "Ctrl+`", {}), { terminal: [] });
    assert.deepEqual(keysFor("terminal", removeKey("terminal", "Ctrl+`", {})), []);
    assert.deepEqual(resetKeys("terminal", { terminal: [], chat: ["Ctrl+J"] }), { chat: ["Ctrl+J"] });
  });
});

describe("sanitizeOverrides", () => {
  it("keeps valid keys, written as here, four at most", () => {
    assert.deepEqual(sanitizeOverrides({ terminal: ["ctrl+alt+t", "nonsense", "Ctrl+Alt+T"], "bad id!": ["F2"], zen: "F3" }), {
      terminal: ["Ctrl+Alt+T"],
    });
    assert.deepEqual(sanitizeOverrides({ x: ["F1", "F2", "F3", "F4", "F5"] }).x?.length, 4);
    assert.deepEqual(sanitizeOverrides(null), {});
    assert.deepEqual(sanitizeOverrides(["F1"]), {});
  });
});

describe("keyLabel", () => {
  it("reads as the palette shows keys", () => {
    assert.equal(keyLabel("Ctrl+Shift+P"), "Ctrl Shift P");
    assert.equal(keyLabel("Ctrl+K Ctrl+S"), "Ctrl K, Ctrl S");
  });
});
