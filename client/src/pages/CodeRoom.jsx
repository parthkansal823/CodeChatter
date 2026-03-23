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
import { API_ENDPOINTS, getWebSocketBaseUrl } from "../config/security";
import {
  dedupePresenceByUser,
  generateRequestId,
  getPresenceColor,
} from "../utils/collaboration";
import { sanitizeInput, secureFetch } from "../utils/security";
import {
  addNodeToWorkspace,
  buildUniqueName,
  createWorkspaceNode,
  findNodeById,
  flattenWorkspaceTree,
  getFirstFile,
  getFolderChildren,
  moveNode,
  removeNodeById,
  renameNode,
  updateNodeById,
} from "../utils/workspace";

export default function CodeRoom({ theme = "vs-dark", onThemeChange }) {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { token, user } = useAuth();
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
  const [presenceSessions, setPresenceSessions] = useState([]);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const [collaborationSessionId, setCollaborationSessionId] = useState(null);
  const [roomAccessReady, setRoomAccessReady] = useState(false);
  const [collaborationRetryTick, setCollaborationRetryTick] = useState(0);

  const saveSnapshotRef = useRef("");
  const latestWorkspaceSnapshotRef = useRef("");
  const hasHydratedWorkspaceRef = useRef(false);
  const workspaceTreeRef = useRef([]);
  const activeFileIdRef = useRef(null);
  const focusedNodeIdRef = useRef(null);
  const openFileIdsRef = useRef(new Set());
  const activeFilePathRef = useRef(null);
  const collaborationSocketRef = useRef(null);
  const pendingWorkspaceRequestsRef = useRef(new Map());
  const cursorBroadcastTimeoutRef = useRef(null);
  const collaborationReconnectTimeoutRef = useRef(null);
  const collaborationHeartbeatIntervalRef = useRef(null);
  const typingStopTimeoutRef = useRef(null);
  const lastTypingBroadcastAtRef = useRef(0);

  const workspaceEntries = useMemo(() => flattenWorkspaceTree(workspaceTree), [workspaceTree]);
  const activeFileEntry = workspaceEntries.find((entry) => {
    return entry.id === activeFileId && entry.type === "file";
  }) || null;
  const focusedEntry = workspaceEntries.find((entry) => entry.id === focusedNodeId) || null;
  const createParentId = focusedEntry?.type === "folder"
    ? focusedEntry.id
    : focusedEntry?.parentId || null;
  const activeCode = activeFileEntry?.node?.content || "";
  const activeFilePath = activeFileEntry?.path || null;

  const openFiles = useMemo(() => {
    return Array.from(openFileIds)
      .map((fileId) => workspaceEntries.find((entry) => entry.id === fileId && entry.type === "file"))
      .filter(Boolean);
  }, [openFileIds, workspaceEntries]);

  const activeCollaborators = useMemo(() => {
    return dedupePresenceByUser(presenceSessions, user?.id).map((session) => {
      return {
        ...session,
        color: getPresenceColor(session.userId || session.sessionId),
      };
    });
  }, [presenceSessions, user?.id]);

  const remoteCursors = useMemo(() => {
    if (!activeFilePath) {
      return [];
    }

    return presenceSessions
      .filter((session) => {
        return (
          session.sessionId !== collaborationSessionId
          && session.cursor?.filePath === activeFilePath
        );
      })
      .map((session) => {
        return {
          sessionId: session.sessionId,
          userId: session.userId,
          username: session.username,
          line: session.cursor.line,
          column: session.cursor.column,
          color: getPresenceColor(session.userId || session.sessionId),
        };
      });
  }, [activeFilePath, collaborationSessionId, presenceSessions]);

  useEffect(() => {
    workspaceTreeRef.current = workspaceTree;
  }, [workspaceTree]);

  useEffect(() => {
    activeFileIdRef.current = activeFileId;
  }, [activeFileId]);

  useEffect(() => {
    focusedNodeIdRef.current = focusedNodeId;
  }, [focusedNodeId]);

  useEffect(() => {
    openFileIdsRef.current = openFileIds;
  }, [openFileIds]);

  useEffect(() => {
    activeFilePathRef.current = activeFilePath;
  }, [activeFilePath]);

  useEffect(() => {
    return () => {
      if (typingStopTimeoutRef.current) {
        window.clearTimeout(typingStopTimeoutRef.current);
      }
    };
  }, []);

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

  const sendCollaborationMessage = useCallback((payload) => {
    const socket = collaborationSocketRef.current;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    socket.send(JSON.stringify(payload));
    return true;
  }, []);

  const applyRoomData = useCallback((roomData, options = {}) => {
    const { preserveSelection = false } = options;
    const nextTree = roomData?.workspaceTree || [];
    const nextSnapshot = JSON.stringify(nextTree);
    const nextEntries = flattenWorkspaceTree(nextTree);
    const validEntryIds = new Set(nextEntries.map((entry) => entry.id));
    const validFileIds = new Set(
      nextEntries
        .filter((entry) => entry.type === "file")
        .map((entry) => entry.id)
    );
    const nextActiveFile = getFirstFile(nextTree);

    startTransition(() => {
      setRoom(roomData);
      setWorkspaceTree(nextTree);
      setModifiedFileIds(new Set());
      setSaveStatus("saved");

      if (!preserveSelection) {
        const initialActiveFileId = nextActiveFile?.id || null;
        setOpenFileIds(initialActiveFileId ? new Set([initialActiveFileId]) : new Set());
        setActiveFileId(initialActiveFileId);
        setFocusedNodeId(initialActiveFileId);
        return;
      }

      const preservedOpenFileIds = Array.from(openFileIdsRef.current).filter((fileId) => {
        return validFileIds.has(fileId);
      });

      let resolvedActiveFileId = null;
      if (activeFileIdRef.current && validFileIds.has(activeFileIdRef.current)) {
        resolvedActiveFileId = activeFileIdRef.current;
      } else if (preservedOpenFileIds.length > 0) {
        [resolvedActiveFileId] = preservedOpenFileIds;
      } else {
        resolvedActiveFileId = nextActiveFile?.id || null;
      }

      if (resolvedActiveFileId && !preservedOpenFileIds.includes(resolvedActiveFileId)) {
        preservedOpenFileIds.unshift(resolvedActiveFileId);
      }

      const resolvedFocusedNodeId = focusedNodeIdRef.current && validEntryIds.has(focusedNodeIdRef.current)
        ? focusedNodeIdRef.current
        : resolvedActiveFileId || nextActiveFile?.id || null;

      setOpenFileIds(new Set(preservedOpenFileIds));
      setActiveFileId(resolvedActiveFileId);
      setFocusedNodeId(resolvedFocusedNodeId);
    });

    saveSnapshotRef.current = nextSnapshot;
    latestWorkspaceSnapshotRef.current = nextSnapshot;
    hasHydratedWorkspaceRef.current = true;
    pendingWorkspaceRequestsRef.current.clear();
  }, []);

  const handleWorkspaceAck = useCallback((message) => {
    const requestId = message?.requestId;
    if (!requestId) {
      return;
    }

    const outgoingSnapshot = pendingWorkspaceRequestsRef.current.get(requestId);
    if (!outgoingSnapshot) {
      return;
    }

    pendingWorkspaceRequestsRef.current.delete(requestId);

    const persistedSnapshot = JSON.stringify(message?.room?.workspaceTree || workspaceTreeRef.current);
    saveSnapshotRef.current = persistedSnapshot;

    if (
      message?.room
      && latestWorkspaceSnapshotRef.current === outgoingSnapshot
      && persistedSnapshot !== outgoingSnapshot
    ) {
      applyRoomData(message.room, { preserveSelection: true });
      return;
    }

    if (message?.room) {
      setRoom(message.room);
    }

    if (
      latestWorkspaceSnapshotRef.current === outgoingSnapshot
      || latestWorkspaceSnapshotRef.current === persistedSnapshot
    ) {
      setSaveStatus("saved");
      setModifiedFileIds(new Set());
    } else {
      setSaveStatus("saving");
    }
  }, [applyRoomData]);

  const saveWorkspace = useCallback(async (nextTree, notifyError = false) => {
    if (!token || !roomId) {
      return null;
    }

    try {
      const outgoingSnapshot = JSON.stringify(nextTree);
      pendingWorkspaceRequestsRef.current.clear();
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

      if (
        latestWorkspaceSnapshotRef.current === outgoingSnapshot
        || latestWorkspaceSnapshotRef.current === persistedSnapshot
      ) {
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
      setRoomAccessReady(false);
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
          setRoomAccessReady(true);
        }
      } catch (error) {
        if (isMounted) {
          toast.error(error.message || "Could not open room");
          setRoomAccessReady(false);
          navigate("/home", { replace: true });
        }
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
    if (!token || !roomId || !roomAccessReady) {
      return undefined;
    }

    let isDisposed = false;
    let shouldReconnect = true;
    const socket = new WebSocket(
      `${getWebSocketBaseUrl()}/api/rooms/${roomId}/collaborate?token=${encodeURIComponent(token)}`
    );
    const pendingWorkspaceRequests = pendingWorkspaceRequestsRef.current;
    collaborationSocketRef.current = socket;
    setIsRealtimeConnected(false);
    setCollaborationSessionId(null);

    const clearHeartbeat = () => {
      if (collaborationHeartbeatIntervalRef.current) {
        window.clearInterval(collaborationHeartbeatIntervalRef.current);
        collaborationHeartbeatIntervalRef.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (isDisposed || !shouldReconnect || typeof window === "undefined") {
        return;
      }

      if (collaborationReconnectTimeoutRef.current) {
        window.clearTimeout(collaborationReconnectTimeoutRef.current);
      }

      collaborationReconnectTimeoutRef.current = window.setTimeout(() => {
        setCollaborationRetryTick((current) => current + 1);
      }, 900);
    };

    socket.onopen = () => {
      clearHeartbeat();
      collaborationHeartbeatIntervalRef.current = window.setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "ping" }));
        }
      }, 15000);
    };

    socket.onmessage = (event) => {
      let message = null;

      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (message.type === "session_ready") {
        if (collaborationReconnectTimeoutRef.current) {
          window.clearTimeout(collaborationReconnectTimeoutRef.current);
          collaborationReconnectTimeoutRef.current = null;
        }
        setCollaborationSessionId(message.sessionId || null);
        setIsRealtimeConnected(true);
        setPresenceSessions(Array.isArray(message.presence) ? message.presence : []);

        if (message.room) {
          applyRoomData(message.room, { preserveSelection: true });
        }
        return;
      }

      if (message.type === "pong") {
        return;
      }

      if (message.type === "presence_snapshot") {
        setPresenceSessions(Array.isArray(message.presence) ? message.presence : []);
        return;
      }

      if (message.type === "workspace_updated") {
        if (message.room) {
          applyRoomData(message.room, { preserveSelection: true });
        }
        return;
      }

      if (message.type === "workspace_ack") {
        handleWorkspaceAck(message);
        return;
      }

      if (message.type === "error") {
        console.error("Collaboration error:", message.detail || "Unknown error");

        if (
          typeof message.detail === "string"
          && /(access|auth|token|room not found)/i.test(message.detail)
        ) {
          shouldReconnect = false;
        }
      }
    };

    socket.onclose = () => {
      clearHeartbeat();

      if (collaborationSocketRef.current === socket) {
        collaborationSocketRef.current = null;
      }
      setIsRealtimeConnected(false);
      setCollaborationSessionId(null);
      setPresenceSessions([]);
      pendingWorkspaceRequests.clear();

      if (latestWorkspaceSnapshotRef.current !== saveSnapshotRef.current) {
        setSaveStatus("error");
      }

      scheduleReconnect();
    };

    socket.onerror = () => {
      setIsRealtimeConnected(false);
    };

    return () => {
      isDisposed = true;
      shouldReconnect = false;

      if (collaborationSocketRef.current === socket) {
        collaborationSocketRef.current = null;
      }

      pendingWorkspaceRequests.clear();
      setIsRealtimeConnected(false);
      setCollaborationSessionId(null);
      setPresenceSessions([]);
      clearHeartbeat();

      if (cursorBroadcastTimeoutRef.current) {
        window.clearTimeout(cursorBroadcastTimeoutRef.current);
      }

      if (typingStopTimeoutRef.current) {
        window.clearTimeout(typingStopTimeoutRef.current);
      }

      if (collaborationReconnectTimeoutRef.current) {
        window.clearTimeout(collaborationReconnectTimeoutRef.current);
      }

      socket.close();
    };
  }, [applyRoomData, collaborationRetryTick, handleWorkspaceAck, roomAccessReady, roomId, token]);

  useEffect(() => {
    if (!token || !roomId || !roomAccessReady || isRealtimeConnected) {
      return undefined;
    }

    let isCancelled = false;

    const refreshRoom = async () => {
      if (latestWorkspaceSnapshotRef.current !== saveSnapshotRef.current) {
        return;
      }

      try {
        const roomData = await secureFetch(API_ENDPOINTS.GET_ROOM(roomId), {}, token);

        if (isCancelled) {
          return;
        }

        const incomingSnapshot = JSON.stringify(roomData?.workspaceTree || []);

        if (incomingSnapshot !== latestWorkspaceSnapshotRef.current) {
          applyRoomData(roomData, { preserveSelection: true });
          return;
        }

        setRoom(roomData);
      } catch {
        // Keep retrying while realtime is offline.
      }
    };

    const intervalId = window.setInterval(refreshRoom, 2000);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, [applyRoomData, isRealtimeConnected, roomAccessReady, roomId, token]);

  useEffect(() => {
    if (!token || !roomId || !roomAccessReady || isRealtimeConnected) {
      return undefined;
    }

    const triggerReconnect = () => {
      setCollaborationRetryTick((current) => current + 1);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        triggerReconnect();
      }
    };

    window.addEventListener("online", triggerReconnect);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("online", triggerReconnect);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isRealtimeConnected, roomAccessReady, roomId, token]);

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
      const requestId = generateRequestId();

      if (isRealtimeConnected) {
        const messageSent = sendCollaborationMessage({
          type: "workspace_update",
          requestId,
          tree: workspaceTreeRef.current,
          activeFilePath: activeFilePathRef.current,
        });

        if (messageSent) {
          pendingWorkspaceRequestsRef.current.set(requestId, nextSnapshot);
          return;
        }
      }

      saveWorkspace(workspaceTreeRef.current).catch(() => {});
    }, 180);

    return () => window.clearTimeout(timeoutId);
  }, [isRealtimeConnected, roomId, saveWorkspace, sendCollaborationMessage, token, workspaceTree]);

  useEffect(() => {
    if (!isRealtimeConnected) {
      return;
    }

    sendCollaborationMessage({
      type: "presence_update",
      activeFilePath,
    });
  }, [activeFilePath, isRealtimeConnected, sendCollaborationMessage]);

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
    setOpenFileIds((currentOpenFileIds) => {
      const next = new Set(currentOpenFileIds);
      next.delete(file.id);

      if (activeFileIdRef.current === file.id) {
        const [nextFileId] = Array.from(next);
        setActiveFileId(nextFileId || null);
      }

      return next;
    });
  };

  const createWorkspaceNodeFromName = (type, rawName, parentIdOverride) => {
    const cleanedName = sanitizeInput(rawName).replace(/[\\/]/g, "").trim();
    const parentId = parentIdOverride === undefined ? createParentId : parentIdOverride;

    if (!cleanedName) {
      toast.error(`Enter a valid ${type} name`);
      return false;
    }

    const siblings = getFolderChildren(workspaceTreeRef.current, parentId);
    const uniqueName = buildUniqueName(siblings, cleanedName);
    const nextNode = type === "folder"
      ? createWorkspaceNode({ type: "folder", name: uniqueName, children: [] })
      : createWorkspaceNode({ type: "file", name: uniqueName, content: "" });

    setWorkspaceTree((currentTree) => addNodeToWorkspace(currentTree, parentId, nextNode));
    setFocusedNodeId(nextNode.id);

    if (type === "file") {
      setActiveFileId(nextNode.id);
      setOpenFileIds((currentOpenFileIds) => new Set([...currentOpenFileIds, nextNode.id]));
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
    if (!nodeToDelete) {
      return;
    }

    setWorkspaceTree((currentTree) => {
      const nextTree = removeNodeById(currentTree, nodeToDelete.id);
      const nextActiveFile = activeFileIdRef.current && findNodeById(nextTree, activeFileIdRef.current)
        ? findNodeById(nextTree, activeFileIdRef.current)
        : getFirstFile(nextTree);
      const nextFocusedNode = focusedNodeIdRef.current && findNodeById(nextTree, focusedNodeIdRef.current)
        ? findNodeById(nextTree, focusedNodeIdRef.current)
        : nextActiveFile;

      setActiveFileId(nextActiveFile?.id || null);
      setFocusedNodeId(nextFocusedNode?.id || null);
      return nextTree;
    });

    setOpenFileIds((prev) => {
      const next = new Set(prev);
      next.delete(nodeToDelete.id);
      return next;
    });

    setModifiedFileIds((prev) => {
      const next = new Set(prev);
      next.delete(nodeToDelete.id);
      return next;
    });

    setNodeToDelete(null);
  };

  const handleRenameNode = (nodeId, newName) => {
    const cleanedName = sanitizeInput(newName).replace(/[\\/]/g, "").trim();
    if (!cleanedName) {
      return;
    }

    setWorkspaceTree((currentTree) => renameNode(currentTree, nodeId, cleanedName));
    setModifiedFileIds((prev) => new Set([...prev, nodeId]));
  };

  const handleMoveNode = (nodeId, newParentId) => {
    setWorkspaceTree((currentTree) => moveNode(currentTree, nodeId, newParentId));
    setModifiedFileIds((prev) => new Set([...prev, nodeId]));
  };

  const handleCodeChange = (nextCode) => {
    if (!activeFileIdRef.current) {
      return;
    }

    setWorkspaceTree((currentTree) => updateNodeById(
      currentTree,
      activeFileIdRef.current,
      (node) => ({ ...node, content: nextCode })
    ));

    setModifiedFileIds((prev) => new Set([...prev, activeFileIdRef.current]));

    if (!isRealtimeConnected || !activeFilePathRef.current) {
      return;
    }

    const now = Date.now();
    if (now - lastTypingBroadcastAtRef.current >= 350) {
      sendCollaborationMessage({
        type: "typing_update",
        activeFilePath: activeFilePathRef.current,
        isTyping: true,
      });
      lastTypingBroadcastAtRef.current = now;
    }

    if (typingStopTimeoutRef.current) {
      window.clearTimeout(typingStopTimeoutRef.current);
    }

    typingStopTimeoutRef.current = window.setTimeout(() => {
      sendCollaborationMessage({
        type: "typing_update",
        activeFilePath: activeFilePathRef.current,
        isTyping: false,
      });
    }, 1200);
  };

  const handleCursorChange = useCallback((nextCursor) => {
    if (!isRealtimeConnected) {
      return;
    }

    if (cursorBroadcastTimeoutRef.current) {
      window.clearTimeout(cursorBroadcastTimeoutRef.current);
    }

    cursorBroadcastTimeoutRef.current = window.setTimeout(() => {
      sendCollaborationMessage({
        type: "cursor_update",
        activeFilePath: activeFilePathRef.current,
        line: nextCursor.line,
        column: nextCursor.column,
      });
    }, 50);
  }, [isRealtimeConnected, sendCollaborationMessage]);

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
      await saveWorkspace(workspaceTreeRef.current, true);

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
            onOpenSettings={() => setIsSettingsOpen(true)}
          />

          {openFiles.length > 0 && (
            <TabBar
              openFiles={openFiles}
              activeFileId={activeFileId}
              modifiedFiles={modifiedFileIds}
              onSelectFile={(file) => {
                setActiveFileId(file.id);
                setFocusedNodeId(file.id);
              }}
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
