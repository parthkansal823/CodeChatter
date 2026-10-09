import { runnableLanguage } from "@codechatter/contracts";

/**
 * How to run a file. `script` is POSIX sh that receives the workspace-relative
 * path as "$1", so the path is never pasted into the command text (a file
 * called `a; rm -rf ~.py` is just an odd name). `display` is what the output
 * header shows.
 */
export type RunPlan = { display: string; script: string };

/**
 * Confines a command to the workspace with Landlock (sandbox/image/cc-jail.c).
 * It execs the command, so the PID a run records is still the program's.
 */
export const JAIL = "/usr/local/bin/cc-jail";

/**
 * One language, shared by Run and the judge. `build` (compiled languages) and
 * `run` are sh that get the file's path as "$1"; `out` is where a build writes:
 * /tmp is per container and never the room's files. Languages only the full
 * sandbox image has name a `tool`, checked first, so a room on the base image
 * gets an explanation instead of "command not found".
 */
type Recipe = {
  display: (path: string) => string;
  build?: (out: string) => string;
  run: (out: string) => string;
  tool?: string;
};

const binary = (out: string) => out;

const RECIPES: Record<string, Recipe> = {
  python: { display: (p) => `python3 ${p}`, run: () => 'python3 -u "$1"' },
  javascript: { display: (p) => `node ${p}`, run: () => 'node "$1"' },
  // Node 24 runs TypeScript directly; transform-types adds enums and namespaces.
  typescript: { display: (p) => `node ${p}`, run: () => 'node --experimental-transform-types --disable-warning=ExperimentalWarning "$1"' },
  c: { display: (p) => `gcc ${p} && ./a.out`, build: (o) => `gcc -std=c17 -O2 -Wall -o ${o} "$1" -lm`, run: binary },
  cpp: { display: (p) => `g++ ${p} && ./a.out`, build: (o) => `g++ -std=c++20 -O2 -Wall -o ${o} "$1"`, run: binary },
  java: { display: (p) => `java ${p}`, run: () => 'java "$1"' },
  shell: { display: (p) => `bash ${p}`, run: () => 'bash "$1"' },

  // The full image (pnpm sandbox:build:full). No network: only the standard libraries.
  go: { tool: "go", display: (p) => `go run ${p}`, build: (o) => `GOTOOLCHAIN=local GOPROXY=off go build -o ${o} "$1"`, run: binary },
  rust: { tool: "rustc", display: (p) => `rustc ${p}`, build: (o) => `rustc -O -o ${o} "$1"`, run: binary },
  ruby: { tool: "ruby", display: (p) => `ruby ${p}`, run: () => 'ruby "$1"' },
  php: { tool: "php", display: (p) => `php ${p}`, run: () => 'php "$1"' },
  perl: { tool: "perl", display: (p) => `perl ${p}`, run: () => 'perl "$1"' },
  lua: { tool: "lua5.4", display: (p) => `lua ${p}`, run: () => 'lua5.4 "$1"' },
  r: { tool: "Rscript", display: (p) => `Rscript ${p}`, run: () => 'Rscript "$1"' },
  kotlin: { tool: "kotlinc", display: (p) => `kotlinc ${p}`, build: (o) => `kotlinc -nowarn "$1" -include-runtime -d ${o}.jar`, run: (o) => `java -jar ${o}.jar` },
  csharp: { tool: "mcs", display: (p) => `mcs ${p} && mono`, build: (o) => `mcs -out:${o}.exe "$1"`, run: (o) => `mono ${o}.exe` },
  haskell: { tool: "ghc", display: (p) => `ghc ${p}`, build: (o) => `ghc -v0 -O1 -outputdir ${o}.d -o ${o} "$1"`, run: binary },
  ocaml: { tool: "ocaml", display: (p) => `ocaml ${p}`, run: () => 'ocaml "$1"' },
  elixir: { tool: "elixir", display: (p) => `elixir ${p}`, run: () => 'elixir "$1"' },
  racket: { tool: "racket", display: (p) => `racket ${p}`, run: () => 'racket "$1"' },
  clojure: { tool: "clojure", display: (p) => `clojure ${p}`, run: () => 'clojure "$1"' },
  groovy: { tool: "groovy", display: (p) => `groovy ${p}`, run: () => 'groovy "$1"' },
  // Module and object files would otherwise land next to the source, in the room.
  fortran: { tool: "gfortran", display: (p) => `gfortran ${p}`, build: (o) => `mkdir -p ${o}.d && gfortran -O2 -J ${o}.d -o ${o} "$1"`, run: binary },
  pascal: { tool: "fpc", display: (p) => `fpc ${p}`, build: (o) => `mkdir -p ${o}.d && fpc -O2 -ve -FU${o}.d -o${o} "$1" >/dev/null`, run: binary },
  ada: { tool: "gnatmake", display: (p) => `gnatmake ${p}`, build: (o) => `mkdir -p ${o}.d && gnatmake -q -D ${o}.d -o ${o} "$1"`, run: binary },
  cobol: { tool: "cobc", display: (p) => `cobc ${p}`, build: (o) => `cobc -x -free -o ${o} "$1"`, run: binary },
  d: { tool: "gdc", display: (p) => `gdc ${p}`, build: (o) => `gdc -O2 -o ${o} "$1"`, run: binary },
  crystal: { tool: "crystal", display: (p) => `crystal build ${p}`, build: (o) => `crystal build --no-color -o ${o} "$1"`, run: binary },
  // Prolog programs define main/0, which runs; then the interpreter quits.
  prolog: { tool: "swipl", display: (p) => `swipl ${p}`, run: () => 'swipl -q -g main -t halt "$1"' },
  sql: { tool: "sqlite3", display: (p) => `sqlite3 < ${p}`, run: () => 'sqlite3 -bail -box :memory: < "$1"' },
  asm: { tool: "nasm", display: (p) => `nasm ${p} && ld`, build: (o) => `nasm -f elf64 -o ${o}.o "$1" && ld -o ${o} ${o}.o`, run: binary },
};

/** The run plans' languages, for tests and the docs. */
export const LANGUAGES = Object.keys(RECIPES);

function recipeFor(path: string): { recipe: Recipe; label: string } | null {
  const language = runnableLanguage(path);
  const recipe = language ? RECIPES[language.language] : undefined;
  return language && recipe ? { recipe, label: language.label } : null;
}

/** Fails with a plain explanation when the room's sandbox image lacks the language. */
function toolCheck(recipe: Recipe, label: string): string | null {
  if (!recipe.tool) return null;
  const message = `${label} needs the full sandbox image. Whoever runs this server can build it (pnpm sandbox:build:full) and set SANDBOX_IMAGE=codechatter-sandbox:full.`;
  return `{ command -v ${recipe.tool} >/dev/null 2>&1 || { printf '%s\\n' '${message}' >&2; exit 127; }; }`;
}

export function planFor(path: string): RunPlan | null {
  const found = recipeFor(path);
  if (!found) return null;
  const { recipe, label } = found;
  const out = "/tmp/cc-prog";
  const steps = [toolCheck(recipe, label), recipe.build?.(out), `exec ${recipe.run(out)}`].filter(Boolean);
  return { display: recipe.display(path), script: steps.join(" && ") };
}

/**
 * The judge's steps for a file: `build` once (the tool check, then compiling),
 * `run` once per test. Its binary is separate from Run's, so judging while a
 * program runs doesn't replace the program.
 */
export function judgeStepsFor(path: string): { build?: string; run: string } | null {
  const found = recipeFor(path);
  if (!found) return null;
  const { recipe, label } = found;
  const out = "/tmp/cc-judge";
  const build = [toolCheck(recipe, label), recipe.build?.(out)].filter(Boolean).join(" && ");
  return { ...(build && { build }), run: recipe.run(out) };
}

/**
 * The full command for docker exec. The shell records its PID (the program
 * keeps it after `exec`), so Stop can end the whole process group, and sets a
 * group-writable umask so the sync agent can update files the program creates.
 */
export function commandFor(plan: RunPlan, path: string, runId: string): string[] {
  return [JAIL, "sh", "-c", `umask 002; echo $$ > /tmp/cc-run-${runId}.pid; ${plan.script}`, "cc-run", path];
}
