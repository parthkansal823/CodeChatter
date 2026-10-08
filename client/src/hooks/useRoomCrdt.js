import { useEffect, useState } from "react";
import * as Y from "yjs";

import { RoomCrdtProvider } from "../utils/crdt";
import { getWebSocketBaseUrl } from "../config/security";

/**
 * One shared Yjs document per room, alive for as long as the room is open.
 *
 * The document deliberately outlives the file the user happens to be looking
 * at: switching tabs must not tear down the connection, and edits other people
 * make in files you are not viewing still have to arrive.
 */
export function useRoomCrdt(roomId, token, user) {
  // Doc and provider live in state, not a ref: a ref read during render can
  // hand back last render's value, and consumers bind Monaco against whatever
  // they are given.
  const [session, setSession] = useState({ doc: null, provider: null });
  const [status, setStatus] = useState("connecting");
  const [isSynced, setIsSynced] = useState(false);

  useEffect(() => {
    if (!roomId || !token) {
      return undefined;
    }

    let doc;
    let provider;
    let offStatus = () => {};
    let offSynced = () => {};

    // Collaboration is an enhancement layered on a working editor. If it cannot
    // start — a bad URL, a protocol package that failed to load, anything — the
    // room must still open on the plain editing path rather than taking the
    // whole page down with it.
    try {
      doc = new Y.Doc();
      const url = `${getWebSocketBaseUrl()}/api/rooms/${roomId}/crdt?token=${encodeURIComponent(token)}`;
      provider = new RoomCrdtProvider(url, doc, {
        user: user ? { name: user.username, hue: user.avatarHue ?? null } : undefined,
      });

      offStatus = provider.on("status", setStatus);
      offSynced = provider.on("synced", () => setIsSynced(true));
    } catch (error) {
      console.error("Live collaboration could not start; editing without it.", error);
      doc?.destroy();
      setStatus("unavailable");
      return undefined;
    }

    setSession({ doc, provider });

    return () => {
      offStatus();
      offSynced();
      provider.destroy();
      doc.destroy();
      setSession({ doc: null, provider: null });
      setIsSynced(false);
    };
    // Only the identity fields matter — a new `user` object with the same id
    // must not tear down and rebuild the connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, token, user?.id, user?.username, user?.avatarHue]);

  return { doc: session.doc, provider: session.provider, status, isSynced };
}
