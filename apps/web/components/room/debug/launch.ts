import { parseJsonc } from "../editor/jsonc";
import { substitute, type TaskContext } from "../editor/tasks";

export const LAUNCH_PATH = ".vscode/launch.json";

/**
 * A debug configuration, as the room's debugger takes it (runner: debug.ts). Paths are
 * the room's (no /workspace/); a C or C++ program is its source file, which the room
 * compiles with debug information; a Go program is a .go file or a package's folder
 * ("." for the room's top), which the room builds; a Node program is a .js or .ts file
 * (Node runs TypeScript as it is).
 */
export type LaunchConfig = {
  name: string;
  language: "python" | "c" | "cpp" | "go" | "javascript" | "java";
  program: string | null;
  /** Python's `-m` module, instead of a program. */
  module: string | null;
  args: string[];
  cwd: string | null;
  env: Record<string, string>;
  stopOnEntry: boolean;
  justMyCode: boolean;
};

/** A configuration the room can't run, and why (shown beside the others). */
export type SkippedConfig = { name: string; reason: string };

const PYTHON = new Set(["debugpy", "python"]);
const NATIVE = new Set(["cppdbg", "gdb", "lldb", "cppvsdbg", "c", "cpp"]);
const GO = new Set(["go", "dlv"]);
const NODE = new Set(["node", "pwa-node"]);
const JAVA = new Set(["java"]);
const NODE_PROGRAM = /\.(m|c)?(js|ts)$/i;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A path from launch.json ("${workspaceFolder}/app/main.py", "${file}", "src/x.py") as the room's, or null. */
function roomPath(value: unknown, context: TaskContext): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const path = substitute(value.trim(), context)
    .replace(/^\/workspace\/?/, "")
    .replace(/^\.\//, "")
    .replace(/\/$/, "");
  return !path || path.startsWith("/") || path.split("/").includes("..") || path.includes("${") ? null : path;
}

function args(value: unknown, context: TaskContext): string[] {
  if (typeof value === "string") return value.trim() ? substitute(value, context).trim().split(/\s+/) : [];
  return Array.isArray(value)
    ? value.filter((a): a is string => typeof a === "string").map((a) => substitute(a, context))
    : [];
}

function env(value: unknown, context: TaskContext): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, string] => ENV_NAME.test(entry[0]) && typeof entry[1] === "string")
      .map(([key, text]) => [key, substitute(text, context)]),
  );
}

/** Whether a program from launch.json is the room's top folder ("${workspaceFolder}", "/workspace" or "."). */
function isTop(value: unknown, context: TaskContext): boolean {
  if (typeof value !== "string") return false;
  return /^(\/workspace|\.)\/?$/.test(substitute(value.trim(), context));
}

const nativeLanguage = (path: string): "c" | "cpp" | null =>
  /\.c$/i.test(path) ? "c" : /\.(cc|cpp|cxx|c\+\+)$/i.test(path) ? "cpp" : null;

/**
 * `.vscode/launch.json`'s configurations, as VS Code writes them (comments and trailing
 * commas fine), with `${file}`, `${workspaceFolder}` and the rest filled in for the open
 * file. Python (debugpy) by program or module, C and C++ (cppdbg, gdb) by source file,
 * Go by file or package folder, Node (node, pwa-node) by a .js or .ts file, and Java by its
 * .java file (mainClass "${file}", or program); the rest are listed as skipped, with why.
 */
export function readLaunch(
  text: string,
  context: TaskContext,
): { configs: LaunchConfig[]; skipped: SkippedConfig[] } {
  const configs: LaunchConfig[] = [];
  const skipped: SkippedConfig[] = [];
  let json: unknown;
  try {
    json = parseJsonc(text);
  } catch {
    return { configs, skipped: [{ name: LAUNCH_PATH, reason: "It isn't valid JSON." }] };
  }
  const list = (json as { configurations?: unknown } | null)?.configurations;
  if (!Array.isArray(list)) return { configs, skipped };
  for (const raw of list as Array<Record<string, unknown>>) {
    if (!raw || typeof raw !== "object") continue;
    const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "Unnamed";
    const type = typeof raw.type === "string" ? raw.type : "";
    if (raw.request === "attach") {
      skipped.push({
        name,
        reason: "Attaching to a running program isn't supported; use a launch configuration.",
      });
      continue;
    }
    const common = {
      name,
      args: args(raw.args, context),
      cwd: roomPath(raw.cwd, context),
      env: env(raw.env, context),
      stopOnEntry: raw.stopOnEntry === true || raw.stopAtEntry === true,
    };
    if (PYTHON.has(type)) {
      const pythonModule =
        typeof raw.module === "string" && /^[A-Za-z_][\w.]*$/.test(raw.module) ? raw.module : null;
      const program = pythonModule ? null : roomPath(raw.program, context);
      if (!pythonModule && !program) {
        skipped.push({
          name,
          reason: "It needs a program (a .py file of the room, or ${file}) or a module.",
        });
        continue;
      }
      if (program && !/\.py$/i.test(program)) {
        skipped.push({ name, reason: `Its program, ${program}, isn't a Python file.` });
        continue;
      }
      configs.push({
        ...common,
        language: "python",
        program,
        module: pythonModule,
        justMyCode: raw.justMyCode !== false,
      });
    } else if (NATIVE.has(type)) {
      const program = roomPath(raw.program, context);
      const language = program ? nativeLanguage(program) : null;
      if (!program || !language) {
        skipped.push({
          name,
          reason:
            "The room builds C and C++ programs itself: set program to the .c or .cpp file (or ${file}).",
        });
        continue;
      }
      configs.push({ ...common, language, program, module: null, justMyCode: true });
    } else if (GO.has(type)) {
      // "${workspaceFolder}" (or ".") is the room's top folder.
      const program = isTop(raw.program, context) ? "." : roomPath(raw.program, context);
      if (!program || /\.(?!go$)[^./]+$/i.test(program)) {
        skipped.push({
          name,
          reason: "Set program to a .go file or a package's folder (${file}, ${fileDirname} or ${workspaceFolder}).",
        });
        continue;
      }
      configs.push({ ...common, language: "go", program, module: null, justMyCode: true });
    } else if (NODE.has(type)) {
      const program = roomPath(raw.program, context);
      if (!program || !NODE_PROGRAM.test(program)) {
        skipped.push({
          name,
          reason: "Set program to a .js or .ts file of the room (or ${file}); npm scripts and runtimeExecutable aren't supported yet.",
        });
        continue;
      }
      configs.push({ ...common, language: "javascript", program, module: null, justMyCode: true });
    } else if (JAVA.has(type)) {
      // VS Code's Java configurations name a class; the room debugs a .java file, as "${file}" gives.
      const program = roomPath(raw.program ?? raw.mainClass, context);
      if (!program || !/\.java$/i.test(program)) {
        skipped.push({
          name,
          reason: "Set mainClass to ${file} (or program to a .java file): the room builds the file it's given.",
        });
        continue;
      }
      configs.push({ ...common, language: "java", program, module: null, justMyCode: true });
    } else {
      skipped.push({
        name,
        reason: `The room's debugger doesn't run "${type || "untyped"}" configurations yet (Python, C, C++, Go, Node and Java do).`,
      });
    }
  }
  return { configs, skipped };
}

/** The launch.json the room starts you with: the open file, in Python, in C or C++, in Node, in Java, and its Go package. */
export const STARTER_LAUNCH = `{
  // Debug configurations for the room's debugger (Run and debug): F5 runs the one picked there.
  // \${file} is the open file. For C and C++, program is the source file: the room compiles it.
  // For Go, it's a .go file or a package's folder: the room builds it. Node runs .js and .ts files.
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Python: current file",
      "type": "debugpy",
      "request": "launch",
      "program": "\${file}",
      "args": [],
      "env": {}
    },
    {
      "name": "C/C++: current file",
      "type": "cppdbg",
      "request": "launch",
      "program": "\${file}",
      "args": []
    },
    {
      "name": "Node: current file",
      "type": "node",
      "request": "launch",
      "program": "\${file}",
      "args": [],
      "env": {}
    },
    {
      "name": "Java: current file",
      "type": "java",
      "request": "launch",
      "mainClass": "\${file}",
      "args": []
    },
    {
      "name": "Go: current package",
      "type": "go",
      "request": "launch",
      "program": "\${fileDirname}",
      "args": [],
      "env": {}
    }
  ]
}
`;
