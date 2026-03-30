import { useEffect, useRef } from "react";
import { useNotifications } from "../context/NotificationsContext";

/**
 * Fires a notification whenever a code run completes.
 * Pass runResult from BottomPanel / CodeRoom.
 */
export function useRunNotifications(runResult, roomId, roomName) {
  const { addNotification } = useNotifications();
  const prevStatusRef = useRef(null);

  useEffect(() => {
    if (!runResult) return;

    const wasRunning = prevStatusRef.current === "running";
    const nowDone    = runResult.status !== "running";

    if (wasRunning && nowDone) {
      const ok = runResult.exitCode === 0;
      const ms = typeof runResult.runtimeMs === "number" ? ` in ${runResult.runtimeMs}ms` : "";
      addNotification({
        type:    ok ? "info" : "room_deleted",  // reuse red icon for errors
        title:   ok ? "Run succeeded" : `Run failed (exit ${runResult.exitCode ?? "?"})`,
        message: `${roomName || "Code"}${ms}${runResult.stderr?.trim() ? " · check Errors tab" : ""}`,
        roomId,
      });
    }

    prevStatusRef.current = runResult.status;
  }, [runResult, roomId, roomName, addNotification]);
}

/**
 * Fires a notification when new collaborators join the room.
 */
export function useCollaboratorNotifications(activeCollaborators, roomId, roomName) {
  const { addNotification } = useNotifications();
  const prevIdsRef = useRef(new Set());

  useEffect(() => {
    if (!activeCollaborators?.length) return;

    const currentIds = new Set(activeCollaborators.map(c => c.userId || c.id));

    activeCollaborators.forEach(c => {
      const id = c.userId || c.id;
      if (!prevIdsRef.current.has(id)) {
        addNotification({
          type:    "join_request",
          title:   `${c.username || "Someone"} joined`,
          message: `in ${roomName || "your room"}`,
          roomId,
        });
      }
    });

    prevIdsRef.current = currentIds;
  }, [activeCollaborators, roomId, roomName, addNotification]);
}
