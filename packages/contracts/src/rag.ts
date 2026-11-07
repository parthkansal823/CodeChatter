/**
 * Ask the codebase: a question finds the passages of a room's files that answer it (sandbox/image/codebase_search.py), and the AI
 * answers from those, citing them.
 */
import { z } from "zod";

export const RAG_LIMITS = { questionChars: 2_000, passages: 12, textChars: 6_000, nameChars: 300 } as const;

export const AiRetrieveInput = z.object({
  question: z.string().trim().min(1, "Ask something first.").max(RAG_LIMITS.questionChars, "That question is too long."),
  limit: z.number().int().min(1).max(RAG_LIMITS.passages).default(8),
});
export type AiRetrieveInput = z.infer<typeof AiRetrieveInput>;

/** What the runner is asked. `model` is the embedding model, when the server has one. */
export const RagRunnerInput = AiRetrieveInput.extend({ model: z.string().min(1).max(200).nullable() });
export type RagRunnerInput = z.infer<typeof RagRunnerInput>;

export const CodebasePassage = z.object({
  path: z.string().min(1).max(1024),
  start: z.number().int().min(1),
  end: z.number().int().min(1),
  name: z.string().max(RAG_LIMITS.nameChars),
  text: z.string().max(RAG_LIMITS.textChars),
  score: z.number(),
  /** How the search found it: by what it means, by the words in it, or both. */
  found: z.enum(["both", "meaning", "words"]),
});
export type CodebasePassage = z.infer<typeof CodebasePassage>;

/** POST /api/rooms/:roomId/ai/retrieve. */
export type CodebaseHits = {
  passages: CodebasePassage[];
  index: {
    files: number;
    chunks: number;
    /** Files read again this time. */
    changed: number;
    embedded: number;
    /** Passages only searchable by words, for now. */
    waiting: number;
    ms: number;
    model: string | null;
  };
  /** Something the person should know about how far to trust this search. */
  note: string | null;
};

/**
 * Places an answer cites that it wasn't shown: a model can name a line that sounds right. Only `path:line` in backticks counts, and a
 * path alone is fine if a passage came from that file.
 */
export function citationsNotShown(answer: string, shown: ReadonlyArray<Pick<CodebasePassage, "path" | "start" | "end">>): string[] {
  const wrong = new Set<string>();
  const sameFile = (cited: string, path: string) => path === cited || path.endsWith(`/${cited}`);
  for (const match of answer.matchAll(/`([^`\n]+?):(\d+)(?:[:-]\d+)?`/g)) {
    const cited = match[1]!.trim().replace(/^\.\//, "");
    if (/\s/.test(cited)) continue;
    const line = Number(match[2]);
    if (!shown.some((passage) => sameFile(cited, passage.path) && line >= passage.start && line <= passage.end)) wrong.add(`${cited}:${line}`);
  }
  return [...wrong];
}
