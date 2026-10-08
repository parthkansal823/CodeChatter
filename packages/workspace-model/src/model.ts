import * as Y from "yjs";

/**
 * The shared file tree of a room, as one Yjs document (`room:{id}:files`).
 *
 *   nodes:    Y.Map<nodeId, Y.Map{ kind, name, parentId, createdBy, createdAt, trashedAt? }>
 *   contents: Y.Map<nodeId, Y.Text>          (files only)
 *   meta:     Y.Map{ schemaVersion, templateId }
 *
 * Rules that keep concurrent edits safe (ADR 0005, plan §4):
 *  - Paths are derived by walking parentId, never stored, so rename and move
 *    change one key and never touch file text.
 *  - A file's Y.Text is created in the same transaction as its node. Editors
 *    never create it lazily, which removes v1's double-seeding race.
 *  - Delete is soft (trashedAt), so edits racing a delete survive a restore.
 *    Re-creating a path makes a new node, so old text can't come back.
 */
export const SCHEMA_VERSION = 1;

export type NodeKind = "file" | "folder";

export interface NodeRecord {
  id: string;
  kind: NodeKind;
  name: string;
  parentId: string | null;
  createdBy: string | null;
  createdAt: number;
  trashedAt: number | null;
}

export interface TreeNode extends NodeRecord {
  path: string;
  children: TreeNode[];
}

export function maps(doc: Y.Doc) {
  return {
    meta: doc.getMap<unknown>("meta"),
    nodes: doc.getMap<Y.Map<unknown>>("nodes"),
    contents: doc.getMap<Y.Text>("contents"),
  };
}

/**
 * A v4 UUID. crypto.randomUUID only exists in secure contexts (HTTPS or
 * localhost); a phone opening http://192.168.x.x has getRandomValues but not
 * randomUUID, so build one from it there.
 */
export function randomId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const newId = randomId;

/** Names a file system and a URL can both carry. */
export function validateName(raw: string): string | null {
  const name = raw.trim();
  if (!name) return "Enter a name.";
  if (name === "." || name === "..") return "That name is reserved.";
  if (/[\\/]/.test(name)) return "Names can't contain slashes.";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(name)) return "Names can't contain control characters.";
  if (name.length > 255) return "Keep names under 255 characters.";
  return null;
}

function read(id: string, entry: Y.Map<unknown>): NodeRecord {
  return {
    id,
    kind: entry.get("kind") as NodeKind,
    name: entry.get("name") as string,
    parentId: (entry.get("parentId") as string | null) ?? null,
    createdBy: (entry.get("createdBy") as string | null) ?? null,
    createdAt: (entry.get("createdAt") as number) ?? 0,
    trashedAt: (entry.get("trashedAt") as number | null) ?? null,
  };
}

export function getNode(doc: Y.Doc, id: string): NodeRecord | null {
  const entry = maps(doc).nodes.get(id);
  return entry ? read(id, entry) : null;
}

export function allNodes(doc: Y.Doc): NodeRecord[] {
  const out: NodeRecord[] = [];
  maps(doc).nodes.forEach((entry, id) => out.push(read(id, entry)));
  return out;
}

function isLive(node: NodeRecord, byId: Map<string, NodeRecord>): boolean {
  let current: NodeRecord | undefined = node;
  const seen = new Set<string>();
  while (current) {
    if (current.trashedAt || seen.has(current.id)) return false;
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return true;
}

/**
 * Two people can create "main.py" in the same folder at the same moment; both
 * nodes survive the merge. Every peer must show them identically, so the
 * rule is deterministic: the oldest node (then smallest id) keeps the name,
 * later ones get " (2)", " (3)", … before the extension.
 */
export function resolveSiblingNames(siblings: NodeRecord[]): Map<string, string> {
  const ordered = [...siblings].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const taken = new Set<string>();
  const display = new Map<string, string>();
  for (const node of ordered) {
    let name = node.name;
    const dot = node.kind === "file" ? node.name.lastIndexOf(".") : -1;
    const [stem, ext] = dot > 0 ? [node.name.slice(0, dot), node.name.slice(dot)] : [node.name, ""];
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${stem} (${n})${ext}`;
    taken.add(name.toLowerCase());
    display.set(node.id, name);
  }
  return display;
}

/** The live tree, folders first then A→Z, with derived paths. */
export function listTree(doc: Y.Doc): TreeNode[] {
  const nodes = allNodes(doc);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const live = nodes.filter((n) => isLive(n, byId));
  const children = new Map<string | null, NodeRecord[]>();
  for (const node of live) {
    // A parent that is missing (or lost to a cycle) puts the node at the root.
    const parent = node.parentId && byId.has(node.parentId) ? node.parentId : null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent)!.push(node);
  }
  const build = (parentId: string | null, prefix: string, depth: number): TreeNode[] => {
    if (depth > 64) return [];
    const siblings = children.get(parentId) ?? [];
    const names = resolveSiblingNames(siblings);
    return siblings
      .map((node) => {
        const name = names.get(node.id)!;
        const path = prefix ? `${prefix}/${name}` : name;
        return { ...node, name, path, children: node.kind === "folder" ? build(node.id, path, depth + 1) : [] };
      })
      .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.kind === "folder" ? -1 : 1));
  };
  return build(null, "", 0);
}

export function flatten(tree: TreeNode[]): TreeNode[] {
  return tree.flatMap((node) => [node, ...flatten(node.children)]);
}

export function pathOf(doc: Y.Doc, id: string): string | null {
  return flatten(listTree(doc)).find((n) => n.id === id)?.path ?? null;
}

export function findByPath(doc: Y.Doc, path: string): TreeNode | null {
  return flatten(listTree(doc)).find((n) => n.path === path) ?? null;
}

export function textOf(doc: Y.Doc, id: string): Y.Text | undefined {
  return maps(doc).contents.get(id);
}

function insertNode(doc: Y.Doc, record: Omit<NodeRecord, "id" | "createdAt" | "trashedAt">, content?: string): string {
  const id = newId();
  doc.transact(() => {
    const entry = new Y.Map<unknown>();
    entry.set("kind", record.kind);
    entry.set("name", record.name.trim());
    entry.set("parentId", record.parentId);
    entry.set("createdBy", record.createdBy);
    entry.set("createdAt", Date.now());
    maps(doc).nodes.set(id, entry);
    if (record.kind === "file") maps(doc).contents.set(id, new Y.Text(content ?? ""));
  }, "workspace-model");
  return id;
}

export function createFile(doc: Y.Doc, input: { name: string; parentId?: string | null; content?: string; createdBy?: string | null }): string {
  return insertNode(doc, { kind: "file", name: input.name, parentId: input.parentId ?? null, createdBy: input.createdBy ?? null }, input.content);
}

export function createFolder(doc: Y.Doc, input: { name: string; parentId?: string | null; createdBy?: string | null }): string {
  return insertNode(doc, { kind: "folder", name: input.name, parentId: input.parentId ?? null, createdBy: input.createdBy ?? null });
}

export function rename(doc: Y.Doc, id: string, name: string): void {
  maps(doc).nodes.get(id)?.set("name", name.trim());
}

/** Move a node under a folder (null = root). Refuses moves into its own subtree. */
export function move(doc: Y.Doc, id: string, parentId: string | null): boolean {
  let cursor = parentId;
  while (cursor) {
    if (cursor === id) return false;
    cursor = getNode(doc, cursor)?.parentId ?? null;
  }
  maps(doc).nodes.get(id)?.set("parentId", parentId);
  return true;
}

export function trash(doc: Y.Doc, id: string): void {
  maps(doc).nodes.get(id)?.set("trashedAt", Date.now());
}

export function restore(doc: Y.Doc, id: string): void {
  maps(doc).nodes.get(id)?.delete("trashedAt");
}

/**
 * Create a file at `a/b/c.ts`, reusing folders that already exist at those
 * paths (seedFiles always makes new ones). Used when a file appears in the
 * sandbox, e.g. a program writes output.txt or `git clone` runs.
 */
export function createFileAtPath(doc: Y.Doc, path: string, content: string, createdBy: string | null = null): string {
  const parts = path.split("/");
  const name = parts.pop()!;
  let id = "";
  doc.transact(() => {
    let parentId: string | null = null;
    let prefix = "";
    for (const part of parts) {
      prefix = prefix ? `${prefix}/${part}` : part;
      const existing = findByPath(doc, prefix);
      parentId = existing?.kind === "folder" ? existing.id : createFolder(doc, { name: part, parentId, createdBy });
    }
    id = createFile(doc, { name, parentId, content, createdBy });
  }, "workspace-model");
  return id;
}

/**
 * Make a Y.Text equal to `next` with the smallest single edit: the common
 * start and end are kept, only the middle is replaced. Someone typing
 * elsewhere in the file keeps their cursor and their unsent keystrokes.
 */
export function setText(text: Y.Text, next: string): void {
  const current = text.toString();
  if (current === next) return;
  let start = 0;
  const max = Math.min(current.length, next.length);
  while (start < max && current.charCodeAt(start) === next.charCodeAt(start)) start++;
  let end = 0;
  while (end < max - start && current.charCodeAt(current.length - 1 - end) === next.charCodeAt(next.length - 1 - end)) end++;
  // Don't split a surrogate pair (emoji) at either edge.
  if (start > 0 && isHighSurrogate(current.charCodeAt(start - 1))) start--;
  if (end > 0 && isLowSurrogate(current.charCodeAt(current.length - end))) end--;
  text.doc!.transact(() => {
    const removed = current.length - start - end;
    if (removed > 0) text.delete(start, removed);
    const inserted = next.slice(start, next.length - end);
    if (inserted) text.insert(start, inserted);
  });
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** Create folders and files for `a/b/c.ts`-style paths (used by templates and imports). */
export function seedFiles(doc: Y.Doc, files: Array<{ path: string; content: string }>, createdBy: string | null = null): void {
  doc.transact(() => {
    const folders = new Map<string, string>();
    const ensureFolder = (path: string): string | null => {
      if (!path) return null;
      const existing = folders.get(path);
      if (existing) return existing;
      const slash = path.lastIndexOf("/");
      const parentId = ensureFolder(slash === -1 ? "" : path.slice(0, slash));
      const id = createFolder(doc, { name: slash === -1 ? path : path.slice(slash + 1), parentId, createdBy });
      folders.set(path, id);
      return id;
    };
    for (const file of files) {
      const slash = file.path.lastIndexOf("/");
      const parentId = ensureFolder(slash === -1 ? "" : file.path.slice(0, slash));
      createFile(doc, { name: slash === -1 ? file.path : file.path.slice(slash + 1), parentId, content: file.content, createdBy });
    }
  }, "workspace-model");
}

export function initDoc(
  doc: Y.Doc,
  templateId: string,
  files: Array<{ path: string; content: string; tests?: Array<{ input: string; expected: string }> }>,
): void {
  doc.transact(() => {
    const { meta } = maps(doc);
    meta.set("schemaVersion", SCHEMA_VERSION);
    meta.set("templateId", templateId);
    seedFiles(doc, files);
    // Test cases for the Tests tab live in map "tests", keyed by file id.
    const tests = doc.getMap<Y.Array<Y.Map<string>>>("tests");
    for (const file of files) {
      if (!file.tests?.length) continue;
      const node = findByPath(doc, file.path);
      if (!node) continue;
      const cases = new Y.Array<Y.Map<string>>();
      cases.push(
        file.tests.map((test) => {
          const entry = new Y.Map<string>();
          entry.set("id", newId());
          entry.set("input", test.input);
          entry.set("expected", test.expected);
          return entry;
        }),
      );
      tests.set(node.id, cases);
    }
  }, "workspace-model");
}

export function isInitialised(doc: Y.Doc): boolean {
  return maps(doc).meta.get("schemaVersion") !== undefined;
}
