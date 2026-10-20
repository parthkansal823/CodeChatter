"use client";

import {
  cellCount,
  cellId,
  cellOutputs,
  cellsOf,
  cellSource,
  cellType,
  clearOutputs,
  createFileAtPath,
  deleteCell,
  ensureNotebook,
  insertCell,
  kernelOf,
  moveCell,
  notebookOf,
  notebooks,
  setCellType,
  textOf,
  type CellType,
  type KernelStatus,
  type TreeNode,
} from "@codechatter/workspace-model";
import {
  ArrowDown,
  ArrowUp,
  Code2,
  Eraser,
  FileText,
  Loader2,
  Play,
  Plus,
  Power,
  RotateCcw,
  Square,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import * as Y from "yjs";

import { Threads, type PresenceSlot } from "@/components/presence/presence";
import { usePeers } from "@/components/room/hooks";
import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { CellEditor } from "./cell-editor";
import { CellOutputs } from "./cell-outputs";
import { controlKernel, runAll, runCells } from "./kernel";
import { useYSnapshot } from "./use-y";

const remarkPlugins = [remarkGfm];

/**
 * A notebook (.ipynb), cell by cell: everyone edits cells at once, runs them in the
 * room's kernel (apps/runner/src/notebooks.ts), and sees the outputs arrive. Shift+Enter
 * runs a cell and moves on, Ctrl+Enter runs it in place, Alt+Enter adds one below.
 */
export function NotebookView({ file }: { file: TreeNode }) {
  const { doc, can, synced } = useRoom();
  const editable = can("files.edit");
  const existing = useYSnapshot([notebooks(doc)], () => notebookOf(doc, file.id) ?? null);

  // The first editor to open it turns the file's JSON into live cells for everyone.
  useEffect(() => {
    if (synced && !existing && editable && textOf(doc, file.id)) ensureNotebook(doc, file.id);
  }, [synced, existing, editable, doc, file.id]);

  // Someone who can't edit, before any editor has opened it: the file as it is, read-only.
  const preview = useMemo(() => {
    if (existing || editable || !synced) return null;
    const local = new Y.Doc();
    const id = createFileAtPath(local, "notebook.ipynb", textOf(doc, file.id)?.toString() ?? "");
    return ensureNotebook(local, id);
  }, [existing, editable, synced, doc, file.id]);

  const nb = existing ?? preview;
  if (!nb) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        <Loader2 className="mr-2 size-3.5 animate-spin" /> Opening the notebook…
      </div>
    );
  }
  return <Notebook key={file.id} nb={nb} file={file} live={Boolean(existing)} />;
}

function Notebook({ nb, file, live }: { nb: Y.Map<unknown>; file: TreeNode; live: boolean }) {
  const { room, doc, can, provider } = useRoom();
  const editable = live && can("files.edit");
  const runnable = live && can("code.run");
  const cells = cellsOf(nb);
  const { ids, maps, kernel } = useYSnapshot([cells, nb], () => {
    const list = cells.toArray();
    return { ids: list.map(cellId), maps: list, kernel: kernelOf(nb) };
  });
  const [active, setActive] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  const [editingMarkdown, setEditingMarkdown] = useState<Set<string>>(() => new Set());

  // Others in this notebook, by the cell they're in (presence, like carets in a file).
  const peers = usePeers();
  const awareness = provider.awareness!;
  const here = peers
    .filter((peer) => peer.activeFileId === file.id)
    .map((peer) => ({ slot: peer.user.slot, cell: (awareness.getStates().get(peer.clientId) as { notebookCell?: string } | undefined)?.notebookCell }));
  const slotsIn = (id: string): PresenceSlot[] => here.filter((p) => p.cell === id).map((p) => p.slot);

  // You're in this notebook: others see it in People and in the explorer.
  useEffect(() => {
    provider.setAwarenessField("activeFileId", file.id);
    provider.setAwarenessField("selection", null);
    return () => provider.setAwarenessField("notebookCell", null);
  }, [provider, file.id]);

  const focusCell = (id: string) => {
    setActive(id);
    setFocus((prev) => ({ id, n: (prev?.n ?? 0) + 1 }));
  };
  const onCellFocus = (id: string) => {
    setActive(id);
    provider.setAwarenessField("activeFileId", file.id);
    provider.setAwarenessField("notebookCell", id);
  };
  const addCell = (index: number, type: CellType) => {
    if (!editable) return;
    const id = insertCell(nb, index, type);
    if (type === "markdown") setEditingMarkdown((prev) => new Set(prev).add(id));
    focusCell(id);
  };
  const run = (id: string, then: "stay" | "next" | "insert") => {
    const index = ids.indexOf(id);
    const cell = maps[index];
    if (!cell) return;
    if (cellType(cell) === "markdown") {
      setEditingMarkdown((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } else if (runnable) {
      void runCells(room.id, doc, file.id, [id]);
    }
    if (then === "insert" || (then === "next" && index === ids.length - 1)) addCell(index + 1, "code");
    else if (then === "next") focusCell(ids[index + 1]!);
  };
  const leave = (id: string, direction: -1 | 1) => {
    const next = ids[ids.indexOf(id) + direction];
    if (next) focusCell(next);
  };
  const clearAll = () =>
    doc.transact(() => {
      for (const cell of cells.toArray()) if (cellType(cell) === "code") clearOutputs(cell);
    });

  const busy = kernel.state === "busy" || kernel.state === "starting";
  return (
    <section data-own-run-key aria-label={`Notebook ${file.name}`} className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-8 shrink-0 items-center gap-0.5 border-b bg-chrome px-2 text-xs">
        {runnable && (
          <>
            <ToolbarButton label="Run every code cell, top to bottom" onClick={() => void runAll(room.id, doc, file.id)}>
              <Play className="fill-current" /> Run all
            </ToolbarButton>
            <ToolbarButton label="Interrupt" disabled={!busy} onClick={() => void controlKernel(room.id, file.id, "interrupt")}>
              <Square className="fill-current" />
            </ToolbarButton>
            <ToolbarButton label="Restart the kernel (forgets every variable)" disabled={kernel.state === "off"} onClick={() => void controlKernel(room.id, file.id, "restart")}>
              <RotateCcw />
            </ToolbarButton>
            <ToolbarButton label="Shut the kernel down" disabled={kernel.state === "off"} onClick={() => void controlKernel(room.id, file.id, "shutdown")}>
              <Power />
            </ToolbarButton>
          </>
        )}
        {editable && (
          <>
            <span className="mx-1 h-4 w-px bg-border" aria-hidden />
            <ToolbarButton label="Add a code cell at the end" onClick={() => addCell(ids.length, "code")}>
              <Plus /> Code
            </ToolbarButton>
            <ToolbarButton label="Add a text cell at the end" onClick={() => addCell(ids.length, "markdown")}>
              <Plus /> Text
            </ToolbarButton>
            <ToolbarButton label="Clear every output" onClick={clearAll}>
              <Eraser />
            </ToolbarButton>
          </>
        )}
        {!live && <span className="text-muted-foreground">Read-only: the file as saved.</span>}
        <KernelBadge kernel={kernel} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-3">
        <ol aria-label="Cells" className="mx-auto flex max-w-5xl flex-col gap-1 px-2">
          {maps.map((cell, index) => {
            const id = ids[index]!;
            return (
              <Cell
                key={id}
                fileId={file.id}
                cell={cell}
                id={id}
                index={index}
                total={ids.length}
                kernel={kernel}
                active={active === id}
                focusToken={focus?.id === id ? focus.n : 0}
                editable={editable}
                runnable={runnable}
                editingMarkdown={editingMarkdown.has(id)}
                peers={slotsIn(id)}
                onFocus={() => onCellFocus(id)}
                onRun={(then) => run(id, then)}
                onLeave={(direction) => leave(id, direction)}
                onEditMarkdown={() => {
                  if (!editable) return;
                  setEditingMarkdown((prev) => new Set(prev).add(id));
                  focusCell(id);
                }}
                onMove={(to) => moveCell(nb, id, to)}
                onDelete={() => {
                  const next = ids[index + 1] ?? ids[index - 1];
                  deleteCell(nb, id);
                  if (next) focusCell(next);
                }}
                onType={(type) => setCellType(nb, id, type)}
              />
            );
          })}
        </ol>
        {editable && (
          <div className="mx-auto mt-2 flex max-w-5xl gap-1 px-2 pl-16">
            <Button size="xs" variant="ghost" onClick={() => addCell(ids.length, "code")}>
              <Plus /> Code
            </Button>
            <Button size="xs" variant="ghost" onClick={() => addCell(ids.length, "markdown")}>
              <Plus /> Text
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

type CellProps = {
  fileId: string;
  cell: Y.Map<unknown>;
  id: string;
  index: number;
  total: number;
  kernel: KernelStatus;
  active: boolean;
  focusToken: number;
  editable: boolean;
  runnable: boolean;
  editingMarkdown: boolean;
  peers: PresenceSlot[];
  onFocus: () => void;
  onRun: (then: "stay" | "next" | "insert") => void;
  onLeave: (direction: -1 | 1) => void;
  onEditMarkdown: () => void;
  onMove: (to: number) => void;
  onDelete: () => void;
  onType: (type: CellType) => void;
};

function Cell(props: CellProps) {
  const { fileId, cell, id, index, total, kernel, active, editable, runnable, peers } = props;
  const outputsArray = cellOutputs(cell);
  const source = cellSource(cell);
  const { type, count, outputs } = useYSnapshot([cell, outputsArray], () => ({
    type: cellType(cell),
    count: cellCount(cell),
    outputs: outputsArray.toArray(),
  }));
  const running = kernel.running === id;
  const queued = kernel.queued.includes(id);
  const isCode = type === "code";
  const showEditor = isCode || props.editingMarkdown;

  return (
    <li
      className={cn(
        "group/cell relative flex rounded-md border border-transparent",
        active && "border-border bg-muted/20",
        running && "border-brand/60",
      )}
      aria-label={`${isCode ? "Code" : "Text"} cell ${index + 1}`}
    >
      <div className="absolute inset-y-1 left-0">
        <Threads slots={peers} />
      </div>
      <div className="flex w-14 shrink-0 flex-col items-end gap-1 pt-2 pr-2 font-mono text-2xs text-muted-foreground">
        {isCode ? (
          <>
            <span aria-label={running ? "Running" : queued ? "Waiting to run" : count ? `Ran as number ${count}` : "Not run"}>
              [{running ? "*" : queued ? "…" : (count ?? " ")}]
            </span>
            {runnable && (
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Run this cell"
                title="Run (Ctrl+Enter; Shift+Enter runs and moves on)"
                className={cn("opacity-0 group-hover/cell:opacity-100 focus-visible:opacity-100", active && "opacity-100")}
                onClick={() => props.onRun("stay")}
              >
                {running ? <Loader2 className="animate-spin" /> : <Play className="fill-current" />}
              </Button>
            )}
          </>
        ) : null}
      </div>
      <div className="min-w-0 flex-1 py-1">
        {showEditor ? (
          <div className={cn("overflow-hidden rounded-sm border bg-card", !isCode && "border-dashed")}>
            <CellEditor
              address={`${fileId}/${id}`}
              source={source}
              language={isCode ? "python" : "markdown"}
              readOnly={!editable}
              focusToken={props.focusToken}
              keys={{
                run: () => props.onRun("stay"),
                runAndNext: () => props.onRun("next"),
                runAndInsert: () => props.onRun("insert"),
                leave: props.onLeave,
              }}
              onFocus={props.onFocus}
              label={`${isCode ? "Code" : "Text"} cell ${index + 1}`}
            />
          </div>
        ) : (
          <MarkdownCell source={source} onEdit={props.onEditMarkdown} editable={editable} />
        )}
        {isCode && <CellOutputs outputs={outputs} />}
      </div>
      {editable && (
        <div
          className={cn(
            "absolute -top-3 right-2 z-10 hidden items-center gap-0.5 rounded-md border bg-popover p-0.5 shadow-sm group-hover/cell:flex",
            active && "flex",
          )}
        >
          <Button size="icon-xs" variant="ghost" aria-label={isCode ? "Make it a text cell" : "Make it a code cell"} title={isCode ? "Text cell" : "Code cell"} onClick={() => props.onType(isCode ? "markdown" : "code")}>
            {isCode ? <FileText /> : <Code2 />}
          </Button>
          <Button size="icon-xs" variant="ghost" aria-label="Move up" disabled={index === 0} onClick={() => props.onMove(index - 1)}>
            <ArrowUp />
          </Button>
          <Button size="icon-xs" variant="ghost" aria-label="Move down" disabled={index === total - 1} onClick={() => props.onMove(index + 1)}>
            <ArrowDown />
          </Button>
          <Button size="icon-xs" variant="ghost" aria-label="Delete the cell" disabled={total === 1} onClick={props.onDelete}>
            <Trash2 />
          </Button>
        </div>
      )}
    </li>
  );
}

/** A text cell, rendered; double-click (or Enter) to edit it. */
function MarkdownCell({ source, onEdit, editable }: { source: Y.Text; onEdit: () => void; editable: boolean }) {
  const text = useYSnapshot([source], () => source.toString());
  return (
    <div
      role={editable ? "button" : undefined}
      tabIndex={editable ? 0 : undefined}
      title={editable ? "Double-click to edit" : undefined}
      onDoubleClick={onEdit}
      onKeyDown={(event) => {
        if (event.key === "Enter" && editable) {
          event.preventDefault();
          onEdit();
        }
      }}
      className="min-h-8 rounded-sm px-3 py-1.5 text-sm leading-relaxed [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.85em] [&_h1]:mt-2 [&_h1]:mb-1 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mt-2 [&_h2]:mb-1 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_p]:my-1 [&_pre]:my-2 [&_pre]:rounded-md [&_pre]:border [&_pre]:bg-chrome [&_pre]:p-2 [&_pre]:text-xs [&_table]:border-collapse [&_td]:border [&_td]:px-2 [&_th]:border [&_th]:px-2 [&_ul]:list-disc"
    >
      {text.trim() ? (
        <Markdown remarkPlugins={remarkPlugins}>{text}</Markdown>
      ) : (
        <span className="text-muted-foreground">{editable ? "Empty text cell: double-click to write." : "Empty text cell."}</span>
      )}
    </div>
  );
}

function KernelBadge({ kernel }: { kernel: KernelStatus }) {
  const label = { off: "Kernel off", starting: "Starting…", idle: "Idle", busy: "Running", dead: "Kernel stopped" }[kernel.state];
  return (
    <span className="ml-auto flex min-w-0 items-center gap-1.5 text-muted-foreground" role="status" title={kernel.detail}>
      <span
        aria-hidden
        className={cn(
          "size-2 shrink-0 rounded-full",
          kernel.state === "idle" && "bg-success",
          (kernel.state === "busy" || kernel.state === "starting") && "animate-pulse bg-brand",
          kernel.state === "dead" && "bg-destructive",
          kernel.state === "off" && "border border-muted-foreground",
        )}
      />
      <span className="shrink-0">Python 3 · {label}</span>
      {kernel.detail && kernel.state !== "idle" && kernel.state !== "busy" && <span className="truncate">: {kernel.detail}</span>}
    </span>
  );
}

function ToolbarButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="xs" variant="ghost" aria-label={label} disabled={disabled} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
