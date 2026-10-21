/**
 * A VS Code colour theme (the .json a theme extension ships, comments and trailing commas
 * allowed) as a Monaco theme. VS Code colours TextMate scopes ("keyword.control.flow"),
 * while the room's highlighters name tokens more broadly ("keyword", "string",
 * "type.identifier"), so the common scopes are also mapped onto those names.
 */
import { parseJsonc } from "./jsonc";

export type ThemeRule = { token: string; foreground?: string; background?: string; fontStyle?: string };
export type MonacoThemeData = {
  base: "vs" | "vs-dark" | "hc-black" | "hc-light";
  inherit: boolean;
  rules: ThemeRule[];
  colors: Record<string, string>;
};
export type ConvertedTheme = { name: string; dark: boolean; data: MonacoThemeData };

export class ThemeError extends Error {}

export { parseJsonc };

/** TextMate scope (prefix) → the highlighters' token names it should colour, most specific first. */
const MAP: Array<[scope: string, tokens: string[]]> = [
  ["comment", ["comment"]],
  ["string.regexp", ["regexp"]],
  ["string", ["string"]],
  ["constant.numeric", ["number"]],
  ["keyword.operator", ["operator"]],
  ["keyword", ["keyword"]],
  ["storage", ["keyword"]],
  ["entity.name.type", ["type", "type.identifier"]],
  ["entity.name.class", ["type.identifier"]],
  ["support.type", ["type"]],
  ["entity.name.tag", ["tag"]],
  ["entity.other.attribute-name", ["attribute.name"]],
  ["variable", ["variable", "identifier"]],
  ["punctuation", ["delimiter"]],
];

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** A token colour as Monaco's rules take it: six hex digits, no #, no alpha. */
const tokenColor = (value: unknown): string | undefined => {
  if (typeof value !== "string" || !HEX.test(value)) return undefined;
  let hex = value.slice(1);
  if (hex.length <= 4) hex = [...hex.slice(0, 3)].map((c) => c + c).join("");
  return hex.slice(0, 6).toLowerCase();
};

function luminance(hex: string): number {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function convertVsCodeTheme(text: string): ConvertedTheme {
  let json: unknown;
  try {
    json = parseJsonc(text);
  } catch {
    throw new ThemeError("That file isn't valid JSON.");
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new ThemeError("That file isn't a VS Code theme.");
  const theme = json as { name?: unknown; type?: unknown; colors?: unknown; tokenColors?: unknown; include?: unknown };
  if (typeof theme.tokenColors === "string" || typeof theme.include === "string") {
    throw new ThemeError("This theme reads its colours from other files. Import the theme file that lists them all (often under themes/ in the extension).");
  }
  if (!theme.colors && !Array.isArray(theme.tokenColors)) throw new ThemeError("That file has no colours: it isn't a VS Code theme.");

  const colors: Record<string, string> = {};
  if (theme.colors && typeof theme.colors === "object") {
    for (const [key, value] of Object.entries(theme.colors as Record<string, unknown>)) {
      if (typeof value === "string" && HEX.test(value)) colors[key] = value;
    }
  }

  const background = tokenColor(colors["editor.background"]);
  const kind = typeof theme.type === "string" ? theme.type.toLowerCase() : "";
  const dark = kind === "dark" || kind === "hc" || (!kind && background !== undefined && luminance(background) < 0.5) || (!kind && background === undefined);
  const base: MonacoThemeData["base"] = kind === "hc" ? "hc-black" : kind === "hclight" ? "hc-light" : dark ? "vs-dark" : "vs";

  const exact: ThemeRule[] = [];
  // For each highlighter token, the best scope seen: [rank in MAP, exact match?] and its rule.
  const mapped = new Map<string, { rank: number; rule: ThemeRule }>();
  let defaultForeground = tokenColor(colors["editor.foreground"]);
  for (const entry of Array.isArray(theme.tokenColors) ? theme.tokenColors : []) {
    if (!entry || typeof entry !== "object") continue;
    const { scope, settings } = entry as { scope?: unknown; settings?: Record<string, unknown> };
    if (!settings) continue;
    const style: Omit<ThemeRule, "token"> = {};
    const foreground = tokenColor(settings.foreground);
    const back = tokenColor(settings.background);
    if (foreground) style.foreground = foreground;
    if (back) style.background = back;
    if (typeof settings.fontStyle === "string") style.fontStyle = settings.fontStyle.trim();
    if (!Object.keys(style).length) continue;
    const scopes = (Array.isArray(scope) ? scope : typeof scope === "string" ? scope.split(",") : [])
      .map((s) => String(s).trim().split(/\s+/).pop() ?? "")
      .filter(Boolean);
    if (!scopes.length) {
      // No scope: the theme's default text colour.
      defaultForeground = foreground ?? defaultForeground;
      continue;
    }
    for (const s of scopes) {
      exact.push({ token: s, ...style });
      MAP.forEach(([prefix, tokens], index) => {
        if (s !== prefix && !s.startsWith(`${prefix}.`)) return;
        // An exact match ("keyword") beats a narrower one ("keyword.control"); earlier MAP entries win ties.
        const rank = index * 2 + (s === prefix ? 0 : 1);
        for (const token of tokens) {
          const seen = mapped.get(token);
          if (!seen || rank < seen.rank) mapped.set(token, { rank, rule: { token, ...style } });
        }
      });
    }
  }

  const rules: ThemeRule[] = [];
  if (defaultForeground || background) rules.push({ token: "", ...(defaultForeground && { foreground: defaultForeground }), ...(background && { background }) });
  rules.push(...[...mapped.values()].map((m) => m.rule), ...exact);
  const name = typeof theme.name === "string" && theme.name.trim() ? theme.name.trim().slice(0, 60) : "Imported theme";
  return { name, dark: base === "vs-dark" || base === "hc-black", data: { base, inherit: true, rules, colors } };
}
