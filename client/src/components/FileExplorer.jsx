import { useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import FileItem from "./FileItem";

export default function FileExplorer() {

  const [isExpanded, setIsExpanded] = useState(true);
  const [files, setFiles] = useState([
    "main.cpp",
    "utils.js",
    "input.txt",
    "README.md",
    "data.json",
    "style.css",
    "index.html",
    "script.py"
  ]);

  const [selectedFile, setSelectedFile] = useState(null);

  const [creatingFile, setCreatingFile] = useState(false);
  const [newFileName, setNewFileName] = useState("");

  const handleCreateFile = () => {

    if (!newFileName.trim()) return;

    if (!files.includes(newFileName)) {
      setFiles([...files, newFileName]);
    }

    setNewFileName("");
    setCreatingFile(false);
  };

  const handleDeleteFile = (fileName) => {
    setFiles(files.filter((f) => f !== fileName));
    if (selectedFile === fileName) setSelectedFile(null);
  };

  return (
    <div
      className={`transition-all duration-300 overflow-hidden
      bg-white dark:bg-zinc-950
      border-r border-zinc-300 dark:border-zinc-800
      ${isExpanded ? "w-56" : "w-14"}`}
    >

      {/* HEADER */}
      <div className="flex items-center justify-between p-3 border-b border-zinc-300 dark:border-zinc-800">

        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 w-full text-sm font-semibold
          text-zinc-800 dark:text-white
          hover:bg-zinc-200 dark:hover:bg-zinc-800
          p-2 rounded transition"
        >
          <ChevronRight
            size={16}
            className={`transition-transform ${isExpanded ? "rotate-90" : ""}`}
          />

          {isExpanded && <span>Files ({files.length})</span>}
        </button>

        {isExpanded && (
          <button
            onClick={() => setCreatingFile(true)}
            className="p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded"
          >
            <Plus size={16} className="text-green-500" />
          </button>
        )}

      </div>

      {/* NEW FILE INPUT */}
      {creatingFile && (
        <div className="px-3 py-2">
          <input
            autoFocus
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateFile();
              if (e.key === "Escape") {
                setCreatingFile(false);
                setNewFileName("");
              }
            }}
            placeholder="filename.ext"
            className="w-full text-sm px-2 py-1 rounded
            bg-zinc-100 dark:bg-zinc-800
            text-zinc-800 dark:text-white
            outline-none"
          />
        </div>
      )}

      {/* FILE LIST */}
      <div className="flex flex-col overflow-y-auto">

        {files.map((file) => (
          <FileItem
            key={file}
            name={file}
            isSelected={selectedFile === file}
            onSelect={() => setSelectedFile(file)}
            onDelete={() => handleDeleteFile(file)}
          />
        ))}

      </div>

    </div>
  );
}
