import { Collector, ended } from "./databases.js";
import { JAIL } from "./plans.js";
import { exitCodeOnceEnded, type RoomSandbox } from "./sandbox.js";

/** Biggest text the formatter takes (and gives back). */
export const MAX_FORMAT_BYTES = 1024 * 1024;
/** A formatter that takes longer than this is stopped. */
const TIMEOUT_SECONDS = 20;

export type FormatOptions = { tabSize: number; insertSpaces: boolean };
type Formatter = { name: string; command: (path: string, options: FormatOptions) => string[] };

/**
 * The editor's Format document for languages the browser can't format itself (it does
 * JavaScript, TypeScript, JSON, CSS and HTML): a formatter in the room's sandbox, inside
 * the jail like a Run. Each reads the text on stdin and writes the result to stdout,
 * and finds the project's own settings (pyproject.toml, .clang-format, rustfmt.toml)
 * from the file's path.
 */
const FORMATTERS: Record<string, Formatter> = {
  python: { name: "Ruff", command: (path) => ["ruff", "format", "--no-cache", "--stdin-filename", path, "-"] },
  c: { name: "clang-format", command: (path) => ["clang-format", "--style=file", "--fallback-style=LLVM", `--assume-filename=${path}`] },
  cpp: { name: "clang-format", command: (path) => ["clang-format", "--style=file", "--fallback-style=LLVM", `--assume-filename=${path}`] },
  shell: { name: "shfmt", command: (path, o) => ["shfmt", "--filename", path, ...(o.insertSpaces ? ["-i", String(o.tabSize)] : [])] },
  go: { name: "gofmt", command: () => ["gofmt"] },
  rust: { name: "rustfmt", command: () => ["rustfmt", "--emit", "stdout", "--edition", "2021", "--quiet"] },
};

export const formatterFor = (language: string): Formatter | null => FORMATTERS[language] ?? null;

export class FormatError extends Error {}

/**
 * The text, formatted. A formatter that isn't installed (Go and Rust are in the full
 * image only), or that rejects the code (a syntax error), is a FormatError with its words.
 */
export async function formatText(sandbox: RoomSandbox, language: string, path: string, text: string, options: FormatOptions): Promise<string> {
  const formatter = formatterFor(language);
  if (!formatter) throw new FormatError(`No formatter for ${language} in the sandbox.`);
  const input = Buffer.from(text, "utf8");
  if (input.length > MAX_FORMAT_BYTES) throw new FormatError("The file is too big to format (over 1 MB).");
  const command = formatter.command(`/workspace/${path}`, options);
  // The exec's stdin can't be closed on its own on every Docker: the formatter reads exactly the text's bytes.
  // $1 is that count; the formatter's command follows it.
  const script = `n=$1; shift; command -v "$1" >/dev/null || { echo "cc-format: missing" >&2; exit 127; }; head -c "$n" | timeout ${TIMEOUT_SECONDS} "$@"`;
  const handle = await sandbox.exec([JAIL, "sh", "-c", script, "cc-format", String(input.length), ...command], { tty: false, stdin: true });
  const stdout = new Collector(MAX_FORMAT_BYTES + 1);
  const stderr = new Collector(16 * 1024);
  handle.demux(stdout, stderr);
  const finished = ended(handle.stream);
  handle.stream.write(input);
  await finished;
  const code = await exitCodeOnceEnded(handle);
  handle.stream.destroy();
  const problem = stderr.text().trim();
  if (code === 127 && problem.includes("cc-format: missing")) {
    throw new FormatError(`${formatter.name} isn't in this room's sandbox${language === "go" || language === "rust" ? " (it comes with the full image)" : ""}.`);
  }
  if (code === 124) throw new FormatError(`${formatter.name} took longer than ${TIMEOUT_SECONDS} seconds and was stopped.`);
  if (code !== 0) throw new FormatError(firstLines(problem, 4) || `${formatter.name} couldn't format it (exit code ${code}).`);
  if (stdout.cut) throw new FormatError("The formatted text is too big to send back.");
  return stdout.text();
}

function firstLines(text: string, count: number): string {
  return text.split("\n").slice(0, count).join("\n").trim();
}
