"use client";

import { flatten, listTree, maps, textOf, type TreeNode } from "@codechatter/workspace-model";
import { RotateCw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useFileTree } from "@/components/room/hooks";
import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { buildPreviewDocument, resolvePath } from "@/lib/preview/build-document";
import { cn } from "@/lib/utils";

type LogLine = { level: string; text: string };

/** The HTML files a preview can show, index.html first. */
export function htmlFiles(tree: TreeNode[]): TreeNode[] {
  return flatten(tree)
    .filter((n) => n.kind === "file" && /\.html?$/i.test(n.name))
    .sort((a, b) => Number(!/(^|\/)index\.html?$/i.test(a.path)) - Number(!/(^|\/)index\.html?$/i.test(b.path)) || a.path.localeCompare(b.path));
}

/**
 * Live preview of the room's web files, rebuilt a moment after anyone types.
 * Runs in a sandboxed iframe with an opaque origin: scripts run, but the page
 * can't read the app, its cookies or act as the viewer. Console output and
 * errors come back over postMessage and are shown underneath.
 */
export function WebPreview({ preferred, onClose }: { preferred: string | null; onClose: () => void }) {
  const { doc } = useRoom();
  const tree = useFileTree();
  const pages = useMemo(() => htmlFiles(tree), [tree]);
  const [chosen, setChosen] = useState<string | null>(null);
  const entry = (chosen && pages.some((p) => p.path === chosen) ? chosen : null) ?? (preferred && /\.html?$/i.test(preferred) ? preferred : pages[0]?.path) ?? null;
  const [html, setHtml] = useState("");
  const [missing, setMissing] = useState<string[]>([]);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [reloads, setReloads] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const shown = useRef("");

  // Rebuild on any change to the room's files (debounced). Only a different
  // document reloads the page (and clears its console); edits to unrelated
  // files leave it alone.
  useEffect(() => {
    if (!entry) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    shown.current = "";
    const rebuild = () => {
      const byPath = new Map(flatten(listTree(doc)).map((n) => [n.path, n]));
      const read = (path: string) => {
        const node = byPath.get(path);
        return node?.kind === "file" ? textOf(doc, node.id)?.toString() : undefined;
      };
      const built = buildPreviewDocument(entry, read);
      setMissing(built.missing);
      if (built.html === shown.current) return;
      shown.current = built.html;
      setHtml(built.html);
      setLogs([]);
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(rebuild, 450);
    };
    rebuild();
    const { nodes, contents } = maps(doc);
    nodes.observeDeep(schedule);
    contents.observeDeep(schedule);
    return () => {
      clearTimeout(timer);
      nodes.unobserveDeep(schedule);
      contents.unobserveDeep(schedule);
    };
  }, [doc, entry, reloads]);

  // Messages from our own iframe only.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data as { __ccPreview?: boolean; level?: string; text?: string; navigate?: string };
      if (!data?.__ccPreview) return;
      if (data.navigate && entry) {
        const target = resolvePath(entry, data.navigate);
        if (target && pages.some((p) => p.path === target)) setChosen(target);
        else setLogs((l) => [...l, { level: "warn", text: `Link to ${data.navigate} isn't a page in this room.` }]);
      } else if (data.text !== undefined) {
        setLogs((l) => [...l.slice(-199), { level: data.level ?? "log", text: data.text! }]);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [entry, pages]);

  const errors = logs.filter((l) => l.level === "error").length;

  return (
    <section aria-label="Web preview" className="flex h-full min-h-0 flex-col border-l bg-background">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b bg-chrome px-2">
        <span className="text-xs font-medium">Preview</span>
        {pages.length > 1 && entry ? (
          <Select value={entry} onValueChange={setChosen}>
            <SelectTrigger size="sm" className="h-6 max-w-48 text-xs" aria-label="Page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pages.map((p) => (
                <SelectItem key={p.id} value={p.path} className="text-xs">
                  {p.path}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          entry && <span className="truncate font-mono text-2xs text-muted-foreground">{entry}</span>
        )}
        <div className="ml-auto flex items-center">
          <Button size="icon-xs" variant="ghost" aria-label="Reload preview" onClick={() => setReloads((n) => n + 1)}>
            <RotateCw />
          </Button>
          <Button size="icon-xs" variant="ghost" aria-label="Close preview" onClick={onClose}>
            <X />
          </Button>
        </div>
      </div>

      {entry ? (
        <>
          {/* Created only once there is a document: an iframe first rendered with an
              empty srcdoc stays on about:blank when srcdoc changes later. */}
          {html ? (
            <iframe
              ref={frame}
              key={reloads}
              title={`Preview of ${entry}`}
              srcDoc={html}
              // No allow-same-origin: the page gets an opaque origin and can't touch the app.
              sandbox="allow-scripts allow-forms allow-modals allow-popups"
              className="min-h-0 w-full flex-1 bg-white"
            />
          ) : (
            <div className="min-h-0 flex-1 bg-white" />
          )}
          <details className="group shrink-0 border-t bg-panel text-xs" open={errors > 0}>
            <summary className="flex h-7 cursor-pointer list-none items-center gap-2 px-2 text-muted-foreground select-none">
              Console
              {logs.length > 0 && <span className="tabular-nums">{logs.length}</span>}
              {errors > 0 && <span className="rounded-sm bg-destructive/10 px-1 text-destructive tabular-nums">{errors} error{errors > 1 ? "s" : ""}</span>}
              {missing.length > 0 && <span className="text-warning">Missing: {missing.join(", ")}</span>}
            </summary>
            <ol className="max-h-40 overflow-y-auto px-2 pb-2 font-mono text-2xs">
              {logs.length === 0 && <li className="py-1 text-muted-foreground">Nothing logged yet.</li>}
              {logs.map((line, i) => (
                <li
                  key={i}
                  className={cn("border-b py-0.5 whitespace-pre-wrap last:border-0", line.level === "error" && "text-destructive", line.level === "warn" && "text-warning")}
                >
                  {line.text}
                </li>
              ))}
            </ol>
          </details>
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
          Add an index.html to preview a web page here.
        </div>
      )}
    </section>
  );
}
