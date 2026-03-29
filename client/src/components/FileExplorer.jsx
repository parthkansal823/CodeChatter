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
        className="h-8 w-full rounded-sm border border-blue-300 bg-white px-2 text-[13px] text-zinc-800 outline-none transition focus:border-blue-500 dark:border-blue-500/60 dark:bg-zinc-900 dark:text-white"
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
      className={`relative flex h-full flex-col border-r border-zinc-100 bg-[#0b0b0c] text-zinc-200 dark:border-white/[0.04] transition-[width] ${
        isResizing ? "duration-0" : "duration-150"
      } ${mobile ? "w-[86vw] max-w-[340px] shadow-2xl shadow-zinc-950/20" : ""}`}
    >
      {!mobile && !isCollapsed && (
        <div
          onMouseDown={() => setIsResizing(true)}
          onDoubleClick={() => setSidebarWidth(EXPLORER_DEFAULT_WIDTH)}
          className="absolute right-0 top-0 z-30 h-full w-3 translate-x-1.5 cursor-col-resize"
          title="Resize explorer"
        >
          <div className={`mx-auto h-full w-px transition-colors ${isResizing ? "bg-brand-500" : "bg-transparent hover:bg-zinc-600"}`} />
        </div>
      )}

      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          {!mobile && (
            <button
              onClick={onToggle}
              className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/5 hover:text-white"
              title={isCollapsed ? "Expand files" : "Collapse files"}
            >
              <ChevronRight size={16} className={`transition-transform ${isCollapsed ? "" : "rotate-180"}`} />
            </button>
          )}

          {!isCollapsed && (
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-zinc-400">
                Explorer
              </p>
            </div>
          )}
        </div>

        {!isCollapsed && (
          <div className="flex items-center gap-0.5">
            {canEdit && (
              <>
                <button
                  onClick={() => startCreate("file")}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/5 hover:text-white"
                  title="New file"
                >
                  <FilePlus2 size={15} />
                </button>

                <button
                  onClick={() => startCreate("folder")}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/5 hover:text-white"
                  title="New folder"
                >
                  <FolderPlus size={15} />
                </button>
              </>
            )}

            {activeFolderCount > 0 && (
              <>
                <button
                  onClick={() => setCollapsedFolders(new Set())}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/5 hover:text-white"
                  title="Expand all"
                >
                  <ChevronRight size={15} className="rotate-90" />
                </button>
                <button
                  onClick={() => setCollapsedFolders(new Set(folderIds))}
                  className="hidden rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 transition-colors hover:bg-white/5 hover:text-white sm:block"
                  title="Collapse all"
                >
                  Close
                </button>
              </>
            )}

            {mobile && (
              <button
                onClick={onClose}
                className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/5 hover:text-white"
                title="Close"
              >
                <X size={15} />
              </button>
            )}
          </div>
        )}
      </div>

      {!isCollapsed && (
        <div className="border-b border-white/[0.06] px-3 py-2">
          <div className="mb-2 flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.22em] text-zinc-500">
            <span className="truncate font-semibold text-zinc-200">{workspaceLabel}</span>
            <span className="whitespace-nowrap text-[11px]">
              {activeFileCount}F {activeFolderCount}D
            </span>
          </div>

          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search files..."
              className="w-full rounded-md border border-white/10 bg-white/[0.05] py-1.5 pl-8 pr-2 text-xs lowercase text-zinc-200 outline-none transition-colors placeholder:text-zinc-500 focus:border-brand-500/50 focus:bg-zinc-900"
            />
          </div>
        </div>
      )}

      <div
        className="flex-1 overflow-y-auto px-1 py-1.5 scrollbar-thin scrollbar-thumb-zinc-700"
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
                  className="flex h-8 w-full items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/5 hover:text-white"
                  title="New file"
                >
                  <FilePlus2 size={16} />
                </button>
                <button
                  onClick={() => startCreate("folder")}
                  className="flex h-9 w-full items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/5 hover:text-white"
                  title="Create folder"
                >
                  <FolderPlus size={16} />
                </button>
                <div className="mx-auto h-px w-6 bg-white/[0.08]" />
              </>
            )}
            {explorerEntries.filter((entry) => entry.type === "file").slice(0, 6).map((entry) => (
              <button
                key={entry.id}
                onClick={() => {
                  onSelectNode?.(entry.node);
                  onToggle?.();
                }}
                className="flex h-9 w-full items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
                title={entry.name}
              >
                {entry.name.charAt(0).toUpperCase()}
              </button>
            ))}
          </div>
        ) : tree.length || createDraft ? (
          <div className="space-y-0.5 pb-8">
            {renderCreateInput(0, null)}
            {searchQuery.trim()
              ? explorerEntries
                .filter((entry) => entry.name.toLowerCase().includes(searchQuery.toLowerCase()))
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
          </div>
        ) : (
          <div className="mx-2 rounded-md border border-dashed border-white/[0.08] px-3 py-4 text-sm text-zinc-500">
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
          className="flex-1 bg-zinc-950/40 backdrop-blur-sm"
          onClick={onClose}
          aria-label="Close file explorer"
        />
        {panel}
      </div>
    );
  }

  return panel;
}
