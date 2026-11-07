/** Runs one of the image's Python scripts in the sandbox, inside the jail like a Run: a JSON request on its input, and one JSON answer on its output. */
import { Collector, ended } from "./databases.js";
import { JAIL } from "./plans.js";
import { exitCodeOnceEnded, type RoomSandbox } from "./sandbox.js";

export type ScriptResult = { code: number | null; stdout: string; stderr: string; cut: boolean };
const MISSING = "cc-script: missing";

/** `missing` is true when this sandbox's image doesn't have the script. */
export async function runScript(sandbox: RoomSandbox, script: string, input: unknown, options: { seconds: number; maxOutput: number }): Promise<ScriptResult & { missing: boolean }> {
  const request = Buffer.from(JSON.stringify(input), "utf8");
  // The exec's stdin can't be closed on its own on every Docker, so the request is read by its size.
  const command = `[ -f "$2" ] || { echo "${MISSING}" >&2; exit 127; }; head -c "$1" | timeout ${options.seconds} python3 "$2"`;
  const handle = await sandbox.exec([JAIL, "sh", "-c", command, "cc-script", String(request.length), script], { tty: false, stdin: true });
  const stdout = new Collector(options.maxOutput);
  const stderr = new Collector(16 * 1024);
  handle.demux(stdout, stderr);
  const finished = ended(handle.stream);
  handle.stream.write(request);
  await finished;
  const code = await exitCodeOnceEnded(handle);
  handle.stream.destroy();
  const errors = stderr.text();
  return { code, stdout: stdout.text(), stderr: errors, cut: stdout.cut, missing: code === 127 && errors.includes(MISSING) };
}

/** The last line of what a script printed when it failed: its traceback ends with what went wrong. */
export const lastLine = (text: string) => text.trim().split("\n").at(-1)?.slice(0, 300) ?? "";
