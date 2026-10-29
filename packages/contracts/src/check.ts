/**
 * A check of the whole room (runner: check.ts), for the Problems tab's files nobody has
 * open: the project-wide checkers in the sandbox, each where its project is (Pyright for
 * Python, the project's own TypeScript where it has a tsconfig.json, go vet for each Go
 * module, cargo check for each crate).
 */
export type RoomProblem = {
  /** The room file's path, from its top. */
  path: string;
  severity: "error" | "warning" | "info";
  message: string;
  /** The checker that said it: "Pyright", "tsc", "go vet", "cargo". */
  source: string;
  code: string | null;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
};

export type RoomCheck = {
  problems: RoomProblem[];
  /** What ran, and where ("Pyright", "tsc in web"). */
  checked: string[];
  /** What couldn't run, and why ("TypeScript isn't installed in web: run npm install"). */
  notes: string[];
  ms: number;
};
