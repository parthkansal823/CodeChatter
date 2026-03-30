import { useLocation, useNavigate, useParams } from "react-router-dom";

import BottomPanel from "../components/BottomPanel";
import CodeEditor from "../components/CodeEditor";
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

export default function CodeRoom({ theme = "vs-dark", onThemeChange }) {
  const { roomId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { token, user } = useAuth();

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
            canEdit={canEditRoom}
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            room={room}
            activePath={activeFileEntry?.path}
            collaborators={room?.collaborators || []}
            activeCollaborators={activeCollaborators}
            explorerOpen={isMobileViewport ? isMobileExplorerOpen : isDesktopExplorerOpen}
            onToggleExplorer={toggleExplorer}
            sidebarOpen={isRightSidebarOpen}
            onToggleSidebar={() => setIsRightSidebarOpen((prev) => !prev)}
            onCopyInvite={handleCopyInvite}
            onRun={handleRun}
            isRunning={runResult?.status === "running"}
            saveStatus={saveStatus}
            liveConnected={isRealtimeConnected}
            canEdit={canEditRoom}
            canRun={canUseTerminal}
            canManageRoom={canManageRoom}
            pendingJoinRequestCount={pendingJoinRequestCount}
            onOpenSettings={() => setIsSettingsOpen(true)}
          />

          {openFiles.length > 0 && (
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
                <CodeEditor
                  selectedFileName={activeFileEntry.name}
                  selectedFilePath={activeFileEntry.path}
                  code={activeCode}
                  theme={theme}
                  onCodeChange={handleCodeChange}
                  onCursorChange={handleCursorChange}
                  remoteCursors={remoteCursors}
                  readOnly={!canEditRoom}
                />
              ) : (
                <EmptyWorkspaceState
                  onCreateFile={() => handleQuickCreate("file")}
                  onCreateFolder={() => handleQuickCreate("folder")}
                />
              )}
            </div>

            <RightSidebar
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
              saveStatus={saveStatus}
              liveConnected={isRealtimeConnected}
              chatMessages={chatMessages}
              sendChatMessage={sendChatMessage}
              sendVideoSignal={sendVideoSignal}
              setVideoSignalListener={setVideoSignalListener}
              unreadChatMessagesCount={unreadChatMessagesCount}
              setUnreadChatMessagesCount={setUnreadChatMessagesCount}
            />
          </div>

          <BottomPanel
            key={runPanelSignal || "idle"}
            runResult={runResult}
            stdin={stdin}
            roomId={roomId}
            onStdinChange={setStdin}
            defaultMinimized={runPanelSignal === 0}
            runEnabled={canEditRoom}
            terminalEnabled={canUseTerminal}
          />
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

    </div>
  );
}
