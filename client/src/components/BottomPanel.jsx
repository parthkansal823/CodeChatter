import { useState, useEffect } from "react";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Keyboard,
  Play,
  TerminalSquare,
  TriangleAlert
} from "lucide-react";
import toast from "react-hot-toast";
import XTerminal from "./XTerminal";

const TABS = [
  { id: "console", label: "Console I/O", icon: Play },
  { id: "errors", label: "Errors", icon: TriangleAlert },
  { id: "terminal", label: "Terminal", icon: TerminalSquare }
];

export default function BottomPanel({
  runResult,
  stdin,
  roomId,
  onStdinChange,
  defaultMinimized = false
}) {
  const [activeTab, setActiveTab] = useState("console");
  const [isMinimized, setIsMinimized] = useState(defaultMinimized);

  useEffect(() => {
    if (runResult && runResult.status !== "running") {
      if (runResult.exitCode !== 0 || (runResult.stderr && runResult.stderr.trim().length > 0)) {
        setActiveTab("errors");
        setIsMinimized(false);
      } else {
        setActiveTab("console");
        setIsMinimized(false);
      }
    }
  }, [runResult]);

  const handleCopy = async () => {
    const content = activeTab === "console" ? getPanelContent("output", runResult) : getPanelContent(activeTab, runResult);

    try {
      await navigator.clipboard.writeText(content);
      toast.success(`${TABS.find((tab) => tab.id === activeTab)?.label || "Panel"} copied`);
    } catch {
      toast.error("Could not copy panel content");
    }
  };

  return (
    <div
      className={`flex flex-col border-t border-zinc-100 bg-[#fafafa] transition-all duration-300 dark:border-white/[0.04] dark:bg-[#0f0f11] ${
        isMinimized ? "h-11" : "h-48"
      }`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-3 py-1.5 dark:border-white/[0.04]">
        <div className="flex items-center gap-1 overflow-x-auto">
          {TABS.map((tab) => {
            const Icon = tab.icon;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                  activeTab === tab.id
                    ? "bg-zinc-200/50 text-zinc-900 dark:bg-white/10 dark:text-white"
                    : "text-zinc-500 hover:bg-zinc-200/50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-200"
                }`}
              >
                <Icon size={15} />
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          {runResult?.status === "running" ? (
            <div className="hidden text-xs text-amber-600 dark:text-amber-400 sm:block">
              Running...
            </div>
          ) : runResult ? (
            <div className="hidden items-center gap-3 text-xs sm:flex">
              {typeof runResult.runtimeMs === "number" && (
                <span className="text-zinc-500 dark:text-zinc-400">
                  {runResult.runtimeMs}ms
                </span>
              )}
              {runResult.exitCode === 0 ? (
                <span className="inline-flex items-center gap-1 rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-500/15 dark:text-green-400">
                  ✓ Success
                </span>
              ) : runResult.exitCode !== null ? (
                <span className="inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-500/15 dark:text-red-400">
                  ✗ Exit {runResult.exitCode}
                </span>
              ) : null}
            </div>
          ) : null}

          <button
            onClick={handleCopy}
            className="rounded-md p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-white"
            title="Copy panel content"
          >
            <Copy size={16} />
          </button>

          <button
            onClick={() => setIsMinimized((current) => !current)}
            className="rounded-md p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-white"
            title={isMinimized ? "Expand panel" : "Minimize panel"}
          >
            {isMinimized ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {!isMinimized && (
        <div className="min-h-0 flex-1 overflow-auto bg-white px-4 py-3 font-mono text-xs leading-6 text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
          {activeTab === "console" ? (
            <div className="flex h-full min-h-[120px] w-full flex-col gap-4 sm:flex-row">
              <div className="flex flex-1 flex-col">
                <label className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Standard Input</label>
                <textarea
                  value={stdin}
                  onChange={(event) => onStdinChange?.(event.target.value)}
                  placeholder="Optional stdin for the active file..."
                  className="w-full flex-1 resize-none rounded-md border border-zinc-200 bg-zinc-50 px-3 py-3 font-mono text-xs outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900"
                />
              </div>
              <div className="flex flex-1 flex-col">
                <label className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Execution Output</label>
                <div className="flex-1 overflow-auto rounded-md border border-zinc-200 bg-zinc-50 px-3 py-3 font-mono text-xs dark:border-zinc-800 dark:bg-zinc-900">
                  <pre className="whitespace-pre-wrap break-words">{getPanelContent("output", runResult)}</pre>
                </div>
              </div>
            </div>
          ) : activeTab === "terminal" ? (
            <div className="h-full min-h-[120px] w-full">
              <XTerminal roomId={roomId} />
            </div>
          ) : (
            <pre className="whitespace-pre-wrap break-words">{getPanelContent(activeTab, runResult)}</pre>
          )}
        </div>
      )}
    </div>
  );
}

const stripAnsi = (str) => {
  if (typeof str !== "string") return str;
  return str.replace(/\x1b\[[0-9;]*m/g, "");
};

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
    runResult.phase ? `Phase: ${runResult.phase}` : null
  ].filter(Boolean).join("\n");
}
