import { useState, useRef, useEffect } from "react";
import { ChevronRight } from "lucide-react";
import { getFileVisual, getFolderVisual } from "../utils/fileIcons";

export default function FileItem({
  node,
  depth = 0,
  canEdit = true,
  isActive = false,
  isFocused = false,
  isExpanded = false,
  onToggleFolder,
  onSelect,
  onDelete,
  onRename,
  onMove,
}) {
  const isFolder = node.type === "folder";
  const { Icon: FileIcon, className: fileIconClassName } = getFileVisual(node.name);
  const { Icon: FolderIcon, OpenIcon: OpenFolderIcon, className: folderIconClassName } = getFolderVisual(node.name);

  const [isRenaming, setIsRenaming] = useState(false);
  const [editName, setEditName] = useState(node.name);
  const [isDropTarget, setIsDropTarget] = useState(false);
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
    if (canEdit && e.key === "F2") {
      e.preventDefault();
      setIsRenaming(true);
    } else if (canEdit && e.key === "Delete") {
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
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e) => {
    if (!canEdit || !isFolder) return;

    // Without preventDefault the browser refuses the drop outright.
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setIsDropTarget(true);
  };

  const handleDragLeave = (e) => {
    // dragleave also fires when the pointer crosses onto a child element, which
    // would flicker the highlight off and on. Ignore those.
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setIsDropTarget(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDropTarget(false);

    if (!canEdit || !isFolder) return;

    const draggedNodeId = e.dataTransfer.getData("nodeId");
    if (draggedNodeId && draggedNodeId !== node.id) {
      onMove?.(draggedNodeId, node.id);
    }
  };

  return (
    <div
      tabIndex={0}
      draggable={canEdit && !isRenaming}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDragEnd={() => setIsDropTarget(false)}
      onDrop={handleDrop}
      onKeyDown={handleItemKeyDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (canEdit) {
          setIsRenaming(true);
        }
      }}
      className={`group flex cursor-pointer select-none items-center gap-1 border-l-2 outline-none transition-colors ${
        isDropTarget
          ? "border-accent bg-accent-subtle text-fg ring-1 ring-inset ring-accent"
          : isActive
            ? "border-accent bg-selected text-fg"
            : isFocused
              ? "border-transparent bg-hovered text-fg"
              : "border-transparent text-fg-muted hover:bg-hovered hover:text-fg"
      }`}
      style={{ paddingLeft: `${depth * 12 + 4}px` }}
      onClick={() => {
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
      {/* 22px rows, the height an editor tree uses — it fits roughly twice the
          files on screen compared with the 28px rows this had. */}
      <div className="flex h-[22px] min-w-0 flex-1 items-center gap-1.5 px-1">
        {isFolder ? (
          <>
            <ChevronRight
              size={14}
              className={`flex-shrink-0 text-fg-subtle transition-transform ${isExpanded ? "rotate-90" : ""}`}
            />
            {isExpanded ? (
              <OpenFolderIcon size={15} className={`flex-shrink-0 ${folderIconClassName}`} />
            ) : (
              <FolderIcon size={15} className={`flex-shrink-0 ${folderIconClassName}`} />
            )}
          </>
        ) : (
          <>
            {/* Matches the chevron's width so files line up under their folder. */}
            <span className="w-[14px] flex-shrink-0" />
            <FileIcon size={15} className={`flex-shrink-0 ${fileIconClassName}`} />
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
            className="h-[18px] w-full min-w-0 rounded-sm border border-accent bg-field px-1 text-[13px] text-fg outline-none"
          />
        ) : (
          <span className="truncate text-[13px]">{node.name}</span>
        )}
      </div>

    </div>
  );
}
