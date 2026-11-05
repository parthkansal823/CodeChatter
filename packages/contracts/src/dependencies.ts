/** Parse supported dependency files in the browser or API without evaluating project code or adding parsers. */
import { z } from "zod";

export const DEPENDENCY_ECOSYSTEMS = ["npm", "PyPI", "Go", "crates.io", "Packagist", "Maven"] as const;
export type DependencyEcosystem = typeof DEPENDENCY_ECOSYSTEMS[number];
export type DependencySeverity = "critical" | "high" | "moderate" | "low" | "unknown";
export type DependencyPackage = { ecosystem: DependencyEcosystem; name: string; version: string | null };
export type ParsedDependency = DependencyPackage & { path: string; line: number };
export type DependencyVulnerability = {
  id: string; aliases: string[]; summary: string; severity: DependencySeverity; fixed: string | null; url: string;
};
export type DependencyResult = Omit<DependencyPackage, "version"> & { version: string; vulns: DependencyVulnerability[] };
export type DependencyCheckResponse = { results: DependencyResult[]; unchecked: DependencyPackage[] };

export const DependencyCheckInput = z.strictObject({
  packages: z.array(z.strictObject({
    ecosystem: z.enum(DEPENDENCY_ECOSYSTEMS),
    name: z.string().trim().min(1).max(300),
    version: z.string().trim().min(1).max(200).nullable(),
  })).max(5000),
});
export type DependencyCheckInput = z.infer<typeof DependencyCheckInput>;

type Source = { path: string; content: string };
type JsonDocument = { value: unknown; line: (...path: Array<string | number>) => number };
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;

function lineFinder(content: string): (offset: number) => number {
  const starts = [0];
  for (let i = 0; i < content.length; i++) if (content[i] === "\n") starts.push(i + 1);
  return (offset) => {
    let low = 0;
    let high = starts.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (starts[mid]! <= offset) low = mid + 1;
      else high = mid;
    }
    return Math.max(1, low);
  };
}

/** JSON.parse validates syntax; this second walk records exact key lines, even for repeated names. */
function jsonDocument(content: string): JsonDocument | null {
  try {
    const value: unknown = JSON.parse(content);
    const positions = new Map<string, number>();
    const lineAt = lineFinder(content);
    let cursor = 0;
    const whitespace = () => { while (/\s/.test(content[cursor] ?? "")) cursor++; };
    const string = (): string => {
      const start = cursor++;
      while (cursor < content.length) {
        const char = content[cursor++];
        if (char === "\\") cursor++;
        else if (char === '"') return JSON.parse(content.slice(start, cursor)) as string;
      }
      throw new Error("Unclosed JSON string");
    };
    const walk = (path: Array<string | number>, depth: number) => {
      if (depth > 128) throw new Error("Dependency JSON is too deeply nested");
      whitespace();
      const key = JSON.stringify(path);
      if (!positions.has(key)) positions.set(key, cursor);
      const char = content[cursor];
      if (char === "{") {
        cursor++;
        whitespace();
        while (content[cursor] !== "}") {
          const start = cursor;
          const name = string();
          whitespace();
          cursor++;
          const child = [...path, name];
          positions.set(JSON.stringify(child), start);
          walk(child, depth + 1);
          whitespace();
          if (content[cursor] !== ",") break;
          cursor++;
          whitespace();
        }
        cursor++;
      } else if (char === "[") {
        cursor++;
        whitespace();
        let index = 0;
        while (content[cursor] !== "]") {
          walk([...path, index++], depth + 1);
          whitespace();
          if (content[cursor] !== ",") break;
          cursor++;
        }
        cursor++;
      } else if (char === '"') string();
      else while (cursor < content.length && !/[\s,}\]]/.test(content[cursor]!)) cursor++;
    };
    walk([], 0);
    return { value, line: (...path) => lineAt(positions.get(JSON.stringify(path)) ?? 0) };
  } catch { return null; }
}

function npmVersion(value: unknown, range = false): string | null {
  const raw = text(value);
  if (!raw) return null;
  const version = range ? raw.replace(/^[~^]/, "") : raw;
  const exact = /^v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(version);
  if (!exact || exact[1]?.split(".").some((part) => /^0\d+$/.test(part))) return null;
  return version.replace(/^v/, "");
}

function npmLock(file: Source): ParsedDependency[] | null {
  const json = jsonDocument(file.content);
  const packages = object(object(json?.value)?.packages);
  if (!json || !packages) return null;
  const result: ParsedDependency[] = [];
  for (const [location, value] of Object.entries(packages)) {
    const item = object(value);
    if (!item || item.link === true) continue;
    const nested = location.lastIndexOf("/node_modules/");
    const tail = nested >= 0 ? location.slice(nested + "/node_modules/".length)
      : location.startsWith("node_modules/") ? location.slice("node_modules/".length) : null;
    if (!tail) continue;
    const name = text(item.name) ?? tail;
    if (!/^(?:@[^/\s]+\/)?[^/\s]+$/.test(name)) continue;
    result.push({ ecosystem: "npm", name, version: npmVersion(item.version), path: file.path, line: json.line("packages", location) });
  }
  return result;
}

function unquote(raw: string): string | null {
  const value = raw.trim();
  try {
    if (value.startsWith('"')) return JSON.parse(value) as string;
    if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'");
    return value;
  } catch { return null; }
}

/** Standard pnpm lock keys, including scoped names, leading slashes and peer suffixes. */
function pnpmLock(file: Source): ParsedDependency[] | null {
  const lines = file.content.split(/\r?\n/);
  let inside = false;
  let found = false;
  let entryIndent: number | null = null;
  const result: ParsedDependency[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^(?:packages|'packages'|"packages"):\s*(?:\{\})?\s*(?:#.*)?$/.test(line)) { inside = true; found = true; continue; }
    if (!inside || !line.trim() || line.trimStart().startsWith("#")) continue;
    if (/^\S/.test(line)) { inside = false; continue; }
    const match = /^(\s+)(.+):\s*(?:#.*)?$/.exec(line);
    if (!match) continue;
    const key = unquote(match[2]!);
    const dependency = key && /^\/?((?:@[^/@:\s]+\/)?[^/@:\s]+)@(.+)$/.exec(key);
    if (!dependency || (entryIndent !== null && match[1]!.length !== entryIndent)) continue;
    entryIndent ??= match[1]!.length;
    const version = dependency[2]!.split(/[(_]/, 1)[0]!;
    result.push({ ecosystem: "npm", name: dependency[1]!, version: npmVersion(version), path: file.path, line: i + 1 });
  }
  return found ? result : null;
}

function npmManifest(file: Source): ParsedDependency[] {
  const json = jsonDocument(file.content);
  const root = object(json?.value);
  if (!json || !root) return [];
  const result: ParsedDependency[] = [];
  for (const section of ["dependencies", "devDependencies"]) {
    for (const [name, version] of Object.entries(object(root[section]) ?? {})) {
      result.push({ ecosystem: "npm", name, version: npmVersion(version, true), path: file.path, line: json.line(section, name) });
    }
  }
  return result;
}

function requirements(file: Source): ParsedDependency[] {
  const result: ParsedDependency[] = [];
  file.content.split(/\r?\n/).forEach((line, index) => {
    const raw = line.replace(/\s+#.*$/, "").trim();
    if (!raw || raw.startsWith("#") || raw.startsWith("-")) return;
    const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]+\])?(.*)$/.exec(raw);
    if (!match) return;
    const specifier = match[2]!.split(";", 1)[0]!.trim();
    const exact = /^==\s*(v?\d[0-9A-Za-z.!+_-]*)(?:\s+--hash=\S+)*(?:\s*\\)?$/.exec(specifier);
    result.push({ ecosystem: "PyPI", name: match[1]!, version: exact?.[1] ?? null, path: file.path, line: index + 1 });
  });
  return result;
}

/** Lock-file package tables use only string name/version fields; unrelated TOML tables are ignored. */
function tomlLock(file: Source, ecosystem: "PyPI" | "crates.io"): ParsedDependency[] | null {
  let current: { name?: string; version?: string; line: number } | null = null;
  let found = false;
  const result: ParsedDependency[] = [];
  const flush = () => {
    if (current?.name) result.push({ ecosystem, name: current.name, version: current.version ?? null, path: file.path, line: current.line });
    current = null;
  };
  file.content.split(/\r?\n/).forEach((line, index) => {
    if (/^\s*\[\[package\]\]\s*(?:#.*)?$/.test(line)) { flush(); current = { line: index + 1 }; found = true; return; }
    if (/^\s*\[/.test(line)) { flush(); return; }
    if (!current) return;
    const match = /^\s*(name|version)\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?$/.exec(line);
    if (!match) return;
    const value = unquote(match[2]!);
    if (!value) return;
    if (match[1] === "name") { current.name = value; current.line = index + 1; }
    else current.version = /^[v\d][0-9A-Za-z.!+_-]*$/.test(value) ? value : undefined;
  });
  flush();
  return found ? result : null;
}

function goMod(file: Source): ParsedDependency[] {
  let block = false;
  const result: ParsedDependency[] = [];
  file.content.split(/\r?\n/).forEach((line, index) => {
    const raw = line.replace(/\/\/.*$/, "").trim();
    if (/^require\s*\(\s*$/.test(raw)) { block = true; return; }
    if (block && raw === ")") { block = false; return; }
    const match = block ? /^(\S+)\s+(\S+)$/.exec(raw) : /^require\s+(\S+)\s+(\S+)$/.exec(raw);
    if (!match) return;
    result.push({ ecosystem: "Go", name: match[1]!, version: /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+incompatible)?$/.test(match[2]!) ? match[2]! : null, path: file.path, line: index + 1 });
  });
  return result;
}

function composer(file: Source): ParsedDependency[] {
  const json = jsonDocument(file.content);
  const root = object(json?.value);
  if (!json || !root) return [];
  const result: ParsedDependency[] = [];
  for (const section of ["packages", "packages-dev"]) {
    const entries = root[section];
    if (!Array.isArray(entries)) continue;
    entries.forEach((entry: unknown, index) => {
      const item = object(entry);
      const name = text(item?.name);
      if (!name) return;
      const version = text(item?.version);
      result.push({ ecosystem: "Packagist", name, version: version && /^v?\d[0-9A-Za-z.+_-]*$/.test(version) ? version : null, path: file.path, line: json.line(section, index, "name") });
    });
  }
  return result;
}

function xmlText(raw: string): string | null {
  if (raw.includes("${") || /[<>]/.test(raw)) return null;
  const decoded = raw.replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" })[entity]!);
  return /&(?:#\w+|\w+);/.test(decoded) ? null : text(decoded);
}

function maven(file: Source): ParsedDependency[] {
  // Preserve offsets while discarding comments; no XML entities or external resources are evaluated.
  const content = file.content.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, " "));
  const lineAt = lineFinder(content);
  const result: ParsedDependency[] = [];
  const prefix = "(?:[A-Za-z_][\\w.-]*:)?";
  const dependencies = new RegExp(`<${prefix}dependency\\b[^>]*>([\\s\\S]*?)<\\/${prefix}dependency\\s*>`, "g");
  for (const match of content.matchAll(dependencies)) {
    const body = match[1]!;
    const fields = new Map<string, string | null>();
    const tags = /<\/?(?:[A-Za-z_][\w.-]*:)?([\w.-]+)\b[^>]*>/g;
    let depth = 0;
    let wanted: { name: string; start: number } | null = null;
    for (const tag of body.matchAll(tags)) {
      const closing = tag[0].startsWith("</");
      const selfClosing = tag[0].endsWith("/>");
      if (closing) {
        depth--;
        if (depth === 0 && wanted && tag[1] === wanted.name) { fields.set(wanted.name, xmlText(body.slice(wanted.start, tag.index))); wanted = null; }
      } else if (!selfClosing) {
        if (depth === 0 && ["groupId", "artifactId", "version"].includes(tag[1]!)) wanted = { name: tag[1]!, start: tag.index + tag[0].length };
        depth++;
      }
    }
    const group = fields.get("groupId");
    const artifact = fields.get("artifactId");
    if (!group || !artifact) continue;
    const version = fields.get("version");
    const exact = version && !/[\s,\[\]()]/.test(version) && !["LATEST", "RELEASE"].includes(version) ? version : null;
    result.push({ ecosystem: "Maven", name: `${group}:${artifact}`, version: exact, path: file.path, line: lineAt(match.index) });
  }
  return result;
}

/** Prefer locks per folder and retain distinct installed versions while deduplicating identical packages. */
export function parseManifests(files: Source[]): ParsedDependency[] {
  const sources = new Map<string, Source>();
  for (const file of files) {
    const segments = file.path.replaceAll("\\", "/").split("/").filter((part) => part && part !== ".");
    if (segments.some((part) => ["..", "node_modules", "vendor", ".venv", "target"].includes(part))) continue;
    const path = segments.join("/");
    if (path) sources.set(path, { path, content: file.content });
  }
  const folders = new Map<string, Source[]>();
  for (const file of [...sources.values()].sort((a, b) => a.path.localeCompare(b.path))) {
    const folder = file.path.slice(0, file.path.lastIndexOf("/") + 1);
    const existing = folders.get(folder) ?? [];
    existing.push(file);
    folders.set(folder, existing);
  }
  const result: ParsedDependency[] = [];
  for (const list of folders.values()) {
    const named = (name: string) => list.find((file) => file.path.split("/").at(-1) === name);
    const npm = named("package-lock.json");
    const pnpm = named("pnpm-lock.yaml");
    const manifest = named("package.json");
    result.push(...(npm && npmLock(npm) || pnpm && pnpmLock(pnpm) || manifest && npmManifest(manifest) || []));
    const poetry = named("poetry.lock");
    const python = poetry && tomlLock(poetry, "PyPI");
    if (python) result.push(...python);
    else for (const file of list) if (/^requirements[^/]*\.txt$/i.test(file.path.split("/").at(-1)!)) result.push(...requirements(file));
    const go = named("go.mod");
    if (go) result.push(...goMod(go));
    const cargo = named("Cargo.lock");
    if (cargo) result.push(...tomlLock(cargo, "crates.io") ?? []);
    const php = named("composer.lock");
    if (php) result.push(...composer(php));
    const pom = named("pom.xml");
    if (pom) result.push(...maven(pom));
  }
  const seen = new Set<string>();
  return result.filter((dependency) => {
    const name = dependency.ecosystem === "PyPI" ? dependency.name.toLowerCase().replace(/[-_.]+/g, "-") : dependency.name;
    const key = JSON.stringify([dependency.ecosystem, name, dependency.version]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
