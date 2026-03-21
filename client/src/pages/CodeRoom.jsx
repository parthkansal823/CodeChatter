import {
  useCallback,
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { FilePlus2, FolderPlus, LoaderCircle } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";

import Navbar from "../components/Navbar";
import TopBar from "../components/TopBar";
import FileExplorer from "../components/FileExplorer";
import CodeEditor from "../components/CodeEditor";
import TabBar from "../components/TabBar";
import BottomPanel from "../components/BottomPanel";
import RightSidebar from "../components/RightSidebar";
import RoomSettingsModal from "../components/RoomSettingsModal";
import ConfirmModal from "../components/ConfirmModal";
import { Button } from "../components/ui/Button";
import { useAuth } from "../hooks/useAuth";
import { API_ENDPOINTS } from "../config/security";
import { sanitizeInput, secureFetch } from "../utils/security";
import {
  addNodeToWorkspace,
  buildUniqueName,
  createWorkspaceNode,
  findNodeById,
  flattenWorkspaceTree,
  getFirstFile,
  getFolderChildren,
  removeNodeById,
  updateNodeById,
  renameNode,
  moveNode
} from "../utils/workspace";

export default function CodeRoom({ theme = "vs-dark", onThemeChange }) {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { token } = useAuth();
  const [room, setRoom] = useState(null);
  const [workspaceTree, setWorkspaceTree] = useState([]);
  const [activeFileId, setActiveFileId] = useState(null);
  const [focusedNodeId, setFocusedNodeId] = useState(null);
  const [openFileIds, setOpenFileIds] = useState(new Set());
  const [modifiedFileIds, setModifiedFileIds] = useState(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [isDesktopExplorerOpen, setIsDesktopExplorerOpen] = useState(true);
  const [isMobileExplorerOpen, setIsMobileExplorerOpen] = useState(false);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState("saved");
  const [stdin, setStdin] = useState("");
  const [runResult, setRunResult] = useState(null);
  const [runPanelSignal, setRunPanelSignal] = useState(0);
  const [nodeToDelete, setNodeToDelete] = useState(null);
  const saveSnapshotRef = useRef("");
  const latestWorkspaceSnapshotRef = useRef("");
  const hasHydratedWorkspaceRef = useRef(false);

  const workspaceEntries = useMemo(() => flattenWorkspaceTree(workspaceTree), [workspaceTree]);
  const activeFileEntry = workspaceEntries.find((entry) => {
    return entry.id === activeFileId && entry.type === "file";
  }) || null;
  const focusedEntry = workspaceEntries.find((entry) => entry.id === focusedNodeId) || null;
  const createParentId = focusedEntry?.type === "folder"
    ? focusedEntry.id
    : focusedEntry?.parentId || null;
  const activeCode = activeFileEntry?.node?.content || "";

  const openFiles = useMemo(() => {
    return Array.from(openFileIds)
      .map((fileId) => workspaceEntries.find((entry) => entry.id === fileId && entry.type === "file"))
      .filter(Boolean);
  }, [openFileIds, workspaceEntries]);

  useEffect(() => {
    if (!roomId) {
      navigate("/home", { replace: true });
    }
  }, [roomId, navigate]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const mediaQuery = window.matchMedia("(max-width: 1023px)");
    const updateViewport = () => {
      setIsMobileViewport(mediaQuery.matches);
    };

    updateViewport();

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", updateViewport);
      return () => mediaQuery.removeEventListener("change", updateViewport);
    }

    mediaQuery.addListener(updateViewport);
    return () => mediaQuery.removeListener(updateViewport);
  }, []);

  const applyRoomData = useCallback((roomData) => {
    const nextTree = roomData?.workspaceTree || [];
    const nextActiveFile = getFirstFile(nextTree);
    const nextSnapshot = JSON.stringify(nextTree);

    startTransition(() => {
      setRoom(roomData);
      setWorkspaceTree(nextTree);
      setActiveFileId(nextActiveFile?.id || null);
      setFocusedNodeId(nextActiveFile?.id || null);
      setSaveStatus("saved");
    });

    saveSnapshotRef.current = nextSnapshot;
    latestWorkspaceSnapshotRef.current = nextSnapshot;
    hasHydratedWorkspaceRef.current = true;
  }, []);

  const saveWorkspace = useCallback(async (nextTree, notifyError = false) => {
    if (!token || !roomId) {
      return null;
    }

    try {
      const outgoingSnapshot = JSON.stringify(nextTree);
      const savedRoom = await secureFetch(
        API_ENDPOINTS.UPDATE_ROOM_WORKSPACE(roomId),
        {
          method: "PUT",
          body: JSON.stringify({ tree: nextTree }),
        },
        token
      );
      const persistedSnapshot = JSON.stringify(savedRoom.workspaceTree || nextTree);

      saveSnapshotRef.current = persistedSnapshot;
      setSaveStatus(
        latestWorkspaceSnapshotRef.current === outgoingSnapshot
          || latestWorkspaceSnapshotRef.current === persistedSnapshot
          ? "saved"
          : "saving"
      );
      setRoom(savedRoom);
      
      // Clear modified flag when files are saved
      if (latestWorkspaceSnapshotRef.current === outgoingSnapshot || latestWorkspaceSnapshotRef.current === persistedSnapshot) {
        setModifiedFileIds(new Set());
      }

      return savedRoom;
    } catch (error) {
      setSaveStatus("error");

      if (notifyError) {
        toast.error(error.message || "Could not save workspace");
      }

      throw error;
    }
  }, [roomId, token]);

  useEffect(() => {
    if (!token || !roomId) {
      return;
    }

    let isMounted = true;

    const openRoom = async () => {
      setIsLoading(true);
      hasHydratedWorkspaceRef.current = false;

      try {
        await secureFetch(
          API_ENDPOINTS.JOIN_ROOM,
          {
            method: "POST",
            body: JSON.stringify({ roomId }),
          },
          token
        );
        const roomData = await secureFetch(API_ENDPOINTS.GET_ROOM(roomId), {}, token);

        if (isMounted) {
          applyRoomData(roomData);
        }
      } catch (error) {
        toast.error(error.message || "Could not open room");
        navigate("/home", { replace: true });
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    openRoom();

    return () => {
      isMounted = false;
    };
  }, [applyRoomData, navigate, roomId, token]);

  useEffect(() => {
    if (!hasHydratedWorkspaceRef.current || !roomId || !token) {
      return undefined;
    }

    const nextSnapshot = JSON.stringify(workspaceTree);
    latestWorkspaceSnapshotRef.current = nextSnapshot;

    if (nextSnapshot === saveSnapshotRef.current) {
      return undefined;
    }

    setSaveStatus("saving");

    const timeoutId = window.setTimeout(() => {
      saveWorkspace(workspaceTree).catch(() => {});
    }, 700);

    return () => window.clearTimeout(timeoutId);
  }, [roomId, saveWorkspace, token, workspaceTree]);

  useEffect(() => {
    if (activeFileId && findNodeById(workspaceTree, activeFileId)) {
      return;
    }

    const nextActiveFile = getFirstFile(workspaceTree);
    setActiveFileId(nextActiveFile?.id || null);
  }, [activeFileId, workspaceTree]);

  useEffect(() => {
    if (focusedNodeId && findNodeById(workspaceTree, focusedNodeId)) {
      return;
    }

    const nextActiveFile = getFirstFile(workspaceTree);
    setFocusedNodeId(nextActiveFile?.id || null);
  }, [focusedNodeId, workspaceTree]);

  const handleSelectNode = (node) => {
    setFocusedNodeId(node.id);

    if (node.type === "file") {
      setActiveFileId(node.id);
      setOpenFileIds((prev) => new Set([...prev, node.id]));
      setIsMobileExplorerOpen(false);
    }
  };

  const handleCloseFile = (file) => {
    setOpenFileIds((prev) => {
      const next = new Set(prev);
      next.delete(file.id);
      return next;
    });

    if (activeFileId === file.id) {
      const nextFile = Array.from(openFileIds).find((id) => id !== file.id);
      if (nextFile) {
        setActiveFileId(nextFile);
      } else {
        setActiveFileId(null);
      }
    }
  };

  const createWorkspaceNodeFromName = (type, rawName, parentIdOverride) => {
    const cleanedName = sanitizeInput(rawName).replace(/[\\/]/g, "").trim();
    const parentId = parentIdOverride === undefined ? createParentId : parentIdOverride;

    if (!cleanedName) {
      toast.error(`Enter a valid ${type} name`);
      return false;
    }

    const siblings = getFolderChildren(workspaceTree, parentId);
    const uniqueName = buildUniqueName(siblings, cleanedName);
    const nextNode = type === "folder"
      ? createWorkspaceNode({ type: "folder", name: uniqueName, children: [] })
      : createWorkspaceNode({ type: "file", name: uniqueName, content: "" });

    setWorkspaceTree((currentTree) => addNodeToWorkspace(currentTree, parentId, nextNode));
    setFocusedNodeId(nextNode.id);

    if (type === "file") {
      setActiveFileId(nextNode.id);
    }

    toast.success(`${type === "folder" ? "Folder" : "File"} created`);
    return true;
  };

  const handleCreateFile = (name, parentId) => createWorkspaceNodeFromName("file", name, parentId);
  const handleCreateFolder = (name, parentId) => createWorkspaceNodeFromName("folder", name, parentId);

  const handleQuickCreate = (type) => {
    const suggestedName = type === "folder" ? "src" : "main.py";
    const input = window.prompt(
      type === "folder" ? "Folder name" : "File name",
      suggestedName
    );

    if (!input) {
      return;
    }

    createWorkspaceNodeFromName(type, input);
  };

  const handleDeleteNode = (node) => {
    setNodeToDelete(node);
  };

  const confirmDeleteNode = () => {
    if (!nodeToDelete) return;

    setWorkspaceTree((currentTree) => {
      const nextTree = removeNodeById(currentTree, nodeToDelete.id);
      const nextActiveFile = activeFileId && findNodeById(nextTree, activeFileId)
        ? findNodeById(nextTree, activeFileId)
        : getFirstFile(nextTree);
      const nextFocusedNode = focusedNodeId && findNodeById(nextTree, focusedNodeId)
        ? findNodeById(nextTree, focusedNodeId)
        : nextActiveFile;

      setActiveFileId(nextActiveFile?.id || null);
      setFocusedNodeId(nextFocusedNode?.id || null);
      return nextTree;
    });

    // Remove from open files if it was open
    setOpenFileIds((prev) => {
      const next = new Set(prev);
      next.delete(nodeToDelete.id);
      return next;
    });

    // Remove from modified files
    setModifiedFileIds((prev) => {
      const next = new Set(prev);
      next.delete(nodeToDelete.id);
      return next;
    });
    
    setNodeToDelete(null);
  };

  const handleRenameNode = (nodeId, newName) => {
    const cleanedName = sanitizeInput(newName).replace(/[\\/]/g, "").trim();
    if (!cleanedName) return;
    setWorkspaceTree((currentTree) => renameNode(currentTree, nodeId, cleanedName));
    setModifiedFileIds((prev) => new Set([...prev, nodeId]));
  };

  const handleMoveNode = (nodeId, newParentId) => {
    setWorkspaceTree((currentTree) => {
      return moveNode(currentTree, nodeId, newParentId);
    });
    setModifiedFileIds((prev) => new Set([...prev, nodeId]));
  };

  const handleCodeChange = (nextCode) => {
    if (!activeFileId) {
      return;
    }

    setWorkspaceTree((currentTree) => updateNodeById(
      currentTree,
      activeFileId,
      (node) => ({ ...node, content: nextCode })
    ));

    setModifiedFileIds((prev) => new Set([...prev, activeFileId]));
  };

  const handleCopyInvite = async () => {
    const roomLink = `${window.location.origin}/room/${roomId}`;

    try {
      await navigator.clipboard.writeText(roomLink);
      toast.success("Invite link copied");
    } catch {
      toast.error("Could not copy invite link");
    }
  };

  const handleRun = async () => {
    if (!activeFileEntry || !roomId) {
      toast.error("Select a file to run");
      return;
    }

    setRunResult({
      status: "running",
      stdout: "",
      stderr: "",
      command: "",
      filePath: activeFileEntry.path,
    });
    setRunPanelSignal((current) => current + 1);

    try {
      await saveWorkspace(workspaceTree, true);

      const result = await secureFetch(
        API_ENDPOINTS.RUN_ROOM_FILE(roomId),
        {
          method: "POST",
          body: JSON.stringify({
            filePath: activeFileEntry.path,
            stdin,
          }),
        },
        token
      );

      setRunResult({
        status: "completed",
        ...result,
      });
      setRunPanelSignal((current) => current + 1);

      if (result.exitCode === 0) {
        toast.success("Run finished");
      } else {
        toast.error("Run finished with errors");
      }
    } catch (error) {
      setRunResult({
        status: "completed",
        stdout: "",
        stderr: error.message || "Could not run file",
        command: "",
        filePath: activeFileEntry.path,
        exitCode: null,
      });
      setRunPanelSignal((current) => current + 1);
      toast.error(error.message || "Could not run file");
    }
  };

  const toggleExplorer = () => {
    if (isMobileViewport) {
      setIsMobileExplorerOpen((current) => !current);
      return;
    }

    setIsDesktopExplorerOpen((current) => !current);
  };

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-white text-zinc-600 dark:bg-zinc-950 dark:text-zinc-300">
        <div className="flex items-center gap-3">
          <LoaderCircle className="animate-spin" size={18} />
          Loading room...
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-50 text-black dark:bg-[#09090b] dark:text-white">
      <Navbar
        theme={theme}
        onThemeChange={onThemeChange}
        minimal
        contextLabel="Room"
        contextValue={room?.name || roomId || ""}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {!isMobileViewport && (
          <FileExplorer
            workspaceLabel={room?.name || "Workspace"}
            tree={workspaceTree}
            activeFileId={activeFileId}
            focusedNodeId={focusedNodeId}
            onSelectNode={handleSelectNode}
            onDeleteNode={handleDeleteNode}
            onCreateFile={handleCreateFile}
            onCreateFolder={handleCreateFolder}
            onRenameNode={handleRenameNode}
            onMoveNode={handleMoveNode}
            isOpen={isDesktopExplorerOpen}
            onToggle={toggleExplorer}
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            room={room}
            activePath={activeFileEntry?.path}
            collaborators={room?.collaborators || []}
            explorerOpen={isMobileViewport ? isMobileExplorerOpen : isDesktopExplorerOpen}
            onToggleExplorer={toggleExplorer}
            sidebarOpen={isRightSidebarOpen}
            onToggleSidebar={() => setIsRightSidebarOpen(prev => !prev)}
            onCopyInvite={handleCopyInvite}
            onRun={handleRun}
            isRunning={runResult?.status === "running"}
            saveStatus={saveStatus}
            onOpenSettings={() => setIsSettingsOpen(true)}
          />

          {openFiles.length > 0 && (
            <TabBar
              openFiles={openFiles}
              activeFileId={activeFileId}
              modifiedFiles={modifiedFileIds}
              onSelectFile={(file) => setActiveFileId(file.id)}
              onCloseFile={handleCloseFile}
            />
          )}

          <div className="flex min-h-0 flex-1">
            <div className="flex flex-1 flex-col min-w-0">
              {activeFileEntry ? (
                <CodeEditor
                  selectedFileName={activeFileEntry.name}
                  selectedFilePath={activeFileEntry.path}
                  code={activeCode}
                  theme={theme}
                  onCodeChange={handleCodeChange}
                />
              ) : (
                <div className="flex flex-1 items-center justify-center bg-white dark:bg-zinc-950">
                  <div className="w-full max-w-md px-6 text-center">
                    <p className="text-lg font-semibold text-zinc-900 dark:text-white">
                      This room starts empty
                    </p>
                    <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                      Create a file or folder and the workspace will be saved for everyone in this room.
                    </p>
                    <div className="mt-6 flex justify-center gap-3">
                      <Button
                        onClick={() => handleQuickCreate("file")}
                        variant="outline"
                      >
                        <FilePlus2 size={16} className="mr-2" />
                        New File
                      </Button>
                      <Button
                        onClick={() => handleQuickCreate("folder")}
                        variant="outline"
                      >
                        <FolderPlus size={16} className="mr-2" />
                        New Folder
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            <RightSidebar
              isOpen={isRightSidebarOpen}
              onToggle={() => setIsRightSidebarOpen((prev) => !prev)}
              mobile={isMobileViewport}
              onClose={() => setIsRightSidebarOpen(false)}
            />
          </div>

          <BottomPanel
            key={runPanelSignal || "idle"}
            runResult={runResult}
            stdin={stdin}
            roomId={roomId}
            onStdinChange={setStdin}
            defaultMinimized={runPanelSignal === 0}
          />
        </div>
      </div>

      {isMobileViewport && (
        <>
          <FileExplorer
            mobile
            workspaceLabel={room?.name || "Workspace"}
            tree={workspaceTree}
            activeFileId={activeFileId}
            focusedNodeId={focusedNodeId}
            onSelectNode={handleSelectNode}
            onDeleteNode={handleDeleteNode}
            onCreateFile={handleCreateFile}
            onCreateFolder={handleCreateFolder}
            onRenameNode={handleRenameNode}
            onMoveNode={handleMoveNode}
            isOpen={isMobileExplorerOpen}
            onClose={() => setIsMobileExplorerOpen(false)}
          />
        </>
      )}

      <RoomSettingsModal
        room={room}
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onUpdate={(updatedRoom) => setRoom(updatedRoom)}
      />

      <ConfirmModal
        isOpen={!!nodeToDelete}
        title={`Delete "${nodeToDelete?.name}"?`}
        description={`This will permanently delete the ${nodeToDelete?.type}.`}
        confirmText="Delete"
        cancelText="Cancel"
        isDestructive={true}
        onConfirm={confirmDeleteNode}
        onCancel={() => setNodeToDelete(null)}
      />
    </div>
  );
}