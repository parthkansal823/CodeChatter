import { useState, useRef, useEffect } from "react";
import {
  ChevronRight,
  FilePlus2,
  FolderOpen,
  FolderPlus,
  Trash2,
  Pencil
} from "lucide-react";
import { getFileVisual, getFolderVisual } from "../utils/fileIcons";

export default function FileItem({
  node,
  depth = 0,
  isActive = false,
  isFocused = false,
  isExpanded = false,
  onToggleFolder,
  onSelect,
  onCreateFile,
  onCreateFolder,
  onDelete,
  onRename,
  onMove,
}) {
  const isFolder = node.type === "folder";
  const { Icon: FileIcon, className: fileIconClassName } = getFileVisual(node.name);
  const { Icon: FolderIcon, OpenIcon: OpenFolderIcon, className: folderIconClassName } = getFolderVisual(node.name);

  const [isRenaming, setIsRenaming] = useState(false);
  const [editName, setEditName] = useState(node.name);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      // Select filename without extension by default
      const dotIndex = editName.lastIndexOf(".");
      if (!isFolder && dotIndex > 0) {
        inputRef.current.setSelectionRange(0, dotIndex);
      } else {
        inputRef.current.select();
      }
    }
  }, [isRenaming, isFolder, editName]);

  const handleRenameSubmit = () => {
    if (editName.trim() && editName !== node.name) {
      onRename?.(node.id, editName.trim());
    } else {
      setEditName(node.name); // Reset if blank
    }
    setIsRenaming(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleRenameSubmit();
    if (e.key === "Escape") {
      setEditName(node.name);
      setIsRenaming(false);
    }
  };

  const handleItemKeyDown = (e) => {
    if (e.key === "F2") {
      e.preventDefault();
      setIsRenaming(true);
    } else if (e.key === "Delete") {
      e.preventDefault();
      onDelete?.(node);
    } else if (e.key === "Enter" && !isRenaming) {
      e.preventDefault();
      if (isFolder) onToggleFolder?.(node.id);
      onSelect?.(node);
    }
  };

  const handleDragStart = (e) => {
    e.stopPropagation();
    e.dataTransfer.setData("nodeId", node.id);
  };

  const handleDragOver = (e) => {
    if (isFolder) {
      e.preventDefault();
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isFolder) return;
    const draggedNodeId = e.dataTransfer.getData("nodeId");
    if (draggedNodeId && draggedNodeId !== node.id) {
      onMove?.(draggedNodeId, node.id);
    }
  };

  return (
    <div
      tabIndex={0}
      draggable={!isRenaming}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onKeyDown={handleItemKeyDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setIsRenaming(true);
      }}
      className={`group flex items-center gap-1 transition-colors cursor-pointer outline-none border-l-[3px] select-none ${
        isActive
          ? "bg-blue-100/50 text-blue-900 border-blue-500 dark:bg-blue-600/20 dark:text-blue-200 dark:border-blue-400"
          : isFocused
            ? "bg-zinc-200/50 text-zinc-950 border-transparent dark:bg-zinc-800/60 dark:text-zinc-100"
            : "text-zinc-700 hover:bg-zinc-100/60 border-transparent dark:text-zinc-300 dark:hover:bg-zinc-900/40"
      }`}
      style={{ paddingLeft: `${depth * 16 + 3}px` }}
      onClick={(e) => {
        if (!isRenaming) {
          if (isFolder) onToggleFolder?.(node.id);
          onSelect?.(node);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onSelect?.(node);
        // We focus it on right click too
        e.currentTarget.focus();
      }}
    >
      <div className="flex h-7 min-w-0 flex-1 items-center gap-[6px] px-1 font-medium">
        {isFolder ? (
          <>
            <ChevronRight
              size={16}
              className={`flex-shrink-0 text-zinc-500 transition-transform dark:text-zinc-400 ${isExpanded ? "rotate-90" : ""}`}
            />
            {isExpanded ? (
              <OpenFolderIcon size={16} className={`flex-shrink-0 ${folderIconClassName}`} />
            ) : (
              <FolderIcon size={16} className={`flex-shrink-0 ${folderIconClassName}`} />
            )}
          </>
        ) : (
          <>
            <span className="w-4 flex-shrink-0" />
            <FileIcon size={16} className={`flex-shrink-0 ${fileIconClassName}`} />
          </>
        )}

        {isRenaming ? (
          <input
            ref={inputRef}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            className="h-6 w-full min-w-0 rounded-sm border border-blue-500 bg-white px-1 text-[13px] text-zinc-900 outline-none dark:bg-zinc-900 dark:text-white"
          />
        ) : (
          <span className="truncate text-[13px]">{node.name}</span>
        )}
      </div>

      <div className="mr-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100">
        {isFolder && (
          <>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onCreateFile?.(node.id);
              }}
              className="rounded-sm p-1 text-zinc-400 transition-colors hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-white"
              title={`New file in ${node.name}`}
            >
              <FilePlus2 size={13} />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onCreateFolder?.(node.id);
              }}
              className="rounded-sm p-1 text-zinc-400 transition-colors hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-white"
              title={`New folder in ${node.name}`}
            >
              <FolderPlus size={13} />
            </button>
          </>
        )}

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setIsRenaming(true);
          }}
          className="rounded-sm p-1 text-zinc-400 transition-colors hover:bg-blue-100 hover:text-blue-600 dark:hover:bg-zinc-800 dark:hover:text-blue-400"
          title={`Rename ${node.name} (F2)`}
        >
          <Pencil size={13} />
        </button>

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDelete?.(node);
          }}
          className="rounded-sm p-1 text-zinc-400 transition-colors hover:bg-red-100 hover:text-red-600 dark:hover:bg-zinc-800 dark:hover:text-red-400"
          title={`Delete ${node.name} (Del)`}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
