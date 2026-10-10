"use client";

import type { RoomSummary } from "@codechatter/contracts";
import { flatten, type TreeNode } from "@codechatter/workspace-model";
import { BookOpen, Columns2, Eye, FileCode2, Globe2, MessageSquare, Search, SquareTerminal, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { usePanelRef } from "react-resizable-panels";

import { BottomPanel, MAX_TERMINALS, type PanelTab } from "@/components/room/bottom-panel";
import { ChatPanel } from "@/components/room/chat-panel";
import { CodeEditor } from "@/components/room/code-editor";
import { useRoomTabs, useTabs } from "@/components/room/editor-store";
import type { PaletteCommand } from "@/components/room/editor/command-palette";
import { DiffView } from "@/components/room/editor/diff-view";
import { MarkdownPreview } from "@/components/room/editor/markdown-preview";
import { EditorOverlays } from "@/components/room/editor/overlays";
import { toggleSplit, toggleZen, useEditorUi } from "@/components/room/editor/ui-store";
import { useEditorShortcuts } from "@/components/room/editor/shortcuts";
import { useInlineCompletions } from "@/components/room/editor/use-inline-completions";
import { Explorer } from "@/components/room/explorer";
import { useFileTree, usePeers } from "@/components/room/hooks";
import { PeoplePanel } from "@/components/room/people-panel";
import { RoomProvider, useRoom } from "@/components/room/room-context";
import { RunButton } from "@/components/room/run-button";
import { canRunPath, RunProvider, useRun } from "@/components/room/run-context";
import { startSearch } from "@/components/room/search/search-store";
import { SearchView } from "@/components/room/search/search-view";
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
  useInlineCompletions();
  const run = useRun();
  const tree = useFileTree();
  const peers = usePeers();
  const tabs = useRoomTabs(room.id);
  const { open, close, prune } = useTabs();
  // The left sidebar: the file list or Search, or neither. Clicking the open one's icon closes it.
  const [sidebar, setSidebar] = useState<"files" | "search" | null>("files");
  const showFiles = sidebar === "files";
  /** Ctrl+Shift+F (seeded from the editor's selection), Ctrl+Shift+H, the palette and the activity bar. */
  const openSearch = (options: { seed?: boolean; replace?: boolean } = {}) => {
    useEditorUi.getState().setZen(false);
    setSidebar("search");
    startSearch(room.id, options);
  };
  const [right, setRight] = useSidePanel(room.id);
  const [unread, setUnread] = useState(0);
  const onUnread = useCallback((n: number) => setUnread(n), []);
  // Clicking the open panel's icon closes it; any other icon switches to it.
  const toggleRight = (panel: Right) => setRight((current) => (current === panel ? null : panel));
  // "Explain error" and "Fix" on the Run output open the AI with their question.
  useOpenAiOnRequest(() => setRight(AI_TOOL_ID));

  // Plug-in tools (components/room/tools/registry.ts).
  const tools = ROOM_TOOLS.filter((tool) => tool.visible?.(can) ?? true);
  const sideTools = tools.filter((tool) => tool.placement === "side");
  const mainTools = tools.filter((tool) => tool.placement === "main");
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
  const hasHtml = useMemo(
    () => [...files.values()].some((n) => n.kind === "file" && /\.html?$/i.test(n.name)),
    [files],
  );
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
  // is overridden); Ctrl+` opens a terminal. Keys typed into a terminal are its
  // own, and so is Ctrl+Enter in a tool that marks itself data-own-run-key (API
  // Studio sends, the database console runs its query).
  // Ctrl+Shift+F opens Search (Ctrl+Shift+H with replace), as in VS Code.
  const shortcuts = useRef({ runActive, openTerminal, openSearch });
  useEffect(() => {
    shortcuts.current = { runActive, openTerminal, openSearch };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const ownKey = (event.target as HTMLElement | null)?.closest?.(".xterm, [data-own-run-key]");
      if (event.key === "Enter" && !ownKey) {
        event.preventDefault();
        event.stopPropagation();
        shortcuts.current.runActive();
      } else if (event.key === "`") {
        event.preventDefault();
        shortcuts.current.openTerminal();
      } else if (event.shiftKey && /^[fh]$/i.test(event.key) && !ownKey) {
        event.preventDefault();
        event.stopPropagation();
        shortcuts.current.openSearch({ seed: true, replace: event.key.toLowerCase() === "h" });
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, []);
  useEditorShortcuts(activeFile?.id ?? null);

  // Editor layout from the editor's own store: split, Markdown preview, comparison, Zen mode, following someone.
  const editorUi = useEditorUi(
    useShallow((state) => ({
      zen: state.zen,
      markdownPreview: state.markdownPreview,
      following: state.following,
      splitFileId: state.splitFileId,
      diff: state.diff,
      setMarkdownPreview: state.setMarkdownPreview,
      setSplit: state.setSplit,
      setDiff: state.setDiff,
      follow: state.follow,
    })),
  );
  const { zen, markdownPreview, following } = editorUi;
  const splitFile = editorUi.splitFileId ? (files.get(editorUi.splitFileId) ?? null) : null;
  const isMarkdown = activeFile ? /\.(md|markdown)$/i.test(activeFile.name) : false;
  const diffLeft = editorUi.diff ? files.get(editorUi.diff.leftId) : undefined;
  const diffRight = editorUi.diff ? files.get(editorUi.diff.rightId) : undefined;
  const diffFiles = diffLeft && diffRight ? ([diffLeft, diffRight] as const) : null;
  // Leaving the room leaves its editor layout behind.
  useEffect(() => () => useEditorUi.getState().reset(), [room.id]);

  // Following someone: their file opens for you as they move between files.
  const followed = following ? peers.find((peer) => peer.user.id === following) : undefined;
  useEffect(() => {
    const id = followed?.activeFileId;
    if (id && id !== tabs.active && files.has(id)) open(room.id, id);
  }, [followed?.activeFileId, tabs.active, files, open, room.id]);

  // The room's commands, for the command palette (Ctrl+Shift+P).
  const roomCommands: PaletteCommand[] = [
    { id: "run", label: "Run the open file", shortcut: "Ctrl Enter", run: runActive },
    { id: "terminal", label: "Open a terminal", shortcut: "Ctrl `", run: openTerminal },
    {
      id: "files",
      label: showFiles ? "Hide the file list" : "Show the file list",
      run: () => setSidebar(showFiles ? null : "files"),
    },
    { id: "search", label: "Search in files", shortcut: "Ctrl Shift F", run: () => openSearch({ seed: true }) },
    ...(can("files.edit")
      ? [
          {
            id: "replace",
            label: "Replace in files",
            shortcut: "Ctrl Shift H",
            run: () => openSearch({ seed: true, replace: true }),
          },
        ]
      : []),
    { id: "chat", label: "Open chat", run: () => setRight("chat") },
    { id: "people", label: "See who's here", run: () => setRight("people") },
    ...sideTools.map((tool) => ({
      id: `side-${tool.id}`,
      label: `Open ${tool.label}`,
      run: () => setRight(tool.id),
    })),
    ...mainTools.map((tool) => ({
      id: `app-${tool.id}`,
      label: `Open ${tool.label}`,
      run: () => setMainToolId(tool.id),
    })),
  ];
  const threadsFor = (id: string) => peers.filter((p) => p.activeFileId === id).map((p) => p.user.slot);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <TitleBar
        actions={<RunButton file={activeFile} onRun={runActive} onPreview={openPreview} />}
        side={{
          panel: right,
          toggle: toggleRight,
          items: [
            { id: "chat", label: "Chat", icon: MessageSquare, badge: right === "chat" ? 0 : unread },
            ...sideTools.map((tool) => ({ id: tool.id, label: tool.label, icon: tool.icon })),
          ],
        }}
      />
      <div className="flex min-h-0 flex-1">
        {/* Activity bar: your code first, then the room's apps, terminals at the foot. Chat, People and AI open from the title bar. */}
        {!zen && (
          <nav
            aria-label="Panels"
            className="flex w-activitybar shrink-0 flex-col items-center gap-1 border-r bg-chrome py-2"
          >
            <ActivityButton label="Files" active={showFiles} onClick={() => setSidebar(showFiles ? null : "files")}>
              <FileCode2 className="size-[18px]" />
            </ActivityButton>
            <ActivityButton
              label="Search"
              active={sidebar === "search"}
              onClick={() => (sidebar === "search" ? setSidebar(null) : openSearch())}
            >
              <Search className="size-[18px]" />
            </ActivityButton>
            <span aria-hidden className="my-1 h-px w-6 bg-border" />
            <div role="group" aria-label="Apps" className="flex flex-col items-center gap-1">
              {mainTools.map((tool) => {
                const active = mainToolId === tool.id;
                return (
                  <ActivityButton
                    key={tool.id}
                    label={tool.label}
                    active={active}
                    onClick={() => setMainToolId(active ? null : tool.id)}
                  >
                    <tool.icon className="size-[18px]" />
                  </ActivityButton>
                );
              })}
            </div>
            <div className="mt-auto">
              <ActivityButton
                label={panelOpen ? "Hide output and terminals" : "Output and terminals"}
                active={panelOpen}
                onClick={() => (panelOpen ? panel.current?.collapse() : openTerminal())}
              >
                <SquareTerminal className="size-[18px]" />
                {run.running && !panelOpen && (
                  <span className="absolute top-1.5 right-1.5 size-2 animate-pulse rounded-full bg-brand" />
                )}
              </ActivityButton>
            </div>
          </nav>
        )}

        <ResizablePanelGroup orientation="horizontal" className="min-w-0 flex-1">
          {sidebar && !zen && (
            <>
              <ResizablePanel id="explorer" defaultSize={248} minSize={180} maxSize={480}>
                {!synced ? (
                  <PanelSkeleton />
                ) : sidebar === "search" ? (
                  <SearchView onOpen={openFile} />
                ) : (
                  <Explorer activeFileId={activeFile?.id ?? null} onOpen={openFile} />
                )}
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
                        <ToolHost
                          tool={mainTool}
                          activeFile={activeFile}
                          openFile={openFileById}
                          close={() => setMainToolId(null)}
                        />
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
                            <>
                              {isMarkdown && (
                                <Button
                                  size="xs"
                                  variant={markdownPreview !== "off" ? "secondary" : "ghost"}
                                  aria-pressed={markdownPreview !== "off"}
                                  title="Markdown preview (Ctrl+K V beside, Ctrl+Shift+V on its own)"
                                  onClick={() =>
                                    editorUi.setMarkdownPreview(markdownPreview === "off" ? "side" : "off")
                                  }
                                >
                                  <BookOpen /> Markdown preview
                                </Button>
                              )}
                              {hasHtml && (
                                <Button
                                  size="xs"
                                  variant={previewOpen ? "secondary" : "ghost"}
                                  aria-pressed={previewOpen}
                                  onClick={togglePreview}
                                >
                                  <Globe2 /> Preview
                                </Button>
                              )}
                              {activeFile && (
                                <Button
                                  size="icon-xs"
                                  variant={splitFile ? "secondary" : "ghost"}
                                  aria-label={splitFile ? "Close the split editor" : "Split editor"}
                                  aria-pressed={Boolean(splitFile)}
                                  title="Split editor (Ctrl+\)"
                                  onClick={() => toggleSplit(activeFile.id)}
                                >
                                  <Columns2 />
                                </Button>
                              )}
                            </>
                          }
                        />
                        {followed && (
                          <div
                            role="status"
                            className="flex h-7 shrink-0 items-center gap-2 border-b bg-brand-muted/40 px-3 text-xs"
                          >
                            <Eye className="size-3.5" /> Following {followed.user.name}: their file opens for
                            you as they move.
                            <button
                              type="button"
                              className="ml-auto font-medium underline-offset-2 hover:underline"
                              onClick={() => editorUi.follow(null)}
                            >
                              Stop following
                            </button>
                          </div>
                        )}
                        <div className="min-h-0 flex-1">
                          {diffFiles ? (
                            <DiffView
                              left={diffFiles[0]}
                              right={diffFiles[1]}
                              onClose={() => editorUi.setDiff(null)}
                            />
                          ) : !activeFile ? (
                            <EmptyEditor synced={synced} />
                          ) : isMarkdown && markdownPreview === "full" ? (
                            <MarkdownPreview
                              fileId={activeFile.id}
                              name={activeFile.name}
                              mode="full"
                              onMode={editorUi.setMarkdownPreview}
                            />
                          ) : (isMarkdown && markdownPreview === "side") || splitFile ? (
                            <ResizablePanelGroup orientation="horizontal">
                              <ResizablePanel id="pane-primary" minSize={200}>
                                <CodeEditor file={activeFile} role="primary" />
                              </ResizablePanel>
                              <ResizableHandle />
                              <ResizablePanel id="pane-second" minSize={200}>
                                {isMarkdown && markdownPreview === "side" ? (
                                  <MarkdownPreview
                                    fileId={activeFile.id}
                                    name={activeFile.name}
                                    mode="side"
                                    onMode={editorUi.setMarkdownPreview}
                                  />
                                ) : splitFile ? (
                                  <SplitPane file={splitFile} onClose={() => editorUi.setSplit(null)} />
                                ) : null}
                              </ResizablePanel>
                            </ResizablePanelGroup>
                          ) : (
                            <CodeEditor file={activeFile} role="primary" />
                          )}
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
                    {previewOpen && (
                      <WebPreview
                        preferred={activeFile?.path ?? null}
                        onClose={() => previewPanel.current?.collapse()}
                      />
                    )}
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
          {right && !zen && (
            <>
              <ResizableHandle />
              <ResizablePanel id="right" defaultSize={300} minSize={240} maxSize={460}>
                <div className="flex h-full min-h-0 flex-col bg-panel">
                  <div
                    role="tablist"
                    aria-label="Side panel"
                    className="flex h-9 shrink-0 items-stretch gap-4 border-b px-3"
                  >
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
                          right === tab.id
                            ? "text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {tab.label}
                        {right === tab.id && (
                          <span aria-hidden className="absolute inset-x-0 -bottom-px h-[2px] bg-brand" />
                        )}
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
                          <ToolHost
                            tool={tool}
                            activeFile={activeFile}
                            openFile={openFileById}
                            close={() => setRight(null)}
                          />
                        </div>
                      ),
                  )}
                </div>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>
      {zen ? (
        <Button
          variant="outline"
          size="xs"
          className="fixed right-3 bottom-3 z-50 bg-background"
          onClick={toggleZen}
        >
          Leave Zen mode <span className="text-muted-foreground">Ctrl K Z</span>
        </Button>
      ) : (
        <StatusBar file={activeFile} />
      )}
      <EditorOverlays openFile={openFile} activeFile={activeFile} commands={roomCommands} />
    </div>
  );
}

/** The right panel (Chat, People, AI), remembered per room on this device. Closed until you open it, so code gets the room. */
function useSidePanel(
  roomId: string,
): [Right | null, (next: Right | null | ((current: Right | null) => Right | null)) => void] {
  const key = `cc:side:${roomId}`;
  const [value, setValue] = useState<Right | null>(() => {
    try {
      return localStorage.getItem(key) || null;
    } catch {
      return null;
    }
  });
  const set = useCallback(
    (next: Right | null | ((current: Right | null) => Right | null)) =>
      setValue((current) => {
        const resolved = typeof next === "function" ? next(current) : next;
        try {
          if (resolved) localStorage.setItem(key, resolved);
          else localStorage.removeItem(key);
        } catch {
          // Storage can be off (private windows); the panel still works for this visit.
        }
        return resolved;
      }),
    [key],
  );
  return [value, set];
}

/** The second editor, beside the first: any file, so you can read one while writing another. */
function SplitPane({ file, onClose }: { file: TreeNode; onClose: () => void }) {
  const change = () => {
    const ui = useEditorUi.getState();
    ui.open({
      kind: "pickFile",
      title: "Show in the split",
      exclude: null,
      onPick: (picked) => ui.setSplit(picked.id),
    });
  };
  return (
    <section aria-label={`Split editor: ${file.path}`} className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b bg-chrome pr-1 pl-3 text-xs">
        <span className="truncate">{file.path}</span>
        <Button variant="ghost" size="xs" className="ml-auto" onClick={change}>
          Change file
        </Button>
        <Button variant="ghost" size="icon-xs" aria-label="Close the split editor" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <CodeEditor file={file} role="split" />
      </div>
    </section>
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
          <p className="mt-1 text-sm text-muted-foreground">
            Pick a file in the explorer, or create one with the + button above the file list.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Opening the room…</p>
      )}
    </div>
  );
}

function ActivityButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
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
