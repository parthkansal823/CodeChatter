"use client";

import { AI_LIMITS } from "@codechatter/contracts";
import { allNodes, flatten, listTree, textOf } from "@codechatter/workspace-model";
import type * as Y from "yjs";

import { diffLines } from "./line-diff";

/**
 * The room's file history isn't available to the browser, so file changes
 * are found by comparing against a copy this tab keeps in sessionStorage:
 * taken when the AI panel first opens, and refreshed by each summary.
 */
type Baseline = { at: number; files: Record<string, string | null> };

const key = (roomId: string) => `cc-ai-base:${roomId}`;
const PER_FILE = 30_000;
const TOTAL = 250_000;
const SHOWN_LINES = 8;
const MAX_FILES = 12;

function snapshot(doc: Y.Doc): Baseline {
  let budget = TOTAL;
  const files: Record<string, string | null> = {};
  for (const node of flatten(listTree(doc))) {
    if (node.kind !== "file") continue;
    const text = textOf(doc, node.id)?.toString() ?? "";
    // Too big to keep: it's listed as present, but its edits can't be compared.
    if (text.length <= PER_FILE && text.length <= budget) {
      files[node.path] = text;
      budget -= text.length;
    } else {
      files[node.path] = null;
    }
  }
  return { at: Date.now(), files };
}

function load(roomId: string): Baseline | null {
  try {
    const raw = sessionStorage.getItem(key(roomId));
    return raw ? (JSON.parse(raw) as Baseline) : null;
  } catch {
    return null;
  }
}

function save(roomId: string, baseline: Baseline): void {
  try {
    sessionStorage.setItem(key(roomId), JSON.stringify(baseline));
  } catch {
    // Storage full or blocked: the next summary just has no line-level changes.
  }
}

/** Remember the files as they are now, unless this tab already did. */
export function ensureBaseline(roomId: string, doc: Y.Doc): void {
  if (!load(roomId)) save(roomId, snapshot(doc));
}

function editedFile(path: string, before: string, after: string): string {
  const changed = diffLines(before, after).filter((line) => line.kind !== "same");
  const added = changed.filter((line) => line.kind === "add").length;
  const shown = changed.slice(0, SHOWN_LINES).map((line) => `  ${line.kind === "add" ? "+" : "-"} ${line.text.trim().slice(0, 120)}`);
  const more = changed.length > SHOWN_LINES ? [`  … ${changed.length - SHOWN_LINES} more changed lines`] : [];
  return [`${path}: +${added} -${changed.length - added} lines`, ...shown, ...more].join("\n");
}

/** What changed in the files, as text for the summary. Also moves the baseline to now. */
export function describeChanges(roomId: string, doc: Y.Doc, minutes: number): string {
  const base = load(roomId);
  const now = snapshot(doc);
  const lines: string[] = [];

  if (!base) {
    // No earlier copy: fall back to the file tree's own created and deleted times.
    const since = Date.now() - minutes * 60_000;
    const paths = new Map(flatten(listTree(doc)).map((node) => [node.id, node.path]));
    const files = allNodes(doc).filter((node) => node.kind === "file");
    const created = files.filter((node) => !node.trashedAt && node.createdAt >= since).map((node) => paths.get(node.id) ?? node.name);
    const deleted = files.filter((node) => node.trashedAt && node.trashedAt >= since).map((node) => node.name);
    if (created.length) lines.push(`Files created in the last ${minutes} minutes: ${created.slice(0, 20).join(", ")}`);
    if (deleted.length) lines.push(`Files deleted in the last ${minutes} minutes: ${deleted.slice(0, 20).join(", ")}`);
    lines.push("This tab had no earlier copy of the files, so line-level changes aren't available yet. The next summary will include them.");
  } else {
    const minutesAgo = Math.max(1, Math.round((Date.now() - base.at) / 60_000));
    lines.push(`Compared with how the files looked ${minutesAgo} minutes ago (when this tab last looked):`);
    const created = Object.keys(now.files).filter((path) => !(path in base.files));
    const deleted = Object.keys(base.files).filter((path) => !(path in now.files));
    if (created.length) lines.push(`Files created: ${created.slice(0, 20).join(", ")}`);
    if (deleted.length) lines.push(`Files deleted: ${deleted.slice(0, 20).join(", ")}`);
    const edited = Object.keys(now.files).flatMap((path) => {
      const before = base.files[path];
      const after = now.files[path];
      return typeof before === "string" && typeof after === "string" && before !== after ? [editedFile(path, before, after)] : [];
    });
    lines.push(...edited.slice(0, MAX_FILES));
    if (edited.length > MAX_FILES) lines.push(`… and ${edited.length - MAX_FILES} more edited files`);
    if (!created.length && !deleted.length && !edited.length) lines.push("No file changes.");
  }

  save(roomId, now);
  return lines.join("\n").slice(0, AI_LIMITS.changesChars);
}
