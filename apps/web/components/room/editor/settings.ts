import type * as monaco from "monaco-editor";

export const LINE_NUMBERS = ["on", "relative", "off"] as const;
export const WHITESPACE = ["none", "selection", "boundary", "trailing", "all"] as const;
export const CURSOR_STYLES = ["line", "line-thin", "block", "block-outline", "underline", "underline-thin"] as const;
export const CURSOR_BLINKING = ["smooth", "blink", "phase", "expand", "solid"] as const;
export const TAB_SIZES = [2, 3, 4, 8] as const;

/** Per-person editor preferences, kept in this browser (see settings-store.ts). */
export type EditorSettings = {
  fontSize: number;
  fontLigatures: boolean;
  tabSize: number;
  insertSpaces: boolean;
  /** Follow the indentation a file already uses instead of the two settings above. */
  detectIndentation: boolean;
  wordWrap: boolean;
  minimap: boolean;
  lineNumbers: (typeof LINE_NUMBERS)[number];
  renderWhitespace: (typeof WHITESPACE)[number];
  cursorStyle: (typeof CURSOR_STYLES)[number];
  cursorBlinking: (typeof CURSOR_BLINKING)[number];
  bracketColors: boolean;
  bracketGuides: boolean;
  stickyScroll: boolean;
  formatOnPaste: boolean;
  formatOnSave: boolean;
};

export const FONT_SIZE = { min: 10, max: 32, default: 14 } as const;

export const DEFAULT_SETTINGS: EditorSettings = {
  fontSize: FONT_SIZE.default,
  fontLigatures: true,
  tabSize: 2,
  insertSpaces: true,
  detectIndentation: true,
  wordWrap: false,
  minimap: true,
  lineNumbers: "on",
  renderWhitespace: "none",
  cursorStyle: "line",
  cursorBlinking: "smooth",
  bracketColors: false,
  bracketGuides: false,
  stickyScroll: true,
  formatOnPaste: false,
  formatOnSave: false,
};

export const clampFontSize = (size: number) => Math.min(FONT_SIZE.max, Math.max(FONT_SIZE.min, Math.round(size)));

/**
 * Whatever localStorage hands back (an older version, a hand edit, nothing) becomes a
 * complete, valid settings object: each key keeps its default unless the stored value fits.
 */
export function sanitizeSettings(raw: unknown): EditorSettings {
  const stored = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof EditorSettings)[]) {
    const value = stored[key];
    const fallback = DEFAULT_SETTINGS[key];
    if (typeof fallback === "boolean" && typeof value === "boolean") out[key] = value;
    else if (key === "fontSize" && typeof value === "number" && Number.isFinite(value)) out[key] = clampFontSize(value);
    else if (key === "tabSize" && typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 8) out[key] = value;
    else if (key === "lineNumbers" && LINE_NUMBERS.includes(value as never)) out[key] = value;
    else if (key === "renderWhitespace" && WHITESPACE.includes(value as never)) out[key] = value;
    else if (key === "cursorStyle" && CURSOR_STYLES.includes(value as never)) out[key] = value;
    else if (key === "cursorBlinking" && CURSOR_BLINKING.includes(value as never)) out[key] = value;
  }
  return out as EditorSettings;
}

type Options = monaco.editor.IEditorOptions & monaco.editor.IGlobalEditorOptions;

/** The settings as Monaco options; the same object works for create() and updateOptions(). */
export function monacoOptions(s: EditorSettings): Options {
  return {
    fontSize: s.fontSize,
    lineHeight: Math.round(s.fontSize * 1.6),
    fontLigatures: s.fontLigatures,
    tabSize: s.tabSize,
    insertSpaces: s.insertSpaces,
    detectIndentation: s.detectIndentation,
    wordWrap: s.wordWrap ? "on" : "off",
    minimap: { enabled: s.minimap, showSlider: "mouseover", renderCharacters: false, maxColumn: 80 },
    lineNumbers: s.lineNumbers,
    renderWhitespace: s.renderWhitespace,
    cursorStyle: s.cursorStyle,
    cursorBlinking: s.cursorBlinking,
    bracketPairColorization: { enabled: s.bracketColors },
    guides: { indentation: true, bracketPairs: s.bracketGuides ? "active" : false },
    stickyScroll: { enabled: s.stickyScroll },
    formatOnPaste: s.formatOnPaste,
  };
}
