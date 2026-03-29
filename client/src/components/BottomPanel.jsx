import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Play,
  ShieldOff,
  TerminalSquare,
  TriangleAlert,
} from "lucide-react";
import toast from "react-hot-toast";

import XTerminal from "./XTerminal";

const TABS = [
  { id: "console", label: "Console I/O", icon: Play },
  { id: "errors", label: "Errors", icon: TriangleAlert },
  { id: "terminal", label: "Terminal", icon: TerminalSquare },
];

const ANSI_ESCAPE_PATTERN = new RegExp(String.raw`\u001b\[[0-9;]*m`, "g");
const PANEL_DEFAULT_HEIGHT = 172;
const PANEL_MIN_HEIGHT = 132;
const PANEL_MAX_HEIGHT = 360;
const PANEL_HEIGHT_STORAGE_KEY = "codechatter-bottom-panel-height";

function getInitialPanelState(runResult, defaultMinimized) {
  const hasCompleted = runResult && runResult.status !== "running";
  const hasErrors = hasCompleted
    && (runResult.exitCode !== 0 || (runResult.stderr && runResult.stderr.trim().length > 0));

  return {
    activeTab: hasErrors ? "errors" : "console",
    isMinimized: hasCompleted ? false : defaultMinimized,
  };
}

export default function BottomPanel({
  runResult,
  stdin,
  roomId,
  onStdinChange,
  defaultMinimized = false,
  runEnabled = true,
  terminalEnabled = true,
}) {
  const initialPanelState = getInitialPanelState(runResult, defaultMinimized);
  const [activeTab, setActiveTab] = useState(initialPanelState.activeTab);
  const [isMinimized, setIsMinimized] = useState(initialPanelState.isMinimized);
  const [panelHeight, setPanelHeight] = useState(() => {
    if (typeof window === "undefined") {
      return PANEL_DEFAULT_HEIGHT;
    }

    const storedValue = Number(window.localStorage.getItem(PANEL_HEIGHT_STORAGE_KEY));
    if (!Number.isFinite(storedValue)) {
      return PANEL_DEFAULT_HEIGHT;
    }

    return Math.min(PANEL_MAX_HEIGHT, Math.max(PANEL_MIN_HEIGHT, storedValue));
  });
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(PANEL_HEIGHT_STORAGE_KEY, String(panelHeight));
  }, [panelHeight]);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
  }, []);

  const resize = useCallback((event) => {
    if (!panelRef.current) {
      return;
    }

    const panelBottom = panelRef.current.getBoundingClientRect().bottom;
    const nextHeight = panelBottom - event.clientY;
    const boundedHeight = Math.min(PANEL_MAX_HEIGHT, Math.max(PANEL_MIN_HEIGHT, nextHeight));
    setPanelHeight(boundedHeight);
  }, []);

  useEffect(() => {
    if (!isResizing) {
      return undefined;
    }

    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", resize);
    window.addEventListener("mouseup", stopResizing);

    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [isResizing, resize, stopResizing]);

  const handleCopy = async () => {
    const content = activeTab === "console"
      ? getPanelContent("output", runResult)
      : getPanelContent(activeTab, runResult);

    try {
      await navigator.clipboard.writeText(content);
      toast.success(`${TABS.find((tab) => tab.id === activeTab)?.label || "Panel"} copied`);
    } catch {
      toast.error("Could not copy panel content");
    }
  };

  const heightStyle = isMinimized ? { height: "40px" } : { height: `${panelHeight}px` };

  return (
    <div
      ref={panelRef}
      style={heightStyle}
      className={`relative flex flex-col border-t border-zinc-100 bg-[#0d0d10] transition-[height] ${
        isResizing ? "duration-0" : "duration-200"
      } dark:border-white/[0.04]`}
    >
      {!isMinimized && (
        <div
          onMouseDown={() => setIsResizing(true)}
          onDoubleClick={() => setPanelHeight(PANEL_DEFAULT_HEIGHT)}
          className="absolute left-0 top-0 z-20 h-2 w-full cursor-row-resize"
          title="Resize panel"
        >
          <div className={`mx-auto mt-0.5 h-px w-full transition-colors ${isResizing ? "bg-brand-500" : "bg-transparent hover:bg-zinc-700"}`} />
        </div>
      )}

      <div className="flex items-center justify-between gap-3 border-b border-white/[0.05] px-3 py-1.5">
        <div className="flex items-center gap-1 overflow-x-auto">
          {TABS.map((tab) => {
            const Icon = tab.icon;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                  activeTab === tab.id
                    ? "bg-white/[0.08] text-white"
                    : "text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100"
                }`}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          {runResult?.status === "running" ? (
            <div className="hidden text-xs text-amber-400 sm:block">
              Running...
            </div>
          ) : runResult ? (
            <div className="hidden items-center gap-3 text-xs sm:flex">
              {typeof runResult.runtimeMs === "number" && (
                <span className="text-zinc-500">
                  {runResult.runtimeMs}ms
                </span>
              )}
              {runResult.exitCode === 0 ? (
                <span className="inline-flex items-center gap-1 rounded bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium text-green-300">
                  Success
                </span>
              ) : runResult.exitCode !== null ? (
                <span className="inline-flex items-center gap-1 rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-300">
                  Exit {runResult.exitCode}
                </span>
              ) : null}
            </div>
          ) : null}

          <button
            onClick={handleCopy}
            className="rounded-md p-2 text-zinc-500 transition-colors hover:bg-white/[0.05] hover:text-zinc-100"
            title="Copy panel content"
          >
            <Copy size={15} />
          </button>

          <button
            onClick={() => setIsMinimized((current) => !current)}
            className="rounded-md p-2 text-zinc-500 transition-colors hover:bg-white/[0.05] hover:text-zinc-100"
            title={isMinimized ? "Expand panel" : "Minimize panel"}
          >
            {isMinimized ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
      </div>

      {!isMinimized && (
        <div className="min-h-0 flex-1 overflow-auto bg-[#111114] px-4 py-3 font-mono text-xs leading-6 text-zinc-300">
          {activeTab === "console" ? (
            <div className="flex h-full min-h-[96px] w-full flex-col gap-4 sm:flex-row">
              <div className="flex flex-1 flex-col">
                <label className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Standard Input
                </label>
                <textarea
                  value={stdin}
                  onChange={(event) => onStdinChange?.(event.target.value)}
                  placeholder="Optional stdin for the active file..."
                  disabled={!runEnabled}
                  className="w-full flex-1 resize-none rounded-md border border-white/[0.08] bg-black/20 px-3 py-3 font-mono text-xs outline-none transition focus:border-zinc-500"
                />
              </div>
              <div className="flex flex-1 flex-col">
                <label className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Execution Output
                </label>
                <div className="flex-1 overflow-auto rounded-md border border-white/[0.08] bg-black/20 px-3 py-3 font-mono text-xs">
                  <pre className="whitespace-pre-wrap break-words">
                    {getPanelContent("output", runResult)}
                  </pre>
                </div>
              </div>
            </div>
          ) : activeTab === "terminal" ? (
            <div className="h-full min-h-[96px] w-full">
              {terminalEnabled ? (
                <XTerminal roomId={roomId} />
              ) : (
                <div className="flex h-full min-h-[96px] flex-col items-center justify-center gap-3 rounded-md border border-dashed border-white/[0.08] bg-black/20 px-6 py-4 text-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-800 text-zinc-500">
                    <ShieldOff size={20} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-semibold text-zinc-300">Terminal Access Restricted</p>
                    <p className="text-xs text-zinc-500 max-w-[260px]">
                      You don&apos;t have terminal permission for this workspace. Ask the room owner to grant you editor access.
                    </p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <pre className="whitespace-pre-wrap break-words">{getPanelContent(activeTab, runResult)}</pre>
          )}
        </div>
      )}
    </div>
  );
}

function stripAnsi(str) {
  if (typeof str !== "string") {
    return str;
  }

  return str.replace(ANSI_ESCAPE_PATTERN, "");
}

function getPanelContent(tabId, runResult) {
  if (!runResult) {
    return "No output yet.";
  }

  if (tabId === "output") {
    return stripAnsi(runResult.stdout) || "No stdout.";
  }

  if (tabId === "errors") {
    return stripAnsi(runResult.stderr) || "No stderr.";
  }

  return [
    runResult.compileCommand ? `$ ${runResult.compileCommand}` : null,
    runResult.command ? `$ ${runResult.command}` : null,
    runResult.exitCode === null ? "Process did not complete normally." : `Exit code: ${runResult.exitCode}`,
    typeof runResult.runtimeMs === "number" ? `Duration: ${runResult.runtimeMs} ms` : null,
    runResult.phase ? `Phase: ${runResult.phase}` : null,
  ].filter(Boolean).join("\n");
}
