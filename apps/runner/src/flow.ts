/** The Flow tool: a room's dbt project, read and built in its sandbox by sandbox/image/flow.py. A build carries on in there after this returns, and its progress is asked for. */
import type { FlowInput } from "@codechatter/contracts";

import type { RoomSandbox } from "./sandbox.js";
import { lastLine, runScript } from "./sandbox-script.js";

const SCRIPT = "/usr/local/lib/codechatter/flow.py";

export class FlowError extends Error {}

export async function askFlow(sandbox: RoomSandbox, input: FlowInput, by: string): Promise<unknown> {
  const done = await runScript(sandbox, SCRIPT, { ...input, by }, { seconds: 120, maxOutput: 16 * 1024 * 1024 });
  if (done.missing) throw new FlowError("This room's sandbox doesn't have dbt yet. Restarting the sandbox brings it up to date.");
  if (done.code === 124) throw new FlowError("That took too long and was stopped.");
  if (done.cut) throw new FlowError("The answer was too big to read back.");
  if (done.code !== 0) throw new FlowError(`It couldn't read the project: ${lastLine(done.stderr) || `exit code ${done.code}`}`);
  const parsed = JSON.parse(done.stdout) as { error?: unknown };
  if (typeof parsed.error === "string") throw new FlowError(parsed.error);
  return parsed;
}
