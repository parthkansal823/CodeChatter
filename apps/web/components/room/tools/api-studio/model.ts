import {
  emptyAuth,
  emptyBody,
  parseQuery,
  withQuery,
  type Assertion,
  type AuthType,
  type BodyMode,
  type Extraction,
  type HttpMethod,
  type KeyValue,
  type RequestAuth,
  type RequestBody,
  type RequestSpec,
} from "@codechatter/contracts";
import { randomId, setText } from "@codechatter/workspace-model";
import * as Y from "yjs";

/**
 * The room's API Studio document (`room:ROOMID:api`):
 *
 *   nodes:        Y.Map<id, Y.Map{ id, kind, name, parentId, order, ...request fields }>
 *   environments: Y.Map<id, Y.Map{ id, name, order, variables: Y.Array<Y.Map> }>
 *   settings:     Y.Map{ mockToken }
 *
 * Long free text (URL, bodies, scripts) is Y.Text, so two people typing in
 * the same field merge instead of overwriting each other. Rows (params,
 * headers, checks) are Y.Maps with ids, so edits to different rows never clash.
 * Secret variable values are never written here (see local-store.ts).
 */

export type NodeKind = "folder" | "request";
export type Protocol = "http" | "ws" | "sse";
export type Row = KeyValue & { id: string };
export type Variable = { id: string; key: string; value: string; secret: boolean; enabled: boolean };
export type Environment = { id: string; name: string; order: number; variables: Variable[] };

/** A saved response, shown in Compare and served by the mock server. */
export type SavedExample = {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  body: string;
  bodyEncoding: "text" | "base64";
  savedAt: number;
  savedBy: string;
};

export type TreeItem = {
  id: string;
  kind: NodeKind;
  name: string;
  parentId: string | null;
  order: number;
  method: HttpMethod;
  protocol: Protocol;
  children: TreeItem[];
};

export type RequestData = RequestSpec & {
  id: string;
  name: string;
  parentId: string | null;
  protocol: Protocol;
  headers: Row[];
  params: Row[];
  body: RequestBody & { form: Row[] };
  assertions: Assertion[];
  extracts: Extraction[];
  preScript: string;
  testScript: string;
  /** WebSocket messages saved with the request. */
  messages: Row[];
  example: SavedExample | null;
};

type YNode = Y.Map<unknown>;

export function apiMaps(doc: Y.Doc) {
  return {
    nodes: doc.getMap<YNode>("nodes"),
    environments: doc.getMap<YNode>("environments"),
    settings: doc.getMap<unknown>("settings"),
  };
}

// ---------------------------------------------------------------------------
// Reading

const str = (map: YNode, key: string, fallback = "") => {
  const value = map.get(key);
  return typeof value === "string" ? value : fallback;
};
const text = (map: YNode, key: string) => (map.get(key) as Y.Text | undefined)?.toString() ?? "";
const rowsOf = (map: YNode | undefined, key: string) => ((map?.get(key) as Y.Array<YNode> | undefined)?.toArray() ?? []).map((r) => r.toJSON());

function readRows(map: YNode | undefined, key: string): Row[] {
  return rowsOf(map, key).map((r) => ({ id: String(r.id), key: String(r.key ?? ""), value: String(r.value ?? ""), enabled: r.enabled !== false }));
}

export function listTree(doc: Y.Doc): TreeItem[] {
  const { nodes } = apiMaps(doc);
  const items = new Map<string, TreeItem>();
  nodes.forEach((node, id) => {
    const kind = node.get("kind") === "folder" ? "folder" : "request";
    items.set(id, {
      id,
      kind,
      name: str(node, "name", kind === "folder" ? "Folder" : "Request"),
      parentId: (node.get("parentId") as string | null) ?? null,
      order: Number(node.get("order") ?? 0),
      method: (str(node, "method", "GET") as HttpMethod) || "GET",
      protocol: (str(node, "protocol", "http") as Protocol) || "http",
      children: [],
    });
  });
  const roots: TreeItem[] = [];
  for (const item of items.values()) {
    const parent = item.parentId ? items.get(item.parentId) : undefined;
    // An item whose folder was deleted by someone else shows at the top level.
    if (parent && parent.kind === "folder") parent.children.push(item);
    else roots.push(item);
  }
  const sort = (list: TreeItem[]) => {
    list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    for (const item of list) sort(item.children);
  };
  sort(roots);
  return roots;
}

/** Requests in the order a folder (or the whole collection) runs them. */
export function requestsIn(items: TreeItem[]): TreeItem[] {
  return items.flatMap((item) => (item.kind === "folder" ? requestsIn(item.children) : [item]));
}

export function findItem(items: TreeItem[], id: string): TreeItem | null {
  for (const item of items) {
    if (item.id === id) return item;
    const inner = findItem(item.children, id);
    if (inner) return inner;
  }
  return null;
}

export function readRequest(doc: Y.Doc, id: string): RequestData | null {
  const node = apiMaps(doc).nodes.get(id);
  if (!node || node.get("kind") !== "request") return null;
  const body = node.get("body") as YNode | undefined;
  const auth = (node.get("auth") as YNode | undefined)?.toJSON() ?? {};
  const example = node.get("example");
  return {
    id,
    name: str(node, "name", "Request"),
    parentId: (node.get("parentId") as string | null) ?? null,
    protocol: (str(node, "protocol", "http") as Protocol) || "http",
    method: (str(node, "method", "GET") as HttpMethod) || "GET",
    url: text(node, "url"),
    params: readRows(node, "params"),
    headers: readRows(node, "headers"),
    body: {
      mode: (body ? str(body, "mode", "none") : "none") as BodyMode,
      text: body ? text(body, "text") : "",
      form: readRows(body, "form"),
      query: body ? text(body, "query") : "",
      variables: body ? text(body, "variables") : "",
    },
    auth: { ...emptyAuth(), ...(auth as Partial<RequestAuth>) },
    assertions: rowsOf(node, "assertions") as Assertion[],
    extracts: rowsOf(node, "extracts") as Extraction[],
    preScript: text(node, "preScript"),
    testScript: text(node, "testScript"),
    messages: readRows(node, "messages"),
    example: example && typeof example === "object" ? (example as SavedExample) : null,
  };
}

export function readEnvironments(doc: Y.Doc): Environment[] {
  const list: Environment[] = [];
  apiMaps(doc).environments.forEach((env, id) => {
    list.push({
      id,
      name: str(env, "name", "Environment"),
      order: Number(env.get("order") ?? 0),
      variables: rowsOf(env, "variables").map((v) => ({
        id: String(v.id),
        key: String(v.key ?? ""),
        value: String(v.value ?? ""),
        secret: v.secret === true,
        enabled: v.enabled !== false,
      })),
    });
  });
  return list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Y structures

export const yText = (node: YNode, key: string) => node.get(key) as Y.Text | undefined;
export const yRows = (node: YNode, key: string) => node.get(key) as Y.Array<YNode> | undefined;

export function rowMap(fields: Record<string, unknown>): YNode {
  const row = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(fields)) row.set(k, v);
  return row;
}

function rowArray(rows: Array<Record<string, unknown>>): Y.Array<YNode> {
  const array = new Y.Array<YNode>();
  array.push(rows.map((r) => rowMap({ id: randomId(), ...r })));
  return array;
}

function textOf(value: string): Y.Text {
  const t = new Y.Text();
  if (value) t.insert(0, value);
  return t;
}

function nextOrder(doc: Y.Doc, parentId: string | null): number {
  let max = 0;
  apiMaps(doc).nodes.forEach((node) => {
    if (((node.get("parentId") as string | null) ?? null) === parentId) max = Math.max(max, Number(node.get("order") ?? 0));
  });
  return max + 1;
}

export type NewRequest = {
  name: string;
  parentId?: string | null;
  protocol?: Protocol;
  method?: HttpMethod;
  url?: string;
  headers?: KeyValue[];
  body?: Partial<RequestBody>;
  auth?: Partial<RequestAuth>;
  assertions?: Array<Omit<Assertion, "id">>;
  extracts?: Array<Omit<Extraction, "id">>;
  preScript?: string;
  testScript?: string;
  messages?: KeyValue[];
  example?: SavedExample | null;
};

function requestNode(doc: Y.Doc, input: NewRequest): { id: string; node: YNode } {
  const id = randomId();
  const url = input.url ?? "";
  const body = { ...emptyBody(), ...input.body };
  const auth = { ...emptyAuth(), ...input.auth };
  const node = new Y.Map<unknown>();
  node.set("id", id);
  node.set("kind", "request");
  node.set("name", input.name);
  node.set("parentId", input.parentId ?? null);
  node.set("order", nextOrder(doc, input.parentId ?? null));
  node.set("protocol", input.protocol ?? "http");
  node.set("method", input.method ?? "GET");
  node.set("url", textOf(url));
  node.set("params", rowArray(parseQuery(url)));
  node.set("headers", rowArray(input.headers ?? []));
  const yBody = new Y.Map<unknown>();
  yBody.set("mode", body.mode);
  yBody.set("text", textOf(body.text));
  yBody.set("form", rowArray(body.form));
  yBody.set("query", textOf(body.query));
  yBody.set("variables", textOf(body.variables));
  node.set("body", yBody);
  node.set("auth", rowMap(auth));
  node.set("assertions", rowArray(input.assertions ?? []));
  node.set("extracts", rowArray(input.extracts ?? []));
  node.set("preScript", textOf(input.preScript ?? ""));
  node.set("testScript", textOf(input.testScript ?? ""));
  node.set("messages", rowArray(input.messages ?? []));
  node.set("example", input.example ?? null);
  return { id, node };
}

// ---------------------------------------------------------------------------
// Writing

export function createRequest(doc: Y.Doc, input: NewRequest): string {
  const { id, node } = requestNode(doc, input);
  doc.transact(() => apiMaps(doc).nodes.set(id, node));
  return id;
}

export function createFolder(doc: Y.Doc, name: string, parentId: string | null = null): string {
  const id = randomId();
  doc.transact(() => apiMaps(doc).nodes.set(id, rowMap({ id, kind: "folder", name, parentId, order: nextOrder(doc, parentId) })));
  return id;
}

/** A folder with requests in it, in one transaction (imports). */
export function createFolderWith(doc: Y.Doc, name: string, parentId: string | null, requests: NewRequest[]): string {
  let folderId = "";
  doc.transact(() => {
    folderId = createFolder(doc, name, parentId);
    for (const request of requests) createRequest(doc, { ...request, parentId: folderId });
  });
  return folderId;
}

export function renameNode(doc: Y.Doc, id: string, name: string): void {
  const trimmed = name.trim();
  if (trimmed) apiMaps(doc).nodes.get(id)?.set("name", trimmed.slice(0, 120));
}

/** Delete an item and everything inside it. */
export function deleteNode(doc: Y.Doc, id: string): void {
  const { nodes } = apiMaps(doc);
  const doomed = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    nodes.forEach((node, nodeId) => {
      const parentId = node.get("parentId") as string | null;
      if (parentId && doomed.has(parentId) && !doomed.has(nodeId)) {
        doomed.add(nodeId);
        grew = true;
      }
    });
  }
  doc.transact(() => doomed.forEach((d) => nodes.delete(d)));
}

export function duplicateRequest(doc: Y.Doc, id: string): string | null {
  const data = readRequest(doc, id);
  if (!data) return null;
  const strip = <T extends { id: string }>(rows: T[]) => rows.map(({ id: _id, ...rest }) => rest);
  return createRequest(doc, {
    ...data,
    name: `${data.name} copy`,
    headers: strip(data.headers),
    body: { ...data.body, form: strip(data.body.form) },
    assertions: strip(data.assertions),
    extracts: strip(data.extracts),
    messages: strip(data.messages),
  });
}

export function moveNode(doc: Y.Doc, id: string, parentId: string | null): void {
  const node = apiMaps(doc).nodes.get(id);
  if (!node || id === parentId) return;
  // Never into itself or its own descendants.
  for (let p = parentId; p; p = (apiMaps(doc).nodes.get(p)?.get("parentId") as string | null) ?? null) if (p === id) return;
  doc.transact(() => {
    node.set("parentId", parentId);
    node.set("order", nextOrder(doc, parentId));
  });
}

export function nodeMap(doc: Y.Doc, id: string): YNode | undefined {
  return apiMaps(doc).nodes.get(id);
}

export function setField(doc: Y.Doc, id: string, key: "method" | "protocol", value: string): void {
  nodeMap(doc, id)?.set(key, value);
}

export function setBodyMode(doc: Y.Doc, id: string, mode: BodyMode): void {
  (nodeMap(doc, id)?.get("body") as YNode | undefined)?.set("mode", mode);
}

export function setAuth(doc: Y.Doc, id: string, patch: Partial<RequestAuth> & { type?: AuthType }): void {
  const auth = nodeMap(doc, id)?.get("auth") as YNode | undefined;
  if (!auth) return;
  doc.transact(() => {
    for (const [k, v] of Object.entries(patch)) auth.set(k, v);
  });
}

export function setExample(doc: Y.Doc, id: string, example: SavedExample | null): void {
  nodeMap(doc, id)?.set("example", example);
}

/**
 * Typing in the URL keeps the Params rows in step: enabled rows follow the
 * query string (keeping their ids where they line up); disabled rows stay.
 */
export function setUrl(doc: Y.Doc, id: string, next: string): void {
  const node = nodeMap(doc, id);
  const url = node && yText(node, "url");
  const params = node && yRows(node, "params");
  if (!url || !params) return;
  doc.transact(() => {
    setText(url, next);
    const parsed = parseQuery(next);
    const enabled = params.toArray().filter((r) => r.get("enabled") !== false);
    parsed.forEach((p, i) => {
      const row = enabled[i];
      if (row) {
        if (row.get("key") !== p.key) row.set("key", p.key);
        if (row.get("value") !== p.value) row.set("value", p.value);
      } else {
        params.push([rowMap({ id: randomId(), ...p })]);
      }
    });
    for (const row of enabled.slice(parsed.length)) {
      const index = params.toArray().indexOf(row);
      if (index !== -1) params.delete(index, 1);
    }
  });
}

/** Editing the Params rows rewrites the URL's query. */
function syncUrlFromParams(doc: Y.Doc, node: YNode): void {
  const url = yText(node, "url");
  if (!url) return;
  setText(url, withQuery(url.toString(), readRows(node, "params")));
}

export type RowList = "params" | "headers" | "form" | "assertions" | "extracts" | "messages" | "variables";

/** The Y.Array behind a row list: on a request, its body, or an environment. */
export function rowList(doc: Y.Doc, ownerId: string, list: RowList): Y.Array<YNode> | undefined {
  if (list === "variables") return yRows(apiMaps(doc).environments.get(ownerId) ?? new Y.Map(), "variables");
  const node = nodeMap(doc, ownerId);
  if (!node) return undefined;
  if (list === "form") return yRows((node.get("body") as YNode | undefined) ?? new Y.Map(), "form");
  return yRows(node, list);
}

export function addRow(doc: Y.Doc, ownerId: string, list: RowList, fields: Record<string, unknown>): string {
  const id = randomId();
  doc.transact(() => {
    rowList(doc, ownerId, list)?.push([rowMap({ id, ...fields })]);
    if (list === "params") syncUrlFromParams(doc, nodeMap(doc, ownerId)!);
  });
  return id;
}

export function updateRow(doc: Y.Doc, ownerId: string, list: RowList, rowId: string, patch: Record<string, unknown>): void {
  const row = rowList(doc, ownerId, list)
    ?.toArray()
    .find((r) => r.get("id") === rowId);
  if (!row) return;
  doc.transact(() => {
    for (const [k, v] of Object.entries(patch)) if (row.get(k) !== v) row.set(k, v);
    if (list === "params") syncUrlFromParams(doc, nodeMap(doc, ownerId)!);
  });
}

export function removeRow(doc: Y.Doc, ownerId: string, list: RowList, rowId: string): void {
  const rows = rowList(doc, ownerId, list);
  const index = rows?.toArray().findIndex((r) => r.get("id") === rowId) ?? -1;
  if (!rows || index === -1) return;
  doc.transact(() => {
    rows.delete(index, 1);
    if (list === "params") syncUrlFromParams(doc, nodeMap(doc, ownerId)!);
  });
}

// ---------------------------------------------------------------------------
// Environments

export function createEnvironment(doc: Y.Doc, name: string, variables: Array<Omit<Variable, "id">> = []): string {
  const id = randomId();
  const { environments } = apiMaps(doc);
  let order = 0;
  environments.forEach((env) => (order = Math.max(order, Number(env.get("order") ?? 0))));
  const env = new Y.Map<unknown>();
  env.set("id", id);
  env.set("name", name);
  env.set("order", order + 1);
  // A secret's value is never written to the shared document.
  env.set("variables", rowArray(variables.map((v) => ({ ...v, value: v.secret ? "" : v.value }))));
  doc.transact(() => environments.set(id, env));
  return id;
}

export function renameEnvironment(doc: Y.Doc, id: string, name: string): void {
  if (name.trim()) apiMaps(doc).environments.get(id)?.set("name", name.trim().slice(0, 80));
}

export function deleteEnvironment(doc: Y.Doc, id: string): void {
  apiMaps(doc).environments.delete(id);
}

/** Marking a variable secret wipes its shared value in the same transaction. */
export function setVariableSecret(doc: Y.Doc, envId: string, rowId: string, secret: boolean): void {
  updateRow(doc, envId, "variables", rowId, secret ? { secret: true, value: "" } : { secret: false });
}
