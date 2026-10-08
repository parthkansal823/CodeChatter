export type DiffLine = { kind: "same" | "add" | "del"; text: string };
export type DiffRow = DiffLine | { kind: "gap"; count: number };

// Past this many cells the exact diff costs too much; show a replace instead.
const MAX_CELLS = 2_000_000;

/** Line diff (longest common subsequence) of two texts, for the Apply preview. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;

  const head: DiffLine[] = a.slice(0, start).map((text) => ({ kind: "same", text }));
  const tail: DiffLine[] = a.slice(a.length - end).map((text) => ({ kind: "same", text }));
  const x = a.slice(start, a.length - end);
  const y = b.slice(start, b.length - end);

  if (x.length * y.length > MAX_CELLS) {
    return [...head, ...x.map((text): DiffLine => ({ kind: "del", text })), ...y.map((text): DiffLine => ({ kind: "add", text })), ...tail];
  }

  // lcs[i][j] = LCS length of x[i..] and y[j..], flattened.
  const width = y.length + 1;
  const lcs = new Uint32Array((x.length + 1) * width);
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      lcs[i * width + j] = x[i] === y[j] ? lcs[(i + 1) * width + j + 1]! + 1 : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
    }
  }
  const middle: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      middle.push({ kind: "same", text: x[i]! });
      i++;
      j++;
    } else if (lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!) {
      middle.push({ kind: "del", text: x[i++]! });
    } else {
      middle.push({ kind: "add", text: y[j++]! });
    }
  }
  while (i < x.length) middle.push({ kind: "del", text: x[i++]! });
  while (j < y.length) middle.push({ kind: "add", text: y[j++]! });
  return [...head, ...middle, ...tail];
}

/** Changes with `context` unchanged lines around each; longer unchanged runs fold into a gap. */
export function withContext(lines: DiffLine[], context = 3): DiffRow[] {
  const near = new Array<boolean>(lines.length).fill(false);
  lines.forEach((line, index) => {
    if (line.kind === "same") return;
    for (let k = Math.max(0, index - context); k <= Math.min(lines.length - 1, index + context); k++) near[k] = true;
  });
  const rows: DiffRow[] = [];
  let skipped = 0;
  lines.forEach((line, index) => {
    if (near[index]) {
      if (skipped) rows.push({ kind: "gap", count: skipped });
      skipped = 0;
      rows.push(line);
    } else {
      skipped++;
    }
  });
  if (skipped) rows.push({ kind: "gap", count: skipped });
  return rows;
}

export type SideRow = { left: DiffLine | null; right: DiffLine | null } | { gap: number };

/**
 * The same diff laid out in two columns: unchanged lines on both sides, and
 * each run of removed and added lines paired up (the shorter side is padded
 * with empty cells so rows line up). Long unchanged stretches fold into a gap.
 */
export function sideBySide(lines: DiffLine[], context = 3): SideRow[] {
  const paired: Array<{ left: DiffLine | null; right: DiffLine | null }> = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i]!;
    if (line.kind === "same") {
      paired.push({ left: line, right: line });
      i++;
      continue;
    }
    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];
    while (i < lines.length && lines[i]!.kind !== "same") (lines[i]!.kind === "del" ? removed : added).push(lines[i++]!);
    for (let k = 0; k < Math.max(removed.length, added.length); k++) paired.push({ left: removed[k] ?? null, right: added[k] ?? null });
  }
  const changed = paired.map((row) => row.left?.kind === "del" || row.right?.kind === "add");
  const near = changed.map((_, index) => changed.slice(Math.max(0, index - context), index + context + 1).some(Boolean));
  const rows: SideRow[] = [];
  let skipped = 0;
  paired.forEach((row, index) => {
    if (near[index]) {
      if (skipped) rows.push({ gap: skipped });
      skipped = 0;
      rows.push(row);
    } else {
      skipped++;
    }
  });
  if (skipped) rows.push({ gap: skipped });
  return rows;
}
