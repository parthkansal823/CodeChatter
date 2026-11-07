/**
 * Ask the codebase: runs sandbox/image/codebase_search.py in the room's sandbox, inside the jail like a Run. It keeps its index in the
 * room's home, and reaches the model only through the AI gateway. One search at a time in a room: they share one index file.
 */
import { CodebasePassage, type CodebaseHits, type RagRunnerInput } from "@codechatter/contracts";

import { Collector, ended } from "./databases.js";
import { JAIL } from "./plans.js";
import type { RoomSession } from "./room-session.js";
import { exitCodeOnceEnded } from "./sandbox.js";

const SCRIPT = "/usr/local/lib/codechatter/codebase_search.py";
/** The API's connection gives up at 300: it stops here first, with most of the index done, and carries on when asked again. */
const SEARCH_SECONDS = 280;
const MAX_OUTPUT = 8 * 1024 * 1024;

export class RagError extends Error {}

const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/** What the script said: only what's named, and a passage that isn't what it should be is left out. */
export function parseHits(output: string): CodebaseHits {
  const parsed = JSON.parse(output) as { error?: unknown; passages?: unknown; index?: Record<string, unknown>; note?: unknown };
  if (typeof parsed.error === "string") throw new RagError(parsed.error);
  const passages = Array.isArray(parsed.passages) ? parsed.passages.flatMap((item) => {
    const passage = CodebasePassage.safeParse(item);
    return passage.success ? [passage.data] : [];
  }) : [];
  const index = parsed.index ?? {};
  return {
    passages,
    index: { files: count(index.files), chunks: count(index.chunks), changed: count(index.changed), embedded: count(index.embedded), waiting: count(index.waiting), ms: count(index.ms), model: typeof index.model === "string" ? index.model : null },
    note: typeof parsed.note === "string" ? parsed.note : null,
  };
}

const queues = new WeakMap<RoomSession, Promise<unknown>>();

async function search(session: RoomSession, input: RagRunnerInput): Promise<CodebaseHits> {
  const request = Buffer.from(JSON.stringify(input), "utf8");
  // The exec's stdin can't be closed on its own on every Docker, so the request is read by its size.
  const script = `[ -f ${SCRIPT} ] || { echo "cc-rag: missing" >&2; exit 127; }; head -c "$1" | timeout ${SEARCH_SECONDS} python3 ${SCRIPT}`;
  const handle = await session.sandbox.exec([JAIL, "sh", "-c", script, "cc-rag", String(request.length)], { tty: false, stdin: true });
  const stdout = new Collector(MAX_OUTPUT);
  const stderr = new Collector(16 * 1024);
  handle.demux(stdout, stderr);
  const finished = ended(handle.stream);
  handle.stream.write(request);
  await finished;
  const code = await exitCodeOnceEnded(handle);
  handle.stream.destroy();
  if (code === 127 && stderr.text().includes("cc-rag: missing")) throw new RagError("This room's sandbox can't search yet: its image needs rebuilding (pnpm sandbox:build).");
  if (code === 124) throw new RagError(`The search took longer than ${SEARCH_SECONDS} seconds and was stopped. Ask again to carry on.`);
  if (code !== 0) throw new RagError(`The search couldn't run: ${stderr.text().trim().split("\n").at(-1)?.slice(0, 300) || `exit code ${code}`}`);
  return parseHits(stdout.text());
}

export function searchCodebase(session: RoomSession, input: RagRunnerInput): Promise<CodebaseHits> {
  const next = (queues.get(session) ?? Promise.resolve()).catch(() => {}).then(() => search(session, input));
  queues.set(session, next);
  return next;
}
