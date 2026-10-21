/** Files by path, as text. */
export type FileMap = ReadonlyMap<string, string>;

export type ChangeKind = "added" | "modified" | "deleted";
export type Change = { path: string; kind: ChangeKind };

/** The room's changes since the base: what a commit would push. */
export function changesOf(base: FileMap, room: FileMap): Change[] {
  const changes: Change[] = [];
  for (const [path, text] of room) {
    const before = base.get(path);
    if (before === undefined) changes.push({ path, kind: "added" });
    else if (before !== text) changes.push({ path, kind: "modified" });
  }
  for (const path of base.keys()) if (!room.has(path)) changes.push({ path, kind: "deleted" });
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

/** Lines with their endings, so joining them gives the text back exactly. */
const lines = (text: string) => (text ? text.split(/(?<=\n)/) : []);

/** Line-by-line LCS over the middle (the common start and end trimmed off) is n × m; past this, a file merges whole. */
const MAX_CELLS = 16_000_000;

/** For each line of `a`, the line of `b` it matches in a longest common subsequence, or -1. Null when too big. */
function matches(a: string[], b: string[]): Int32Array | null {
  const match = new Int32Array(a.length).fill(-1);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    match[start] = start;
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
    match[endA] = endB;
  }
  const n = endA - start;
  const m = endB - start;
  if (n === 0 || m === 0) return match;
  if (n * m > MAX_CELLS) return null;
  // lengths[i][j]: the LCS of a[start+i..endA) and b[start+j..endB), one flat table.
  const width = m + 1;
  const lengths = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lengths[i * width + j] =
        a[start + i] === b[start + j]
          ? lengths[(i + 1) * width + j + 1]! + 1
          : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + j + 1]!);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[start + i] === b[start + j]) {
      match[start + i] = start + j;
      i++;
      j++;
    } else if (lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!) i++;
    else j++;
  }
  return match;
}

export type Labels = { ours: string; theirs: string };

const withNewline = (text: string) => (text && !text.endsWith("\n") ? `${text}\n` : text);
const conflictBlock = (ours: string, theirs: string, labels: Labels) =>
  `<<<<<<< ${labels.ours}\n${withNewline(ours)}=======\n${withNewline(theirs)}>>>>>>> ${labels.theirs}\n`;

/**
 * Three-way merge of one file, line by line (diff3): changes on one side only are taken,
 * the same change on both sides once, and different changes to the same lines become a
 * conflict, marked as git marks one. `ours` is the room's text, `theirs` GitHub's.
 */
export function merge3(
  base: string,
  ours: string,
  theirs: string,
  labels: Labels,
): { text: string; conflict: boolean } {
  if (ours === theirs || theirs === base) return { text: ours, conflict: false };
  if (ours === base) return { text: theirs, conflict: false };
  const o = lines(base);
  const a = lines(ours);
  const b = lines(theirs);
  const ma = matches(o, a);
  const mb = matches(o, b);
  if (!ma || !mb) return { text: conflictBlock(ours, theirs, labels), conflict: true };

  const out: string[] = [];
  let conflict = false;
  let io = 0;
  let ia = 0;
  let ib = 0;
  /** The lines up to (not including) a stable point: each side's version of them. */
  const chunk = (eo: number, ea: number, eb: number) => {
    const so = o.slice(io, eo).join("");
    const sa = a.slice(ia, ea).join("");
    const sb = b.slice(ib, eb).join("");
    if (sa === so) out.push(sb);
    else if (sb === so || sa === sb) out.push(sa);
    else {
      conflict = true;
      out.push(conflictBlock(sa, sb, labels));
    }
  };
  for (;;) {
    // The next base line both sides kept.
    let k = io;
    while (k < o.length && (ma[k]! < 0 || mb[k]! < 0)) k++;
    if (k === o.length) {
      chunk(o.length, a.length, b.length);
      break;
    }
    if (k === io && ma[k] === ia && mb[k] === ib) {
      out.push(o[k]!);
      io++;
      ia++;
      ib++;
      continue;
    }
    chunk(k, ma[k]!, mb[k]!);
    io = k;
    ia = ma[k]!;
    ib = mb[k]!;
  }
  return { text: out.join(""), conflict };
}

/** What a pull does to the room: files to write, files to delete, and the files that conflicted. */
export type MergePlan = { write: Map<string, string>; remove: string[]; conflicts: string[] };

/**
 * Merge GitHub's files into the room's, both changed since the base: a file only GitHub
 * changed (or added, or deleted) takes GitHub's version; one only the room changed keeps
 * the room's; one both changed is merged line by line. A file deleted on one side and
 * changed on the other is a conflict, and the changed version is kept.
 */
export function mergeFiles(base: FileMap, room: FileMap, remote: FileMap, labels: Labels): MergePlan {
  const plan: MergePlan = { write: new Map(), remove: [], conflicts: [] };
  const paths = new Set([...base.keys(), ...room.keys(), ...remote.keys()]);
  for (const path of [...paths].sort()) {
    const was = base.get(path);
    const ours = room.get(path);
    const theirs = remote.get(path);
    if (ours === theirs || theirs === was) continue;
    if (ours === was) {
      if (theirs === undefined) plan.remove.push(path);
      else plan.write.set(path, theirs);
      continue;
    }
    if (ours !== undefined && theirs !== undefined) {
      const merged = merge3(was ?? "", ours, theirs, labels);
      if (merged.text !== ours) plan.write.set(path, merged.text);
      if (merged.conflict) plan.conflicts.push(path);
      continue;
    }
    plan.conflicts.push(path);
    if (theirs !== undefined) plan.write.set(path, theirs);
  }
  return plan;
}
