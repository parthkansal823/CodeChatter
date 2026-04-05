import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { Minimize2 } from "lucide-react";

import BottomPanel from "../components/BottomPanel";
import CodeEditor from "../components/CodeEditor";
import NotebookEditor from "../components/NotebookEditor";
import ConfirmModal from "../components/ConfirmModal";
import EmptyWorkspaceState from "../components/code-room/EmptyWorkspaceState";
import LoadingRoomScreen from "../components/code-room/LoadingRoomScreen";
import PendingRoomAccessScreen from "../components/code-room/PendingRoomAccessScreen";
import FileExplorer from "../components/FileExplorer";
import Navbar from "../components/Navbar";
import RightSidebar from "../components/RightSidebar";
import RoomSettingsModal from "../components/RoomSettingsModal";
import TabBar from "../components/TabBar";
import TopBar from "../components/TopBar";
import { useAuth } from "../hooks/useAuth";
import { useCodeRoomState } from "../hooks/code-room/useCodeRoomState";
import { useRunNotifications, useCollaboratorNotifications } from "../hooks/useRunNotifications";
import RoomTutorial from "../components/RoomTutorial";
import { countFiles, flattenWorkspaceTree } from "../utils/workspace";

export default function CodeRoom({ theme = "vs-dark", onThemeChange }) {
  const { roomId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const [focusMode, setFocusMode] = useState(false);
  const [requestedSidebarFeature, setRequestedSidebarFeature] = useState(null);
  const handleOpenTutorial = useCallback(() => {
    window.dispatchEvent(new CustomEvent("cc-open-room-tutorial"));
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "Z") {
        e.preventDefault();
        setFocusMode(v => !v);
      }
      if (e.key === "Escape" && focusMode) {
        setFocusMode(false);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [focusMode]);

  const {
    room,
    setRoom,
    workspaceTree,
    activeFileId,
    focusedNodeId,
    modifiedFileIds,
    isLoading,
    isMobileViewport,
    isDesktopExplorerOpen,
    isMobileExplorerOpen,
    setIsMobileExplorerOpen,
    isRightSidebarOpen,
    setIsRightSidebarOpen,
    isSettingsOpen,
    setIsSettingsOpen,
    saveStatus,
    stdin,
    setStdin,
    runResult,
    runPanelSignal,
    nodeToDelete,
    setNodeToDelete,
    isRealtimeConnected,
    activeFileEntry,
    activeCode,
    openFiles,
    activeCollaborators,
    remoteCursors,
    pendingAccessState,
    isRefreshingPendingAccess,
    pendingJoinRequestCount,
    handleSelectNode,
    handleOpenFile,
    handleCloseFile,
    handleDeleteNode,
    confirmDeleteNode,
    handleCreateFile,
    handleCreateFolder,
    handleQuickCreate,
    handleRenameNode,
    handleMoveNode,
    handleCodeChange,
    handleCursorChange,
    handleCopyInvite,
    handleRun,
    toggleExplorer,
    refreshPendingAccess,
    canEditRoom,
    canRunRoom,
    canUseTerminal,
    canManageRoom,
    chatMessages,
    sendChatMessage,
    sendVideoSignal,
    setVideoSignalListener,
    unreadChatMessagesCount,
    setUnreadChatMessagesCount,
  } = useCodeRoomState({
    roomId,
    locationSearch: location.search,
    navigate,
    token,
    user,
  });
  const workspaceEntries = useMemo(() => flattenWorkspaceTree(workspaceTree), [workspaceTree]);
  const workspaceFileCount = useMemo(() => countFiles(workspaceTree), [workspaceTree]);
  const workspaceFolderCount = useMemo(
    () => workspaceEntries.filter((entry) => entry.type === "folder").length,
    [workspaceEntries],
  );
  const workspaceFiles = useMemo(
    () =>
      workspaceEntries
        .filter((entry) => entry.type === "file")
        .map((entry) => ({
          id: entry.id,
          name: entry.name,
          path: entry.path,
          isActive: entry.id === activeFileId,
          isOpen: openFiles.some((file) => file.id === entry.id),
        })),
    [activeFileId, openFiles, workspaceEntries],
  );

  const openSidebarTool = useCallback((toolId) => {
    setIsRightSidebarOpen(true);
    setRequestedSidebarFeature({ toolId, nonce: Date.now() });
  }, [setIsRightSidebarOpen]);

  useEffect(() => {
    const openFileFromPalette = (fileId) => {
      const entry = workspaceEntries.find((item) => item.id === fileId && item.type === "file");
      if (entry) {
        handleOpenFile(entry);
      }
    };

    window.dispatchEvent(new CustomEvent("cc-room-command-context", {
      detail: {
        roomId,
        roomName: room?.name || "Workspace",
        canEdit: canEditRoom,
        canRun: canRunRoom,
        canManage: canManageRoom,
        files: workspaceFiles,
        actions: {
          openFile: openFileFromPalette,
          createFile: () => handleQuickCreate("file"),
          createFolder: () => handleQuickCreate("folder"),
          runActiveFile: handleRun,
          copyInvite: handleCopyInvite,
          openTutorial: handleOpenTutorial,
          toggleExplorer,
          toggleSidebar: () => setIsRightSidebarOpen((current) => !current),
          openTool: openSidebarTool,
          openSettings: () => setIsSettingsOpen(true),
        },
      },
    }));
  }, [
    canEditRoom,
    canManageRoom,
    canRunRoom,
    handleCopyInvite,
    handleOpenFile,
    handleOpenTutorial,
    handleRun,
    handleQuickCreate,
    openSidebarTool,
    room?.name,
    roomId,
    setIsSettingsOpen,
    setIsRightSidebarOpen,
    toggleExplorer,
    workspaceEntries,
    workspaceFiles,
  ]);

  useEffect(() => {
    return () => {
      window.dispatchEvent(new CustomEvent("cc-room-command-context", { detail: null }));
    };
  }, []);

  // Auto-fire notifications after state is available
  useRunNotifications(runResult, roomId, room?.name);
  useCollaboratorNotifications(activeCollaborators, roomId, room?.name);

  if (isLoading) {
    return <LoadingRoomScreen />;
  }

  if (pendingAccessState) {
    return (
      <div className="flex min-h-screen flex-col bg-[#09090b] text-white">
        <Navbar
          theme={theme}
          onThemeChange={onThemeChange}
          minimal
          contextLabel="Lobby"
          contextValue={pendingAccessState.roomName || roomId || ""}
        />
        <PendingRoomAccessScreen
          roomId={pendingAccessState.roomId || roomId}
          roomName={pendingAccessState.roomName}
          status={pendingAccessState.status}
          message={pendingAccessState.message}
          requestedAt={pendingAccessState.requestedAt}
          accessRole={pendingAccessState.accessRole}
          isRefreshing={isRefreshingPendingAccess}
          onRefresh={() => refreshPendingAccess()}
          onGoHome={() => navigate("/home")}
        />
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-zinc-50 text-black dark:bg-[#09090b] dark:text-white">
      {!focusMode && (
        <Navbar
          theme={theme}
          onThemeChange={onThemeChange}
          minimal
          contextLabel="Room"
          contextValue={room?.name || roomId || ""}
        />
      )}

      {/* Focus mode exit pill */}
      <AnimatePresence>
        {focusMode && (
          <Motion.button
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ type: "spring", stiffness: 400, damping: 28 }}
            onClick={() => setFocusMode(false)}
            className="absolute left-1/2 top-3 z-50 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-zinc-900/80 px-3 py-1.5 text-[11px] font-medium text-zinc-300 shadow-xl backdrop-blur-sm hover:bg-zinc-800 dark:bg-zinc-100/10 dark:text-zinc-200 sm:px-4 sm:text-xs"
          >
            <Minimize2 size={12} />
            <span className="whitespace-nowrap">Focus mode</span>
            <span className="hidden whitespace-nowrap sm:inline">- press Esc or Ctrl+Shift+Z to exit</span>
          </Motion.button>
        )}
      </AnimatePresence>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {!focusMode && !isMobileViewport && (
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
            canEdit={canEditRoom}
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {!focusMode && (
              <TopBar
                room={room}
                activePath={activeFileEntry?.path}
                collaborators={room?.collaborators || []}
                activeCollaborators={activeCollaborators}
                fileCount={workspaceFileCount}
                folderCount={workspaceFolderCount}
                openFileCount={openFiles.length}
                explorerOpen={isMobileViewport ? isMobileExplorerOpen : isDesktopExplorerOpen}
                onToggleExplorer={toggleExplorer}
                onCopyInvite={handleCopyInvite}
                onRun={handleRun}
                isRunning={runResult?.status === "running"}
                saveStatus={saveStatus}
                liveConnected={isRealtimeConnected}
                canRun={canRunRoom}
                canManageRoom={canManageRoom}
                pendingJoinRequestCount={pendingJoinRequestCount}
                onOpenSettings={() => setIsSettingsOpen(true)}
              />
          )}

          {!focusMode && openFiles.length > 0 && (
            <TabBar
              openFiles={openFiles}
              activeFileId={activeFileId}
              modifiedFiles={modifiedFileIds}
              onSelectFile={handleOpenFile}
              onCloseFile={handleCloseFile}
            />
          )}

          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              {activeFileEntry ? (
                activeFileEntry.name.endsWith(".nb") ? (
                  <NotebookEditor
                    code={activeCode}
                    onCodeChange={handleCodeChange}
                    readOnly={!canEditRoom}
                    roomId={roomId}
                  />
                ) : (
                <CodeEditor
                  selectedFileName={activeFileEntry.name}
                  selectedFilePath={activeFileEntry.path}
                  code={activeCode}
                  theme={theme}
                  onCodeChange={handleCodeChange}
                  onCursorChange={handleCursorChange}
                  remoteCursors={remoteCursors}
                  readOnly={!canEditRoom}
                  roomId={roomId}
                />
                )
              ) : (
                <EmptyWorkspaceState
                  onCreateFile={() => handleQuickCreate("file")}
                  onCreateFolder={() => handleQuickCreate("folder")}
                  onCreateStarterFile={(name) => handleCreateFile(name, null)}
                  onOpenTutorial={handleOpenTutorial}
                />
              )}
            </div>

            {!focusMode && (
              <RightSidebar
                key={requestedSidebarFeature?.nonce || "workspace-sidebar"}
                isOpen={isRightSidebarOpen}
                onToggle={() => setIsRightSidebarOpen((prev) => !prev)}
                mobile={isMobileViewport}
                onClose={() => setIsRightSidebarOpen(false)}
                room={room}
                roomId={roomId}
                activeFilePath={activeFileEntry?.path}
                activeCode={activeCode}
                runResult={runResult}
                activeCollaborators={activeCollaborators}
                liveConnected={isRealtimeConnected}
                fileCount={workspaceFileCount}
                folderCount={workspaceFolderCount}
                openFileCount={openFiles.length}
                accessRole={room?.accessRole}
                chatMessages={chatMessages}
                sendChatMessage={sendChatMessage}
                sendVideoSignal={sendVideoSignal}
                setVideoSignalListener={setVideoSignalListener}
                unreadChatMessagesCount={unreadChatMessagesCount}
                setUnreadChatMessagesCount={setUnreadChatMessagesCount}
                initialFeature={requestedSidebarFeature?.toolId || null}
              />
            )}
          </div>

          {!focusMode && (
            <BottomPanel
              key={runPanelSignal || "idle"}
              runResult={runResult}
              stdin={stdin}
              roomId={roomId}
              onStdinChange={setStdin}
              defaultMinimized={runPanelSignal === 0}
              runEnabled={canRunRoom}
              terminalEnabled={canUseTerminal}
            />
          )}
        </div>
      </div>

      {isMobileViewport && (
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
          canEdit={canEditRoom}
        />
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

      <RoomTutorial />
    </div>
  );
}
