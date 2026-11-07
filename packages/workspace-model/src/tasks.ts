/** Room task cards and a resumable comment scanner: code cards stay derived until someone changes their board state. */
import * as Y from "yjs";

import { randomId } from "./model.js";

export const TASK_COLUMNS = [{ id: "todo", label: "To do" }, { id: "doing", label: "Doing" }, { id: "done", label: "Done" }] as const;
export type TaskColumn = (typeof TASK_COLUMNS)[number]["id"];
export type TaskMarker = "TODO" | "FIXME" | "HACK" | "XXX";
export type CodeTask = { line: number; marker: TaskMarker; text: string };
export type TaskSource = CodeTask & { fileId: string };
export type TaskCard = {
  id: string;
  title: string;
  description: string;
  column: TaskColumn;
  order: number;
  assigneeId: string | null;
  createdBy: string;
  createdAt: number;
  source: TaskSource | null;
};
export type BoardTask = TaskCard & { noLongerInCode: boolean };
export type NewTask = { title: string; description?: string; column?: TaskColumn; assigneeId?: string | null; createdBy: string };
export const MAX_CODE_TASKS = 500;
export const MAX_TASK_TITLE = 200;
export const MAX_TASK_DESCRIPTION = 4000;
const MAX_ID = 128;
const ORIGIN = "tasks";
const MARKERS = new Set<TaskMarker>(["TODO", "FIXME", "HACK", "XXX"]);
const isColumn = (value: unknown): value is TaskColumn => TASK_COLUMNS.some((column) => column.id === value);
const clipped = (value: unknown, limit: number): string => typeof value === "string" ? value.replace(/\0/g, "").slice(0, limit) : "";
const orderOf = (value: unknown): number => typeof value === "number" && Number.isFinite(value) ? Math.max(-1e12, Math.min(1e12, value)) : 0;
const compareId = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const plain = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Separate per-card keys avoid array replacement and preserve independent move, assignment and text edits. */
export function taskMaps(doc: Y.Doc) {
  return {
    cards: doc.getMap<TaskCard>("task-cards"),
    placements: doc.getMap<{ column: TaskColumn; order: number }>("task-placements"),
    assignees: doc.getMap<string | null>("task-assignees"),
    titles: doc.getMap<string>("task-titles"),
    descriptions: doc.getMap<string>("task-descriptions"),
  };
}

function sourceOf(value: unknown): TaskSource | null {
  const source = plain(value);
  if (!source || !MARKERS.has(source.marker as TaskMarker) || typeof source.fileId !== "string") return null;
  return {
    fileId: clipped(source.fileId, MAX_ID),
    line: typeof source.line === "number" && Number.isSafeInteger(source.line) ? Math.max(1, source.line) : 1,
    marker: source.marker as TaskMarker,
    text: clipped(source.text, MAX_TASK_DESCRIPTION).trim(),
  };
}

function cardOf(value: unknown, id: string): TaskCard | null {
  const card = plain(value);
  if (!card || typeof card.title !== "string") return null;
  const source = sourceOf(card.source);
  if (card.source !== null && !source) return null;
  return {
    id,
    title: clipped(card.title, MAX_TASK_TITLE),
    description: clipped(card.description, MAX_TASK_DESCRIPTION),
    column: isColumn(card.column) ? card.column : "todo",
    order: orderOf(card.order),
    assigneeId: typeof card.assigneeId === "string" ? clipped(card.assigneeId, MAX_ID) : null,
    createdBy: clipped(card.createdBy, MAX_ID),
    createdAt: typeof card.createdAt === "number" && Number.isFinite(card.createdAt) ? Math.max(0, card.createdAt) : 0,
    source,
  };
}

function stateOf(doc: Y.Doc, base: TaskCard): TaskCard {
  const maps = taskMaps(doc);
  const position = plain(maps.placements.get(base.id));
  const title = maps.titles.get(base.id);
  const description = maps.descriptions.get(base.id);
  const assignee = maps.assignees.has(base.id) ? maps.assignees.get(base.id) : base.assigneeId;
  return {
    ...base,
    title: typeof title === "string" ? clipped(title, MAX_TASK_TITLE) : base.title,
    description: typeof description === "string" ? clipped(description, MAX_TASK_DESCRIPTION) : base.description,
    column: isColumn(position?.column) ? position.column : base.column,
    order: position ? orderOf(position.order) : base.order,
    assigneeId: typeof assignee === "string" ? clipped(assignee, MAX_ID) : null,
  };
}

/** Exact bounded text, not a hash or line number: moving lines keeps identity and cannot introduce hash collisions. */
export function codeTaskKey(fileId: string, marker: TaskMarker, text: string): string {
  return `code:${JSON.stringify([clipped(fileId, MAX_ID), marker, clipped(text, MAX_TASK_DESCRIPTION).trim()])}`;
}

/** Default code cards are plain derived data. Calling this writes nothing. */
export function codeTaskCard(fileId: string, task: CodeTask): TaskCard {
  const source: TaskSource = { fileId: clipped(fileId, MAX_ID), line: Math.max(1, Math.trunc(task.line) || 1), marker: task.marker, text: clipped(task.text, MAX_TASK_DESCRIPTION).trim() };
  return { id: codeTaskKey(source.fileId, source.marker, source.text), title: (source.text || source.marker).slice(0, MAX_TASK_TITLE), description: "", column: "todo", order: 0, assigneeId: null, createdBy: "", createdAt: 0, source };
}

/** Merge local code results with shared user changes; only Doing snapshots survive a missing comment. */
export function readTasks(doc: Y.Doc, liveCode: readonly TaskCard[] = []): BoardTask[] {
  const out = new Map<string, BoardTask>();
  for (const [id, value] of taskMaps(doc).cards) {
    const base = cardOf(value, id);
    if (!base) continue;
    const card = stateOf(doc, base);
    if (!card.source || card.column === "doing") out.set(id, { ...card, noLongerInCode: card.source !== null });
  }
  for (const value of liveCode) {
    const base = cardOf(value, value.id);
    if (!base?.source || out.get(base.id)?.noLongerInCode === false) continue;
    const card = stateOf(doc, base);
    out.set(card.id, { ...card, noLongerInCode: false });
  }
  const columns = new Map(TASK_COLUMNS.map((column, index) => [column.id, index]));
  return [...out.values()].sort((a, b) => columns.get(a.column)! - columns.get(b.column)! || a.order - b.order || compareId(a.id, b.id));
}

function storedCards(doc: Y.Doc): TaskCard[] {
  const out: TaskCard[] = [];
  for (const [id, value] of taskMaps(doc).cards) {
    const card = cardOf(value, id);
    if (card) out.push(stateOf(doc, card));
  }
  return out;
}

function nextOrder(doc: Y.Doc, column: TaskColumn, skip?: string, beforeId?: string | null): number {
  const peers = storedCards(doc).filter((card) => card.id !== skip && card.column === column).sort((a, b) => a.order - b.order || compareId(a.id, b.id));
  const before = beforeId ? peers.findIndex((card) => card.id === beforeId) : -1;
  if (before >= 0) {
    const next = peers[before]!.order;
    const previous = before ? peers[before - 1]!.order : next - 2;
    return orderOf(previous + (next - previous) / 2);
  }
  return orderOf((peers.at(-1)?.order ?? 0) + 1);
}

/** Each hand-written card gets its own immutable base; all later field edits use independent keys. */
export function addTask(doc: Y.Doc, input: NewTask): string | null {
  const title = clipped(input.title, MAX_TASK_TITLE).trim();
  if (!title) return null;
  const id = randomId();
  const column = isColumn(input.column) ? input.column : "todo";
  const card: TaskCard = { id, title, description: clipped(input.description, MAX_TASK_DESCRIPTION), column, order: nextOrder(doc, column), assigneeId: typeof input.assigneeId === "string" ? clipped(input.assigneeId, MAX_ID) : null, createdBy: clipped(input.createdBy, MAX_ID), createdAt: Date.now(), source: null };
  doc.transact(() => taskMaps(doc).cards.set(id, card), ORIGIN);
  return id;
}

/** Code text belongs to the file; only hand-written cards have editable title/description. */
export function editTask(doc: Y.Doc, id: string, patch: { title?: string; description?: string }): boolean {
  const maps = taskMaps(doc);
  const base = cardOf(maps.cards.get(id), id);
  if (!base || base.source || (patch.title !== undefined && !clipped(patch.title, MAX_TASK_TITLE).trim())) return false;
  doc.transact(() => {
    if (patch.title !== undefined) maps.titles.set(id, clipped(patch.title, MAX_TASK_TITLE).trim());
    if (patch.description !== undefined) maps.descriptions.set(id, clipped(patch.description, MAX_TASK_DESCRIPTION));
  }, ORIGIN);
  return true;
}

function remember(doc: Y.Doc, card: TaskCard): boolean {
  const maps = taskMaps(doc);
  if (maps.cards.has(card.id)) return true;
  // A deleted hand-written card cannot be recreated by a stale move/assignment.
  if (!card.source) return false;
  const base = cardOf(card, card.id);
  if (!base) return false;
  maps.cards.set(card.id, base);
  return true;
}

/** A placement is one atomic value, so concurrent same-card moves never mix one move's column with another's order. */
export function moveTask(doc: Y.Doc, card: TaskCard, column: TaskColumn, beforeId?: string | null): boolean {
  if (!isColumn(column)) return false;
  let changed = false;
  doc.transact(() => {
    if (!remember(doc, card)) return;
    taskMaps(doc).placements.set(card.id, { column, order: nextOrder(doc, column, card.id, beforeId) });
    changed = true;
  }, ORIGIN);
  return changed;
}

export function assignTask(doc: Y.Doc, card: TaskCard, assigneeId: string | null): boolean {
  let changed = false;
  doc.transact(() => {
    if (!remember(doc, card)) return;
    taskMaps(doc).assignees.set(card.id, typeof assigneeId === "string" ? clipped(assigneeId, MAX_ID) : null);
    changed = true;
  }, ORIGIN);
  return changed;
}

/** Removing a Doing orphan removes its snapshot. A live code comment remains owned by the code. */
export function deleteTask(doc: Y.Doc, id: string): boolean {
  const maps = taskMaps(doc);
  const existed = Object.values(maps).some((map) => map.has(id));
  if (existed) doc.transact(() => { for (const map of Object.values(maps)) map.delete(id); }, ORIGIN);
  return existed;
}

type CommentStyle = { slash: boolean; hash: boolean; dash: boolean; percent: boolean; semicolon: boolean; html: boolean; rust: boolean; numericSeparators: boolean };
function commentStyle(path: string): CommentStyle {
  const name = path.split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : name;
  const slash = /^(?:[cm]?[jt]sx?|jsonc?|c|cc|cpp|cxx|h|hh|hpp|cs|java|kt|kts|scala|go|rs|swift|dart|php|css|scss|less|vue|svelte)$/.test(ext);
  const hash = /^(?:py|pyw|sh|bash|zsh|fish|rb|r|pl|pm|php|yaml|yml|toml|ini|conf|properties|dockerfile|makefile|mk)$/.test(ext) || name.startsWith("dockerfile.") || name.startsWith(".env");
  const dash = /^(?:sql|lua|hs|elm|ada|adb|ads|vhd|vhdl)$/.test(ext);
  const percent = /^(?:m|tex|sty|cls|erl|hrl|pro|ps)$/.test(ext);
  const semicolon = /^(?:lisp|lsp|clj|cljs|cljc|edn|el|scm|ss|rkt|asm|s|ini)$/.test(ext);
  const html = /^(?:html?|xml|svg|vue|svelte|md|mdx)$/.test(ext);
  const unknown = !slash && !hash && !dash && !percent && !semicolon && !html;
  return { slash: slash || dash || unknown, hash: hash || unknown, dash: dash || unknown, percent: percent || unknown, semicolon: semicolon || unknown, html: html || unknown, rust: ext === "rs", numericSeparators: /^(?:c|cc|cpp|cxx|h|hh|hpp)$/.test(ext) };
}

// A Rust lifetime/label starts with an apostrophe but has no closing character quote.
const RUST_CHARACTER = /^'(?:\\(?:[nrt0\\'"]|x[0-9a-fA-F]{2}|u\{[0-9a-fA-F_]{1,12}\})|[^'\\\r\n])'/u;

/**
 * Resume after each 4096 characters, including inside strings and long comments.
 * This lightweight lexer skips quoted/backtick/triple-quoted strings. It is not a
 * full language parser: regex literals, shell heredocs and embedded languages can
 * have false positives/negatives. The board presents findings as code links.
 */
export function* scanCodeTasks(path: string, text: string): Generator<CodeTask | null, void> {
  const style = commentStyle(path);
  let i = 0, line = 1, sinceYield = 0;
  let quote = "", comment: "" | "line" | "block" = "", blockEnd = "", numericToken = false;
  while (i < text.length) {
    if (sinceYield >= 4096) { sinceYield = 0; yield null; }
    const c = text[i]!;
    if (c === "\n" || comment) numericToken = false;
    sinceYield++;
    if (quote) {
      if (c === "\\" && i + 1 < text.length) { if (text[i + 1] === "\n") line++; i += 2; continue; }
      if (text.startsWith(quote, i)) { i += quote.length; quote = ""; continue; }
      if (c === "\n") { line++; if (quote.length === 1 && quote !== "`") quote = ""; }
      i++; continue;
    }
    if (comment) {
      if (comment === "block" && text.startsWith(blockEnd, i)) { i += blockEnd.length; comment = ""; continue; }
      if (c === "\n") { line++; i++; if (comment === "line") comment = ""; continue; }
      const previous = i ? text[i - 1]! : "";
      if (!/[A-Za-z0-9_$]/.test(previous)) {
        const match = /^(TODO|FIXME|HACK|XXX)\b/.exec(text.slice(i, i + 6));
        if (match) {
          let end = text.indexOf("\n", i);
          if (end === -1) end = text.length;
          if (comment === "block") { const close = text.indexOf(blockEnd, i); if (close !== -1) end = Math.min(end, close); }
          const body = text.slice(i + match[0].length, Math.min(end, i + match[0].length + MAX_TASK_DESCRIPTION)).replace(/^\s*:\s*/, "").trim();
          yield { line, marker: match[0] as TaskMarker, text: body };
          i += match[0].length;
          continue;
        }
      }
      i++; continue;
    }
    if (c === "\n") { line++; i++; continue; }
    if (style.html && text.startsWith("<!--", i)) { comment = "block"; blockEnd = "-->"; i += 4; continue; }
    if (style.slash && text.startsWith("/*", i)) { comment = "block"; blockEnd = "*/"; i += 2; continue; }
    if ((style.slash && text.startsWith("//", i)) || (style.dash && text.startsWith("--", i))) { comment = "line"; i += 2; continue; }
    if ((style.hash && c === "#") || (style.percent && c === "%") || (style.semicolon && c === ";")) { comment = "line"; i++; continue; }
    if (c === "'" && style.rust && !RUST_CHARACTER.test(text.slice(i, i + 20))) { i++; continue; }
    if (style.numericSeparators) {
      // Track preprocessing-number boundaries, so 1'000 and 0xAB'CD stay code,
      // while the apostrophe after the identifier prefix in u8'c' still quotes.
      if (numericToken && c === "'" && /[0-9a-zA-Z]/.test(text[i - 1] ?? "") && /[0-9a-zA-Z]/.test(text[i + 1] ?? "")) { i++; continue; }
      if (numericToken && !/[0-9a-zA-Z_.]/.test(c) && !((c === "+" || c === "-") && /[eEpP]/.test(text[i - 1] ?? ""))) numericToken = false;
      if (!numericToken && /[0-9]/.test(c) && !/[0-9a-zA-Z_$]/.test(text[i - 1] ?? "")) numericToken = true;
    }
    if (c === "'" || c === '"' || c === "`") { quote = text.startsWith(c.repeat(3), i) ? c.repeat(3) : c; i += quote.length; continue; }
    i++;
  }
}

/** Synchronous convenience for pure tests and small inputs; browser callers consume the resumable generator instead. */
export function findCodeTasks(path: string, text: string): CodeTask[] {
  const tasks: CodeTask[] = [];
  for (const task of scanCodeTasks(path, text)) if (task) tasks.push(task);
  return tasks;
}
