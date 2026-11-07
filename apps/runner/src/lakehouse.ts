/** The Lakehouse tool: a room's Delta tables and MLflow runs, read in its sandbox by sandbox/image/lakehouse_info.py, which comes with the full image. */
import type { LakehouseInput } from "@codechatter/contracts";

import type { RoomSandbox } from "./sandbox.js";
import { lastLine, runScript } from "./sandbox-script.js";

const SCRIPT = "/usr/local/lib/codechatter/lakehouse_info.py";

export class LakehouseError extends Error {}

export async function askLakehouse(sandbox: RoomSandbox, input: LakehouseInput): Promise<unknown> {
  const done = await runScript(sandbox, SCRIPT, input, { seconds: 120, maxOutput: 16 * 1024 * 1024 });
  if (done.missing) throw new LakehouseError("This room's sandbox doesn't have Spark, Delta Lake and MLflow. They come with the full image: its owner can choose that in the Ports panel.");
  if (done.code === 124) throw new LakehouseError("That took too long and was stopped.");
  if (done.cut) throw new LakehouseError("The answer was too big to read back.");
  if (done.code !== 0) throw new LakehouseError(`It couldn't read the lakehouse: ${lastLine(done.stderr) || `exit code ${done.code}`}`);
  const parsed = JSON.parse(done.stdout) as { error?: unknown };
  if (typeof parsed.error === "string") throw new LakehouseError(parsed.error);
  return parsed;
}
