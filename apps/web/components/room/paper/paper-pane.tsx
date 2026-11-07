/** A paper's PDF beside its .tex file: built with real TeX Live in the room's sandbox, with what went wrong by file and line. Everyone in the room sees the same PDF, and the last good one stays while a mistake is fixed. */
"use client";

import type { LatexBuild, LatexInput, LatexPdf, LatexProblem } from "@codechatter/contracts";
import { flatten, textOf, type TreeNode } from "@codechatter/workspace-model";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronRight, CircleAlert, Download, FileWarning, Hammer, Loader2, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";

import { openRoomFile } from "@/components/room/editor/editor-opener";
import { useFileTree } from "@/components/room/hooks";
import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

import { base64ToPdf, isPaperName, rootTexOf } from "./model";

const STATUS_MS = 5000;
const AS_I_TYPE_MS = 2500;
const AS_I_TYPE_KEY = "cc:paper:as-i-type";
const failure = (error: unknown) => (error instanceof ApiError ? error.message : "Couldn't reach the server. Try again.");
const when = (at: number) => new Date(at).toLocaleTimeString([], { timeStyle: "short" });

function stateVectorOf(doc: Y.Doc): string {
  let binary = "";
  for (const byte of Y.encodeStateVector(doc)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function Problem({ problem }: { problem: LatexProblem }) {
  const Icon = problem.severity === "error" ? CircleAlert : AlertTriangle;
  const place = problem.file ? `${problem.file}${problem.line ? `:${problem.line}` : ""}` : null;
  const body = (
    <>
      <Icon className={cn("mt-0.5 size-3.5 shrink-0", problem.severity === "error" ? "text-destructive" : "text-warning")} aria-hidden />
      <span className="grid min-w-0">
        <span className="break-words">{problem.message}</span>
        {problem.context && <span className="truncate font-mono text-[11px] text-muted-foreground">{problem.context}</span>}
        {place && <span className="truncate font-mono text-[11px] text-muted-foreground">{place}</span>}
      </span>
    </>
  );
  if (!problem.file) return <li className="flex items-start gap-2 px-2 py-1">{body}</li>;
  const open = () => openRoomFile(problem.file!, { startLine: problem.line ?? 1, startColumn: 1, endLine: problem.line ?? 1, endColumn: 1 });
  return (
    <li>
      <button type="button" className="flex w-full items-start gap-2 rounded-sm px-2 py-1 text-left hover:bg-accent" onClick={open}>
        {body}
      </button>
    </li>
  );
}

export function PaperPane({ activeFile, onClose }: { activeFile: TreeNode | null; onClose: () => void }) {
  const { room, doc, can } = useRoom();
  const tree = useFileTree();
  const queryClient = useQueryClient();
  const canRun = can("code.run");

  const texts = flatten(tree)
    .filter((node) => node.kind === "file" && !node.blob && isPaperName(node.name))
    .map((node) => ({ path: node.path, text: textOf(doc, node.id)?.toString() ?? "" }));
  const found = rootTexOf(texts, activeFile?.path ?? null);
  // Looking at a file that isn't part of a paper keeps the last paper here.
  const [remembered, setRemembered] = useState(found);
  if (found && found !== remembered) setRemembered(found);
  const root = found ?? (remembered && texts.some((file) => file.path === remembered) ? remembered : null);

  const ask = <T,>(input: LatexInput) => api<T>(`/api/rooms/${room.id}/latex`, { method: "POST", json: input });
  const statusKey = ["latex", room.id, "status", root];
  // Someone else may build: what they made shows up here, too.
  const status = useQuery({ queryKey: statusKey, queryFn: () => ask<LatexBuild>({ op: "status", file: root! }), enabled: Boolean(root), refetchInterval: STATUS_MS, retry: false });
  const build = useMutation({
    mutationFn: (fresh: boolean) => ask<LatexBuild>({ op: "build", file: root!, fresh, stateVector: stateVectorOf(doc) }),
    onSuccess: (result) => queryClient.setQueryData(statusKey, result),
  });
  const result = status.data;
  const pdfAt = result?.pdfAt ?? null;

  const pdf = useQuery({
    queryKey: ["latex", room.id, "pdf", root, pdfAt],
    queryFn: async () => URL.createObjectURL(base64ToPdf((await ask<LatexPdf>({ op: "pdf", file: root! })).base64)),
    enabled: Boolean(root && pdfAt),
    retry: false,
    // A link to these bytes, only good while this pane has it: it's taken back below.
    gcTime: 0,
    staleTime: Number.POSITIVE_INFINITY,
    placeholderData: (previous) => previous,
  });
  const url = pdf.data ?? null;
  useEffect(() => {
    if (!url) return;
    return () => {
      // A moment later, so the new PDF is in place before the old one's link goes.
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    };
  }, [url]);

  const [asIType, setAsIType] = useState(() => {
    try {
      return localStorage.getItem(AS_I_TYPE_KEY) === "on";
    } catch {
      return false;
    }
  });
  const chooseAsIType = (on: boolean) => {
    setAsIType(on);
    try {
      localStorage.setItem(AS_I_TYPE_KEY, on ? "on" : "off");
    } catch {
      // Storage can be off (private windows); it still works for this visit.
    }
  };
  const start = useRef(build.mutate);
  const busy = useRef(build.isPending);
  useEffect(() => {
    start.current = build.mutate;
    busy.current = build.isPending;
  });
  // After a pause in this person's own typing. Other people's typing is theirs to build, and this pane shows the result.
  useEffect(() => {
    if (!asIType || !root || !canRun) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(() => (busy.current ? later() : start.current(false)), AS_I_TYPE_MS);
    };
    const onChange = (transaction: Y.Transaction) => {
      if (transaction.local && transaction.changed.size) later();
    };
    doc.on("afterTransaction", onChange);
    return () => {
      clearTimeout(timer);
      doc.off("afterTransaction", onChange);
    };
  }, [asIType, root, canRun, doc]);

  const [showLog, setShowLog] = useState(false);
  const errors = result?.problems.filter((item) => item.severity === "error") ?? [];
  const warnings = result?.problems.filter((item) => item.severity === "warning") ?? [];
  const name = root?.split("/").at(-1) ?? "";
  const pdfName = name.replace(/\.tex$/i, ".pdf");

  return (
    <section aria-label="PDF" className="flex h-full min-h-0 flex-col bg-background text-xs">
      <header className="flex min-h-9 shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1">
        <span className="min-w-0 flex-1 truncate font-mono" title={root ?? undefined}>
          {name || "PDF"}
        </span>
        {canRun && root && (
          <>
            <Label className="flex items-center gap-1 text-xs font-normal">
              <Switch size="sm" checked={asIType} onCheckedChange={chooseAsIType} /> As I type
            </Label>
            <Button size="icon-xs" variant="ghost" aria-label="Build from scratch" title="Build from scratch, without what earlier builds left" disabled={build.isPending} onClick={() => build.mutate(true)}>
              <RotateCcw />
            </Button>
            <Button size="xs" disabled={build.isPending} onClick={() => build.mutate(false)}>
              {build.isPending ? <Loader2 className="animate-spin" /> : <Hammer />} Build
            </Button>
          </>
        )}
        {url && (
          <Button size="icon-xs" variant="ghost" aria-label={`Download ${pdfName}`} title="Download the PDF" asChild>
            <a href={url} download={pdfName}>
              <Download />
            </a>
          </Button>
        )}
        <Button size="icon-xs" variant="ghost" aria-label="Close the PDF" title="Close the PDF" onClick={onClose}>
          <X />
        </Button>
      </header>

      {build.isError && (
        <p role="alert" className="shrink-0 border-b px-2 py-1 text-destructive">
          {failure(build.error)}
        </p>
      )}
      {status.isError && !build.isError && (
        <p role="alert" className="shrink-0 border-b px-2 py-1 text-destructive">
          {failure(status.error)}
        </p>
      )}

      {result?.built && (
        <div className="max-h-[40%] shrink-0 overflow-auto border-b">
          <p role="status" className={cn("px-2 py-1", errors.length ? "font-medium text-destructive" : "text-muted-foreground")}>
            {errors.length
              ? `${errors.length} ${errors.length === 1 ? "error" : "errors"}${pdfAt && !result.ok ? ". This is the last PDF it could make." : ""}`
              : `${result.pages ?? "?"} ${result.pages === 1 ? "page" : "pages"}, built${result.at ? ` at ${when(result.at)}` : ""}${result.ms ? ` in ${(result.ms / 1000).toFixed(1)} s` : ""}`}
            {warnings.length > 0 && ` ${errors.length ? "and " : "with "}${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"}`}
            {result.overfull > 0 && `, ${result.overfull} badly fitting ${result.overfull === 1 ? "line" : "lines"}`}
          </p>
          {result.problems.length > 0 && (
            <ul aria-label="Problems in the build" className="grid">
              {result.problems.map((problem, index) => (
                <Problem key={index} problem={problem} />
              ))}
            </ul>
          )}
          <button type="button" aria-expanded={showLog} className="flex min-h-6 w-full items-center gap-1 px-2 text-muted-foreground hover:bg-accent" onClick={() => setShowLog(!showLog)}>
            <ChevronRight className={cn("size-3", showLog && "rotate-90")} aria-hidden /> What LaTeX said
          </button>
          {showLog && (
            <pre tabIndex={0} aria-label="What LaTeX said" className="max-h-48 overflow-auto bg-chrome p-2 font-mono text-[11px] whitespace-pre-wrap outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {result.log || "Nothing."}
            </pre>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {!root ? (
          <div className="grid max-w-prose gap-1 p-3 text-muted-foreground">
            <FileWarning className="size-4" aria-hidden />
            <p>This room has no paper yet. A paper is a .tex file with a \documentclass in it.</p>
          </div>
        ) : url ? (
          <iframe key={url} src={url} title={`${pdfName}, as a PDF`} className="size-full border-0" />
        ) : pdf.isError ? (
          <p role="alert" className="p-3 text-destructive">
            {failure(pdf.error)}
          </p>
        ) : pdfAt ? (
          <p role="status" className="p-3 text-muted-foreground">
            Loading the PDF…
          </p>
        ) : build.isPending ? (
          <p role="status" className="p-3 text-muted-foreground">
            Building. The first time takes a few seconds…
          </p>
        ) : (
          <p className="p-3 text-muted-foreground">{canRun ? "Press Build to make the PDF." : "The PDF shows here once someone has built it."}</p>
        )}
      </div>
    </section>
  );
}
