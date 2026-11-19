/** Automations in a room's sandbox: sandbox/image/automation.py queues a flow, and Activepieces' engine runs it there with image/automation/host.mjs. A run carries on after this returns, and its progress is asked for. */
import type { AutomationRunnerInput } from "@codechatter/contracts";

import type { RoomSandbox } from "./sandbox.js";
import { lastLine, runScript } from "./sandbox-script.js";

const SCRIPT = "/usr/local/lib/codechatter/automation.py";

export class AutomationError extends Error {}

export async function askAutomations(sandbox: RoomSandbox, input: AutomationRunnerInput, by: string, trigger = "manual"): Promise<unknown> {
  // The room's connections (from the API) go to the sandbox on stdin, and from there only to the worker running the flow (image/automation/host.mjs).
  const request = input.op === "run" ? { op: input.op, path: input.path, payload: input.payload ?? {}, seconds: input.seconds, mode: input.mode, step: input.step, sampleData: input.sampleData, retryOf: input.retryOf, flowId: input.flowId, headers: input.headers, query: input.query, by, trigger: input.trigger ?? trigger, resumeBase: input.resumeBase, connections: input.connections ?? {}, variables: input.variables ?? {} } : input;
  const done = await runScript(sandbox, SCRIPT, request, { seconds: 60, maxOutput: 32 * 1024 * 1024 });
  if (done.missing) throw new AutomationError("This room's sandbox doesn't have automations yet. Restarting the sandbox brings it up to date.");
  if (done.code === 124) throw new AutomationError("That took too long and was stopped.");
  if (done.cut) throw new AutomationError("The answer was too big to read back.");
  if (done.code !== 0) throw new AutomationError(`It couldn't reach the automation: ${lastLine(done.stderr) || `exit code ${done.code}`}`);
  const parsed = JSON.parse(done.stdout) as { error?: unknown };
  if (typeof parsed.error === "string") throw new AutomationError(parsed.error);
  return parsed;
}
