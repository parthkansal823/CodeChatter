/** Cache resumable code-task scans per file, so changed text and paths invalidate only their own bounded results. */
import * as Y from "yjs";

import { maps, textOf } from "./model.js";
import { codeTaskCard, MAX_CODE_TASKS, scanCodeTasks, type TaskCard } from "./tasks.js";

export type CodeTaskScanResult = { cards: TaskCard[]; capped: boolean; skipped: number; unread: string[] };
type File = { id: string; path: string };
type Cached = { cards: TaskCard[]; capped: boolean; unread: boolean; skipped: boolean; checked: ReadonlySet<string> };

export class CodeTaskIndex {
  private files = new Map<string, File>();
  private readonly cached = new Map<string, Cached>();
  private readonly dirty = new Map<string, number>();
  private revision = 0;

  constructor(private readonly doc: Y.Doc, private readonly maxFileChars: number, private readonly scanner = scanCodeTasks) {}

  setFiles(files: readonly File[]): boolean {
    const next = new Map(files.map((file) => [file.id, { id: file.id, path: file.path }]));
    let changed = false;
    for (const [id, file] of next) {
      if (this.files.get(id)?.path !== file.path) { this.dirty.set(id, ++this.revision); changed = true; }
    }
    for (const id of this.files.keys()) if (!next.has(id)) {
      this.cached.delete(id);
      this.dirty.delete(id);
      changed = true;
    }
    this.files = next;
    return changed;
  }

  /** Deep-event paths start with the contents-map file ID; replacing an entire text instead exposes changed map keys. */
  invalidateContents(events: readonly Y.YEvent<Y.AbstractType<unknown>>[]): boolean {
    const contents = maps(this.doc).contents;
    let changed = false;
    for (const event of events) {
      const ids = event.target === contents ? [...event.changes.keys.keys()] : [event.path[0]];
      for (const id of ids) if (typeof id === "string" && this.files.has(id)) {
        this.dirty.set(id, ++this.revision);
        changed = true;
      }
    }
    return changed;
  }

  /** Cancellation leaves unfinished files dirty; only a complete, still-current replacement becomes cached data. */
  *scan(tracked: readonly TaskCard[] = []): Generator<null, CodeTaskScanResult> {
    const trackedIds = new Set(tracked.map((card) => card.id));
    const trackedByFile = new Map<string, Set<string>>();
    for (const card of tracked) {
      const id = card.source?.fileId;
      if (id) {
        const ids = trackedByFile.get(id) ?? new Set<string>();
        ids.add(card.id);
        trackedByFile.set(id, ids);
      }
      const previous = id ? this.cached.get(id) : undefined;
      if (id && this.files.has(id) && previous?.capped && !previous.unread && !previous.checked.has(card.id) && !previous.cards.some((item) => item.id === card.id) && !this.dirty.has(id)) this.dirty.set(id, ++this.revision);
    }
    while (this.dirty.size) {
      const [id, revision] = this.dirty.entries().next().value!;
      const file = this.files.get(id);
      if (!file) { this.dirty.delete(id); continue; }
      const source = textOf(this.doc, id);
      // Remember absent tracked IDs too: an already checked Doing orphan must not force another text scan.
      const next: Cached = { cards: [], capped: false, unread: !source, skipped: false, checked: trackedByFile.get(id) ?? new Set<string>() };
      if (source && source.length > this.maxFileChars) { next.unread = true; next.skipped = true; }
      if (source && !next.unread) {
        for (const task of this.scanner(file.path, source.toString())) {
          if (this.dirty.get(id) !== revision || this.files.get(id)?.path !== file.path) break;
          if (task) {
            const card = codeTaskCard(id, task);
            if (next.cards.length < MAX_CODE_TASKS || trackedIds.has(card.id)) next.cards.push(card);
            else next.capped = true;
          }
          yield null;
        }
      }
      if (this.files.get(id)?.path !== file.path || this.dirty.get(id) !== revision || textOf(this.doc, id) !== source) continue;
      this.cached.set(id, next);
      this.dirty.delete(id);
      yield null;
    }
    const found = new Map<string, TaskCard>();
    const unread = new Set<string>();
    let capped = false, skipped = 0;
    for (const id of this.files.keys()) {
      const entry = this.cached.get(id);
      if (!entry) continue;
      if (entry.unread) unread.add(id);
      if (entry.skipped) skipped++;
      capped ||= entry.capped;
      for (const card of entry.cards) {
        if (found.size >= MAX_CODE_TASKS && !trackedIds.has(card.id)) capped = true;
        else found.set(card.id, card);
        yield null;
      }
      yield null;
    }
    for (const card of tracked) {
      if (card.source && unread.has(card.source.fileId) && !found.has(card.id)) found.set(card.id, card);
      yield null;
    }
    return { cards: [...found.values()].filter((card) => card.source && this.files.has(card.source.fileId)), capped, skipped, unread: [...unread].filter((id) => this.files.has(id)) };
  }
}
