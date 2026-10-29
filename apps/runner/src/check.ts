import type { RoomCheck, RoomProblem } from "@codechatter/contracts";
import { flatten, listTree } from "@codechatter/workspace-model";

import { Collector, ended } from "./databases.js";
import { JAIL } from "./plans.js";
import type { RoomSession } from "./room-session.js";
import { exitCodeOnceEnded, type RoomSandbox } from "./sandbox.js";

/** Each checker gets this long; a big project may need it all. */
const CHECK_SECONDS = 180;
/** At most this many problems come back, worst first. */
const MAX_PROBLEMS = 2000;
const MAX_OUTPUT = 8 * 1024 * 1024;

type Output = { code: number | null; stdout: string; stderr: string };

/** A command in the sandbox, inside the jail like a Run, from `cwd` (a folder of the room's). */
async function run(sandbox: RoomSandbox, cwd: string, command: string[]): Promise<Output> {
  const script = `cd "$1" || exit 1; shift; command -v "$1" >/dev/null || exit 127; exec timeout ${CHECK_SECONDS} "$@"`;
  const handle = await sandbox.exec([JAIL, "sh", "-c", script, "cc-check", cwd, ...command], { tty: false });
  const stdout = new Collector(MAX_OUTPUT);
  const stderr = new Collector(MAX_OUTPUT);
  handle.demux(stdout, stderr);
  await ended(handle.stream);
  const code = await exitCodeOnceEnded(handle);
  handle.stream.destroy();
  return { code, stdout: stdout.text(), stderr: stderr.text() };
}

const join = (folder: string, path: string) => (folder ? `${folder}/${path}` : path).replace(/^\.\//, "").replace(/\/\.\//g, "/");
const dirOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/** Pyright's --outputjson, its paths absolute and its lines from 0. */
export function parsePyright(json: string): RoomProblem[] {
  const report = JSON.parse(json) as {
    generalDiagnostics?: Array<{ file: string; severity: string; message: string; rule?: string; range?: { start: { line: number; character: number }; end: { line: number; character: number } } }>;
  };
  return (report.generalDiagnostics ?? [])
    .filter((d) => d.file.startsWith("/workspace/"))
    .map((d) => ({
      path: d.file.slice("/workspace/".length),
      severity: d.severity === "error" ? "error" : d.severity === "warning" ? "warning" : "info",
      message: d.message,
      source: "Pyright",
      code: d.rule ?? null,
      line: (d.range?.start.line ?? 0) + 1,
      column: (d.range?.start.character ?? 0) + 1,
      endLine: (d.range?.end.line ?? 0) + 1,
      endColumn: (d.range?.end.character ?? 0) + 1,
    }));
}

/** `tsc --pretty false`: "src/a.ts(3,7): error TS2322: …", a message's later lines indented under it. */
export function parseTsc(output: string, folder: string): RoomProblem[] {
  const problems: RoomProblem[] = [];
  for (const line of output.split("\n")) {
    const match = /^(.+?)\((\d+),(\d+)\): (error|warning|message) (TS\d+): (.*)$/.exec(line.trimEnd());
    if (match) {
      const [, file, row, column, kind, code, message] = match;
      problems.push({ path: join(folder, file!), severity: kind === "error" ? "error" : kind === "warning" ? "warning" : "info", message: message!, source: "tsc", code: code!, line: Number(row), column: Number(column), endLine: Number(row), endColumn: Number(column) });
    } else if (/^\s+\S/.test(line) && problems.length) {
      problems.at(-1)!.message += `\n${line.trim()}`;
    }
  }
  return problems;
}

/**
 * go vet's and cargo's short form: "main.go:12:2: message", "src/main.rs:3:5: error[E0425]: message",
 * paths from the folder they ran in.
 */
export function parseLines(output: string, folder: string, source: string): RoomProblem[] {
  const problems: RoomProblem[] = [];
  for (const line of output.split("\n")) {
    const match = /^(\S.*?\.\w+):(\d+):(\d+): (?:(error|warning)(?:\[(\w+)\])?: )?(.*)$/.exec(line.trimEnd());
    if (!match) continue;
    const [, file, row, column, kind, code, message] = match;
    problems.push({ path: join(folder, file!), severity: kind === "warning" ? "warning" : "error", message: message!, source, code: code ?? null, line: Number(row), column: Number(column), endLine: Number(row), endColumn: Number(column) });
  }
  return problems;
}

/**
 * Check the whole room: each project-wide checker the room's files call for, in the
 * folder its project is in (the room's files say which: .py files, each tsconfig.json,
 * go.mod and Cargo.toml). Go and Rust are in the full image only, and a project's
 * TypeScript is its own (node_modules), so a missing one is a note, not a failure.
 */
export async function checkRoom(session: RoomSession): Promise<RoomCheck> {
  const started = Date.now();
  await session.sync.synced();
  const files = flatten(listTree(session.sync.doc)).filter((node) => node.kind === "file").map((node) => node.path);
  const sandbox = session.sandbox;
  const problems: RoomProblem[] = [];
  const checked: string[] = [];
  const notes: string[] = [];
  const where = (folder: string) => folder || "the room's top folder";

  if (files.some((path) => path.endsWith(".py"))) {
    // Pyright's command line, beside the language server the image links (sandbox/image/Dockerfile).
    const output = await run(sandbox, "/workspace", ["node", "/usr/local/lib/pyright/index.js", "--outputjson"]);
    try {
      problems.push(...parsePyright(output.stdout));
      checked.push("Pyright");
    } catch {
      notes.push(`Pyright didn't finish: ${(output.stderr || output.stdout).trim().split("\n").at(-1) ?? ""}`);
    }
  }
  for (const config of files.filter((path) => /(^|\/)tsconfig\.json$/.test(path))) {
    const folder = dirOf(config);
    // The project's own TypeScript, the nearest above its tsconfig.json.
    const output = await run(sandbox, `/workspace/${folder}`, ["sh", "-c", 'd=$PWD; while [ "$d" != / ]; do if [ -x "$d/node_modules/.bin/tsc" ]; then exec "$d/node_modules/.bin/tsc" --noEmit --pretty false; fi; d=$(dirname "$d"); done; exit 127']);
    if (output.code === 127) {
      notes.push(`TypeScript isn't installed in ${where(folder)}: run npm install there.`);
      continue;
    }
    problems.push(...parseTsc(output.stdout, folder));
    checked.push(`tsc in ${where(folder)}`);
  }
  for (const [manifest, command, source] of [
    ["go.mod", ["go", "vet", "./..."], "go vet"],
    ["Cargo.toml", ["cargo", "check", "--offline", "--message-format=short"], "cargo"],
  ] as const) {
    for (const found of files.filter((path) => path === manifest || path.endsWith(`/${manifest}`))) {
      const folder = dirOf(found);
      const output = await run(sandbox, `/workspace/${folder}`, [...command]);
      if (output.code === 127) {
        notes.push(`${source} isn't in this sandbox: it comes with the full image.`);
        break;
      }
      const reported = parseLines(`${output.stdout}\n${output.stderr}`, folder, source);
      problems.push(...reported);
      // It failed without saying where (a dependency to download, say): what it said instead.
      if (output.code !== 0 && reported.length === 0) notes.push(`${source} in ${where(folder)}: ${output.stderr.trim().split("\n").slice(-2).join(" ")}`);
      checked.push(`${source} in ${where(folder)}`);
    }
  }
  const rank = { error: 0, warning: 1, info: 2 };
  problems.sort((a, b) => rank[a.severity] - rank[b.severity] || a.path.localeCompare(b.path) || a.line - b.line);
  return { problems: problems.slice(0, MAX_PROBLEMS), checked, notes, ms: Date.now() - started };
}
