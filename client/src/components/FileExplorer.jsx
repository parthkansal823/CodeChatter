import { useEffect, useMemo, useState } from "react";
import { ChevronRight, FilePlus2, FolderPlus, X } from "lucide-react";

import FileItem from "./FileItem";
import { countFiles, flattenWorkspaceTree } from "../utils/workspace";

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
  activeFileId,
  focusedNodeId,
  onSelectNode,
  onDeleteNode,
  onCreateFile,
  onCreateFolder,
  isOpen = true,
  onToggle,
  mobile = false,
  onClose,
}) {
  const [createDraft, setCreateDraft] = useState(null);
  const [newNodeName, setNewNodeName] = useState("");
  const [collapsedFolders, setCollapsedFolders] = useState(() => new Set());

  const isCollapsed = !mobile && !isOpen;
  const explorerEntries = useMemo(() => flattenWorkspaceTree(tree), [tree]);
  const folderIds = useMemo(() => collectFolderIds(tree), [tree]);
  const activeFolderCount = folderIds.length;
  const activeFileCount = useMemo(() => countFiles(tree), [tree]);
  const focusedEntry = explorerEntries.find((entry) => entry.id === focusedNodeId) || null;
  const defaultCreateParentId = focusedEntry?.type === "folder"
    ? focusedEntry.id
    : focusedEntry?.parentId || null;

  useEffect(() => {
    setCollapsedFolders((current) => {
      return new Set([...current].filter((folderId) => folderIds.includes(folderId)));
    });
  }, [folderIds]);

  useEffect(() => {
    if (!focusedNodeId) {
      return;
    }

    const ancestorIds = findAncestorFolderIds(tree, focusedNodeId);

    if (!ancestorIds?.length) {
      return;
    }

    setCollapsedFolders((current) => {
      const next = new Set(current);
      let changed = false;

      ancestorIds.forEach((folderId) => {
        if (next.has(folderId)) {
          next.delete(folderId);
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, [focusedNodeId, tree]);

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
      const isExpanded = node.type === "folder" ? !collapsedFolders.has(node.id) : false;

      return (
        <div key={node.id}>
          <FileItem
            node={node}
            depth={depth}
            isActive={activeFileId === node.id}
            isFocused={focusedNodeId === node.id}
            isExpanded={isExpanded}
            onToggleFolder={toggleFolder}
            onSelect={onSelectNode}
            onCreateFile={(folderId) => startCreate("file", folderId)}
            onCreateFolder={(folderId) => startCreate("folder", folderId)}
            onDelete={onDeleteNode}
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

  const panel = (
    <div
      className={`flex h-full flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 ${
        mobile
          ? "w-[86vw] max-w-[340px] shadow-2xl shadow-zinc-950/20"
          : isCollapsed
            ? "w-12"
            : "w-72"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-3 dark:border-zinc-800">
        <div className="flex min-w-0 items-center gap-2.5">
          {!mobile && (
            <button
              onClick={onToggle}
              className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-white"
              title={isCollapsed ? "Expand files" : "Collapse files"}
            >
              <ChevronRight size={16} className={`transition-transform ${isCollapsed ? "" : "rotate-180"}`} />
            </button>
          )}

          {!isCollapsed && (
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                Explorer
              </p>
            </div>
          )}
        </div>

        {!isCollapsed && (
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => startCreate("file")}
              className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-white"
              title="New file"
            >
              <FilePlus2 size={15} />
            </button>

            <button
              onClick={() => startCreate("folder")}
              className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-white"
              title="New folder"
            >
              <FolderPlus size={15} />
            </button>

            {activeFolderCount > 0 && (
              <button
                onClick={() => setCollapsedFolders(new Set(folderIds))}
                className="hidden text-xs font-semibold uppercase tracking-wider text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-white sm:block rounded-md px-2 py-1"
                title="Collapse all"
              >
                ⋮
              </button>
            )}

            {mobile && (
              <button
                onClick={onClose}
                className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-white"
                title="Close"
              >
                <X size={15} />
              </button>
            )}
          </div>
        )}
      </div>

      {!isCollapsed && (
        <div className="border-b border-zinc-200 px-3 py-2.5 text-xs uppercase tracking-widest text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <div className="flex items-center justify-between gap-3">
            <span className="truncate font-semibold text-zinc-600 dark:text-zinc-300">{workspaceLabel}</span>
            <span className="whitespace-nowrap text-xs">
              {activeFileCount}F {activeFolderCount}D
            </span>
          </div>
        </div>
      )}

      {/* Tree */}
      <div className="flex-1 overflow-y-auto px-1 py-1.5 scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-700">
        {isCollapsed ? (
          <div className="space-y-2 px-1">
            <button
              onClick={() => startCreate("file")}
              className="flex h-8 w-full items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-white"
              title="New file"
            >
              <FilePlus2 size={16} />
            </button>
            <button
              onClick={() => startCreate("folder")}
              className="flex h-9 w-full items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-white"
              title="Create folder"
            >
              <FolderPlus size={16} />
            </button>
            <div className="mx-auto h-px w-6 bg-zinc-200 dark:bg-zinc-800" />
            {explorerEntries.filter((entry) => entry.type === "file").slice(0, 6).map((entry) => (
              <button
                key={entry.id}
                onClick={() => {
                  onSelectNode?.(entry.node);
                  onToggle?.();
                }}
                className="flex h-9 w-full items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-white"
                title={entry.name}
              >
                {entry.name.charAt(0).toUpperCase()}
              </button>
            ))}
          </div>
        ) : tree.length || createDraft ? (
          <div className="space-y-0.5">
            {renderCreateInput(0, null)}
            {renderNodes(tree)}
          </div>
        ) : (
          <div className="mx-2 rounded-md border border-dashed border-zinc-200 px-3 py-4 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
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
