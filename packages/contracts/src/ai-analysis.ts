/**
 * What goes to the AI when it's asked about a whole project. A project is far bigger than a model's context, so it
 * gets what the Analysis tool's tools found, what plain code can tell about the project's shape, the tree, a
 * few key files and an outline of the rest. Secrets don't go: the browser takes them out, and the server again.
 */
import type { RoomAnalysis } from "./analysis.js";

export type ProjectFile = {
  path: string;
  /** null for a binary file, or one too big to read. */
  text: string | null;
};

export type ProjectDigest = {
  counts: { files: number; lines: number };
  /** What the tools and plain code found: the model is told these are right. */
  facts: string[];
  tree: string[];
  files: Array<{ path: string; text: string }>;
  outlines: Array<{ path: string; lines: string[] }>;
};

const MOST_FILES_READ = 12;
const MOST_FILE_CHARS = 20_000;
const MOST_OUTLINES = 150;
const MOST_OUTLINE_LINES = 16;
const MOST_OUTLINE_LINE_CHARS = 140;
const MOST_TREE = 800;
const MOST_NAMED = 8;

const NEVER_READ = /(^|\/)\.env($|\.(?!example$|sample$|template$)[^/]*$)|\.(pem|key|p12|pfx|keystore)$|(^|\/)id_(rsa|ed25519|ecdsa)$/i;
const NOT_THEIRS = /(^|\/)(node_modules|dist|build|target|out|\.next|\.git|\.venv|venv|__pycache__|vendor|coverage)\/|\.(lock|min\.js|map|svg|csv|tsv|log)$|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/i;
const TEST_FILE = /(^|\/)(tests?|__tests__|spec)\/|[._-](test|spec|e2e)\.[a-z0-9]+$|(^|\/)test_[^/]+$|_test\.[a-z0-9]+$/i;
const README = /(^|\/)readme(\.[a-z]+)?$/i;
const MANIFEST = /(^|\/)(package\.json|pyproject\.toml|requirements\.txt|go\.mod|Cargo\.toml|pom\.xml|build\.gradle(\.kts)?|Gemfile|composer\.json|mix\.exs|[^/]+\.csproj)$/i;
const SETUP = /(^|\/)(Dockerfile|docker-compose\.ya?ml|compose\.ya?ml|Makefile|room\.json|\.env\.example|tsconfig\.json|vite\.config\.[a-z]+|next\.config\.[a-z]+)$/i;
const ENTRY = /(^|\/)(main|index|app|server|cli|__main__|manage)\.[a-z0-9]+$/i;
const CI = /(^|\/)(\.github\/workflows\/|\.gitlab-ci\.yml|\.circleci\/|azure-pipelines\.yml|Jenkinsfile)/i;
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|c|h|cc|cpp|hpp|cs|rb|php|swift|scala|sh|sql|vue|svelte)$/i;
const LOCKFILE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/;

/** What a secret looks like. The first group, when there is one, is what's kept: the name, not the value. */
const SECRET_SHAPES: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /(\b[A-Za-z0-9_-]*(?:password|passwd|secret|api[_-]?key|access[_-]?key|auth[_-]?token|private[_-]?key)[A-Za-z0-9_-]*["']?\s*[:=]\s*)["'][^"'\n]{6,}["']/gi,
  // A password in a connection string.
  /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s:@/]{3,}(?=@)/gi,
];
const PLACEHOLDER = /^["'](?:\$\{?[A-Za-z_]|<|\{\{|changeme|change-me|your[_-]|example|xxx|placeholder|dummy|fake)/i;

/** The same text with anything that looks like a secret taken out. Run in the browser, and again on the server. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const shape of SECRET_SHAPES) {
    out = out.replace(shape, (whole: string, name: unknown) => {
      if (typeof name !== "string") return "[removed: looks like a secret]";
      const value = whole.slice(name.length);
      if (PLACEHOLDER.test(value)) return whole;
      return value.startsWith('"') || value.startsWith("'") ? `${name}"[removed: looks like a secret]"` : `${name}[removed]`;
    });
  }
  return out;
}

const lineCount = (text: string) => (text ? text.replace(/\n$/, "").split("\n").length : 0);
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const named = (items: string[]) => `${items.slice(0, MOST_NAMED).join(", ")}${items.length > MOST_NAMED ? `, and ${items.length - MOST_NAMED} more` : ""}`;

const DEFINITION = /^\s*(?:export\s+|public\s+|private\s+|protected\s+|static\s+|abstract\s+|final\s+|async\s+|default\s+|pub\s+)*(?:function|def|class|interface|type|enum|struct|trait|impl|module|func|fn)\b/;
const ROUTE = /^\s*(?:app|router|server)\.(?:get|post|put|delete|patch|use)\(|^\s*@(?:Get|Post|Put|Delete|Patch|app\.|router\.)/;

function outlineOf(text: string): string[] {
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    if (!DEFINITION.test(raw) && !ROUTE.test(raw)) continue;
    lines.push(raw.trim().replace(/\s*\{\s*$/, "").slice(0, MOST_OUTLINE_LINE_CHARS));
    if (lines.length === MOST_OUTLINE_LINES) break;
  }
  return lines;
}

function rank(path: string): number {
  if (README.test(path)) return 0;
  if (MANIFEST.test(path)) return 1;
  if (SETUP.test(path)) return 2;
  if (ENTRY.test(path)) return 3;
  return 4;
}

/** What the project's shape says: what no analysis tool looks at. */
function shapeFacts(paths: string[], code: string[]): string[] {
  const facts: string[] = [];
  const tests = code.filter((path) => TEST_FILE.test(path));
  const own = code.filter((path) => !TEST_FILE.test(path));
  if (own.length >= 3 && tests.length === 0) facts.push(`No test files among ${plural(own.length, "source file")}.`);
  else if (own.length) facts.push(`${plural(tests.length, "test file")} and ${plural(own.length, "source file")}.`);
  if (!paths.some((path) => README.test(path))) facts.push("No README.");
  if (own.length && !paths.some((path) => MANIFEST.test(path))) facts.push("No package manifest (package.json, requirements.txt and so on), so what it depends on isn't written down.");
  if (paths.some((path) => /(^|\/)package\.json$/.test(path)) && !paths.some((path) => LOCKFILE.test(path))) facts.push("A package.json with no lockfile, so installs can differ from one machine to the next.");
  if (own.length >= 3 && !paths.some((path) => /(^|\/)\.gitignore$/.test(path))) facts.push("No .gitignore.");
  if (own.length >= 3 && !paths.some((path) => CI.test(path))) facts.push("No CI configuration.");
  const inTree = paths.filter((path) => /(^|\/)(node_modules|\.venv|venv|__pycache__)\//.test(path));
  if (inTree.length) facts.push(`${plural(inTree.length, "installed or generated file")} ${inTree.length === 1 ? "is" : "are"} in the project.`);
  const secretFiles = paths.filter((path) => NEVER_READ.test(path));
  if (secretFiles.length) facts.push(`${plural(secretFiles.length, "file")} that should stay private ${secretFiles.length === 1 ? "is" : "are"} in the project, and weren't read: ${named(secretFiles)}.`);
  return facts;
}

/** The Analysis tool's report, as facts. Places and rule names only, as the report itself holds no secret. */
export function analysisFacts(report: RoomAnalysis): string[] {
  const facts: string[] = [];
  const { size, functions, secrets, security, problems, tools } = report;
  if (size.languages.length) {
    facts.push(`scc: ${size.code} lines of code in ${plural(size.files, "file")}: ${size.languages.slice(0, 6).map((language) => `${language.name} ${language.code}`).join(", ")}.`);
    if (size.biggest.length) facts.push(`scc, the biggest files: ${named(size.biggest.slice(0, 5).map((file) => `${file.path} (${file.code} lines)`))}.`);
  }
  if (functions.total) {
    const tangled = functions.worst.filter((fn) => fn.complexity >= 5).slice(0, 8);
    facts.push(`lizard: ${plural(functions.total, "function")}, ${functions.tooComplex} too complex (over 15).${tangled.length ? ` The most complex: ${tangled.map((fn) => `${fn.name} at ${fn.path}:${fn.line} (${fn.complexity})`).join(", ")}.` : ""}`);
  }
  if (secrets.total) facts.push(`gitleaks: ${plural(secrets.total, "secret")} in the code: ${named(secrets.items.map((secret) => `${secret.path}:${secret.line} (${secret.rule})`))}. Their values were not sent to you.`);
  const serious = security.items.filter((issue) => issue.severity !== "low");
  if (security.total) {
    const count = (level: string) => security.items.filter((issue) => issue.severity === level).length;
    facts.push(`bandit, Python security: ${count("high")} high, ${count("medium")} medium, ${count("low")} low.${serious.length ? ` ${named(serious.map((issue) => `${issue.path}:${issue.line} ${issue.code} (${issue.severity}): ${issue.message}`))}` : ""}`);
  }
  if (problems.errors + problems.warnings) {
    const worst = problems.items.slice(0, 8).map((problem) => `${problem.path}:${problem.line} ${problem.message.slice(0, 120)}`);
    facts.push(`The project's checkers: ${plural(problems.errors, "error")}, ${plural(problems.warnings, "warning")}. ${named(worst)}`);
  }
  for (const tool of tools) if (!tool.ran && tool.note) facts.push(`Not run: ${tool.note}`);
  return facts;
}

/** A project as a model can take it in. Nothing in it is a secret. */
export function buildProjectDigest(files: readonly ProjectFile[], report: RoomAnalysis | null = null): ProjectDigest {
  const all = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const paths = all.map((file) => file.path);
  const readable = all.filter((file): file is { path: string; text: string } => file.text !== null && !NEVER_READ.test(file.path));
  const useful = readable.filter((file) => !NOT_THEIRS.test(file.path));
  const code = useful.filter((file) => SOURCE.test(file.path)).map((file) => file.path);
  const chosen = [...useful]
    .filter((file) => rank(file.path) < 4 || SOURCE.test(file.path))
    .sort((a, b) => rank(a.path) - rank(b.path) || a.path.split("/").length - b.path.split("/").length || b.text.length - a.text.length)
    .slice(0, MOST_FILES_READ);
  const read = new Set(chosen.map((file) => file.path));
  const outlines = useful
    .filter((file) => !read.has(file.path) && SOURCE.test(file.path) && !TEST_FILE.test(file.path))
    .map((file) => ({ path: file.path, lines: outlineOf(file.text).map(redactSecrets) }))
    .filter((outline) => outline.lines.length > 0)
    .slice(0, MOST_OUTLINES);
  return {
    counts: { files: all.length, lines: useful.reduce((sum, file) => sum + lineCount(file.text), 0) },
    facts: [...(report ? analysisFacts(report) : []), ...shapeFacts(paths, code)].map(redactSecrets),
    tree: paths.filter((path) => !NOT_THEIRS.test(path)).slice(0, MOST_TREE),
    files: chosen.map((file) => ({ path: file.path, text: redactSecrets(file.text.slice(0, MOST_FILE_CHARS)) })),
    outlines,
  };
}

/**
 * Paths an answer names that aren't in the project. A model that hasn't read a file may still name one that
 * sounds right. Only what's in `backticks` counts, and a file's name alone is fine if the project has one.
 */
export function pathsNotInProject(answer: string, known: readonly string[]): string[] {
  const names = new Set(known.map((path) => path.slice(path.lastIndexOf("/") + 1)));
  const exact = new Set(known);
  const folders = new Set(known.flatMap((path) => path.split("/").slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join("/"))));
  const unknown = new Set<string>();
  for (const match of answer.matchAll(/`([^`\n]+)`/g)) {
    const raw = match[1]!.trim().replace(/^\.\//, "").replace(/:\d+(?::\d+)?$/, "");
    if (/\s/.test(raw) || /^[a-z]+:|[(){}=<>,;'"$*]/.test(raw)) continue;
    const looksLikePath = raw.includes("/") ? /^[\w@.-]+(\/[\w@.-]+)+\/?$/.test(raw) : SOURCE.test(raw) || README.test(raw) || MANIFEST.test(raw) || SETUP.test(raw) || /\.(json|ya?ml|toml|md|html|css)$/i.test(raw);
    if (!looksLikePath) continue;
    const path = raw.replace(/\/$/, "");
    if (exact.has(path) || folders.has(path) || names.has(path) || known.some((candidate) => candidate.endsWith(`/${path}`))) continue;
    unknown.add(path);
  }
  return [...unknown];
}
