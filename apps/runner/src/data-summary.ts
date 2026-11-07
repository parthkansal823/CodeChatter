/** Explain this data: DuckDB's numbers for a table of results (sandbox/image/summarize_data.py), in the sandbox, inside the jail like a Run. */
import { DataSummary, type DataSummaryInput } from "@codechatter/contracts";

import { Collector, ended } from "./databases.js";
import { JAIL } from "./plans.js";
import { exitCodeOnceEnded, type RoomSandbox } from "./sandbox.js";

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
  const request = Buffer.from(JSON.stringify(input), "utf8");
  // The exec's stdin can't be closed on its own on every Docker, so the request is read by its size.
  const script = `[ -f ${SCRIPT} ] || { echo "cc-data: missing" >&2; exit 127; }; head -c "$1" | timeout ${SUMMARY_SECONDS} python3 ${SCRIPT}`;
  const handle = await sandbox.exec([JAIL, "sh", "-c", script, "cc-data", String(request.length)], { tty: false, stdin: true });
  const stdout = new Collector(MAX_OUTPUT);
  const stderr = new Collector(16 * 1024);
  handle.demux(stdout, stderr);
  const finished = ended(handle.stream);
  handle.stream.write(request);
  await finished;
  const code = await exitCodeOnceEnded(handle);
  handle.stream.destroy();
  if (code === 127 && stderr.text().includes("cc-data: missing")) throw new DataSummaryError("This room's sandbox can't summarize data yet: its image needs rebuilding (pnpm sandbox:build).");
  if (code === 124) throw new DataSummaryError(`Summarizing took longer than ${SUMMARY_SECONDS} seconds and was stopped.`);
  if (code !== 0) throw new DataSummaryError(`The summary couldn't run: ${stderr.text().trim().split("\n").at(-1)?.slice(0, 300) || `exit code ${code}`}`);
  return parseSummary(stdout.text());
}
