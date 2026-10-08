import { randomId } from "@codechatter/workspace-model";
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import * as Y from "yjs";

import { TITLE_PROP, type Filter, type Option, type Prop, type PropType, type Row, type Sort, type View, type ViewType } from "./db-model";

/**
 * A database lives in its page's Yjs document:
 *
 *   dbMeta:  Y.Map { initialised }
 *   dbProps: Y.Map<propId, Prop>            plain objects, replaced whole when edited
 *   dbViews: Y.Map<viewId, View>            same
 *   dbRows:  Y.Map<rowId, Y.Map>            "title", "_order", "_at", then one key per property
 *
 * A row is its own map, so two people editing different cells of one row, or
 * different rows, never overwrite each other; only the same cell is last-write-wins.
 */
const ORIGIN = "docs-database";
const metaMap = (doc: Y.Doc) => doc.getMap<unknown>("dbMeta");
const propsMap = (doc: Y.Doc) => doc.getMap<Prop>("dbProps");
const viewsMap = (doc: Y.Doc) => doc.getMap<View>("dbViews");
const rowsMap = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>("dbRows");

export const STATUS_OPTIONS: Option[] = [
  { id: "not-started", name: "Not started", group: "todo" },
  { id: "in-progress", name: "In progress", group: "doing" },
  { id: "done", name: "Done", group: "done" },
];

const view = (id: string, name: string, type: ViewType, order: number, extra: Partial<View> = {}): View => ({ id, name, type, filters: [], sorts: [], groupBy: null, dateProp: null, order, ...extra });

/**
 * A new database starts with Status, Assignee, Due and Tags, and a table and a
 * board. The ids are fixed so two people opening it at once write the same keys.
 */
export function initDatabase(doc: Y.Doc): void {
  if (metaMap(doc).get("initialised")) return;
  doc.transact(() => {
    const props: Prop[] = [
      { id: "status", name: "Status", type: "status", options: STATUS_OPTIONS, order: 1 },
      { id: "assignee", name: "Assignee", type: "person", options: [], order: 2 },
      { id: "due", name: "Due", type: "date", options: [], order: 3 },
      { id: "tags", name: "Tags", type: "multiSelect", options: [], order: 4 },
    ];
    for (const prop of props) propsMap(doc).set(prop.id, prop);
    viewsMap(doc).set("table", view("table", "Table", "table", 1));
    viewsMap(doc).set("board", view("board", "Board", "board", 2, { groupBy: "status" }));
    metaMap(doc).set("initialised", true);
  }, ORIGIN);
}

export type Database = { props: Prop[]; rows: Row[]; views: View[] };

function readRow(id: string, entry: Y.Map<unknown>): Row {
  const cells: Record<string, unknown> = {};
  entry.forEach((value, key) => {
    if (key !== "title" && key !== "_order" && key !== "_at") cells[key] = value;
  });
  return {
    id,
    title: typeof entry.get("title") === "string" ? (entry.get("title") as string) : "",
    order: typeof entry.get("_order") === "number" ? (entry.get("_order") as number) : 0,
    createdAt: typeof entry.get("_at") === "number" ? (entry.get("_at") as number) : 0,
    cells,
  };
}

export function readDatabase(doc: Y.Doc): Database {
  const rows: Row[] = [];
  rowsMap(doc).forEach((entry, id) => entry instanceof Y.Map && rows.push(readRow(id, entry)));
  const sorted = <T extends { order: number; id: string }>(list: T[]) => list.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return { props: sorted([...propsMap(doc).values()]), rows, views: sorted([...viewsMap(doc).values()]) };
}

/** The database in a page document, live (empty until it has synced and been initialised). */
export function useDatabase(doc: Y.Doc | null): Database {
  const version = useRef(0);
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!doc) return () => {};
      const targets = [propsMap(doc), viewsMap(doc), rowsMap(doc)];
      const handler = () => {
        version.current += 1;
        onChange();
      };
      targets.forEach((t) => t.observeDeep(handler));
      return () => targets.forEach((t) => t.unobserveDeep(handler));
    },
    [doc],
  );
  const tick = useSyncExternalStore(subscribe, () => version.current, () => 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (doc ? readDatabase(doc) : { props: [], rows: [], views: [] }), [doc, tick]);
}

// Rows

export function addRow(doc: Y.Doc, input: { title?: string; cells?: Record<string, unknown> } = {}): string {
  const id = randomId();
  let top = 0;
  rowsMap(doc).forEach((entry) => {
    const order = entry.get("_order");
    if (typeof order === "number") top = Math.max(top, order);
  });
  doc.transact(() => {
    const entry = new Y.Map<unknown>();
    entry.set("title", input.title ?? "");
    entry.set("_order", top + 1);
    entry.set("_at", Date.now());
    for (const [key, value] of Object.entries(input.cells ?? {})) if (value !== undefined) entry.set(key, value);
    rowsMap(doc).set(id, entry);
  }, ORIGIN);
  return id;
}

/** Set one cell (`title` is the row name). Empty values are removed so the row stays small. */
export function setCell(doc: Y.Doc, rowId: string, propId: string, value: unknown): void {
  const entry = rowsMap(doc).get(rowId);
  if (!entry) return;
  const key = propId === TITLE_PROP.id ? "title" : propId;
  const empty = value === null || value === undefined || (Array.isArray(value) && value.length === 0);
  if (empty && key !== "title") entry.delete(key);
  else entry.set(key, value ?? "");
}

export const deleteRow = (doc: Y.Doc, rowId: string) => rowsMap(doc).delete(rowId);

// Properties

export function addProp(doc: Y.Doc, input: { name: string; type: PropType; options?: Option[] }): string {
  const id = `p-${randomId().slice(0, 8)}`;
  let top = 0;
  propsMap(doc).forEach((prop) => (top = Math.max(top, prop.order)));
  propsMap(doc).set(id, { id, name: input.name, type: input.type, options: input.options ?? (input.type === "status" ? STATUS_OPTIONS : []), order: top + 1 });
  return id;
}

export function updateProp(doc: Y.Doc, propId: string, patch: Partial<Pick<Prop, "name" | "type" | "options">>): void {
  const prop = propsMap(doc).get(propId);
  if (prop) propsMap(doc).set(propId, { ...prop, ...patch });
}

/** Removes the property, its cells, and any filter, sort, group or date setting that used it. */
export function deleteProp(doc: Y.Doc, propId: string): void {
  doc.transact(() => {
    propsMap(doc).delete(propId);
    rowsMap(doc).forEach((entry) => entry.delete(propId));
    viewsMap(doc).forEach((v) =>
      viewsMap(doc).set(v.id, {
        ...v,
        filters: v.filters.filter((f) => f.prop !== propId),
        sorts: v.sorts.filter((s) => s.prop !== propId),
        groupBy: v.groupBy === propId ? null : v.groupBy,
        dateProp: v.dateProp === propId ? null : v.dateProp,
      }),
    );
  }, ORIGIN);
}

/** A new option on a select-like property; returns it so the caller can assign it right away. */
export function addOption(doc: Y.Doc, propId: string, name: string): Option | null {
  const prop = propsMap(doc).get(propId);
  const clean = name.trim();
  if (!prop || !clean) return null;
  const existing = prop.options.find((o) => o.name.toLowerCase() === clean.toLowerCase());
  if (existing) return existing;
  const option: Option = { id: `o-${randomId().slice(0, 8)}`, name: clean, ...(prop.type === "status" && { group: "todo" as const }) };
  propsMap(doc).set(propId, { ...prop, options: [...prop.options, option] });
  return option;
}

// Views

export function addView(doc: Y.Doc, type: ViewType, props: Prop[]): string {
  const id = `v-${randomId().slice(0, 8)}`;
  let top = 0;
  viewsMap(doc).forEach((v) => (top = Math.max(top, v.order)));
  const board = props.find((p) => p.type === "status") ?? props.find((p) => p.type === "select");
  const date = props.find((p) => p.type === "date");
  const names: Record<ViewType, string> = { table: "Table", board: "Board", calendar: "Calendar", gallery: "Gallery", list: "List" };
  viewsMap(doc).set(id, view(id, names[type], type, top + 1, { groupBy: type === "board" ? (board?.id ?? null) : null, dateProp: type === "calendar" ? (date?.id ?? null) : null }));
  return id;
}

export function updateView(doc: Y.Doc, viewId: string, patch: Partial<Pick<View, "name" | "type" | "filters" | "sorts" | "groupBy" | "dateProp">>): void {
  const current = viewsMap(doc).get(viewId);
  if (current) viewsMap(doc).set(viewId, { ...current, ...patch });
}

export const deleteView = (doc: Y.Doc, viewId: string) => viewsMap(doc).delete(viewId);

export const newFilter = (prop: Prop): Filter => ({ id: randomId().slice(0, 8), prop: prop.id, op: prop.type === "checkbox" ? "checked" : "is", value: "" });
export const sortBy = (prop: string): Sort => ({ prop, dir: "asc" });
