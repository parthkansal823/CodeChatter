import {
  ChevronRight,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  Trash2,
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
}) {
  const isFolder = node.type === "folder";
  const { Icon: FileIcon, className: fileIconClassName } = getFileVisual(node.name);
  const { Icon: FolderIcon, OpenIcon: OpenFolderIcon, className: folderIconClassName } = getFolderVisual(node.name);

  return (
    <div
      className={`group flex items-center gap-1 rounded-md transition-colors cursor-default ${
        isActive
          ? "bg-blue-100/50 text-zinc-950 dark:bg-blue-500/15 dark:text-blue-300"
          : isFocused
            ? "bg-zinc-200/50 text-zinc-950 dark:bg-zinc-800/50 dark:text-zinc-100"
            : "text-zinc-700 hover:bg-zinc-100/60 dark:text-zinc-300 dark:hover:bg-zinc-900/40"
      }`}
      style={{ paddingLeft: `${depth * 16 + 6}px` }}
    >
      <button
        type="button"
        onClick={() => {
          if (isFolder) {
            onToggleFolder?.(node.id);
          }

          onSelect?.(node);
        }}
        className="flex h-7 min-w-0 flex-1 items-center gap-2 px-1 text-left font-medium"
        title={node.name}
      >
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

        <span className="truncate text-[13px]">{node.name}</span>
      </button>

      <div className="mr-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
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
            onDelete?.(node);
          }}
          className="rounded-sm p-1 text-zinc-400 transition-colors hover:bg-red-600 hover:text-white"
          title={`Delete ${node.name}`}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
