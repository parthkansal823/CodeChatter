"use client";

import type { RoomSummary } from "@codechatter/contracts";
import { flatten, isNotebookName, languageFor, textOf, type TreeNode } from "@codechatter/workspace-model";
import {
  BookOpen,
  Columns2,
  Eye,
  FileCode2,
  Globe2,
  Image as ImageIcon,
  Bug,
  GitBranch,
  ListTree,
  Rows2,
  SquareX,
  MessageSquare,
  Search,
  SquareTerminal,
  Table2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { usePanelRef } from "react-resizable-panels";

import { BottomPanel, MAX_TERMINALS, type PanelTab, type RunningTask } from "@/components/room/bottom-panel";
import { ChatPanel } from "@/components/room/chat-panel";
import { CodeEditor } from "@/components/room/code-editor";
import { useRoomTabs, useTabs } from "@/components/room/editor-store";
import type { PaletteCommand } from "@/components/room/editor/command-palette";
import { DiffView } from "@/components/room/editor/diff-view";
import { FilePreview } from "@/components/room/editor/file-preview";
import { previewKindOf, PREVIEW_LABEL } from "@/components/room/editor/preview-kind";
import { connectDebugger, step, stopDebugging, useDebug } from "@/components/room/debug/debug-store";
import { DebugView } from "@/components/room/debug/debug-view";
import { startPicked } from "@/components/room/debug/start";
import { OutlineView } from "@/components/room/editor/outline-view";
import { EditorOverlays } from "@/components/room/editor/overlays";
import { useEditorSettings } from "@/components/room/editor/settings-store";
import {
  closeSplits,
  splitDown,
  toggleSplit,
  toggleZen,
  useEditorUi,
  type SplitSlot,
} from "@/components/room/editor/ui-store";
import {
  LSP_LANGUAGES,
  startLanguageClient,
  stopLanguageClients,
} from "@/components/room/editor/language-client";
import { setEditorOpener } from "@/components/room/editor/editor-opener";
import { revealInFile, type RevealRange } from "@/components/room/editor/reveal";
import { useProblems } from "@/components/room/editor/problems";
import { setFormatRoom } from "@/components/room/editor/sandbox-format";
import { useSettingsSync } from "@/components/room/editor/settings-sync";
import { buildTask, readTasks, taskInput, TASKS_PATH, type Task } from "@/components/room/editor/tasks";
import { clearRoomFiles, mirrorRoomFiles } from "@/components/room/editor/workspace-fs";
import { useEditorShortcuts } from "@/components/room/editor/shortcuts";
import { useInlineCompletions } from "@/components/room/editor/use-inline-completions";
import { Explorer } from "@/components/room/explorer";
import { runAll } from "@/components/room/notebook/kernel";
import { NotebookView } from "@/components/room/notebook/notebook-view";
import { useFileTree, usePeers } from "@/components/room/hooks";
import { PeoplePanel } from "@/components/room/people-panel";
import { ensureMonaco } from "@/components/room/monaco-setup";
import { RoomProvider, useRoom } from "@/components/room/room-context";
import { RunButton } from "@/components/room/run-button";
import { canRunPath, RunProvider, useRun } from "@/components/room/run-context";
import { startSearch } from "@/components/room/search/search-store";
import { SearchView } from "@/components/room/search/search-view";
import { PullRequestView } from "@/components/room/source-control/pull-request-view";
import { GistDialog } from "@/components/room/source-control/gist-dialog";
import { RepoDiffView } from "@/components/room/source-control/repo-diff-view";
import { SourceControlView } from "@/components/room/source-control/source-control-view";
import { useRoomRepo } from "@/components/room/source-control/use-repo";
import { StatusBar } from "@/components/room/status-bar";
import { TaskPicker } from "@/components/room/task-picker";
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
  const { room, doc, synced, can } = useRoom();
  useInlineCompletions();
  // Your editor settings and themes, from and to your account.
  useSettingsSync();
  // What the language servers and TypeScript report: the Problems tab and the status bar's counts.
  const problems = useProblems();
  // Format document for Python, C, C++, shell, Go and Rust goes to this room's sandbox.
  useEffect(() => {
    setFormatRoom(room.id);
    return () => setFormatRoom(null);
  }, [room.id]);
  const run = useRun();
  const tree = useFileTree();
  const peers = usePeers();
  const tabs = useRoomTabs(room.id);
  const { open, close, prune } = useTabs();
  // The left sidebar: the file list, Search, the Outline or Source control, or none. Clicking the open one's icon closes it.
  const [sidebar, setSidebar] = useState<"files" | "search" | "outline" | "scm" | "debug" | null>("files");
  // Source control: for a room on GitHub, and publishing one that isn't.
  const repo = useRoomRepo();
  const [gistOpen, setGistOpen] = useState(false);
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

  // IntelliSense from the sandbox's language servers, for people who write code here, from
  // the first file in a language that has one; it runs until they leave the room.
  const canEdit = can("files.edit");
  const activeLanguage = activeFile ? languageFor(activeFile.name) : null;
  useEffect(() => {
    const language = LSP_LANGUAGES.find((l) => l === activeLanguage);
    if (canEdit && language) void startLanguageClient(room.id, language);
  }, [canEdit, activeLanguage, room.id]);
  useEffect(() => () => void stopLanguageClients(), [room.id]);

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
  // Go to definition and the like into another file: open its tab at that place.
  const openAt = useRef<(path: string, range: RevealRange) => boolean>(() => false);
  useEffect(() => {
    openAt.current = (path, range) => {
      const node = [...files.values()].find((n) => n.kind === "file" && n.path === path);
      if (!node) return false;
      openFile(node);
      revealInFile(node, range);
      return true;
    };
  });
  useEffect(() => {
    setEditorOpener((path, range) => openAt.current(path, range));
    return () => setEditorOpener(null);
  }, []);
  // Every room file, readable by the editor's services (for definitions in files nobody has open).
  useEffect(() => {
    if (synced) void ensureMonaco().then(() => mirrorRoomFiles(doc, [...files.values()]));
  }, [synced, files, doc]);
  useEffect(() => () => clearRoomFiles(), [room.id]);

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
    if (!activeFile || !can("code.run")) return;
    // A notebook runs in its own kernel, cell by cell: Run is Run all.
    if (isNotebookName(activeFile.name)) return void runAll(room.id, doc, activeFile.id);
    if (!canRunPath(activeFile.path)) return;
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

  // Tasks (.vscode/tasks.json and npm scripts) run in your Task terminal, one at a time.
  const [task, setTask] = useState<RunningTask | null>(null);
  const [taskPicker, setTaskPicker] = useState<{ title: string; tasks: Task[] } | null>(null);
  const roomTasks = () =>
    readTasks(
      [...files.values()]
        .filter((n) => n.kind === "file" && (n.path === TASKS_PATH || n.name === "package.json"))
        .map((n) => ({ path: n.path, text: textOf(doc, n.id)?.toString() ?? "" })),
      { activePath: activeFile?.path ?? null },
    );
  const runTask = (picked: Task) => {
    if (!can("terminal.open")) return;
    // A new id per run, so the Task terminal types the line again even for the same task.
    setTask((prev) => ({ label: picked.label, input: taskInput(picked), id: (prev?.id ?? 0) + 1 }));
    showPanel("task");
  };
  const pickTask = () => setTaskPicker({ title: "Run task", tasks: roomTasks() });
  /** Ctrl+Shift+B: the default build task, or a choice of the build tasks (or of every task when none is marked build). */
  const runBuildTask = () => {
    if (!can("terminal.open")) return;
    const tasks = roomTasks();
    const build = buildTask(tasks);
    if (build) return runTask(build);
    const builds = tasks.filter((t) => t.group === "build");
    setTaskPicker({ title: "Run build task", tasks: builds.length ? builds : tasks });
  };
  const closeTask = () => {
    setTask(null);
    if (panelTab === "task") setPanelTab("output");
  };

  // Ctrl/Cmd+Enter runs the open file from anywhere (Monaco's own Ctrl+Enter
  // is overridden); Ctrl+` opens a terminal. Keys typed into a terminal are its
  // own, and so is Ctrl+Enter in a tool that marks itself data-own-run-key (API
  // Studio sends, the database console runs its query).
  // Ctrl+Shift+F opens Search (Ctrl+Shift+H with replace), as in VS Code.
  const openSourceControl = () => {
    useEditorUi.getState().setZen(false);
    setSidebar("scm");
  };
  // F5 starts debugging the open file, or continues; Shift+F5 stops; F6 pauses; F10, F11
  // and Shift+F11 step over, into and out, as in VS Code (F9, a breakpoint, is the editor's).
  const debugKey = (event: KeyboardEvent): boolean => {
    if (!can("code.run") || event.ctrlKey || event.metaKey || event.altKey) return false;
    const session = useDebug.getState().session;
    const paused = session?.state === "stopped";
    if (event.key === "F5" && event.shiftKey) {
      if (!session) return false;
      stopDebugging();
    } else if (event.key === "F5") {
      if (session) {
        if (paused) void step("continue");
      } else if (startPicked(doc, activeFile?.path ?? null)) {
        // The configuration picked in Run and debug, else the open file.
        setSidebar("debug");
      } else return false;
    } else if (event.key === "F6" && session && !paused) void step("pause");
    else if (event.key === "F10" && paused) void step("next");
    else if (event.key === "F11" && paused) void step(event.shiftKey ? "stepOut" : "stepIn");
    else return false;
    return true;
  };
  const debugConsole = () => {
    if (sidebar === "debug") showPanel("debug");
  };
  const shortcuts = useRef({
    runActive,
    openTerminal,
    openSearch,
    runBuildTask,
    openSourceControl,
    debugKey,
    debugConsole,
  });
  useEffect(() => {
    shortcuts.current = {
      runActive,
      openTerminal,
      openSearch,
      runBuildTask,
      openSourceControl,
      debugKey,
      debugConsole,
    };
  });
  // Everyone in the room follows its debugger, so a session anyone starts shows for all;
  // with Run and debug open, a session starting opens the Debug console under the editor.
  useEffect(() => {
    const disconnect = connectDebugger(room.id);
    const stopWatching = useDebug.subscribe((state, before) => {
      if (state.session && !before.session) shortcuts.current.debugConsole();
    });
    return () => {
      stopWatching();
      disconnect();
    };
  }, [room.id]);
  const debugging = useDebug((s) => s.session !== null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (/^F(5|6|10|11)$/.test(event.key) && shortcuts.current.debugKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const ownKey = (event.target as HTMLElement | null)?.closest?.(".xterm, [data-own-run-key]");
      if (event.key === "Enter" && !ownKey) {
        event.preventDefault();
        event.stopPropagation();
        shortcuts.current.runActive();
      } else if (event.key === "`") {
        event.preventDefault();
        shortcuts.current.openTerminal();
      } else if (event.shiftKey && event.key.toLowerCase() === "b") {
        // Ctrl+Shift+B, as in VS Code (Edge would show its favourites bar).
        event.preventDefault();
        event.stopPropagation();
        shortcuts.current.runBuildTask();
      } else if (event.shiftKey && event.key.toLowerCase() === "g" && !ownKey) {
        // Ctrl+Shift+G, as in VS Code.
        event.preventDefault();
        event.stopPropagation();
        shortcuts.current.openSourceControl();
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
      filePreview: state.filePreview,
      following: state.following,
      splitFileId: state.splitFileId,
      splitBelowId: state.splitBelowId,
      splitBelowRightId: state.splitBelowRightId,
      diff: state.diff,
      repoDiff: state.repoDiff,
      pullRequest: state.pullRequest,
      setFilePreview: state.setFilePreview,
      setSplit: state.setSplit,
      setDiff: state.setDiff,
      setRepoDiff: state.setRepoDiff,
      setPullRequest: state.setPullRequest,
      follow: state.follow,
    })),
  );
  const { zen, filePreview, following } = editorUi;
  // The editor grid: up to three more editors, right, below and below right.
  const splitFile = editorUi.splitFileId ? (files.get(editorUi.splitFileId) ?? null) : null;
  const splitBelow = editorUi.splitBelowId ? (files.get(editorUi.splitBelowId) ?? null) : null;
  const splitBelowRight = editorUi.splitBelowRightId ? (files.get(editorUi.splitBelowRightId) ?? null) : null;
  const anySplit = Boolean(splitFile || splitBelow || splitBelowRight);
  // Markdown, CSV and SVG files have a preview (beside the code, or on its own).
  const previewKind = activeFile ? previewKindOf(activeFile.name) : null;
  const isNotebook = activeFile ? isNotebookName(activeFile.name) : false;
  const breadcrumbs = useEditorSettings((state) => state.breadcrumbs);
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
    {
      id: "search",
      label: "Search in files",
      shortcut: "Ctrl Shift F",
      run: () => openSearch({ seed: true }),
    },
    { id: "problems", label: "Show problems", run: () => showPanel("problems") },
    ...(can("terminal.open")
      ? [
          { id: "task", label: "Run task…", run: pickTask },
          { id: "build-task", label: "Run build task", shortcut: "Ctrl Shift B", run: runBuildTask },
        ]
      : []),
    {
      id: "outline",
      label: sidebar === "outline" ? "Hide the outline" : "Show the outline",
      run: () => setSidebar(sidebar === "outline" ? null : "outline"),
    },
    {
      id: "source-control",
      label: repo === null ? "Publish the room to GitHub" : "Show source control",
      shortcut: "Ctrl Shift G",
      run: () => setSidebar("scm"),
    },
    ...(activeFile
      ? [{ id: "gist", label: "Share the file as a GitHub gist…", run: () => setGistOpen(true) }]
      : []),
    {
      id: "breadcrumbs",
      label: breadcrumbs ? "Hide breadcrumbs" : "Show breadcrumbs",
      run: () => useEditorSettings.getState().update({ breadcrumbs: !breadcrumbs }),
    },
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
            <ActivityButton
              label="Files"
              active={showFiles}
              onClick={() => setSidebar(showFiles ? null : "files")}
            >
              <FileCode2 className="size-[18px]" />
            </ActivityButton>
            <ActivityButton
              label="Search"
              active={sidebar === "search"}
              onClick={() => (sidebar === "search" ? setSidebar(null) : openSearch())}
            >
              <Search className="size-[18px]" />
            </ActivityButton>
            <ActivityButton
              label="Outline"
              active={sidebar === "outline"}
              onClick={() => setSidebar(sidebar === "outline" ? null : "outline")}
            >
              <ListTree className="size-[18px]" />
            </ActivityButton>
            <ActivityButton
              label="Source control"
              active={sidebar === "scm"}
              onClick={() => setSidebar(sidebar === "scm" ? null : "scm")}
            >
              <GitBranch className="size-[18px]" />
            </ActivityButton>
            <ActivityButton
              label="Run and debug"
              active={sidebar === "debug"}
              onClick={() => setSidebar(sidebar === "debug" ? null : "debug")}
            >
              <Bug className="size-[18px]" />
              {debugging && sidebar !== "debug" && (
                <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-brand" />
              )}
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
                ) : sidebar === "outline" ? (
                  <OutlineView />
                ) : sidebar === "scm" ? (
                  <SourceControlView onOpen={openFile} />
                ) : sidebar === "debug" ? (
                  <DebugView activeFile={activeFile} />
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
                              {previewKind && (
                                <Button
                                  size="xs"
                                  variant={filePreview !== "off" ? "secondary" : "ghost"}
                                  aria-pressed={filePreview !== "off"}
                                  title={`${PREVIEW_LABEL[previewKind]} (Ctrl+K V beside, Ctrl+Shift+V on its own)`}
                                  onClick={() =>
                                    editorUi.setFilePreview(filePreview === "off" ? "side" : "off")
                                  }
                                >
                                  {previewKind === "table" ? (
                                    <Table2 />
                                  ) : previewKind === "image" ? (
                                    <ImageIcon />
                                  ) : (
                                    <BookOpen />
                                  )}{" "}
                                  {PREVIEW_LABEL[previewKind]}
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
                              {activeFile && (
                                <Button
                                  size="icon-xs"
                                  variant="ghost"
                                  aria-label="Split down"
                                  title="Split editor down: below this one, then below the right one"
                                  onClick={() => splitDown(activeFile.id)}
                                >
                                  <Rows2 />
                                </Button>
                              )}
                              {anySplit && (
                                <Button
                                  size="icon-xs"
                                  variant="ghost"
                                  aria-label="Close all split editors"
                                  title="Back to one editor"
                                  onClick={closeSplits}
                                >
                                  <SquareX />
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
                          {editorUi.pullRequest ? (
                            <PullRequestView
                              number={editorUi.pullRequest}
                              onClose={() => editorUi.setPullRequest(null)}
                            />
                          ) : editorUi.repoDiff ? (
                            <RepoDiffView
                              path={editorUi.repoDiff}
                              onClose={() => editorUi.setRepoDiff(null)}
                            />
                          ) : diffFiles ? (
                            <DiffView
                              left={diffFiles[0]}
                              right={diffFiles[1]}
                              onClose={() => editorUi.setDiff(null)}
                            />
                          ) : !activeFile ? (
                            <EmptyEditor synced={synced} />
                          ) : previewKind && filePreview === "full" ? (
                            <FilePreview
                              file={activeFile}
                              kind={previewKind}
                              mode="full"
                              onMode={editorUi.setFilePreview}
                            />
                          ) : (
                            <EditorGrid
                              main={
                                isNotebook ? (
                                  <NotebookView file={activeFile} />
                                ) : (
                                  <CodeEditor file={activeFile} role="primary" />
                                )
                              }
                              preview={
                                previewKind && filePreview === "side" ? (
                                  <FilePreview
                                    file={activeFile}
                                    kind={previewKind}
                                    mode="side"
                                    onMode={editorUi.setFilePreview}
                                  />
                                ) : null
                              }
                              right={splitFile}
                              below={splitBelow}
                              belowRight={splitBelowRight}
                            />
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
                  problems={problems}
                  task={task}
                  onCloseTask={closeTask}
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
        <StatusBar file={activeFile} problems={problems} onProblems={() => showPanel("problems")} />
      )}
      <EditorOverlays openFile={openFile} activeFile={activeFile} commands={roomCommands} />
      {taskPicker && (
        <TaskPicker
          title={taskPicker.title}
          tasks={taskPicker.tasks}
          onRun={runTask}
          onClose={() => setTaskPicker(null)}
        />
      )}
      <GistDialog file={activeFile} open={gistOpen} onOpenChange={setGistOpen} />
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

const SLOT_LABEL: Record<SplitSlot, string> = {
  right: "Split editor",
  below: "Editor below",
  belowRight: "Editor below right",
};
const SLOT_ROLE = { right: "split", below: "split-below", belowRight: "split-below-right" } as const;

/** One of the grid's other editors: any file, so you can read one while writing another. */
function SplitPane({ slot, file }: { slot: SplitSlot; file: TreeNode }) {
  const ui = useEditorUi.getState;
  const change = () =>
    ui().open({
      kind: "pickFile",
      title: "Show in this editor",
      exclude: null,
      onPick: (picked) => ui().setSplitSlot(slot, picked.id),
    });
  const closeLabel =
    slot === "right" ? "Close the split editor" : `Close the ${SLOT_LABEL[slot].toLowerCase()}`;
  return (
    <section aria-label={`${SLOT_LABEL[slot]}: ${file.path}`} className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b bg-chrome pr-1 pl-3 text-xs">
        <span className="truncate">{file.path}</span>
        <Button variant="ghost" size="xs" className="ml-auto" onClick={change}>
          Change file
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={closeLabel}
          onClick={() => ui().setSplitSlot(slot, null)}
        >
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <CodeEditor file={file} role={SLOT_ROLE[slot]} />
      </div>
    </section>
  );
}

/**
 * The editors in VS Code's grid: the main one (top left), the preview or a split on its
 * right, one below it, and one below the right one. Columns and rows resize.
 */
function EditorGrid({
  main,
  preview,
  right,
  below,
  belowRight,
}: {
  main: ReactNode;
  preview: ReactNode;
  right: TreeNode | null;
  below: TreeNode | null;
  belowRight: TreeNode | null;
}) {
  const stack = (id: string, top: ReactNode, bottom: ReactNode) => (
    <ResizablePanelGroup orientation="vertical">
      <ResizablePanel id={`${id}-top`} minSize={100}>
        {top}
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel id={`${id}-bottom`} minSize={100}>
        {bottom}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
  const left = below ? stack("grid-left", main, <SplitPane slot="below" file={below} />) : main;
  const rightTop = preview ?? (right ? <SplitPane slot="right" file={right} /> : null);
  const rightBottom = belowRight ? <SplitPane slot="belowRight" file={belowRight} /> : null;
  const rightColumn =
    rightTop && rightBottom ? stack("grid-right", rightTop, rightBottom) : (rightTop ?? rightBottom);
  if (!rightColumn) return <>{left}</>;
  return (
    <ResizablePanelGroup orientation="horizontal">
      <ResizablePanel id="grid-left" minSize={200}>
        {left}
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel id="grid-right" minSize={200}>
        {rightColumn}
      </ResizablePanel>
    </ResizablePanelGroup>
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
