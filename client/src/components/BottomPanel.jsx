import { useState } from "react";
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

const TABS = [
  { id: "output", label: "Output", icon: Play },
  { id: "errors", label: "Errors", icon: TriangleAlert },
  { id: "terminal", label: "Terminal", icon: TerminalSquare },
  { id: "input", label: "Input", icon: Keyboard }
];

export default function BottomPanel({
  runResult,
  stdin,
  onStdinChange,
  defaultMinimized = false
}) {
  const [activeTab, setActiveTab] = useState("output");
  const [isMinimized, setIsMinimized] = useState(defaultMinimized);

  const handleCopy = async () => {
    const content = activeTab === "input" ? stdin : getPanelContent(activeTab, runResult);

    try {
      await navigator.clipboard.writeText(content);
      toast.success(`${TABS.find((tab) => tab.id === activeTab)?.label || "Panel"} copied`);
    } catch {
      toast.error("Could not copy panel content");
    }
  };

  return (
    <div
      className={`flex flex-col border-t border-zinc-200 bg-white transition-all duration-300 dark:border-zinc-800 dark:bg-zinc-950 ${
        isMinimized ? "h-11" : "h-48"
      }`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
        <div className="flex items-center gap-1 overflow-x-auto">
          {TABS.map((tab) => {
            const Icon = tab.icon;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                  activeTab === tab.id
                    ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-white"
                    : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-white"
                }`}
              >
                <Icon size={15} />
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          {runResult?.status === "running" && (
            <div className="hidden text-xs text-amber-600 dark:text-amber-400 sm:block">
              Running...
            </div>
          )}

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
          {activeTab === "input" ? (
            <textarea
              value={stdin}
              onChange={(event) => onStdinChange?.(event.target.value)}
              placeholder="Optional stdin for the active file..."
              className="h-full min-h-[120px] w-full resize-none rounded-md border border-zinc-200 bg-zinc-50 px-3 py-3 font-mono text-xs outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900"
            />
          ) : (
            <pre className="whitespace-pre-wrap break-words">{getPanelContent(activeTab, runResult)}</pre>
          )}
        </div>
      )}
    </div>
  );
}

function getPanelContent(tabId, runResult) {
  if (!runResult) {
    return tabId === "terminal"
      ? "Run the active file to see command output."
      : "No output yet.";
  }

  if (tabId === "output") {
    return runResult.stdout || "No stdout.";
  }

  if (tabId === "errors") {
    return runResult.stderr || "No stderr.";
  }

  return [
    runResult.compileCommand ? `$ ${runResult.compileCommand}` : null,
    runResult.command ? `$ ${runResult.command}` : null,
    runResult.exitCode === null ? "Process did not complete normally." : `Exit code: ${runResult.exitCode}`,
    typeof runResult.runtimeMs === "number" ? `Duration: ${runResult.runtimeMs} ms` : null,
    runResult.phase ? `Phase: ${runResult.phase}` : null
  ].filter(Boolean).join("\n");
}
