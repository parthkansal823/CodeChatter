import { randomId } from "@codechatter/workspace-model";
import * as Y from "yjs";

/**
 * The room's page index, one Yjs document (`room:{id}:pages`):
 *
 *   pages: Y.Map<pageId, Y.Map{ title, icon, parentId, order, kind, createdBy,
 *                                createdAt, updatedAt, trashedAt, links, tags, text,
 *                                publishToken, publishedAt }>
 *
 * Page content lives in its own document (`room:{id}:page:{pageId}`), so the
 * tree, backlinks, tags, search and graph never load page bodies: every page
 * keeps `links` (page ids and file paths), `tags` and a short plain-text
 * excerpt up to date from its content.
 *
 * Like files, delete is soft (trashedAt) and nesting is a parentId walk, so a
 * move or rename changes one key.
 */
export type PageKind = "page" | "daily" | "database";

export interface PageRecord {
  id: string;
  title: string;
  icon: string;
  parentId: string | null;
  order: number;
  kind: PageKind;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  trashedAt: number | null;
  links: string[];
  tags: string[];
  /** The start of the page's text, for search, snippets and unlinked mentions. */
  text: string;
  /** Set while the page is published; the public link carries it. */
  publishToken: string | null;
  publishedAt: number | null;
}

/** What a page's content says about the rest of the room. */
export interface PageSummary {
  links: string[];
  tags: string[];
  text: string;
}

export const TEXT_EXCERPT = 1500;

export interface PageNode extends PageRecord {
  children: PageNode[];
}

const ORIGIN = "docs-model";
export const UNTITLED = "Untitled";

export const pagesMap = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>("pages");

export const titleOf = (page: Pick<PageRecord, "title">) => page.title.trim() || UNTITLED;

function read(id: string, entry: Y.Map<unknown>): PageRecord {
  const text = (key: string) => {
    const value = entry.get(key);
    return typeof value === "string" ? value : "";
  };
  const number = (key: string) => {
    const value = entry.get(key);
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  };
  const strings = (key: string) => {
    const value = entry.get(key);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  };
  const stamp = (key: string) => {
    const value = entry.get(key);
    return typeof value === "number" ? value : null;
  };
  return {
    id,
    title: text("title"),
    icon: text("icon"),
    parentId: text("parentId") || null,
    order: number("order"),
    kind: entry.get("kind") === "daily" ? "daily" : entry.get("kind") === "database" ? "database" : "page",
    createdBy: text("createdBy") || null,
    createdAt: number("createdAt"),
    updatedAt: number("updatedAt"),
    trashedAt: stamp("trashedAt"),
    links: strings("links"),
    tags: strings("tags"),
    text: text("text"),
    publishToken: text("publishToken") || null,
    publishedAt: stamp("publishedAt"),
  };
}

export function allPages(doc: Y.Doc): PageRecord[] {
  const out: PageRecord[] = [];
  pagesMap(doc).forEach((entry, id) => {
    if (entry instanceof Y.Map) out.push(read(id, entry));
  });
  return out;
}

export function getPage(doc: Y.Doc, id: string): PageRecord | null {
  const entry = pagesMap(doc).get(id);
  return entry instanceof Y.Map ? read(id, entry) : null;
}

const bySiblingOrder = (a: PageRecord, b: PageRecord) => a.order - b.order || a.createdAt - b.createdAt || a.id.localeCompare(b.id);

/** A page is live when neither it nor any ancestor is in the trash. */
export function isLive(page: PageRecord, byId: Map<string, PageRecord>): boolean {
  const seen = new Set<string>();
  let current: PageRecord | undefined = page;
  while (current) {
    if (current.trashedAt !== null || seen.has(current.id)) return false;
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return true;
}

/** Root first, the page's parent last. */
export function ancestorsOf(id: string, byId: Map<string, PageRecord>): PageRecord[] {
  const chain: PageRecord[] = [];
  const seen = new Set([id]);
  let parentId = byId.get(id)?.parentId ?? null;
  while (parentId && !seen.has(parentId)) {
    const parent = byId.get(parentId);
    if (!parent) break;
    chain.unshift(parent);
    seen.add(parentId);
    parentId = parent.parentId;
  }
  return chain;
}

/** Live pages as a tree. A page whose parent is gone sits at the root. */
export function buildTree(pages: PageRecord[]): PageNode[] {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const live = pages.filter((p) => isLive(p, byId));
  const children = new Map<string | null, PageRecord[]>();
  for (const page of live) {
    const parent = page.parentId && byId.has(page.parentId) ? page.parentId : null;
    const list = children.get(parent) ?? [];
    list.push(page);
    children.set(parent, list);
  }
  const build = (parentId: string | null, depth: number): PageNode[] =>
    depth > 32 ? [] : (children.get(parentId) ?? []).sort(bySiblingOrder).map((page) => ({ ...page, children: build(page.id, depth + 1) }));
  return build(null, 0);
}

export function siblingsOf(pages: PageRecord[], parentId: string | null, byId: Map<string, PageRecord>): PageRecord[] {
  return pages
    .filter((p) => isLive(p, byId) && (p.parentId && byId.has(p.parentId) ? p.parentId : null) === parentId)
    .sort(bySiblingOrder);
}

function nextOrder(doc: Y.Doc, parentId: string | null): number {
  let max = 0;
  for (const page of allPages(doc)) if (page.parentId === parentId) max = Math.max(max, page.order);
  return max + 1;
}

export function createPage(
  doc: Y.Doc,
  input: { id?: string; title?: string; icon?: string; parentId?: string | null; kind?: PageKind; createdBy: string | null },
): string {
  const id = input.id ?? randomId();
  const parentId = input.parentId ?? null;
  const now = Date.now();
  doc.transact(() => {
    const entry = new Y.Map<unknown>();
    entry.set("title", input.title ?? "");
    entry.set("icon", input.icon ?? "");
    entry.set("parentId", parentId);
    entry.set("order", nextOrder(doc, parentId));
    entry.set("kind", input.kind ?? "page");
    entry.set("createdBy", input.createdBy);
    entry.set("createdAt", now);
    entry.set("updatedAt", now);
    entry.set("trashedAt", null);
    entry.set("links", []);
    pagesMap(doc).set(id, entry);
  }, ORIGIN);
  return id;
}

export function updatePage(doc: Y.Doc, id: string, patch: Partial<Pick<PageRecord, "title" | "icon">>): void {
  const entry = pagesMap(doc).get(id);
  if (!entry) return;
  doc.transact(() => {
    if (patch.title !== undefined) entry.set("title", patch.title);
    if (patch.icon !== undefined) entry.set("icon", patch.icon);
    entry.set("updatedAt", Date.now());
  }, ORIGIN);
}

/** Move under `parentId` (null = top level) at `order`. Refuses moves into the page's own subtree. */
export function movePage(doc: Y.Doc, id: string, parentId: string | null, order?: number): boolean {
  let cursor = parentId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    if (cursor === id) return false;
    seen.add(cursor);
    cursor = getPage(doc, cursor)?.parentId ?? null;
  }
  const entry = pagesMap(doc).get(id);
  if (!entry) return false;
  doc.transact(() => {
    entry.set("parentId", parentId);
    entry.set("order", order ?? nextOrder(doc, parentId));
  }, ORIGIN);
  return true;
}

export function trashPage(doc: Y.Doc, id: string): void {
  pagesMap(doc).get(id)?.set("trashedAt", Date.now());
}

/** Restoring a page whose parent is still in the trash (or gone) brings it back at the top level. */
export function restorePage(doc: Y.Doc, id: string): void {
  const entry = pagesMap(doc).get(id);
  const page = getPage(doc, id);
  if (!entry || !page) return;
  const pages = allPages(doc);
  const byId = new Map(pages.map((p) => [p.id, p]));
  const parent = page.parentId ? byId.get(page.parentId) : undefined;
  doc.transact(() => {
    entry.set("trashedAt", null);
    if (page.parentId && (!parent || !isLive(parent, byId))) entry.set("parentId", null);
  }, ORIGIN);
}

/** Remove a page and everything under it from the index. */
export function deletePageForever(doc: Y.Doc, id: string): void {
  const pages = allPages(doc);
  const doomed = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const page of pages) {
      if (page.parentId && doomed.has(page.parentId) && !doomed.has(page.id)) {
        doomed.add(page.id);
        grew = true;
      }
    }
  }
  doc.transact(() => doomed.forEach((pageId) => pagesMap(doc).delete(pageId)), ORIGIN);
}

/** Stamp an edit and write whatever the content now says (only the parts that changed). */
export function recordEdit(doc: Y.Doc, id: string, summary: PageSummary | null): void {
  const entry = pagesMap(doc).get(id);
  if (!entry) return;
  doc.transact(() => {
    entry.set("updatedAt", Date.now());
    if (summary) writeSummary(entry, id, summary);
  }, ORIGIN);
}

export function syncSummary(doc: Y.Doc, id: string, summary: PageSummary): void {
  const entry = pagesMap(doc).get(id);
  if (entry) doc.transact(() => writeSummary(entry, id, summary), ORIGIN);
}

function writeSummary(entry: Y.Map<unknown>, id: string, summary: PageSummary) {
  const current = read(id, entry);
  if (!sameList(current.links, summary.links)) entry.set("links", summary.links);
  if (!sameList(current.tags, summary.tags)) entry.set("tags", summary.tags);
  if (current.text !== summary.text) entry.set("text", summary.text);
}

/** Turn publishing on (with a fresh unguessable token) or off. Returns the token. */
export function setPublished(doc: Y.Doc, id: string, on: boolean): string | null {
  const entry = pagesMap(doc).get(id);
  if (!entry) return null;
  const token = on ? (read(id, entry).publishToken ?? randomToken()) : null;
  doc.transact(() => {
    entry.set("publishToken", token);
    entry.set("publishedAt", on ? Date.now() : null);
  }, ORIGIN);
  return token;
}

function randomToken(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((value, i) => value === b[i]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAILY = /^daily-\d{4}-\d{2}-\d{2}$/;

/** `links` holds page ids and file paths; ids have a fixed shape, anything else is a path. */
export const isPageLink = (link: string) => UUID.test(link) || DAILY.test(link);

/** Today's date in the viewer's time zone, as YYYY-MM-DD. */
export function localDate(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Daily notes use the date as their id, so two people opening today's note at
 * the same moment land on the same page instead of creating two.
 */
export const dailyId = (date: string) => `daily-${date}`;
