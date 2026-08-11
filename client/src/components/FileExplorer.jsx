import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, FilePlus2, FolderPlus, Search, X } from "lucide-react";

import FileItem from "./FileItem";
import { countFiles, flattenWorkspaceTree } from "../utils/workspace";

const EXPLORER_DEFAULT_WIDTH = 272;
const EXPLORER_MIN_WIDTH = 220;
const EXPLORER_MAX_WIDTH = 420;
const EXPLORER_WIDTH_STORAGE_KEY = "codechatter-explorer-width";

function collectFolderIds(nodes) {
  return nodes.flatMap((node) => {
    if (node.type !== "folder") {
      return [];
    }

    return [node.id, ...collectFolderIds(node.children || [])];
  });
}

function findAncestorFolderIds(nodes, targetId, ancestors = []) {
  for (const node of nodes) {
    if (node.id === targetId) {
      return ancestors;
    }

    if (node.type === "folder") {
      const result = findAncestorFolderIds(
        node.children || [],
        targetId,
        [...ancestors, node.id]
      );

      if (result) {
        return result;
      }
    }
  }

  return null;
}

function sortNodes(nodes) {
  return [...nodes].sort((leftNode, rightNode) => {
    if (leftNode.type !== rightNode.type) {
      return leftNode.type === "folder" ? -1 : 1;
    }

    return leftNode.name.localeCompare(rightNode.name, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
}

function CreateNodeInput({
  depth = 0,
  creatingType,
  newNodeName,
  onNameChange,
  onSubmit,
  onCancel,
}) {
  return (
    <div className="px-2 py-1" style={{ paddingLeft: `${depth * 14 + 20}px` }}>
      <input
        autoFocus
        value={newNodeName}
        onChange={(event) => onNameChange(event.target.value)}
        onBlur={onCancel}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            onSubmit();
          }

          if (event.key === "Escape") {
            onCancel();
          }
        }}
        placeholder={creatingType === "folder" ? "new-folder" : "new-file.ext"}
        className="h-7 w-full rounded-sm border border-accent bg-field px-2 text-[13px] text-fg outline-none transition-colors focus:ring-1 focus:ring-accent"
      />
    </div>
  );
}

export default function FileExplorer({
  workspaceLabel = "Workspace",
  tree = [],
  canEdit = true,
  activeFileId,
  focusedNodeId,
  onSelectNode,
  onDeleteNode,
  onCreateFile,
  onCreateFolder,
  onRenameNode,
  onMoveNode,
  isOpen = true,
  onToggle,
  mobile = false,
  onClose,
}) {
  const [createDraft, setCreateDraft] = useState(null);
  const [newNodeName, setNewNodeName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedFolders, setCollapsedFolders] = useState(() => new Set());
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === "undefined") {
      return EXPLORER_DEFAULT_WIDTH;
    }

    const storedValue = Number(window.localStorage.getItem(EXPLORER_WIDTH_STORAGE_KEY));
    if (!Number.isFinite(storedValue)) {
      return EXPLORER_DEFAULT_WIDTH;
    }

    return Math.min(EXPLORER_MAX_WIDTH, Math.max(EXPLORER_MIN_WIDTH, storedValue));
  });
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef(null);

  const isCollapsed = !mobile && !isOpen;
  const explorerEntries = useMemo(() => flattenWorkspaceTree(tree), [tree]);
  const folderIds = useMemo(() => collectFolderIds(tree), [tree]);
  const folderIdSet = useMemo(() => new Set(folderIds), [folderIds]);
  const activeFolderCount = folderIds.length;
  const activeFileCount = useMemo(() => countFiles(tree), [tree]);
  const focusedEntry = explorerEntries.find((entry) => entry.id === focusedNodeId) || null;
  const defaultCreateParentId = focusedEntry?.type === "folder"
    ? focusedEntry.id
    : focusedEntry?.parentId || null;

  const visibleCollapsedFolders = useMemo(() => {
    const next = new Set([...collapsedFolders].filter((folderId) => folderIdSet.has(folderId)));

    if (!focusedNodeId) {
      return next;
    }

    const ancestorIds = findAncestorFolderIds(tree, focusedNodeId) || [];
    ancestorIds.forEach((folderId) => next.delete(folderId));
    return next;
  }, [collapsedFolders, folderIdSet, focusedNodeId, tree]);
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredEntries = useMemo(() => {
    if (!normalizedSearchQuery) {
      return [];
    }

    return explorerEntries.filter((entry) => entry.name.toLowerCase().includes(normalizedSearchQuery));
  }, [explorerEntries, normalizedSearchQuery]);

  useEffect(() => {
    if (mobile || typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(EXPLORER_WIDTH_STORAGE_KEY, String(sidebarWidth));
  }, [mobile, sidebarWidth]);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
  }, []);

  const resize = useCallback((event) => {
    if (!panelRef.current) {
      return;
    }

    const panelLeft = panelRef.current.getBoundingClientRect().left;
    const nextWidth = event.clientX - panelLeft;
    const boundedWidth = Math.min(EXPLORER_MAX_WIDTH, Math.max(EXPLORER_MIN_WIDTH, nextWidth));
    setSidebarWidth(boundedWidth);
  }, []);

  useEffect(() => {
    if (!isResizing) {
      return undefined;
    }

    document.body.style.cursor = "col-resize";
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

  if (mobile && !isOpen) {
    return null;
  }

  const closeCreateInput = () => {
    setCreateDraft(null);
    setNewNodeName("");
  };

  const expandToFolder = (folderId) => {
    if (!folderId) {
      return;
    }

    const ancestorIds = findAncestorFolderIds(tree, folderId) || [];
    const folderIdsToOpen = [...ancestorIds, folderId];

    setCollapsedFolders((current) => {
      const next = new Set(current);
      let changed = false;

      folderIdsToOpen.forEach((id) => {
        if (next.has(id)) {
          next.delete(id);
          changed = true;
        }
      });

      return changed ? next : current;
    });
  };

  const startCreate = (type, parentId = defaultCreateParentId) => {
    if (!canEdit) {
      return;
    }

    if (parentId) {
      expandToFolder(parentId);
    }

    setCreateDraft({ type, parentId });
    setNewNodeName("");
  };

  const handleCreate = () => {
    if (!createDraft) {
      return;
    }

    const created = createDraft.type === "folder"
      ? onCreateFolder?.(newNodeName, createDraft.parentId)
      : onCreateFile?.(newNodeName, createDraft.parentId);

    if (!created) {
      return;
    }

    closeCreateInput();
  };

  const toggleFolder = (folderId) => {
    setCollapsedFolders((current) => {
      const next = new Set(current);

      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }

      return next;
    });
  };

  const renderCreateInput = (depth, parentId) => {
    if (!createDraft || createDraft.parentId !== parentId || isCollapsed) {
      return null;
    }

    return (
      <CreateNodeInput
        depth={depth}
        creatingType={createDraft.type}
        newNodeName={newNodeName}
        onNameChange={setNewNodeName}
        onSubmit={handleCreate}
        onCancel={closeCreateInput}
      />
    );
  };

  const renderNodes = (nodes, depth = 0) => {
    return sortNodes(nodes).map((node) => {
      const isExpanded = node.type === "folder" ? !visibleCollapsedFolders.has(node.id) : false;

      return (
        <div key={node.id}>
          <FileItem
            node={node}
            depth={depth}
            canEdit={canEdit}
            isActive={activeFileId === node.id}
            isFocused={focusedNodeId === node.id}
            isExpanded={isExpanded}
            onToggleFolder={toggleFolder}
            onSelect={onSelectNode}
            onCreateFile={(folderId) => startCreate("file", folderId)}
            onCreateFolder={(folderId) => startCreate("folder", folderId)}
            onDelete={onDeleteNode}
            onRename={onRenameNode}
            onMove={onMoveNode}
          />

          {node.type === "folder" && isExpanded && (
            <>
              {renderCreateInput(depth + 1, node.id)}
              {renderNodes(node.children || [], depth + 1)}
            </>
          )}
        </div>
      );
    });
  };

  const widthStyle = mobile
    ? undefined
    : isCollapsed
      ? { width: "48px" }
      : { width: `${sidebarWidth}px` };

  const panel = (
    <div
      ref={panelRef}
      style={widthStyle}
      className={`relative flex h-full flex-col border-r border-edge-subtle bg-panel text-fg transition-[width] ${
        isResizing ? "duration-0" : "duration-150"
      } ${mobile ? "w-[88vw] max-w-[360px] shadow-xl" : ""}`}
    >
      {!mobile && !isCollapsed && (
        <div
          onMouseDown={() => setIsResizing(true)}
          onDoubleClick={() => setSidebarWidth(EXPLORER_DEFAULT_WIDTH)}
          className="absolute right-0 top-0 z-30 h-full w-3 translate-x-1.5 cursor-col-resize"
          title="Resize explorer"
        >
          <div className={`mx-auto h-full w-px transition-colors ${isResizing ? "bg-brand-500" : "bg-transparent hover:bg-edge-strong"}`} />
        </div>
      )}

      <div className="flex items-center justify-between border-b border-edge-subtle px-3 py-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {!mobile && (
            <button
              onClick={onToggle}
              className="flex h-7 w-7 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-hovered hover:text-fg"
              title={isCollapsed ? "Expand files" : "Collapse files"}
            >
              <ChevronRight size={16} className={`transition-transform ${isCollapsed ? "" : "rotate-180"}`} />
            </button>
          )}

          {!isCollapsed && (
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-fg-muted">
                Explorer
              </p>
            </div>
          )}
        </div>

        {!isCollapsed && (
          <div className="flex items-center gap-0.5">
            {mobile && (
              <button
                onClick={onClose}
                className="flex h-7 w-7 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-hovered hover:text-fg"
                title="Close"
              >
                <X size={15} />
              </button>
            )}
          </div>
        )}
      </div>

      {!isCollapsed && (
        <div className="border-b border-edge-subtle px-3 py-2">
          <div className="mb-2 flex items-center justify-between gap-3 text-[11px] uppercase tracking-wider text-fg-subtle">
            <span className="truncate font-semibold text-fg">{workspaceLabel}</span>
            <span className="whitespace-nowrap text-[11px]">
              {activeFileCount}F {activeFolderCount}D
            </span>
          </div>

          {canEdit && (
            <div className="mb-2 grid grid-cols-2 gap-2">
              <button
                onClick={() => startCreate("file")}
                className="inline-flex items-center justify-center gap-1.5 rounded-md border border-edge-subtle bg-field px-2 py-1.5 text-xs font-medium text-fg transition-colors hover:border-accent hover:text-accent"
              >
                <FilePlus2 size={13} />
                File
              </button>
              <button
                onClick={() => startCreate("folder")}
                className="inline-flex items-center justify-center gap-1.5 rounded-md border border-edge-subtle bg-field px-2 py-1.5 text-xs font-medium text-fg transition-colors hover:border-accent hover:text-accent"
              >
                <FolderPlus size={13} />
                Folder
              </button>
            </div>
          )}

          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search files..."
              className="w-full rounded-md border border-edge bg-field py-1.5 pl-8 pr-2 text-xs text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-accent focus:ring-1 focus:ring-accent"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-fg-subtle transition-colors hover:bg-hovered hover:text-fg"
                title="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>

          <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-fg-muted">
            <span>
              {normalizedSearchQuery
                ? `${filteredEntries.length} matching item${filteredEntries.length === 1 ? "" : "s"}`
                : "Tip: F2 rename, Del delete, drag to move"}
            </span>
            {activeFolderCount > 0 && (
              <button
                onClick={() => setCollapsedFolders(new Set())}
                className="font-medium transition-colors hover:text-fg"
              >
                Expand all
              </button>
            )}
          </div>
        </div>
      )}

      <div
        className="flex-1 overflow-y-auto px-1 py-1.5"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (!canEdit) {
            return;
          }
          const draggedNodeId = event.dataTransfer.getData("nodeId");
          if (draggedNodeId) {
            onMoveNode?.(draggedNodeId, null);
          }
        }}
      >
        {isCollapsed ? (
          <div className="space-y-2 px-1">
            {canEdit && (
              <>
                <button
                  onClick={() => startCreate("file")}
                  className="flex h-8 w-full items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-hovered hover:text-fg"
                  title="New file"
                >
                  <FilePlus2 size={16} />
                </button>
                <button
                  onClick={() => startCreate("folder")}
                  className="flex h-9 w-full items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-hovered hover:text-fg"
                  title="Create folder"
                >
                  <FolderPlus size={16} />
                </button>
                <div className="mx-auto h-px w-6 bg-edge-subtle" />
              </>
            )}
            {explorerEntries.filter((entry) => entry.type === "file").slice(0, 6).map((entry) => (
              <button
                key={entry.id}
                onClick={() => {
                  onSelectNode?.(entry.node);
                  onToggle?.();
                }}
                className="flex h-9 w-full items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-hovered hover:text-fg"
                title={entry.name}
              >
                {entry.name.charAt(0).toUpperCase()}
              </button>
            ))}
          </div>
        ) : tree.length || createDraft ? (
          <div className="space-y-0.5 pb-8">
            {renderCreateInput(0, null)}
            {normalizedSearchQuery
              ? filteredEntries
                .map((entry) => (
                  <FileItem
                    key={entry.id}
                    node={entry.node}
                    depth={0}
                    canEdit={canEdit}
                    isActive={activeFileId === entry.id}
                    isFocused={focusedNodeId === entry.id}
                    onSelect={onSelectNode}
                    onDelete={onDeleteNode}
                    onRename={onRenameNode}
                    onMove={onMoveNode}
                  />
                ))
              : renderNodes(tree)}
            {normalizedSearchQuery && filteredEntries.length === 0 && (
              <div className="mx-2 mt-2 rounded-md border border-dashed border-edge px-3 py-3 text-xs text-fg-muted">
                No files match "{searchQuery}".
              </div>
            )}
          </div>
        ) : (
          <div className="mx-2 rounded-md border border-dashed border-edge px-3 py-4 text-sm text-fg-muted">
            This room is empty. Create a file or folder to start.
          </div>
        )}
      </div>
    </div>
  );

  if (mobile) {
    return (
      <div className="fixed inset-0 z-50 flex lg:hidden">
        <button
          className="flex-1 bg-black/40 backdrop-blur-sm"
          onClick={onClose}
          aria-label="Close file explorer"
        />
        {panel}
      </div>
    );
  }

  return panel;
}
