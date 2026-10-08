import { randomId } from "@codechatter/workspace-model";
import * as Y from "yjs";

/**
 * The room's list of designs (`room:ID:designs`) or whiteboards
 * (`room:ID:boards`), one Yjs document each:
 *
 *   items: Y.Map<id, Y.Map{ name, createdAt, createdBy, trashedAt }>
 *
 * Each item's canvas lives in its own document (`design:<id>` / `board:<id>`),
 * so opening the list never downloads every canvas. Trashing is soft, like
 * files: the canvas document stays and can be restored.
 */
export type ListItem = { id: string; name: string; createdAt: number; createdBy: string | null; trashedAt: number | null };

export const itemsOf = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>("items");

export function readItems(doc: Y.Doc): ListItem[] {
  const items: ListItem[] = [];
  itemsOf(doc).forEach((entry, id) => {
    items.push({
      id,
      name: typeof entry.get("name") === "string" ? (entry.get("name") as string) : "Untitled",
      createdAt: typeof entry.get("createdAt") === "number" ? (entry.get("createdAt") as number) : 0,
      createdBy: (entry.get("createdBy") as string | null) ?? null,
      trashedAt: (entry.get("trashedAt") as number | null) ?? null,
    });
  });
  return items.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1));
}

export function createItem(doc: Y.Doc, name: string, createdBy: string | null): string {
  const id = randomId();
  doc.transact(() => {
    const entry = new Y.Map<unknown>();
    entry.set("name", name);
    entry.set("createdAt", Date.now());
    entry.set("createdBy", createdBy);
    entry.set("trashedAt", null);
    itemsOf(doc).set(id, entry);
  });
  return id;
}

export function renameItem(doc: Y.Doc, id: string, name: string) {
  itemsOf(doc).get(id)?.set("name", name);
}

export function trashItem(doc: Y.Doc, id: string) {
  itemsOf(doc).get(id)?.set("trashedAt", Date.now());
}

export function restoreItem(doc: Y.Doc, id: string) {
  itemsOf(doc).get(id)?.set("trashedAt", null);
}

/** "Untitled design 3": the next free number, so new items don't all share one name. */
export function nextName(items: ListItem[], base: string): string {
  const taken = new Set(items.map((item) => item.name));
  for (let i = 1; ; i++) {
    const name = i === 1 ? base : `${base} ${i}`;
    if (!taken.has(name)) return name;
  }
}
