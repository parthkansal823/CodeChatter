/**
 * Files changing, for automations started by a room event (packages/contracts/src/room-events.ts). While a room's files document is open here, what people
 * change in it is collected: files and folders added, edited, renamed, moved, deleted and restored, and by whom. A few seconds after they stop (or at most
 * MOST_WAIT_MS after the first change), one event goes on a Valkey list for the API to run the flows listening for it.
 *
 * Only changes from a person's own connection here count: not the sandbox's (a run writing files can't set its own flow off again), not the server's, and not
 * another collab instance's (they arrive over Valkey, and that instance counts them).
 */
import { ROOM_EVENTS_QUEUE, type ChangedFile, type FileChange, type QueuedRoomEvent, type RoomEventPerson } from "@codechatter/contracts";
import { getNode, maps, parseDocName } from "@codechatter/workspace-model";
import type { Extension } from "@hocuspocus/server";
import type { Redis } from "ioredis";
import type * as Y from "yjs";

const QUIET_MS = 3000;
const MOST_WAIT_MS = 15_000;
const MOST_FILES = 200;
/** The queue is kept to this many events, so it can't grow without end while no API takes them. */
const MOST_QUEUED = 1000;

type Person = { id: string; name: string };

/** The person whose connection made a change, if a person did. */
export function personOf(origin: unknown): Person | null {
  const from = origin as { source?: unknown; connection?: { context?: { userId?: unknown; name?: unknown } } } | null;
  if (!from || from.source !== "connection") return null;
  const context = from.connection?.context;
  return typeof context?.userId === "string" && context.userId ? { id: context.userId, name: typeof context.name === "string" && context.name ? context.name : "Someone" } : null;
}

/** A node's path as its names make it, deleted or not (the tree's own paths leave deleted ones out). */
function rawPath(doc: Y.Doc, id: string, override: { name?: string; parentId?: string | null } = {}): string | null {
  const node = getNode(doc, id);
  if (!node) return null;
  const names = [override.name ?? node.name];
  const seen = new Set([id]);
  for (let parent = override.parentId !== undefined ? override.parentId : node.parentId; parent && !seen.has(parent) && seen.size < 64; ) {
    seen.add(parent);
    const up = getNode(doc, parent);
    if (!up) break;
    names.unshift(up.name);
    parent = up.parentId;
  }
  return names.join("/");
}

type Seen = { change: FileChange; from?: string; by: Map<string, string> };

/**
 * What's changed since the last event, one entry a node. A file added and then edited is added; added and deleted is nothing; renamed twice keeps where it
 * started.
 */
export class FileChanges {
  private readonly seen = new Map<string, Seen>();

  get size() {
    return this.seen.size;
  }

  note(id: string, change: FileChange, who: Person, from?: string) {
    const before = this.seen.get(id);
    const by = before?.by ?? new Map<string, string>();
    by.set(who.id, who.name);
    if (!before) {
      this.seen.set(id, { change, ...(from !== undefined && { from }), by });
      return;
    }
    if (before.change === "added" && change === "deleted") {
      this.seen.delete(id);
      return;
    }
    let next = change;
    if (change === "changed" && before.change !== "deleted") next = before.change;
    else if (change === "restored" && before.change === "deleted") next = "changed";
    else if ((change === "renamed" || change === "moved") && before.change === "added") next = "added";
    this.seen.set(id, { change: next, ...((before.from ?? from) !== undefined && { from: before.from ?? from }), by });
  }

  /** The event, with each node's path as it is now; then it starts again. */
  take(doc: Y.Doc): { files: ChangedFile[]; more: number; by: RoomEventPerson[] } {
    const files: ChangedFile[] = [];
    const people = new Map<string, string>();
    let more = 0;
    for (const [id, seen] of this.seen) {
      const node = getNode(doc, id);
      const path = rawPath(doc, id);
      if (!node || !path) continue;
      for (const [person, name] of seen.by) people.set(person, name);
      if (seen.change === "renamed" || seen.change === "moved") {
        // Back where it was: nothing to say.
        if (seen.from === path) continue;
      }
      if (files.length >= MOST_FILES) {
        more += 1;
        continue;
      }
      const moved = seen.change === "renamed" || seen.change === "moved";
      files.push({ path, kind: node.kind, change: seen.change, ...(moved && seen.from !== undefined && { from: seen.from }) });
    }
    this.seen.clear();
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { files, more, by: [...people].map(([id, name]) => ({ id, name })) };
  }
}

/** Calls back with each change a person makes to the files; returns how to stop. */
export function watchFileChanges(doc: Y.Doc, onChange: (id: string, change: FileChange, who: Person, from?: string) => void): () => void {
  const { nodes, contents } = maps(doc);
  const onNodes = (events: Array<Y.YEvent<Y.AbstractType<unknown>>>, transaction: Y.Transaction) => {
    const who = personOf(transaction.origin);
    if (!who) return;
    for (const event of events) {
      const changes = (event as Y.YMapEvent<unknown>).changes.keys;
      if (event.target === nodes) {
        for (const [id, change] of changes) {
          if (change.action === "add") onChange(id, "added", who);
        }
        continue;
      }
      const id = event.path[0];
      if (typeof id !== "string") continue;
      for (const [key, change] of changes) {
        if (key === "name") onChange(id, "renamed", who, rawPath(doc, id, { name: String(change.oldValue ?? "") }) ?? undefined);
        else if (key === "parentId") onChange(id, "moved", who, rawPath(doc, id, { parentId: (change.oldValue as string | null | undefined) ?? null }) ?? undefined);
        else if (key === "trashedAt") onChange(id, getNode(doc, id)?.trashedAt ? "deleted" : "restored", who);
        else if (key === "blob") onChange(id, "changed", who);
      }
    }
  };
  const onContents = (events: Array<Y.YEvent<Y.AbstractType<unknown>>>, transaction: Y.Transaction) => {
    const who = personOf(transaction.origin);
    if (!who) return;
    for (const event of events) {
      // A new file's text comes with its node, which says it was added.
      if (event.target === contents) continue;
      const id = event.path[0];
      if (typeof id === "string") onChange(id, "changed", who);
    }
  };
  nodes.observeDeep(onNodes);
  contents.observeDeep(onContents);
  return () => {
    nodes.unobserveDeep(onNodes);
    contents.unobserveDeep(onContents);
  };
}

export function automationEventsExtension(redis: Pick<Redis, "rpush" | "ltrim">, options: { quietMs?: number; mostWaitMs?: number } = {}): Extension {
  const quietMs = options.quietMs ?? QUIET_MS;
  const mostWaitMs = options.mostWaitMs ?? MOST_WAIT_MS;
  const watched = new Map<string, { roomId: string; doc: Y.Doc; changes: FileChanges; stop: () => void; quiet?: ReturnType<typeof setTimeout>; since?: number }>();

  async function send(docName: string) {
    const entry = watched.get(docName);
    if (!entry) return;
    clearTimeout(entry.quiet);
    entry.quiet = undefined;
    entry.since = undefined;
    if (entry.changes.size === 0) return;
    const { files, more, by } = entry.changes.take(entry.doc);
    if (files.length === 0) return;
    const event: QueuedRoomEvent = { room: entry.roomId, event: "files.changed", at: Date.now(), by, files, ...(more > 0 && { more }) };
    try {
      await redis.rpush(ROOM_EVENTS_QUEUE, JSON.stringify(event));
      await redis.ltrim(ROOM_EVENTS_QUEUE, -MOST_QUEUED, -1);
    } catch (error) {
      console.warn(`[collab] a room event wasn't queued: ${String(error)}`);
    }
  }

  return {
    async afterLoadDocument({ documentName, document }) {
      const parsed = parseDocName(documentName);
      if (!parsed || parsed.kind !== "files") return;
      const changes = new FileChanges();
      const entry: { roomId: string; doc: Y.Doc; changes: FileChanges; stop: () => void; quiet?: ReturnType<typeof setTimeout>; since?: number } = { roomId: parsed.roomId, doc: document, changes, stop: () => {} };
      entry.stop = watchFileChanges(document, (id, change, who, from) => {
        changes.note(id, change, who, from);
        entry.since ??= Date.now();
        clearTimeout(entry.quiet);
        const wait = Math.max(0, Math.min(quietMs, entry.since + mostWaitMs - Date.now()));
        entry.quiet = setTimeout(() => void send(documentName), wait);
      });
      watched.set(documentName, entry);
    },
    async beforeUnloadDocument({ documentName }) {
      await send(documentName);
      watched.get(documentName)?.stop();
      watched.delete(documentName);
    },
    async onDestroy() {
      await Promise.all([...watched.keys()].map((name) => send(name)));
      for (const entry of watched.values()) entry.stop();
      watched.clear();
    },
  };
}
