"use client";

import type { RoomSummary } from "@codechatter/contracts";
import { flatten, type TreeNode } from "@codechatter/workspace-model";
import { FileCode2, Globe2, MessageSquare, SquareTerminal, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePanelRef } from "react-resizable-panels";

import { BottomPanel, MAX_TERMINALS, type PanelTab } from "@/components/room/bottom-panel";
import { ChatPanel } from "@/components/room/chat-panel";
import { CodeEditor } from "@/components/room/code-editor";
import { useRoomTabs, useTabs } from "@/components/room/editor-store";
import { EditorOverlays } from "@/components/room/editor/overlays";
import { useEditorShortcuts } from "@/components/room/editor/shortcuts";
import { Explorer } from "@/components/room/explorer";
import { useFileTree, usePeers } from "@/components/room/hooks";
import { PeoplePanel } from "@/components/room/people-panel";
import { RoomProvider, useRoom } from "@/components/room/room-context";
import { RunButton } from "@/components/room/run-button";
import { canRunPath, RunProvider, useRun } from "@/components/room/run-context";
import { StatusBar } from "@/components/room/status-bar";
import { TabBar } from "@/components/room/tab-bar";
import { TitleBar } from "@/components/room/title-bar";
import { AI_TOOL_ID, useOpenAiOnRequest } from "@/components/room/tools/ai/ai-requests";
import { ROOM_TOOLS } from "@/components/room/tools/registry";
import { ToolHost } from "@/components/room/tools/tool-host";
import { WebPreview } from "@/components/room/web-preview";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Skeleton } from "@/components/ui/skeleton";
import type { Me } from "@/lib/me";
import { cn } from "@/lib/utils";

export default function RoomWorkspace({ room, me }: { room: RoomSummary; me: Me }) {
  return (
    <RoomProvider room={room} me={me}>
      <RunProvider>
        <Workspace />
      </RunProvider>
    </RoomProvider>
  );
}

/** The right panel: Chat, People, or a side tool (by id). */
type Right = string;

function Workspace() {
  const { room, synced, can } = useRoom();
  const run = useRun();
  const tree = useFileTree();
  const peers = usePeers();
  const tabs = useRoomTabs(room.id);
  const { open, close, prune } = useTabs();
  const [showFiles, setShowFiles] = useState(true);
  const [right, setRight] = useState<Right | null>("chat");
  const [unread, setUnread] = useState(0);
  const onUnread = useCallback((n: number) => setUnread(n), []);
  // Clicking the open panel's icon closes it; any other icon switches to it.
  const toggleRight = (panel: Right) => setRight((current) => (current === panel ? null : panel));
  // "Explain error" and "Fix" on the Run output open the AI with their question.
  useOpenAiOnRequest(() => setRight(AI_TOOL_ID));

  // Plug-in tools (components/room/tools/registry.ts).
  const tools = ROOM_TOOLS.filter((tool) => tool.visible?.(can) ?? true);
  const sideTools = tools.filter((tool) => tool.placement === "side");
  const [mainToolId, setMainToolId] = useState<string | null>(null);
  const mainTool = tools.find((tool) => tool.id === mainToolId && tool.placement === "main") ?? null;

  const files = useMemo(() => new Map(flatten(tree).map((n) => [n.id, n])), [tree]);
  const openTabs = tabs.open.map((id) => files.get(id)).filter((n): n is TreeNode => Boolean(n));
  const activeFile = tabs.active ? (files.get(tabs.active) ?? null) : null;

  // Files deleted by anyone disappear from everyone's tabs.
  useEffect(() => {
    if (synced) prune(room.id, new Set(files.keys()));
  }, [synced, files, prune, room.id]);

  // First visit: open the README or the first file so the room isn't blank.
  useEffect(() => {
    if (!synced || tabs.open.length > 0) return;
    const all = [...files.values()].filter((n) => n.kind === "file");
    const first = all.find((n) => /^readme/i.test(n.name)) ?? all[0];
    if (first) open(room.id, first.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [synced]);

  const openFile = (node: TreeNode) => {
    if (node.kind !== "file") return;
    setMainToolId(null);
    open(room.id, node.id);
  };
  const openFileById = (id: string) => {
    const node = files.get(id);
    if (node) openFile(node);
  };

  // The bottom panel (Output + terminals) collapses instead of unmounting, so
  // terminals stay connected while it's hidden.
  const panel = usePanelRef();
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>("output");
  const [terminals, setTerminals] = useState<number[]>([]);
  const showPanel = (tab?: PanelTab) => {
    if (tab) setPanelTab(tab);
    if (panel.current?.isCollapsed()) {
      panel.current.expand();
      panel.current.resize(280);
    }
  };
  const runActive = () => {
    if (!activeFile || !canRunPath(activeFile.path) || !can("code.run")) return;
    showPanel("output");
    void run.start(activeFile.path);
  };
  const addTerminal = () => {
    const n = Array.from({ length: MAX_TERMINALS }, (_, i) => i + 1).find((i) => !terminals.includes(i));
    if (n === undefined) return;
    setTerminals([...terminals, n].sort());
    showPanel(`terminal-${n}`);
  };
  /** Show your first terminal, or open one. */
  const openTerminal = () => {
    if (!can("terminal.open")) return showPanel("output");
    const first = terminals[0];
    if (first === undefined) addTerminal();
    else showPanel(`terminal-${first}`);
  };
  // Live web preview, split beside the editor.
  const previewPanel = usePanelRef();
  const [previewOpen, setPreviewOpen] = useState(false);
  const hasHtml = useMemo(() => [...files.values()].some((n) => n.kind === "file" && /\.html?$/i.test(n.name)), [files]);
  const openPreview = () => {
    if (previewPanel.current?.isCollapsed()) {
      previewPanel.current.expand();
      previewPanel.current.resize("45%");
    }
  };
  const togglePreview = () => (previewOpen ? previewPanel.current?.collapse() : openPreview());

  const closeTerminal = (n: number) => {
    setTerminals(terminals.filter((i) => i !== n));
    if (panelTab === `terminal-${n}`) setPanelTab("output");
  };

  // Ctrl/Cmd+Enter runs the open file from anywhere (Monaco's own Ctrl+Enter
  // is overridden); Ctrl+` opens a terminal. Keys typed into a terminal are its own.
  const shortcuts = useRef({ runActive, openTerminal });
  useEffect(() => {
    shortcuts.current = { runActive, openTerminal };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const inTerminal = (event.target as HTMLElement | null)?.closest?.(".xterm");
      if (event.key === "Enter" && !inTerminal) {
        event.preventDefault();
        event.stopPropagation();
        shortcuts.current.runActive();
      } else if (event.key === "`") {
        event.preventDefault();
        shortcuts.current.openTerminal();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, []);
  useEditorShortcuts(activeFile?.id ?? null);
  const threadsFor = (id: string) => peers.filter((p) => p.activeFileId === id).map((p) => p.user.slot);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <TitleBar actions={<RunButton file={activeFile} onRun={runActive} onPreview={openPreview} />} />
      <div className="flex min-h-0 flex-1">
        {/* Activity bar */}
        <nav aria-label="Panels" className="flex w-activitybar shrink-0 flex-col items-center gap-1 border-r bg-chrome py-2">
          <ActivityButton label="Files" active={showFiles} onClick={() => setShowFiles((v) => !v)}>
            <FileCode2 className="size-[18px]" />
          </ActivityButton>
          <ActivityButton label={unread ? `Chat, ${unread} unread` : "Chat"} active={right === "chat"} onClick={() => toggleRight("chat")}>
            <MessageSquare className="size-[18px]" />
            {unread > 0 && right !== "chat" && (
              <span className="absolute top-1 right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-brand px-1 text-[9px] leading-none font-semibold text-brand-foreground tabular-nums">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </ActivityButton>
          <ActivityButton label="People" active={right === "people"} onClick={() => toggleRight("people")}>
            <Users className="size-[18px]" />
          </ActivityButton>
          {tools.map((tool) => {
            const active = tool.placement === "main" ? mainToolId === tool.id : right === tool.id;
            return (
              <ActivityButton
                key={tool.id}
                label={tool.label}
                active={active}
                onClick={() => (tool.placement === "main" ? setMainToolId(active ? null : tool.id) : toggleRight(tool.id))}
              >
                <tool.icon className="size-[18px]" />
              </ActivityButton>
            );
          })}
          <ActivityButton
            label={panelOpen ? "Hide output and terminals" : "Output and terminals"}
            active={panelOpen}
            onClick={() => (panelOpen ? panel.current?.collapse() : openTerminal())}
          >
            <SquareTerminal className="size-[18px]" />
            {run.running && !panelOpen && <span className="absolute top-1.5 right-1.5 size-2 animate-pulse rounded-full bg-brand" />}
          </ActivityButton>
        </nav>

        <ResizablePanelGroup orientation="horizontal" className="min-w-0 flex-1">
          {showFiles && (
            <>
              <ResizablePanel id="explorer" defaultSize={248} minSize={180} maxSize={480}>
                {synced ? <Explorer activeFileId={activeFile?.id ?? null} onOpen={openFile} /> : <PanelSkeleton />}
              </ResizablePanel>
              <ResizableHandle />
            </>
          )}
          <ResizablePanel id="editor" minSize={320}>
            <ResizablePanelGroup orientation="vertical">
              <ResizablePanel id="code" minSize={120}>
                <ResizablePanelGroup orientation="horizontal">
                  <ResizablePanel id="source" minSize={240}>
                    {mainTool ? (
                      <div className="h-full min-h-0 bg-background">
                        <ToolHost tool={mainTool} activeFile={activeFile} openFile={openFileById} close={() => setMainToolId(null)} />
                      </div>
                    ) : (
                    <div className="flex h-full min-h-0 flex-col">
                      <TabBar
                        tabs={openTabs}
                        activeId={activeFile?.id ?? null}
                        threadsFor={threadsFor}
                        onSelect={(id) => open(room.id, id)}
                        onClose={(id) => close(room.id, id)}
                        actions={
                          hasHtml && (
                            <Button size="xs" variant={previewOpen ? "secondary" : "ghost"} aria-pressed={previewOpen} onClick={togglePreview}>
                              <Globe2 /> Preview
                            </Button>
                          )
                        }
                      />
                      <div className="min-h-0 flex-1">
                        {activeFile ? <CodeEditor file={activeFile} role="primary" /> : <EmptyEditor synced={synced} />}
                      </div>
                    </div>
                    )}
                  </ResizablePanel>
                  <ResizableHandle />
                  <ResizablePanel
                    id="preview"
                    panelRef={previewPanel}
                    collapsible
                    collapsedSize={0}
                    defaultSize={0}
                    minSize={260}
                    onResize={(size) => setPreviewOpen(size.inPixels > 0)}
                  >
                    {previewOpen && <WebPreview preferred={activeFile?.path ?? null} onClose={() => previewPanel.current?.collapse()} />}
                  </ResizablePanel>
                </ResizablePanelGroup>
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel
                id="panel"
                panelRef={panel}
                collapsible
                collapsedSize={0}
                defaultSize={0}
                minSize={140}
                onResize={(size) => setPanelOpen(size.inPixels > 0)}
              >
                <BottomPanel
                  tab={panelTab}
                  file={activeFile}
                  onTab={setPanelTab}
                  terminals={terminals}
                  onAddTerminal={addTerminal}
                  onCloseTerminal={closeTerminal}
                  onClose={() => panel.current?.collapse()}
                />
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
          {right && (
            <>
              <ResizableHandle />
              <ResizablePanel id="right" defaultSize={300} minSize={240} maxSize={460}>
                <div className="flex h-full min-h-0 flex-col bg-panel">
                  <div role="tablist" aria-label="Side panel" className="flex h-9 shrink-0 items-stretch gap-4 border-b px-3">
                    {[
                      { id: "chat", label: "Chat" },
                      { id: "people", label: "People" },
                      ...sideTools.map((tool) => ({ id: tool.id, label: tool.label })),
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        role="tab"
                        type="button"
                        aria-selected={right === tab.id}
                        onClick={() => setRight(tab.id)}
                        className={cn(
                          "relative text-xs font-medium whitespace-nowrap",
                          right === tab.id ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {tab.label}
                        {right === tab.id && <span aria-hidden className="absolute inset-x-0 -bottom-px h-[2px] bg-brand" />}
                      </button>
                    ))}
                  </div>
                  {/* Chat stays mounted (hidden) so it keeps its socket and counts unread messages. */}
                  <div className={cn("min-h-0 flex-1", right !== "chat" && "hidden")}>
                    <ChatPanel visible={right === "chat"} onUnread={onUnread} />
                  </div>
                  {right === "people" && (
                    <div className="min-h-0 flex-1">
                      <PeoplePanel tree={tree} onOpen={openFile} />
                    </div>
                  )}
                  {sideTools.map(
                    (tool) =>
                      right === tool.id && (
                        <div key={tool.id} className="min-h-0 flex-1">
                          <ToolHost tool={tool} activeFile={activeFile} openFile={openFileById} close={() => setRight(null)} />
                        </div>
                      ),
                  )}
                </div>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>
      <StatusBar file={activeFile} />
      <EditorOverlays openFile={openFile} />
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="grid gap-2 bg-panel p-3">
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-4" style={{ width: `${60 + ((i * 17) % 35)}%` }} />
      ))}
    </div>
  );
}

function EmptyEditor({ synced }: { synced: boolean }) {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center">
      {synced ? (
        <div className="max-w-xs">
          <p className="font-medium">No file open</p>
          <p className="mt-1 text-sm text-muted-foreground">Pick a file in the explorer, or create one with the + button above the file list.</p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Opening the room…</p>
      )}
    </div>
  );
}

function ActivityButton({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "relative flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
        active && "text-foreground",
      )}
    >
      {active && <span aria-hidden className="absolute inset-y-2 -left-2 w-thread rounded-full bg-brand" />}
      {children}
    </button>
  );
}
