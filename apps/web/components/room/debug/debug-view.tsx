"use client";

import {
  allBreakpoints,
  clearBreakpoints,
  pathOf,
  toggleBreakpoint,
  type TreeNode,
} from "@codechatter/workspace-model";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bug,
  ChevronRight,
  Pause,
  Play,
  Plus,
  Redo2,
  Square,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { openRoomFile } from "@/components/room/editor/editor-opener";
import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

import {
  isDebuggable,
  loadChildren,
  selectFrame,
  setRevealOnStop,
  setWatches,
  step,
  stopDebugging,
  useDebug,
  type Variable,
} from "./debug-store";
import { LAUNCH_PATH } from "./launch";
import { addLaunchFile, launchConfigs, startPicked } from "./start";

/**
 * Run and Debug (it shares the sidebar with Files and Search): one session for the whole
 * room, which anyone can follow; people who can run code start it, step and evaluate.
 * Variables, watch expressions, the call stack and the room's breakpoints, with the
 * file opening where the program is paused while this view is open.
 */
export function DebugView({ activeFile }: { activeFile: TreeNode | null }) {
  const { doc, can } = useRoom();
  const session = useDebug((s) => s.session);
  const connected = useDebug((s) => s.connected);
  const drive = can("code.run");
  useEffect(() => {
    setRevealOnStop(true);
    return () => setRevealOnStop(false);
  }, []);

  const paused = session?.state === "stopped";
  const reason = session?.stopped?.reason;
  return (
    <section aria-label="Run and debug" className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex h-9 shrink-0 items-center gap-1 pr-1 pl-3">
        <span className="text-xs font-medium text-muted-foreground">Run and debug</span>
        {session && drive && (
          <div role="toolbar" aria-label="Debug controls" className="ml-auto flex items-center">
            {paused ? (
              <Control label="Continue" keys="F5" onClick={() => void step("continue")}>
                <Play />
              </Control>
            ) : (
              <Control
                label="Pause"
                keys="F6"
                onClick={() => void step("pause")}
                disabled={session.state === "starting"}
              >
                <Pause />
              </Control>
            )}
            <Control label="Step over" keys="F10" disabled={!paused} onClick={() => void step("next")}>
              <Redo2 />
            </Control>
            <Control label="Step into" keys="F11" disabled={!paused} onClick={() => void step("stepIn")}>
              <ArrowDownToLine />
            </Control>
            <Control
              label="Step out"
              keys="Shift+F11"
              disabled={!paused}
              onClick={() => void step("stepOut")}
            >
              <ArrowUpFromLine />
            </Control>
            <Control label="Stop" keys="Shift+F5" onClick={stopDebugging}>
              <Square className="text-destructive" />
            </Control>
          </div>
        )}
      </div>
      <div className="shrink-0 px-3 pb-2 text-xs">
        {!connected ? (
          <p className="text-muted-foreground">Connecting to the room’s debugger…</p>
        ) : session ? (
          <p role="status">
            {session.name && <>{session.name}: </>}
            <span className="font-mono">{session.path}</span>, started by {session.startedBy}:{" "}
            {session.state === "starting"
              ? "starting…"
              : paused
                ? `paused${reason ? ` (${reason})` : ""}`
                : "running"}
          </p>
        ) : drive ? (
          <div className="grid gap-2">
            <Launch activeFile={activeFile} />
            <p className="text-muted-foreground">
              Python, C, C++, Go, Java, JavaScript and TypeScript. Click left of a line number (or F9) for a breakpoint; everyone in the room
              shares them, and the session.
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground">
            Nobody is debugging. When someone does, you can follow along here.
          </p>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto border-t">
        {session && (
          <>
            <Section title="Variables">
              <Variables />
            </Section>
            <Section title="Watch">
              <Watch />
            </Section>
            <Section title="Call stack">
              <CallStack />
            </Section>
          </>
        )}
        <Section title="Breakpoints">
          <Breakpoints />
        </Section>
      </div>
    </section>
  );
}

function Control({
  label,
  keys,
  disabled,
  onClick,
  children,
}: {
  label: string;
  keys: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      title={`${label} (${keys})`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-7 w-full items-center gap-1 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        {title}
      </button>
      {open && <div className="pb-2">{children}</div>}
    </div>
  );
}

function Variables() {
  const scopes = useDebug((s) => s.scopes);
  const paused = useDebug((s) => s.session?.state === "stopped");
  if (!paused)
    return <p className="px-3 text-xs text-muted-foreground">Variables show while the program is paused.</p>;
  if (!scopes.length) return <p className="px-3 text-xs text-muted-foreground">Reading…</p>;
  return (
    <ul role="tree" aria-label="Variables" className="text-xs">
      {scopes.map((scope) => (
        <Node
          key={scope.variablesReference}
          label={scope.name}
          value=""
          reference={scope.variablesReference}
          depth={0}
          startOpen={!scope.expensive}
        />
      ))}
    </ul>
  );
}

/** A scope or a variable; one with children (a list, an object, a struct) opens to them. */
function Node({
  label,
  value,
  type,
  reference,
  depth,
  startOpen = false,
}: {
  label: string;
  value: string;
  type?: string;
  reference: number;
  depth: number;
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const children = useDebug((s) => (reference ? s.children[reference] : undefined));
  const expandable = reference > 0;
  // An open node reads its children (once; loadChildren keeps them for this pause).
  useEffect(() => {
    if (open && expandable && !children) void loadChildren(reference);
  }, [open, expandable, children, reference]);
  const toggle = () => {
    if (expandable) setOpen(!open);
  };
  return (
    <li
      role="treeitem"
      aria-selected={false}
      aria-expanded={expandable ? open : undefined}
      aria-label={value ? `${label} = ${value}` : label}
    >
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-baseline gap-1 py-0.5 pr-2 text-left hover:bg-accent"
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        <ChevronRight
          className={cn(
            "size-3 shrink-0 self-center transition-transform",
            open && "rotate-90",
            !expandable && "invisible",
          )}
        />
        <span className={cn("shrink-0", depth === 0 ? "font-medium" : "text-muted-foreground")}>{label}</span>
        {value && (
          <span className="min-w-0 truncate font-mono" title={type ? `${type}: ${value}` : value}>
            {value}
          </span>
        )}
      </button>
      {open && expandable && (
        <ul role="group">
          {!children ? (
            <li className="py-0.5 text-muted-foreground" style={{ paddingLeft: 20 + depth * 12 }}>
              Reading…
            </li>
          ) : (
            children.map((child: Variable) => (
              <Node
                key={`${child.name}-${child.variablesReference}`}
                label={child.name}
                value={child.value}
                type={child.type}
                reference={child.variablesReference}
                depth={depth + 1}
              />
            ))
          )}
        </ul>
      )}
    </li>
  );
}

function Watch() {
  const watches = useDebug((s) => s.watches);
  const values = useDebug((s) => s.watchValues);
  const paused = useDebug((s) => s.session?.state === "stopped");
  const [draft, setDraft] = useState("");
  return (
    <div className="text-xs">
      <ul aria-label="Watch expressions">
        {watches.map((watch) => (
          <li key={watch} className="group flex items-baseline gap-1 px-3 py-0.5 hover:bg-accent">
            <span className="shrink-0 font-mono">{watch}</span>
            <span
              className={cn(
                "min-w-0 flex-1 truncate font-mono",
                values[watch]?.failed ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {paused ? (values[watch]?.value ?? "…") : ""}
            </span>
            <button
              type="button"
              aria-label={`Stop watching ${watch}`}
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              onClick={() => setWatches(watches.filter((w) => w !== watch))}
            >
              <X className="size-3" />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex items-center gap-1 px-3 pt-1"
        onSubmit={(event) => {
          event.preventDefault();
          const expression = draft.trim();
          if (expression && !watches.includes(expression)) setWatches([...watches, expression]);
          setDraft("");
        }}
      >
        <input
          aria-label="Add a watch expression"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Expression to watch"
          className="h-6 min-w-0 flex-1 rounded-sm border bg-background px-1.5 font-mono outline-none focus-visible:outline-2 focus-visible:outline-ring"
        />
        <Button type="submit" variant="ghost" size="icon-xs" aria-label="Watch it">
          <Plus />
        </Button>
      </form>
    </div>
  );
}

function CallStack() {
  const frames = useDebug((s) => s.frames);
  const frameId = useDebug((s) => s.frameId);
  if (!frames.length)
    return <p className="px-3 text-xs text-muted-foreground">The stack shows while the program is paused.</p>;
  return (
    <ul aria-label="Call stack" className="text-xs">
      {frames.map((frame) => (
        <li key={frame.id}>
          <button
            type="button"
            aria-current={frame.id === frameId ? "true" : undefined}
            onClick={() => void selectFrame(frame.id)}
            className={cn(
              "flex w-full items-baseline gap-2 px-3 py-0.5 text-left hover:bg-accent",
              frame.id === frameId && "bg-accent",
            )}
          >
            <span className="truncate font-mono">{frame.name}</span>
            <span className="ml-auto shrink-0 text-muted-foreground">
              {frame.path ? `${frame.path.split("/").pop()}:${frame.line}` : "library"}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The room's breakpoints, from the files document, kept current as anyone sets or clears one. */
function Breakpoints() {
  const { doc, can } = useRoom();
  // Breakpoints move with edits above them, so any change to the files can move one.
  const changes = useRef(0);
  const subscribe = useCallback(
    (onChange: () => void) => {
      const bump = () => {
        changes.current += 1;
        onChange();
      };
      doc.on("update", bump);
      return () => doc.off("update", bump);
    },
    [doc],
  );
  const version = useSyncExternalStore(
    subscribe,
    () => changes.current,
    () => 0,
  );
  const list = useMemo(
    () =>
      allBreakpoints(doc).flatMap(({ fileId, lines }) =>
        lines.map((line) => ({ fileId, line, path: pathOf(doc, fileId) ?? "?" })),
      ),
    // Read again on each change to the files (`version`), which the document doesn't show React.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, version],
  );
  const editable = can("files.edit");
  if (!list.length)
    return (
      <p className="px-3 text-xs text-muted-foreground">
        No breakpoints. Click left of a line number to add one.
      </p>
    );
  return (
    <div className="text-xs">
      <ul aria-label="Breakpoints">
        {list.map((bp) => (
          <li
            key={`${bp.fileId}:${bp.line}`}
            className="group flex items-center gap-1.5 px-3 py-0.5 hover:bg-accent"
          >
            <span aria-hidden className="size-2 shrink-0 rounded-full bg-destructive" />
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left"
              onClick={() =>
                openRoomFile(bp.path, { startLine: bp.line, startColumn: 1, endLine: bp.line, endColumn: 1 })
              }
            >
              {bp.path.split("/").pop()} <span className="text-muted-foreground">line {bp.line}</span>
            </button>
            {editable && (
              <button
                type="button"
                aria-label={`Remove the breakpoint at ${bp.path} line ${bp.line}`}
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => toggleBreakpoint(doc, bp.fileId, bp.line)}
              >
                <X className="size-3" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <button
          type="button"
          className="px-3 pt-1 text-muted-foreground hover:text-foreground"
          onClick={() => clearBreakpoints(doc)}
        >
          Remove all
        </button>
      )}
    </div>
  );
}

/**
 * What F5 starts: the open file, or a configuration from .vscode/launch.json (kept current
 * as the file changes); ones the room can't run are listed with why.
 */
function Launch({ activeFile }: { activeFile: TreeNode | null }) {
  const { doc, me, can } = useRoom();
  const configName = useDebug((s) => s.configName);
  const changes = useRef(0);
  const subscribe = useCallback(
    (onChange: () => void) => {
      const bump = () => {
        changes.current += 1;
        onChange();
      };
      doc.on("update", bump);
      return () => doc.off("update", bump);
    },
    [doc],
  );
  const version = useSyncExternalStore(
    subscribe,
    () => changes.current,
    () => 0,
  );
  const activePath = activeFile?.path ?? null;
  const launch = useMemo(
    () => launchConfigs(doc, activePath),
    // Read again on each change to the files (`version`), which the document doesn't show React.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, activePath, version],
  );
  const picked = launch?.configs.find((c) => c.name === configName) ?? null;
  const openFile = activeFile && isDebuggable(activeFile.path) ? activeFile : null;
  const label = picked
    ? `Debug: ${picked.name}`
    : openFile
      ? `Debug ${openFile.name}`
      : "Debug the open file";
  return (
    <>
      {launch && launch.configs.length > 0 && (
        <Select
          value={picked?.name ?? OPEN_FILE}
          onValueChange={(name) => useDebug.setState({ configName: name === OPEN_FILE ? null : name })}
        >
          <SelectTrigger size="sm" aria-label="Configuration" className="w-full text-xs data-[size=sm]:h-7">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={OPEN_FILE}>The open file</SelectItem>
            {launch.configs.map((config) => (
              <SelectItem key={config.name} value={config.name}>
                {config.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Button size="sm" disabled={!picked && !openFile} onClick={() => startPicked(doc, activePath)}>
        <Bug /> {label}
      </Button>
      {launch?.skipped.map((skip) => (
        <p key={skip.name} className="text-muted-foreground">
          <span className="text-foreground">{skip.name}</span>: {skip.reason}
        </p>
      ))}
      {can("files.edit") && (
        <button
          type="button"
          className="justify-self-start text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => {
            addLaunchFile(doc, me.user.id);
            // A file just made reaches the room's file list a moment later: open it once it's there.
            const open = (tries: number) => {
              if (!openRoomFile(LAUNCH_PATH, { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 }) && tries > 0)
                setTimeout(() => open(tries - 1), 50);
            };
            open(40);
          }}
        >
          {launch ? "Edit launch.json" : "Add a launch.json (arguments, environment, folder)"}
        </button>
      )}
    </>
  );
}

/** The picker's choice for "no configuration": the open file. */
const OPEN_FILE = "__open_file__";
