"use client";

import { useEffect, useState } from "react";

import { ensureMonaco, monaco } from "@/components/room/monaco-setup";

export type ProblemSeverity = "error" | "warning" | "info";

export type Problem = {
  /** The room file's path (file:///workspace/<path>). */
  path: string;
  severity: ProblemSeverity;
  message: string;
  /** Who reported it: "Pyright", "ts", "clangd"… */
  source: string | null;
  code: string | null;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
};

const RANK: Record<ProblemSeverity, number> = { error: 0, warning: 1, info: 2 };

function severityOf(severity: monaco.MarkerSeverity): ProblemSeverity | null {
  if (severity === monaco.MarkerSeverity.Error) return "error";
  if (severity === monaco.MarkerSeverity.Warning) return "warning";
  if (severity === monaco.MarkerSeverity.Info) return "info";
  return null; // hints (unused code, faded in the editor) aren't problems
}

/** Every room file's problems Monaco knows of, by file path, then worst first, then by line. */
export function readProblems(): Problem[] {
  const out: Problem[] = [];
  for (const marker of monaco.editor.getModelMarkers({})) {
    const severity = severityOf(marker.severity);
    if (!severity || marker.resource.scheme !== "file" || !marker.resource.path.startsWith("/workspace/")) continue;
    const code = typeof marker.code === "string" ? marker.code : (marker.code?.value ?? null);
    out.push({
      path: decodeURIComponent(marker.resource.path.slice("/workspace/".length)),
      severity,
      message: marker.message,
      source: marker.source ?? null,
      code,
      line: marker.startLineNumber,
      column: marker.startColumn,
      endLine: marker.endLineNumber,
      endColumn: marker.endColumn,
    });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path) || RANK[a.severity] - RANK[b.severity] || a.line - b.line || a.column - b.column);
}

/**
 * The problems in the room's open files, live: what the language servers in the sandbox
 * (and TypeScript in the browser) report, as Monaco's markers.
 */
export function useProblems(): Problem[] {
  const [problems, setProblems] = useState<Problem[]>([]);
  useEffect(() => {
    let live = true;
    let listener: { dispose(): void } | null = null;
    void ensureMonaco().then(() => {
      if (!live) return;
      setProblems(readProblems());
      listener = monaco.editor.onDidChangeMarkers(() => setProblems(readProblems()));
    });
    return () => {
      live = false;
      listener?.dispose();
    };
  }, []);
  return problems;
}
