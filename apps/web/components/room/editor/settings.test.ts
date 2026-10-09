import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { clampFontSize, DEFAULT_SETTINGS, FONT_SIZE, monacoOptions, sanitizeSettings } from "./settings";

describe("sanitizeSettings", () => {
  it("fills everything from defaults when nothing was saved", () => {
    assert.deepEqual(sanitizeSettings(undefined), DEFAULT_SETTINGS);
    assert.deepEqual(sanitizeSettings("nope"), DEFAULT_SETTINGS);
  });

  it("keeps valid saved values and drops invalid ones", () => {
    const out = sanitizeSettings({
      fontSize: 18,
      tabSize: 4,
      wordWrap: true,
      lineNumbers: "relative",
      cursorStyle: "wavy",
      minimap: "yes",
      extra: 1,
    });
    assert.equal(out.fontSize, 18);
    assert.equal(out.tabSize, 4);
    assert.equal(out.wordWrap, true);
    assert.equal(out.lineNumbers, "relative");
    assert.equal(out.cursorStyle, DEFAULT_SETTINGS.cursorStyle);
    assert.equal(out.minimap, DEFAULT_SETTINGS.minimap);
    assert.ok(!("extra" in out));
  });

  it("clamps the font size and rejects odd tab sizes", () => {
    assert.equal(sanitizeSettings({ fontSize: 400 }).fontSize, FONT_SIZE.max);
    assert.equal(sanitizeSettings({ fontSize: 2 }).fontSize, FONT_SIZE.min);
    assert.equal(sanitizeSettings({ tabSize: 0 }).tabSize, DEFAULT_SETTINGS.tabSize);
    assert.equal(sanitizeSettings({ tabSize: 2.5 }).tabSize, DEFAULT_SETTINGS.tabSize);
    assert.equal(clampFontSize(13.6), 14);
  });
});

describe("monacoOptions", () => {
  it("maps each setting onto the matching Monaco option", () => {
    const o = monacoOptions({
      ...DEFAULT_SETTINGS,
      fontSize: 20,
      wordWrap: true,
      minimap: false,
      bracketGuides: true,
      lineNumbers: "off",
    });
    assert.equal(o.fontSize, 20);
    assert.equal(o.lineHeight, 32);
    assert.equal(o.wordWrap, "on");
    assert.equal(o.minimap?.enabled, false);
    assert.equal(o.guides?.bracketPairs, "active");
    assert.equal(o.lineNumbers, "off");
  });
});
