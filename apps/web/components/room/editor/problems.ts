"use client";

import type { RoomCheck } from "@codechatter/contracts";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

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

/** The last check of the whole room (Check all files), kept while the room is open. */
let lastCheck: { roomId: string; check: RoomCheck } | null = null;
const checkListeners = new Set<() => void>();

export function setRoomCheck(roomId: string, check: RoomCheck | null): void {
  lastCheck = check ? { roomId, check } : null;
  for (const listener of checkListeners) listener();
}

/** The room's last whole check, or null. */
export function useRoomCheck(roomId: string): RoomCheck | null {
  return useSyncExternalStore(
    (listener) => {
      checkListeners.add(listener);
      return () => void checkListeners.delete(listener);
    },
    () => (lastCheck?.roomId === roomId ? lastCheck.check : null),
    () => null,
  );
}

/** The room files open in an editor now: theirs are the live problems, whatever a check said. */
function openPaths(): Set<string> {
  const paths = new Set<string>();
  for (const model of monaco.editor.getModels()) {
    if (model.uri.scheme === "file" && model.uri.path.startsWith("/workspace/")) paths.add(decodeURIComponent(model.uri.path.slice("/workspace/".length)));
  }
  return paths;
}

/**
 * The room's problems: in open files, live, what the language servers in the sandbox (and
 * TypeScript in the browser) report as Monaco's markers; in the rest, what the last check of
 * the whole room found (Check all files in the Problems tab).
 */
export function useProblems(roomId: string): Problem[] {
  const [live, setLive] = useState<{ problems: Problem[]; open: Set<string> }>({ problems: [], open: new Set() });
  const check = useRoomCheck(roomId);
  useEffect(() => {
    let alive = true;
    const listeners: Array<{ dispose(): void }> = [];
    void ensureMonaco().then(() => {
      if (!alive) return;
      const read = () => setLive({ problems: readProblems(), open: openPaths() });
      read();
      listeners.push(monaco.editor.onDidChangeMarkers(read), monaco.editor.onDidCreateModel(read), monaco.editor.onWillDisposeModel(() => queueMicrotask(read)));
    });
    return () => {
      alive = false;
      for (const listener of listeners) listener.dispose();
    };
  }, []);
  return useMemo(() => {
    if (!check) return live.problems;
    const checked: Problem[] = check.problems.filter((p) => !live.open.has(p.path));
    return [...live.problems, ...checked].sort((a, b) => a.path.localeCompare(b.path) || RANK[a.severity] - RANK[b.severity] || a.line - b.line || a.column - b.column);
  }, [check, live]);
}
