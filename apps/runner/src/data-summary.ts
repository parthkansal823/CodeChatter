/** Explain this data: DuckDB's numbers for a table of results (sandbox/image/summarize_data.py), in the sandbox, inside the jail like a Run. */
import { DataSummary, type DataSummaryInput } from "@codechatter/contracts";

import type { RoomSandbox } from "./sandbox.js";
import { lastLine, runScript } from "./sandbox-script.js";

const SCRIPT = "/usr/local/lib/codechatter/summarize_data.py";
const SUMMARY_SECONDS = 60;
const MAX_OUTPUT = 4 * 1024 * 1024;

export class DataSummaryError extends Error {}

/** What the script said, checked: a number it couldn't work out shouldn't reach the model as anything else. */
export function parseSummary(output: string): DataSummary {
  const parsed = JSON.parse(output) as { error?: unknown };
  if (typeof parsed.error === "string") throw new DataSummaryError(parsed.error);
  const summary = DataSummary.safeParse(parsed);
  if (!summary.success) throw new DataSummaryError("DuckDB's summary wasn't what was expected.");
  return summary.data;
}

export async function summarizeData(sandbox: RoomSandbox, input: DataSummaryInput): Promise<DataSummary> {
  const done = await runScript(sandbox, SCRIPT, input, { seconds: SUMMARY_SECONDS, maxOutput: MAX_OUTPUT });
  if (done.missing) throw new DataSummaryError("This room's sandbox can't summarize data yet: its image needs rebuilding (pnpm sandbox:build).");
  if (done.code === 124) throw new DataSummaryError(`Summarizing took longer than ${SUMMARY_SECONDS} seconds and was stopped.`);
  if (done.code !== 0) throw new DataSummaryError(`The summary couldn't run: ${lastLine(done.stderr) || `exit code ${done.code}`}`);
  return parseSummary(done.stdout);
}
