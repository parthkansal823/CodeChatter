/**
 * The Analysis tool's report on a room: what real tools found, run in its sandbox (apps/runner/src/analysis.ts).
 * It holds where a secret is, and which rule found it, but never the secret: that's kept out by the tools'
 * own redaction and by what the parsers choose to keep.
 */
import type { RoomProblem } from "./check.js";

/** A function more tangled than this is worth a look: lizard's own warning line. */
export const COMPLEX_FUNCTION = 15;

export type AnalysisLanguage = { name: string; files: number; code: number; comments: number; blanks: number; complexity: number };
export type AnalysisFile = { path: string; language: string; code: number; complexity: number };
export type AnalysisFunction = { path: string; name: string; line: number; complexity: number; lines: number; params: number };
export type AnalysisSecret = { path: string; line: number; rule: string; description: string };
export type AnalysisIssue = {
  path: string;
  line: number;
  severity: "high" | "medium" | "low";
  confidence: "high" | "medium" | "low";
  code: string;
  message: string;
  cwe: number | null;
};
export type AnalysisToolRun = { name: string; ran: boolean; note: string | null; ms: number };

export type RoomAnalysis = {
  at: string;
  ms: number;
  tools: AnalysisToolRun[];
  size: { files: number; lines: number; code: number; comments: number; blanks: number; complexity: number; languages: AnalysisLanguage[]; biggest: AnalysisFile[] };
  functions: { total: number; tooComplex: number; worst: AnalysisFunction[] };
  secrets: { total: number; items: AnalysisSecret[] };
  security: { total: number; items: AnalysisIssue[] };
  problems: { errors: number; warnings: number; infos: number; items: RoomProblem[] };
};
