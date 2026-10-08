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

// Compiled programs go to /tmp (tmpfs, per container), never into the room's files.
const SCRIPTS: Record<string, (path: string) => RunPlan> = {
  python: (p) => ({ display: `python3 ${p}`, script: 'exec python3 -u "$1"' }),
  javascript: (p) => ({ display: `node ${p}`, script: 'exec node "$1"' }),
  // Node 24 runs TypeScript directly; transform-types adds enums and namespaces.
  typescript: (p) => ({
    display: `node ${p}`,
    script: 'exec node --experimental-transform-types --disable-warning=ExperimentalWarning "$1"',
  }),
  c: (p) => ({ display: `gcc ${p} && ./a.out`, script: 'gcc -std=c17 -O2 -Wall -o /tmp/cc-prog "$1" -lm && exec /tmp/cc-prog' }),
  cpp: (p) => ({ display: `g++ ${p} && ./a.out`, script: 'g++ -std=c++20 -O2 -Wall -o /tmp/cc-prog "$1" && exec /tmp/cc-prog' }),
  java: (p) => ({ display: `java ${p}`, script: 'exec java "$1"' }),
  shell: (p) => ({ display: `bash ${p}`, script: 'exec bash "$1"' }),
};

export function planFor(path: string): RunPlan | null {
  const language = runnableLanguage(path);
  return language ? (SCRIPTS[language.language]?.(path) ?? null) : null;
}

/**
 * The full command for docker exec. The shell records its PID (the program
 * keeps it after `exec`), so Stop can end the whole process group, and sets a
 * group-writable umask so the sync agent can update files the program creates.
 */
export function commandFor(plan: RunPlan, path: string, runId: string): string[] {
  return [JAIL, "sh", "-c", `umask 002; echo $$ > /tmp/cc-run-${runId}.pid; ${plan.script}`, "cc-run", path];
}
