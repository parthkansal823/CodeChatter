import type { PullComment } from "@codechatter/contracts";

/** One line of a unified diff, with its numbers in the old and new file; or a hunk's header. */
export type PatchRow =
  | { kind: "hunk"; text: string }
  | { kind: "context" | "add" | "del"; oldLine: number | null; newLine: number | null; text: string };

/** A line comments attach to, as GitHub places them: RIGHT is the new file's line, LEFT the old one's. */
export type Anchor = { side: "LEFT" | "RIGHT"; line: number };

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** GitHub's `patch` for one file, row by row. "\ No newline at end of file" is dropped. */
export function parsePatch(patch: string): PatchRow[] {
  const rows: PatchRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (const line of patch.split("\n")) {
    const hunk = HUNK.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      rows.push({ kind: "hunk", text: line });
    } else if (line.startsWith("+"))
      rows.push({ kind: "add", oldLine: null, newLine: newLine++, text: line.slice(1) });
    else if (line.startsWith("-"))
      rows.push({ kind: "del", oldLine: oldLine++, newLine: null, text: line.slice(1) });
    else if (line.startsWith(" "))
      rows.push({ kind: "context", oldLine: oldLine++, newLine: newLine++, text: line.slice(1) });
  }
  return rows;
}

/** Where a comment on this row goes: removed lines on the old side, the rest on the new. */
export function anchorOf(row: PatchRow): Anchor | null {
  if (row.kind === "hunk") return null;
  if (row.kind === "del") return { side: "LEFT", line: row.oldLine! };
  return { side: "RIGHT", line: row.newLine! };
}

export type Thread = { root: PullComment; replies: PullComment[] };

/** Comments as threads (GitHub's replies point at the first comment); a reply whose first comment is gone starts its own. */
export function threadsOf(comments: PullComment[]): Thread[] {
  const ids = new Set(comments.map((c) => c.id));
  const roots = comments.filter((c) => c.inReplyTo === null || !ids.has(c.inReplyTo));
  return roots.map((root) => ({ root, replies: comments.filter((c) => c.inReplyTo === root.id) }));
}

/** The threads on one row of one file. */
export const threadsAt = (threads: Thread[], path: string, anchor: Anchor | null) =>
  anchor
    ? threads.filter(
        (t) => t.root.path === path && t.root.line === anchor.line && t.root.side === anchor.side,
      )
    : [];
