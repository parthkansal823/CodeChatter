// node:test, run with tsx (see CLAUDE.md "Unit tests").
/* eslint-disable no-restricted-syntax -- the hex colours are a VS Code theme's, the test's input */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convertVsCodeTheme, parseJsonc, ThemeError } from "./vscode-theme";

const THEME = `{
  // A dark theme, as an extension ships it.
  "name": "Night Owl Test",
  "type": "dark",
  "colors": {
    "editor.background": "#011627",
    "editor.foreground": "#d6deeb",
    "editorCursor.foreground": "#80a4c2",
    "notAColor": "red", /* dropped */
  },
  "tokenColors": [
    { "settings": { "foreground": "#d6deeb" } },
    { "scope": "comment", "settings": { "foreground": "#637777", "fontStyle": "italic" } },
    { "scope": ["string", "string.quoted"], "settings": { "foreground": "#ecc48d" } },
    { "scope": "keyword.control.flow, storage.type", "settings": { "foreground": "#c792ea" } },
    { "scope": "keyword", "settings": { "foreground": "#7fdbca" } },
    { "scope": "constant.numeric", "settings": { "foreground": "#f78c6cff" } },
    { "scope": "meta.class entity.name.type.class", "settings": { "foreground": "#ffcb8b" } },
  ],
}`;

const rule = (theme: ReturnType<typeof convertVsCodeTheme>, token: string) => theme.data.rules.find((r) => r.token === token);

describe("parseJsonc", () => {
  it("drops comments and trailing commas but keeps slashes in strings", () => {
    assert.deepEqual(parseJsonc('{ "url": "https://x//y", /* c */ "a": [1, 2,], // end\n }'), { url: "https://x//y", a: [1, 2] });
  });
});

describe("convertVsCodeTheme", () => {
  const theme = convertVsCodeTheme(THEME);

  it("name, base and the editor's colours (invalid ones dropped)", () => {
    assert.equal(theme.name, "Night Owl Test");
    assert.equal(theme.dark, true);
    assert.equal(theme.data.base, "vs-dark");
    assert.deepEqual(theme.data.colors, { "editor.background": "#011627", "editor.foreground": "#d6deeb", "editorCursor.foreground": "#80a4c2" });
  });

  it("maps TextMate scopes onto the highlighters' token names", () => {
    assert.deepEqual(rule(theme, "comment"), { token: "comment", foreground: "637777", fontStyle: "italic" });
    assert.equal(rule(theme, "string")?.foreground, "ecc48d");
    assert.equal(rule(theme, "number")?.foreground, "f78c6c", "alpha is dropped");
    // "keyword" itself beats "keyword.control.flow" and "storage.type".
    assert.equal(rule(theme, "keyword")?.foreground, "7fdbca");
    assert.equal(rule(theme, "type.identifier")?.foreground, "ffcb8b", "the last part of a descendant selector");
  });

  it("keeps the exact scopes too, and the default text colour", () => {
    assert.equal(rule(theme, "keyword.control.flow")?.foreground, "c792ea");
    assert.deepEqual(rule(theme, ""), { token: "", foreground: "d6deeb", background: "011627" });
  });

  it("light, high contrast, and a guess from the background when there's no type", () => {
    assert.equal(convertVsCodeTheme('{ "type": "light", "colors": {} }').data.base, "vs");
    assert.equal(convertVsCodeTheme('{ "type": "hc", "colors": {} }').data.base, "hc-black");
    assert.equal(convertVsCodeTheme('{ "colors": { "editor.background": "#fafafa" } }').data.base, "vs");
    assert.equal(convertVsCodeTheme('{ "colors": { "editor.background": "#1e1e1e" } }').data.base, "vs-dark");
  });

  it("says why when it can't", () => {
    assert.throws(() => convertVsCodeTheme("not json"), ThemeError);
    assert.throws(() => convertVsCodeTheme('{ "version": 1 }'), /isn't a VS Code theme/);
    assert.throws(() => convertVsCodeTheme('{ "include": "./base.json", "colors": {} }'), /other files/);
  });
});
