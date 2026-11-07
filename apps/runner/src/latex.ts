/** LaTeX in a room: sandbox/image/latex_build.py builds a .tex file with real TeX Live in its sandbox. It comes with the full image. */
import type { LatexInput } from "@codechatter/contracts";

import type { RoomSandbox } from "./sandbox.js";
import { lastLine, runScript } from "./sandbox-script.js";

const SCRIPT = "/usr/local/lib/codechatter/latex_build.py";

export class LatexError extends Error {}

export async function askLatex(sandbox: RoomSandbox, input: LatexInput): Promise<unknown> {
  const request = input.op === "build" ? { op: input.op, file: input.file, fresh: input.fresh } : input;
  const done = await runScript(sandbox, SCRIPT, request, { seconds: 115, maxOutput: 24 * 1024 * 1024 });
  if (done.missing) throw new LatexError("This room's sandbox doesn't have LaTeX. It comes with the full image: its owner can choose that in the Ports panel.");
  if (done.code === 124) throw new LatexError("That took too long and was stopped.");
  if (done.cut) throw new LatexError("The answer was too big to read back.");
  if (done.code !== 0) throw new LatexError(`It couldn't run LaTeX: ${lastLine(done.stderr) || `exit code ${done.code}`}`);
  const parsed = JSON.parse(done.stdout) as { error?: unknown };
  if (typeof parsed.error === "string") throw new LatexError(parsed.error);
  return parsed;
}
