"use client";

import { emptyAuth, parseCurl, type CurlImport } from "@codechatter/contracts";
import { useDeferredValue, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { focusUrlSoon } from "./collections-tree";
import { ImportBuilder, importUrl, parseOpenApi, safeExample, type ImportPlan } from "./import-openapi";
import { parsePostman } from "./import-postman";
import { addRow, createEnvironment, createFolder, createRequest } from "./model";
import { useStudio } from "./studio-context";

const MAX_BYTES = 5 * 1024 * 1024;
type Plan = Omit<ImportPlan, "format"> & { format: ImportPlan["format"] | "curl" };
type Parsed = { value: Plan; error?: never } | { value?: never; error: string } | null;

function nameFor(imported: CurlImport): string {
  try { const url = new URL(imported.url); return `${imported.method} ${url.pathname === "/" ? url.host : url.pathname}`.slice(0, 80); }
  catch { return `${imported.method} request`; }
}

/** Keep the existing cURL import, but move recognizable credentials to empty secret variables. */
function curlPlan(text: string): Plan {
  const value = parseCurl(text);
  const builder = new ImportBuilder(nameFor(value), "openapi");
  const auth = { ...emptyAuth(), ...value.auth };
  if (auth.type === "bearer") auth.token = builder.credential(auth.token, "token");
  if (auth.type === "basic") { auth.username = builder.clip(auth.username); auth.password = builder.credential(auth.password, "password"); }
  if (auth.type === "apiKey") auth.value = builder.credential(auth.value, "apiKey");
  const { url, params } = importUrl(builder, value.url);
  if (value.headers.length > 63 || value.body.form.length > 256) builder.unsupported("Extra header or form rows were skipped.");
  const headers = value.headers.slice(0, 63).flatMap((row) => { const safe = builder.row(row.key, row.value, row.enabled); return safe ? [safe] : []; });
  const body = { ...value.body, text: builder.clip(value.body.text, 512 * 1024), form: value.body.form.slice(0, 256).flatMap((row) => { const safe = builder.row(row.key, row.value, row.enabled); return safe ? [safe] : []; }) };
  if (body.mode === "json") {
    try { body.text = JSON.stringify(safeExample(builder, JSON.parse(body.text)), null, 2); }
    catch { builder.warn("The JSON body could not be checked. Review it before sending."); body.text = ""; }
  }
  builder.add({ folderId: null, name: builder.plan.name, method: value.method, url, headers, params, body, auth });
  if (value.warnings.length) builder.unsupported("Some cURL options, file fields or extra arguments were skipped. Review the imported request.");
  return { ...builder.finish(), format: "curl" };
}

function parseInput(source: string): Parsed {
  if (new TextEncoder().encode(source).byteLength > MAX_BYTES) return { error: "Use a file or text no larger than 5 MB." };
  const text = source.replace(/^\uFEFF/, "");
  if (!text.trim()) return null;
  try {
    if (/^\s*(?:\$\s+)?curl\b/i.test(text)) return { value: curlPlan(text) };
    let postman = false;
    if (text.trimStart().startsWith("{")) {
      try {
        const root: unknown = JSON.parse(text);
        if (root && typeof root === "object" && Object.hasOwn(root, "item") && Object.hasOwn(root, "info")) {
          const info = (root as { info: unknown }).info;
          postman = Boolean(info && typeof info === "object" && Object.hasOwn(info, "schema"));
        }
      } catch { /* The format parser supplies a safe error without quoting the input. */ }
    }
    return { value: postman ? parsePostman(text) : parseOpenApi(text) };
  } catch (error) {
    return { error: /^\s*(?:\$\s+)?curl\b/i.test(text) ? "Couldn't read that cURL command. Check its quotes and options." : error instanceof Error ? error.message : "Couldn't read this API document." };
  }
}

/** Validate folder references before the first Yjs write; model helpers then share one outer transaction. */
function folderOrder(plan: Plan) {
  const ordered: Plan["folders"] = [];
  const known = new Set<string>();
  let pending = [...plan.folders];
  while (pending.length) {
    const next = pending.filter((folder) => folder.parentId === null || known.has(folder.parentId));
    if (!next.length) throw new Error("The imported folder structure is invalid.");
    for (const folder of next) { if (known.has(folder.id)) throw new Error("The imported folders have duplicate IDs."); known.add(folder.id); ordered.push(folder); }
    pending = pending.filter((folder) => !known.has(folder.id));
  }
  if (plan.requests.some((request) => request.folderId !== null && !known.has(request.folderId))) throw new Error("An imported request has no matching folder.");
  return ordered;
}

function folderPath(folders: Map<string, Plan["folders"][number]>, id: string | null): string {
  const names: string[] = [];
  const seen = new Set<string>();
  while (id && !seen.has(id) && names.length <= 200) {
    seen.add(id);
    const folder = folders.get(id);
    if (!folder) break;
    names.unshift(folder.name);
    id = folder.parentId;
  }
  return names.join(" / ");
}

export function ImportDialog() {
  const { dialog, openDialog } = useStudio();
  const open = dialog?.kind === "import";
  return (
    <Dialog open={open} onOpenChange={(value) => !value && openDialog(null)}>
      <DialogContent data-own-run-key className="max-h-[90dvh] overflow-y-auto text-[13px] sm:max-w-2xl">
        <DialogHeader><DialogTitle>Import</DialogTitle><DialogDescription>Paste cURL, OpenAPI, Swagger or a Postman collection, or choose a file. Preview it before adding anything.</DialogDescription></DialogHeader>
        {open && <ImportPanel />}
      </DialogContent>
    </Dialog>
  );
}

function ImportPanel() {
  const { doc, select, openDialog, canEdit, setEnvId } = useStudio();
  const [text, setText] = useState("");
  const [fileError, setFileError] = useState("");
  const [reading, setReading] = useState(false);
  const readEpoch = useRef(0);
  const adding = useRef(false);
  const deferred = useDeferredValue(text);
  const parsed = parseInput(deferred);
  const plan = parsed?.value;
  const folders = new Map(plan?.folders.map((folder) => [folder.id, folder]));
  const waiting = reading || deferred !== text;
  const format = plan?.format === "curl" ? "cURL" : plan?.format === "swagger" ? "Swagger 2.0" : plan?.format === "postman" ? "Postman" : "OpenAPI";

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    const epoch = ++readEpoch.current;
    setFileError("");
    if (!file) { setReading(false); return; }
    if (file.size > MAX_BYTES) { setText(""); setReading(false); setFileError("Choose a file no larger than 5 MB."); return; }
    setReading(true);
    try { const value = await file.text(); if (epoch === readEpoch.current) setText(value); }
    catch { if (epoch === readEpoch.current) { setText(""); setFileError("Couldn't read that file. Try another file or paste its text."); } }
    finally { if (epoch === readEpoch.current) setReading(false); }
  }

  function add() {
    if (!canEdit || !plan || !plan.requests.length || waiting || adding.current) return;
    adding.current = true;
    try {
      const ordered = folderOrder(plan);
      let first: string | null = null;
      let environment = "";
      doc.transact(() => {
        const top = createFolder(doc, plan.name);
        const folders = new Map<string, string>();
        for (const folder of ordered) folders.set(folder.id, createFolder(doc, folder.name, folder.parentId === null ? top : folders.get(folder.parentId)!));
        for (const request of plan.requests) {
          const { folderId, params, ...input } = request;
          const id = createRequest(doc, { ...input, parentId: folderId === null ? top : folders.get(folderId)! });
          for (const row of params) addRow(doc, id, "params", { ...row });
          first ??= id;
        }
        environment = createEnvironment(doc, plan.name, plan.variables);
      });
      setEnvId(environment);
      select(first);
      openDialog(null);
      toast.success(`Imported ${plan.requests.length} ${plan.requests.length === 1 ? "request" : "requests"}.`);
      focusUrlSoon();
    } catch { toast.error("Couldn't add the collection. Check the preview and try again."); }
    finally { adding.current = false; }
  }

  return (
    <>
      <div className="grid gap-2"><Label htmlFor="api-import-file">Choose an API file</Label><Input id="api-import-file" type="file" accept=".json,.yaml,.yml,.txt,application/json,application/yaml,text/yaml,text/plain" onChange={(event) => void chooseFile(event)} className="h-9 text-xs" /></div>
      <div className="grid gap-2"><Label htmlFor="api-import-text">cURL command or API document</Label><Textarea id="api-import-text" value={text} onChange={(event) => { readEpoch.current++; setReading(false); setFileError(""); setText(event.target.value); }} placeholder="Paste cURL, OpenAPI, Swagger or a Postman collection" spellCheck={false} className="max-h-48 min-h-28 font-mono text-xs md:text-xs" /></div>
      <div aria-live="polite" aria-busy={waiting} className="grid min-h-10 gap-2">
        {waiting && <p role="status" className="text-muted-foreground">Reading the import...</p>}
        {fileError && <p role="alert" className="text-destructive">{fileError}</p>}
        {!waiting && parsed?.error && <p role="alert" className="text-destructive">{parsed.error}</p>}
        {!waiting && plan && <section aria-label="Import preview" className="grid gap-3 rounded-md border p-3">
          <div><p className="font-medium">Detected {format}: {plan.name}</p><p className="text-xs text-muted-foreground">{plan.folders.length + 1} folders, {plan.requests.length} requests, {plan.variables.length} variables. A new folder and environment will be added. Existing items stay as they are.</p></div>
          <p className="text-xs text-muted-foreground">No API request is sent while importing. Scripts are excluded. Recognized credentials become empty secret variables; review other values before sharing.</p>
          {plan.folders.length > 0 && <details><summary className="min-h-6 cursor-pointer py-1">Folders ({plan.folders.length})</summary><ul className="max-h-32 overflow-y-auto pl-4 text-xs">{plan.folders.map((folder) => <li key={folder.id} className="py-0.5 break-words">{folderPath(folders, folder.id)}</li>)}</ul></details>}
          <details open><summary className="min-h-6 cursor-pointer py-1">Requests ({plan.requests.length})</summary><ul className="max-h-40 overflow-y-auto pl-4 text-xs">{plan.requests.map((request, index) => <li key={index} className="py-0.5 break-words"><span className="font-mono text-muted-foreground">{request.method}</span> {request.folderId && `${folderPath(folders, request.folderId)} / `}{request.name}</li>)}</ul></details>
          {plan.variables.length > 0 && <details open><summary className="min-h-6 cursor-pointer py-1">Variables ({plan.variables.length})</summary><ul className="max-h-32 overflow-y-auto pl-4 text-xs">{plan.variables.map((variable) => <li key={variable.key} className="py-0.5 break-words"><span className="font-mono">{variable.key}</span>{variable.secret && " (secret)"}{!variable.value && " - needs a value"}</li>)}</ul><p className="mt-1 text-xs text-muted-foreground">Add missing values in Environments after importing. Secret values stay on each device.</p></details>}
          <p className="text-xs text-muted-foreground">Skipped: {plan.counts.remoteRefs} remote references, {plan.counts.files} file fields, {plan.counts.scripts} requests with scripts, {plan.counts.secretValues} secret values, {plan.counts.unsupported} unsupported items. Stopped {plan.counts.cycles} cyclic or deep references; shortened {plan.counts.truncated} long values.</p>
          {plan.warnings.length > 0 && <ul className="grid gap-1 text-xs text-muted-foreground">{plan.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
        </section>}
      </div>
      <DialogFooter><Button variant="ghost" size="sm" onClick={() => openDialog(null)}>Cancel</Button><Button size="sm" disabled={waiting || !plan?.requests.length || !canEdit} onClick={add}>{plan?.format === "curl" ? "Add to collection" : "Import"}</Button></DialogFooter>
      {!canEdit && <p className="text-xs text-muted-foreground">You can view this room but cannot add requests.</p>}
    </>
  );
}
