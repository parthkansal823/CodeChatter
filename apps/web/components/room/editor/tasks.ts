import { parseJsonc } from "./jsonc";

/**
 * Tasks, as VS Code knows them: the ones `.vscode/tasks.json` lists (shell, process and
 * npm tasks, with their args, folder, environment and build or test group), and each
 * package.json's scripts. A task becomes one shell command line, run in the room's
 * Task terminal.
 */
export type Task = {
  label: string;
  /** The line the shell runs. */
  command: string;
  /** Workspace-relative folder it runs in ("" for the room's root). */
  cwd: string;
  group: "build" | "test" | null;
  isDefault: boolean;
  source: "tasks.json" | "npm";
};

export type TaskFile = { path: string; text: string };
/** What `${file}` and friends mean: the file open in the editor, if any. */
export type TaskContext = { activePath: string | null };

export const TASKS_PATH = ".vscode/tasks.json";

/** A word for the shell, quoted when it needs to be. */
export function shellQuote(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}

/** ${workspaceFolder}, ${file}, ${relativeFile}, ${fileBasename}, ${fileBasenameNoExtension}, ${fileDirname}, ${cwd}. */
export function substitute(text: string, context: TaskContext): string {
  const file = context.activePath;
  const base = file?.split("/").pop() ?? "";
  const dir = file?.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
  const values: Record<string, string | null> = {
    workspaceFolder: "/workspace",
    workspaceFolderBasename: "workspace",
    cwd: "/workspace",
    file: file && `/workspace/${file}`,
    relativeFile: file,
    fileBasename: file && base,
    fileBasenameNoExtension: file && base.replace(/\.[^.]*$/, ""),
    fileExtname: file && (/\.[^.]*$/.exec(base)?.[0] ?? ""),
    fileDirname: file && (dir ? `/workspace/${dir}` : "/workspace"),
    pathSeparator: "/",
  };
  return text.replace(/\$\{(\w+)\}/g, (all, name: string) => values[name] ?? all);
}

/** A folder from tasks.json (often "${workspaceFolder}/app") as workspace-relative. */
function relativeCwd(cwd: unknown, context: TaskContext): string | null {
  if (typeof cwd !== "string" || !cwd.trim()) return null;
  const path = substitute(cwd.trim(), context).replace(/^\/workspace\/?/, "").replace(/^\.\/?/, "").replace(/\/$/, "");
  return path.startsWith("/") || path.includes("..") ? null : path;
}

type RawTask = {
  label?: unknown;
  type?: unknown;
  command?: unknown;
  args?: unknown;
  script?: unknown;
  path?: unknown;
  options?: { cwd?: unknown; env?: unknown };
  group?: unknown;
};

function fromTasksJson(text: string, context: TaskContext): Task[] {
  let json: unknown;
  try {
    json = parseJsonc(text);
  } catch {
    return [];
  }
  const raw = (json as { tasks?: unknown })?.tasks;
  if (!Array.isArray(raw)) return [];
  const out: Task[] = [];
  for (const entry of raw as RawTask[]) {
    if (!entry || typeof entry !== "object") continue;
    const type = typeof entry.type === "string" ? entry.type : "shell";
    let line: string;
    let cwd = relativeCwd(entry.options?.cwd, context) ?? "";
    if (type === "npm") {
      if (typeof entry.script !== "string") continue;
      line = `npm run ${shellQuote(entry.script)}`;
      cwd = relativeCwd(entry.path, context) ?? cwd;
    } else {
      if (typeof entry.command !== "string" || !entry.command.trim()) continue;
      const args = Array.isArray(entry.args) ? entry.args.filter((a): a is string => typeof a === "string") : [];
      const command = substitute(entry.command, context);
      // A shell task's command is shell text; a process task's is one program.
      line = [type === "process" ? shellQuote(command) : command, ...args.map((a) => shellQuote(substitute(a, context)))].join(" ");
    }
    const env = entry.options?.env && typeof entry.options.env === "object" ? Object.entries(entry.options.env as Record<string, unknown>) : [];
    const assignments = env.filter(([k, v]) => /^[A-Za-z_]\w*$/.test(k) && typeof v === "string").map(([k, v]) => `${k}=${shellQuote(substitute(v as string, context))}`);
    if (assignments.length) line = `env ${assignments.join(" ")} ${line}`;
    const group = typeof entry.group === "string" ? entry.group : (entry.group as { kind?: unknown } | undefined)?.kind;
    const label = typeof entry.label === "string" && entry.label.trim() ? entry.label.trim() : type === "npm" ? `npm: ${String(entry.script)}` : line;
    out.push({
      label,
      command: line,
      cwd,
      group: group === "build" || group === "test" ? group : null,
      isDefault: Boolean((entry.group as { isDefault?: unknown } | undefined)?.isDefault),
      source: "tasks.json",
    });
  }
  return out;
}

function fromPackageJson(path: string, text: string): Task[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return [];
  }
  const scripts = (json as { scripts?: unknown })?.scripts;
  if (!scripts || typeof scripts !== "object") return [];
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  return Object.keys(scripts as Record<string, unknown>).map((name) => ({
    label: dir ? `npm: ${name} (${dir})` : `npm: ${name}`,
    command: `npm run ${shellQuote(name)}`,
    cwd: dir,
    group: name === "build" ? "build" : name === "test" ? "test" : null,
    isDefault: false,
    source: "npm",
  }));
}

/** Every task in the room: tasks.json's first (in its order), then npm scripts by folder. */
export function readTasks(files: TaskFile[], context: TaskContext): Task[] {
  const listed = files.filter((f) => f.path === TASKS_PATH).flatMap((f) => fromTasksJson(f.text, context));
  const npm = files
    .filter((f) => (f.path === "package.json" || f.path.endsWith("/package.json")) && !f.path.includes("node_modules/"))
    .sort((a, b) => a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path))
    .flatMap((f) => fromPackageJson(f.path, f.text));
  return [...listed, ...npm];
}

/** Ctrl+Shift+B: the default build task, else the only build task; null to choose from the list. */
export function buildTask(tasks: Task[]): Task | null {
  const builds = tasks.filter((t) => t.group === "build");
  return builds.find((t) => t.isDefault) ?? (builds.length === 1 ? builds[0]! : null);
}

/** What's typed into the Task terminal (after Ctrl+C stops what it was running): this task, in its folder. */
export function taskInput(task: Task): string {
  const dir = task.cwd ? `/workspace/${task.cwd}` : "/workspace";
  return `clear && cd ${shellQuote(dir)} && ${task.command}\r`;
}
