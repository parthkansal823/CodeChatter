/** LaTeX in a room: a .tex file built with real TeX Live in the sandbox, the PDF beside the editor, and what went wrong by file and line. It comes with the full sandbox image. */
import { z } from "zod";

const TexFile = z
  .string()
  .min(1)
  .max(1024)
  .refine((path) => /\.tex$/i.test(path) && !path.startsWith("/") && !path.includes("\\") && !path.includes("\0") && path.split("/").every((part) => part !== "" && part !== "." && part !== ".."), "That isn't a .tex file in this room.");

export const LatexInput = z.discriminatedUnion("op", [
  /** `stateVector` is what the browser has, so the build waits until the sandbox has it too. `fresh` throws away what earlier builds left. */
  z.object({ op: z.literal("build"), file: TexFile, fresh: z.boolean().default(false), stateVector: z.string().max(4_000_000).optional() }),
  z.object({ op: z.literal("status"), file: TexFile }),
  z.object({ op: z.literal("pdf"), file: TexFile }),
]);
export type LatexInput = z.infer<typeof LatexInput>;

export type LatexProblem = { severity: "error" | "warning"; file: string | null; line: number | null; message: string; context: string | null };
export type LatexBuild = {
  file: string;
  built: boolean;
  /** It made a new PDF, with no errors. */
  ok: boolean;
  at: number | null;
  ms: number | null;
  pages: number | null;
  bytes: number | null;
  /** When the PDF there now was made, which may be before a build that failed. */
  pdfAt: number | null;
  problems: LatexProblem[];
  overfull: number;
  log: string;
};
export type LatexPdf = { file: string; at: number; base64: string };

/** What a reference lookup takes: a DOI or an arXiv id, as people paste them, links included. */
export const ReferenceLookupInput = z.object({ id: z.string().min(1).max(300) });
export type ReferenceLookupInput = z.infer<typeof ReferenceLookupInput>;
export type ReferenceLookup = { bibtex: string };

const DOI = /^10\.\d{4,9}\/[-._;()/:A-Za-z0-9<>]+$/;
const ARXIV_NEW = /^\d{4}\.\d{4,5}(?:v\d+)?$/;
const ARXIV_OLD = /^[a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?$/;

/** A DOI or arXiv id from what someone pasted, or null. Only these ever reach a request. */
export function parseReferenceId(input: string): { kind: "doi" | "arxiv"; id: string } | null {
  const text = input
    .trim()
    .replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "");
  const arxiv = text
    .replace(/^(?:https?:\/\/)?(?:www\.)?arxiv\.org\/(?:abs|pdf)\//i, "")
    .replace(/^arxiv:\s*/i, "")
    .replace(/\.pdf$/i, "");
  if (ARXIV_NEW.test(arxiv) || ARXIV_OLD.test(arxiv)) return { kind: "arxiv", id: arxiv };
  return DOI.test(text) ? { kind: "doi", id: text } : null;
}
