/**
 * The Analysis tool: real tools over the whole room, in its sandbox, inside the jail like a Run. scc measures it,
 * lizard finds its most tangled functions, gitleaks its secrets, bandit its security problems in Python, and
 * the project-wide checkers (check.ts) its errors. The parsers keep only named fields, so a secret that a tool
 * prints (bandit quotes a hardcoded password in its message) goes no further than this file.
 */
import { COMPLEX_FUNCTION, type AnalysisFile, type AnalysisFunction, type AnalysisIssue, type AnalysisLanguage, type AnalysisSecret, type AnalysisToolRun, type RoomAnalysis } from "@codechatter/contracts";

import { checkRoom, run } from "./check.js";
import type { RoomSession } from "./room-session.js";

const NOT_THEIRS = ["node_modules", ".git", "dist", "build", "target", ".next", ".venv", "venv", "__pycache__", "vendor", "coverage"];
const NOT_THEIRS_PATH = new RegExp(`(^|/)(${NOT_THEIRS.map((name) => name.replace(".", "\\.")).join("|")})/`);
const PYTHON_TOOLS = "PYTHONPATH=/usr/local/lib/codechatter/analysis";
const GITLEAKS_CONFIG = "/usr/local/lib/codechatter/gitleaks.toml";

const MOST_BIGGEST = 10;
const MOST_WORST = 30;
const MOST_FINDINGS = 200;
const MOST_PROBLEMS = 100;

const clean = (path: string) => path.replace(/^\.\//, "").replace(/^\/workspace\//, "");

type SccLanguage = { Name: string; Lines: number; Code: number; Comment: number; Blank: number; Complexity: number; Count: number; Files?: Array<{ Language: string; Location: string; Code: number; Complexity: number }> };

/** scc --format json --by-file. */
export function parseScc(json: string): RoomAnalysis["size"] {
  const report = JSON.parse(json || "[]") as SccLanguage[];
  const languages: AnalysisLanguage[] = report
    .map((language) => ({ name: language.Name, files: language.Count, code: language.Code, comments: language.Comment, blanks: language.Blank, complexity: language.Complexity }))
    .sort((a, b) => b.code - a.code);
  const biggest: AnalysisFile[] = report
    .flatMap((language) => language.Files ?? [])
    .map((file) => ({ path: clean(file.Location), language: file.Language, code: file.Code, complexity: file.Complexity }))
    .sort((a, b) => b.code - a.code)
    .slice(0, MOST_BIGGEST);
  const sum = (pick: (language: SccLanguage) => number) => report.reduce((total, language) => total + pick(language), 0);
  return { files: sum((l) => l.Count), lines: sum((l) => l.Lines), code: sum((l) => l.Code), comments: sum((l) => l.Comment), blanks: sum((l) => l.Blank), complexity: sum((l) => l.Complexity), languages, biggest };
}

/** One line of CSV, with quoted fields that may hold commas. */
function csvFields(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      fields.push(field);
      field = "";
    } else field += char;
  }
  fields.push(field);
  return fields;
}

/** lizard --csv: NLOC, CCN, tokens, params, length, location, file, function, long name, start, end. */
export function parseLizard(csv: string): RoomAnalysis["functions"] {
  const all: AnalysisFunction[] = [];
  for (const line of csv.split("\n")) {
    const fields = csvFields(line.trimEnd());
    if (fields.length < 11) continue;
    const complexity = Number(fields[1]);
    const start = Number(fields[9]);
    if (!Number.isFinite(complexity) || !Number.isFinite(start)) continue;
    all.push({ path: clean(fields[6]!), name: fields[7]!.slice(0, 120), line: start, complexity, lines: Number(fields[0]) || 0, params: Number(fields[3]) || 0 });
  }
  all.sort((a, b) => b.complexity - a.complexity || b.lines - a.lines);
  return { total: all.length, tooComplex: all.filter((fn) => fn.complexity > COMPLEX_FUNCTION).length, worst: all.slice(0, MOST_WORST) };
}

/** gitleaks' JSON report. Only where, and which rule: never Match or Secret, whatever they hold. */
export function parseGitleaks(json: string): RoomAnalysis["secrets"] {
  const report = JSON.parse(json || "[]") as Array<{ RuleID: string; Description: string; StartLine: number; File: string }> | null;
  const items: AnalysisSecret[] = (report ?? [])
    .map((finding) => ({ path: clean(finding.File), line: finding.StartLine, rule: finding.RuleID, description: finding.Description.slice(0, 200) }))
    .sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  return { total: items.length, items: items.slice(0, MOST_FINDINGS) };
}

// These three quote the password they found in their message.
const QUOTES_THE_SECRET = new Set(["B105", "B106", "B107"]);
const level = (value: string): AnalysisIssue["severity"] => (value === "HIGH" ? "high" : value === "MEDIUM" ? "medium" : "low");

/** bandit -f json. Its `code` field and some messages hold the line itself, so neither is kept as it comes. */
export function parseBandit(json: string): RoomAnalysis["security"] {
  const report = JSON.parse(json) as {
    results?: Array<{ filename: string; line_number: number; issue_severity: string; issue_confidence: string; test_id: string; issue_text: string; issue_cwe?: { id?: number } }>;
  };
  const rank = { high: 0, medium: 1, low: 2 };
  const items: AnalysisIssue[] = (report.results ?? [])
    .map((issue) => ({
      path: clean(issue.filename),
      line: issue.line_number,
      severity: level(issue.issue_severity),
      confidence: level(issue.issue_confidence),
      code: issue.test_id,
      message: QUOTES_THE_SECRET.has(issue.test_id) ? "Possible hardcoded password." : issue.issue_text.slice(0, 300),
      cwe: issue.issue_cwe?.id ?? null,
    }))
    .sort((a, b) => rank[a.severity] - rank[b.severity] || rank[a.confidence] - rank[b.confidence] || a.path.localeCompare(b.path) || a.line - b.line);
  return { total: items.length, items: items.slice(0, MOST_FINDINGS) };
}

type Step<T> = { value: T; run: AnalysisToolRun };

/** A tool that's missing, or that says something unreadable, is a note in the report, not a failed report. */
async function step<T>(name: string, empty: T, session: RoomSession, command: string[], parse: (stdout: string) => T): Promise<Step<T>> {
  const started = Date.now();
  const output = await run(session.sandbox, "/workspace", command);
  const ms = Date.now() - started;
  if (output.code === 127) return { value: empty, run: { name, ran: false, note: `${name} isn't in this room's sandbox image: it needs rebuilding.`, ms } };
  if (output.code === 124) return { value: empty, run: { name, ran: false, note: `${name} ran out of time.`, ms } };
  // Empty output from a tool that failed isn't "nothing found": say so, or a broken tool reads as a clean project.
  if (output.code !== 0 && !output.stdout.trim()) return { value: empty, run: { name, ran: false, note: `${name} didn't finish: ${output.stderr.trim().split("\n").at(-1)?.slice(0, 200) ?? "no reason given"}`, ms } };
  try {
    return { value: parse(output.stdout), run: { name, ran: true, note: null, ms } };
  } catch {
    return { value: empty, run: { name, ran: false, note: `${name} didn't finish: ${(output.stderr || output.stdout).trim().split("\n").at(-1)?.slice(0, 200) ?? ""}`, ms } };
  }
}

const NO_SIZE: RoomAnalysis["size"] = { files: 0, lines: 0, code: 0, comments: 0, blanks: 0, complexity: 0, languages: [], biggest: [] };
const NO_FUNCTIONS: RoomAnalysis["functions"] = { total: 0, tooComplex: 0, worst: [] };
const NO_SECRETS: RoomAnalysis["secrets"] = { total: 0, items: [] };
const NO_ISSUES: RoomAnalysis["security"] = { total: 0, items: [] };

const notTheirs = <T extends { path: string }>(items: T[]) => items.filter((item) => !NOT_THEIRS_PATH.test(item.path));

async function analyse(session: RoomSession): Promise<RoomAnalysis> {
  const started = Date.now();
  await session.sync.synced();
  const lizardSkips = NOT_THEIRS.flatMap((name) => ["-x", `*/${name}/*`]);
  const banditSkips = [...NOT_THEIRS, "tests", "test"].map((name) => `*/${name}/*`).join(",");
  const [size, functions, secrets, check] = await Promise.all([
    step("scc", NO_SIZE, session, ["scc", "--format", "json", "--by-file", "--no-cocomo", "--no-min-gen", "--exclude-dir", NOT_THEIRS.join(","), "."], parseScc),
    step("lizard", NO_FUNCTIONS, session, ["env", PYTHON_TOOLS, "python3", "-m", "lizard", "--csv", ...lizardSkips, "."], parseLizard),
    step("gitleaks", NO_SECRETS, session, ["gitleaks", "dir", ".", "--no-banner", "--redact=100", "--report-format", "json", "--report-path", "-", "--exit-code", "0", "--config", GITLEAKS_CONFIG, "--max-target-megabytes", "5", "--log-level", "error"], parseGitleaks),
    checkRoom(session),
  ]);
  const hasPython = size.value.languages.some((language) => language.name === "Python");
  const security: Step<RoomAnalysis["security"]> = hasPython
    ? await step("bandit", NO_ISSUES, session, ["env", PYTHON_TOOLS, "python3", "-m", "bandit", "-r", "-q", "-f", "json", "-x", banditSkips, "."], parseBandit)
    : { value: NO_ISSUES, run: { name: "bandit", ran: false, note: "bandit only reads Python, and there's none here.", ms: 0 } };

  const counts = { errors: 0, warnings: 0, infos: 0 };
  for (const problem of check.problems) counts[problem.severity === "error" ? "errors" : problem.severity === "warning" ? "warnings" : "infos"]++;
  const tools: AnalysisToolRun[] = [
    size.run,
    functions.run,
    secrets.run,
    security.run,
    ...check.checked.map((name) => ({ name, ran: true, note: null, ms: check.ms })),
    ...check.notes.map((note) => ({ name: "Checks", ran: false, note, ms: 0 })),
  ];
  return {
    at: new Date().toISOString(),
    ms: Date.now() - started,
    tools,
    size: { ...size.value, biggest: notTheirs(size.value.biggest) },
    functions: { ...functions.value, worst: notTheirs(functions.value.worst) },
    secrets: { total: secrets.value.total, items: notTheirs(secrets.value.items) },
    security: { total: security.value.total, items: notTheirs(security.value.items) },
    problems: { ...counts, items: check.problems.slice(0, MOST_PROBLEMS) },
  };
}

const running = new WeakMap<RoomSession, Promise<RoomAnalysis>>();

/** The whole room, once at a time: a second person asking gets the run already under way. */
export function analyseRoom(session: RoomSession): Promise<RoomAnalysis> {
  const current = running.get(session);
  if (current) return current;
  const next = analyse(session).finally(() => running.delete(session));
  running.set(session, next);
  return next;
}
