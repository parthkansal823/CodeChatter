/**
 * Ask the codebase: runs sandbox/image/codebase_search.py in the room's sandbox, inside the jail like a Run. It keeps its index in the
 * room's home, and reaches the model only through the AI gateway. One search at a time in a room: they share one index file.
 */
import { CodebasePassage, type CodebaseHits, type RagRunnerInput } from "@codechatter/contracts";

import type { RoomSession } from "./room-session.js";
import { lastLine, runScript } from "./sandbox-script.js";

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
  const done = await runScript(session.sandbox, SCRIPT, input, { seconds: SEARCH_SECONDS, maxOutput: MAX_OUTPUT });
  if (done.missing) throw new RagError("This room's sandbox can't search yet: its image needs rebuilding (pnpm sandbox:build).");
  if (done.code === 124) throw new RagError(`The search took longer than ${SEARCH_SECONDS} seconds and was stopped. Ask again to carry on.`);
  if (done.code !== 0) throw new RagError(`The search couldn't run: ${lastLine(done.stderr) || `exit code ${done.code}`}`);
  return parseHits(done.stdout);
}

export function searchCodebase(session: RoomSession, input: RagRunnerInput): Promise<CodebaseHits> {
  const next = (queues.get(session) ?? Promise.resolve()).catch(() => {}).then(() => search(session, input));
  queues.set(session, next);
  return next;
}
