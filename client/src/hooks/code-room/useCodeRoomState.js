import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import toast from "react-hot-toast";

import { API_ENDPOINTS, getWebSocketBaseUrl } from "../../config/security";
import { useResponsiveViewport } from "../ui/useResponsiveViewport";
import {
  dedupePresenceByUser,
  generateRequestId,
  getPresenceColor,
} from "../../utils/collaboration";
import { buildRoomInviteLink, getInviteTokenFromSearch } from "../../utils/room/invite";
import { sanitizeInput, secureFetch } from "../../utils/security";
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
} from "../../utils/workspace";
import { encryptText, decryptText } from "../../utils/crypto";

export function useCodeRoomState({
  roomId,
  locationSearch,
  navigate,
  token,
  user,
}) {
  const [room, setRoom] = useState(null);
  const [workspaceTree, setWorkspaceTree] = useState([]);
  const [activeFileId, setActiveFileId] = useState(null);
  const [focusedNodeId, setFocusedNodeId] = useState(null);
  const [openFileIds, setOpenFileIds] = useState(new Set());
  const [modifiedFileIds, setModifiedFileIds] = useState(new Set());
  const [isLoading, setIsLoading] = useState(true);
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
  const [pendingAccessState, setPendingAccessState] = useState(null);
  const [isRefreshingPendingAccess, setIsRefreshingPendingAccess] = useState(false);
  const [chatMessages, setChatMessages] = useState([
    { id: 1, text: "Welcome to the room chat! Messages are end-to-end encrypted and only visible to current collaborators.", sender: "System", isSystem: true, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
  ]);
  const [unreadChatMessagesCount, setUnreadChatMessagesCount] = useState(0);

  const isMobileViewport = useResponsiveViewport();
  const inviteToken = useMemo(() => getInviteTokenFromSearch(locationSearch), [locationSearch]);

  const videoSignalListenerRef = useRef(null);

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
  const lastCursorBroadcastRef = useRef(null);
  const lastPresenceFilePathRef = useRef(null);
  const ownerPendingRequestCountRef = useRef(null);

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
  const canEditRoom = Boolean(room?.canEdit);
  const canRunRoom = Boolean(room?.canRun ?? room?.canEdit);
  const canUseTerminal = Boolean(room?.canUseTerminal);
  const canManageRoom = Boolean(room?.canManage ?? (room?.ownerIds?.includes(user?.id) || room?.ownerId === user?.id));

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
    lastCursorBroadcastRef.current = null;
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

  const sendCollaborationMessage = useCallback((payload) => {
    const socket = collaborationSocketRef.current;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    socket.send(JSON.stringify(payload));
    return true;
  }, []);

  const sendVideoSignal = useCallback((payload) => {
    sendCollaborationMessage(payload);
  }, [sendCollaborationMessage]);

  const setVideoSignalListener = useCallback((fn) => {
    videoSignalListenerRef.current = fn;
  }, []);

  const sendChatMessage = useCallback(async (msgData) => {
    if (typeof msgData === "string") {
      const encryptedText = await encryptText(msgData, roomId);
      sendCollaborationMessage({ type: "chat_message", text: encryptedText, msgType: "text" });
    } else {
      const encryptedText = await encryptText(msgData.text || "", roomId);
      sendCollaborationMessage({ 
        type: "chat_message", 
        text: encryptedText, 
        msgType: msgData.type || "text",
        fileUrl: msgData.fileUrl,
        fileName: msgData.fileName,
        fileSize: msgData.fileSize
      });
    }
  }, [sendCollaborationMessage, roomId]);

  const markPendingAccess = useCallback((statusPayload) => {
    const roomName = statusPayload?.roomName || room?.name || `Room ${roomId}`;

    startTransition(() => {
      setRoom((currentRoom) => ({
        ...(currentRoom || {}),
        id: roomId,
        name: roomName,
        accessRole: statusPayload?.accessRole || "viewer",
        canEdit: false,
        canManage: false,
        canUseTerminal: false,
      }));
      setWorkspaceTree([]);
      setActiveFileId(null);
      setFocusedNodeId(null);
      setOpenFileIds(new Set());
      setModifiedFileIds(new Set());
      setRunResult(null);
      setSaveStatus("saved");
    });

    setPendingAccessState({
      status: statusPayload?.status === "rejected" ? "rejected" : "pending",
      roomId,
      roomName,
      accessRole: statusPayload?.accessRole || "editor",
      requestedAt: statusPayload?.requestedAt || null,
      message: statusPayload?.message || "",
    });
    setRoomAccessReady(false);
  }, [room?.name, roomId]);

  const applyRoomData = useCallback((roomData, options = {}) => {
    const { preserveSelection = false } = options;
    const nextTree = roomData?.workspaceTree || [];
    const nextSnapshot = JSON.stringify(nextTree);
    const nextEntries = flattenWorkspaceTree(nextTree);
    const validEntryIds = new Set(nextEntries.map((entry) => entry.id));
    const validFileIds = new Set(
      nextEntries
        .filter((entry) => entry.type === "file")
        .map((entry) => entry.id),
    );
    const nextActiveFile = getFirstFile(nextTree);

    startTransition(() => {
      setRoom(roomData);
      setPendingAccessState(null);
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
    if (!token || !roomId || !canEditRoom) {
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
        token,
      );
      const persistedSnapshot = JSON.stringify(savedRoom.workspaceTree || nextTree);

      saveSnapshotRef.current = persistedSnapshot;
      setSaveStatus(
        latestWorkspaceSnapshotRef.current === outgoingSnapshot
          || latestWorkspaceSnapshotRef.current === persistedSnapshot
          ? "saved"
          : "saving",
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
  }, [canEditRoom, roomId, token]);

  const refreshPendingAccess = useCallback(async ({ silent = false } = {}) => {
    if (!token || !roomId) {
      return null;
    }

    if (!silent) {
      setIsRefreshingPendingAccess(true);
    }

    try {
      const joinStatus = await secureFetch(API_ENDPOINTS.GET_ROOM_JOIN_STATUS(roomId), {}, token);

      if (joinStatus?.status === "approved") {
        const roomData = await secureFetch(API_ENDPOINTS.GET_ROOM(roomId), {}, token);
        applyRoomData(roomData);
        setRoomAccessReady(true);
        toast.success("Access approved. Opening workspace.");
        return { status: "approved", room: roomData };
      }

      if (joinStatus?.status === "pending_approval") {
        markPendingAccess(joinStatus);
        return joinStatus;
      }

      markPendingAccess({
        ...joinStatus,
        status: "rejected",
        message: "Your join request is no longer active. Ask the owner to invite or approve you again.",
      });
      return { ...joinStatus, status: "rejected" };
    } catch (error) {
      if (!silent) {
        toast.error(error.message || "Could not refresh lobby status");
      }
      throw error;
    } finally {
      if (!silent) {
        setIsRefreshingPendingAccess(false);
      }
    }
  }, [applyRoomData, markPendingAccess, roomId, token]);

  useEffect(() => {
    if (!token || !roomId) {
      return;
    }

    let isMounted = true;

    const openRoom = async () => {
      setIsLoading(true);
      setRoomAccessReady(false);
      setPendingAccessState(null);
      hasHydratedWorkspaceRef.current = false;

      try {
        const roomData = await secureFetch(API_ENDPOINTS.GET_ROOM(roomId), {}, token);

        if (isMounted) {
          applyRoomData(roomData);
          setRoomAccessReady(true);
          
          // Load chat history
          secureFetch(`/api/rooms/${roomId}/messages`, {}, token)
            .then(async (msgs) => {
              if (isMounted && Array.isArray(msgs)) {
                // Decrypt existing history
                const decryptedMsgs = await Promise.all(msgs.map(async (msg) => {
                  let decryptedText = msg.text;
                  if (msg.text && msg.text.startsWith("E2EE~")) {
                     decryptedText = await decryptText(msg.text, roomId);
                  }
                  return { ...msg, type: "chat_message", text: decryptedText, msgType: msg.msgType || "text" };
                }));
                // We preserve the initial system message and append history
                setChatMessages([
                   { id: 1, text: "Welcome to the room chat! Messages are end-to-end encrypted and only visible to current collaborators.", sender: "System", isSystem: true, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
                   ...decryptedMsgs
                ]);
              }
            })
            .catch(() => {});
        }
      } catch (error) {
        const shouldAttemptInviteJoin = inviteToken
          && (error.status === 403 || /access|private|invite/i.test(error.message || ""));

        if (shouldAttemptInviteJoin) {
          try {
            const joinResult = await secureFetch(
              API_ENDPOINTS.JOIN_ROOM,
              {
                method: "POST",
                body: JSON.stringify({ roomId, inviteToken }),
              },
              token,
            );

            if (joinResult?.status === "pending_approval") {
              if (isMounted) {
                markPendingAccess(joinResult);
                toast.success(joinResult.message || "Join request sent");
              }
              return;
            }

            const roomData = await secureFetch(API_ENDPOINTS.GET_ROOM(roomId), {}, token);

            if (isMounted) {
              applyRoomData(roomData);
              setRoomAccessReady(true);
            }
            return;
          } catch (joinError) {
            if (isMounted) {
              toast.error(joinError.message || "Could not open room");
              setRoomAccessReady(false);
              navigate("/home", { replace: true });
            }
            return;
          }
        }

        if (error.status === 403) {
          try {
            const joinStatus = await secureFetch(API_ENDPOINTS.GET_ROOM_JOIN_STATUS(roomId), {}, token);

            if (joinStatus?.status === "pending_approval") {
              if (isMounted) {
                markPendingAccess(joinStatus);
              }
              return;
            }

            if (joinStatus?.status === "approved") {
              const roomData = await secureFetch(API_ENDPOINTS.GET_ROOM(roomId), {}, token);

              if (isMounted) {
                applyRoomData(roomData);
                setRoomAccessReady(true);
              }
              return;
            }
          } catch {
            // Fall back to the standard access error below.
          }
        }

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
  }, [applyRoomData, inviteToken, markPendingAccess, navigate, roomId, token]);

  useEffect(() => {
    if (!token || !roomId || pendingAccessState?.status !== "pending") {
      return undefined;
    }

    let isCancelled = false;

    const pollJoinStatus = async () => {
      try {
        const result = await refreshPendingAccess({ silent: true });

        if (isCancelled) {
          return;
        }

        if (result?.status === "rejected") {
          toast.error("This join request is no longer waiting in the lobby.");
        }
      } catch {
        // Keep polling quietly while the lobby is open.
      }
    };

    const intervalId = window.setInterval(pollJoinStatus, 4000);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, [pendingAccessState?.status, refreshPendingAccess, roomId, token]);

  useEffect(() => {
    if (!token || !roomId || !roomAccessReady) {
      return undefined;
    }

    let isDisposed = false;
    let shouldReconnect = true;
    const socket = new WebSocket(
      `${getWebSocketBaseUrl()}/api/rooms/${roomId}/collaborate?token=${encodeURIComponent(token)}`,
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

      if (message.type === "chat_message") {
        (async () => {
          let decryptedText = message.text;
          if (message.text && message.text.startsWith("E2EE~")) {
            decryptedText = await decryptText(message.text, roomId);
          }
          const finalMessage = { ...message, text: decryptedText };
          setChatMessages((prev) => [...prev, finalMessage]);
          setUnreadChatMessagesCount((prev) => prev + 1);
        })();
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

      if (
        message.type === "video_join" ||
        message.type === "video_leave" ||
        message.type === "video_offer" ||
        message.type === "video_answer" ||
        message.type === "video_ice_candidate"
      ) {
        videoSignalListenerRef.current?.(message);
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

    socket.onclose = (event) => {
      if (event.code === 1008) {
        shouldReconnect = false;
      }

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
    if (!token || !roomId || !roomAccessReady || !canManageRoom) {
      ownerPendingRequestCountRef.current = null;
      return undefined;
    }

    let isCancelled = false;

    const refreshRoomMeta = async () => {
      try {
        const roomData = await secureFetch(API_ENDPOINTS.GET_ROOM(roomId), {}, token);

        if (isCancelled) {
          return;
        }

        setRoom((currentRoom) => ({
          ...(currentRoom || {}),
          ...roomData,
        }));
      } catch {
        // Ignore occasional metadata refresh failures.
      }
    };

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        refreshRoomMeta();
      }
    }, 5000);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, [canManageRoom, roomAccessReady, roomId, token]);

  useEffect(() => {
    if (!canManageRoom) {
      ownerPendingRequestCountRef.current = null;
      return;
    }

    const nextPendingCount = room?.pendingJoinRequestCount || 0;

    if (ownerPendingRequestCountRef.current === null) {
      ownerPendingRequestCountRef.current = nextPendingCount;
      return;
    }

    if (nextPendingCount > ownerPendingRequestCountRef.current) {
      const delta = nextPendingCount - ownerPendingRequestCountRef.current;
      toast.success(
        delta === 1
          ? "A new join request is waiting for approval."
          : `${delta} new join requests are waiting for approval.`,
      );
    }

    ownerPendingRequestCountRef.current = nextPendingCount;
  }, [canManageRoom, room?.pendingJoinRequestCount]);

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
    if (!hasHydratedWorkspaceRef.current || !roomId || !token || !canEditRoom) {
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
  }, [canEditRoom, isRealtimeConnected, roomId, saveWorkspace, sendCollaborationMessage, token, workspaceTree]);

  useEffect(() => {
    if (!isRealtimeConnected) {
      lastPresenceFilePathRef.current = null;
      return;
    }

    if (lastPresenceFilePathRef.current === activeFilePath) {
      return;
    }

    lastPresenceFilePathRef.current = activeFilePath;
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

  const ensureEditAccess = useCallback((actionLabel = "make changes in this workspace") => {
    if (canEditRoom) {
      return true;
    }

    toast.error(`You need edit access to ${actionLabel}.`);
    return false;
  }, [canEditRoom]);

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

  const handleOpenFile = (file) => {
    if (!file) {
      return;
    }

    setActiveFileId(file.id);
    setFocusedNodeId(file.id);
    setOpenFileIds((currentOpenFileIds) => new Set([...currentOpenFileIds, file.id]));
  };

  const createWorkspaceNodeFromName = (type, rawName, parentIdOverride) => {
    if (!ensureEditAccess(`create ${type}s here`)) {
      return false;
    }

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
    if (!ensureEditAccess(`create ${type}s here`)) {
      return;
    }

    const suggestedName = type === "folder" ? "src" : "main.py";
    const input = window.prompt(
      type === "folder" ? "Folder name" : "File name",
      suggestedName,
    );

    if (!input) {
      return;
    }

    createWorkspaceNodeFromName(type, input);
  };

  const handleDeleteNode = (node) => {
    if (!ensureEditAccess("delete files or folders")) {
      return;
    }

    setNodeToDelete(node);
  };

  const confirmDeleteNode = () => {
    if (!nodeToDelete) {
      return;
    }

    if (!ensureEditAccess("delete files or folders")) {
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
    if (!ensureEditAccess("rename files or folders")) {
      return;
    }

    const cleanedName = sanitizeInput(newName).replace(/[\\/]/g, "").trim();
    if (!cleanedName) {
      return;
    }

    setWorkspaceTree((currentTree) => {
      const currentEntries = flattenWorkspaceTree(currentTree);
      const targetEntry = currentEntries.find((entry) => entry.id === nodeId);
      if (!targetEntry) {
        return currentTree;
      }

      const siblings = getFolderChildren(currentTree, targetEntry.parentId)
        .filter((node) => node.id !== nodeId);
      const uniqueName = buildUniqueName(siblings, cleanedName);

      return renameNode(currentTree, nodeId, uniqueName);
    });
    setModifiedFileIds((prev) => new Set([...prev, nodeId]));
  };

  const handleMoveNode = (nodeId, newParentId) => {
    if (!ensureEditAccess("move files or folders")) {
      return;
    }

    setWorkspaceTree((currentTree) => moveNode(currentTree, nodeId, newParentId));
    setModifiedFileIds((prev) => new Set([...prev, nodeId]));
  };

  const handleCodeChange = (nextCode) => {
    if (!canEditRoom) {
      return;
    }

    if (!activeFileIdRef.current) {
      return;
    }

    setWorkspaceTree((currentTree) => updateNodeById(
      currentTree,
      activeFileIdRef.current,
      (node) => ({ ...node, content: nextCode }),
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

    const nextSignature = `${activeFilePathRef.current || ""}:${nextCursor.line}:${nextCursor.column}`;
    if (lastCursorBroadcastRef.current === nextSignature) {
      return;
    }

    if (cursorBroadcastTimeoutRef.current) {
      window.clearTimeout(cursorBroadcastTimeoutRef.current);
    }

    cursorBroadcastTimeoutRef.current = window.setTimeout(() => {
      lastCursorBroadcastRef.current = nextSignature;
      sendCollaborationMessage({
        type: "cursor_update",
        activeFilePath: activeFilePathRef.current,
        line: nextCursor.line,
        column: nextCursor.column,
      });
    }, 90);
  }, [isRealtimeConnected, sendCollaborationMessage]);

  const handleCopyInvite = async () => {
    const roomLink = buildRoomInviteLink({
      roomId,
      inviteToken: room?.inviteToken,
    });

    try {
      await navigator.clipboard.writeText(roomLink);
      toast.success("Invite link copied");
    } catch {
      toast.error("Could not copy invite link");
    }
  };

  const handleRun = async () => {
    if (!ensureEditAccess("run files")) {
      return;
    }

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
        token,
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

  return {
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
    pendingJoinRequestCount: room?.pendingJoinRequestCount || 0,
    chatMessages,
    unreadChatMessagesCount,
    setUnreadChatMessagesCount,
    sendChatMessage,
    sendVideoSignal,
    setVideoSignalListener,
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
  };
}
