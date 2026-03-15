import { Copy, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { useState } from "react";

export default function BottomPanel() {

  const [activeTab, setActiveTab] = useState("output");
  const [output, setOutput] = useState("$ Ready to run code...\n");
  const [isMinimized, setIsMinimized] = useState(false);

  const handleClear = () => {
    setOutput("$ Ready to run code...\n");
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(output);
    alert("Output copied to clipboard!");
  };

  const tabs = [
    { id: "output", label: "Output", icon: "▶" },
    { id: "errors", label: "Errors", icon: "⚠" },
    { id: "terminal", label: "Terminal", icon: "$" },
    { id: "input", label: "Input", icon: "⌨" }
  ];

  return (
    <div
      className={`border-t transition-all duration-300 flex flex-col
      border-zinc-300 dark:border-zinc-800
      bg-zinc-50 dark:bg-zinc-950
      ${isMinimized ? "h-12" : "h-48"}`}
    >

      {/* HEADER */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-300 dark:border-zinc-800">

        <div className="flex items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 text-sm font-medium rounded transition-colors whitespace-nowrap
              ${
                activeTab === tab.id
                  ? "bg-blue-600 text-white"
                  : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-black dark:hover:text-white"
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* ACTION BUTTONS */}
        <div className="flex items-center gap-2">

          <button
            onClick={handleCopy}
            className="p-1.5 rounded transition
            text-zinc-600 dark:text-zinc-400
            hover:text-black dark:hover:text-white
            hover:bg-zinc-200 dark:hover:bg-zinc-800"
          >
            <Copy size={16} />
          </button>

          <button
            onClick={handleClear}
            className="p-1.5 rounded transition
            text-zinc-600 dark:text-zinc-400
            hover:text-black dark:hover:text-white
            hover:bg-zinc-200 dark:hover:bg-zinc-800"
          >
            <Trash2 size={16} />
          </button>

          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="p-1.5 rounded transition
            text-zinc-600 dark:text-zinc-400
            hover:text-black dark:hover:text-white
            hover:bg-zinc-200 dark:hover:bg-zinc-800"
          >
            {isMinimized ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>

        </div>
      </div>

      {/* TERMINAL OUTPUT */}
      {!isMinimized && (
        <div
          className="flex-1 p-3 font-mono text-xs overflow-auto
          text-green-700 dark:text-green-400
          bg-white dark:bg-black
          whitespace-pre-wrap break-words"
        >
          {output}
        </div>
      )}

    </div>
  );
}