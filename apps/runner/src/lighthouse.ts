/** Lighthouse in a room's sandbox: sandbox/image/lighthouse.py runs Google's own, with the image's Chromium, against one of the room's servers on localhost. */
import type { LighthouseInput } from "@codechatter/contracts";

import type { RoomSandbox } from "./sandbox.js";
import { lastLine, runScript } from "./sandbox-script.js";

const SCRIPT = "/usr/local/lib/codechatter/lighthouse.py";

export class LighthouseError extends Error {}

export async function askLighthouse(sandbox: RoomSandbox, input: LighthouseInput): Promise<unknown> {
  // A run takes half a minute or so; Lighthouse stops itself at two and a half.
  const done = await runScript(sandbox, SCRIPT, input, { seconds: 180, maxOutput: 24 * 1024 * 1024 });
  if (done.missing) throw new LighthouseError("This room's sandbox doesn't have Lighthouse yet. Restarting the sandbox brings it up to date.");
  if (done.code === 124) throw new LighthouseError("Lighthouse took too long and was stopped.");
  if (done.cut) throw new LighthouseError("Lighthouse's report was too big to read back.");
  if (done.code !== 0) throw new LighthouseError(`Lighthouse couldn't run: ${lastLine(done.stderr) || `exit code ${done.code}`}`);
  const parsed = JSON.parse(done.stdout) as { error?: unknown };
  if (typeof parsed.error === "string") throw new LighthouseError(parsed.error);
  return parsed;
}
