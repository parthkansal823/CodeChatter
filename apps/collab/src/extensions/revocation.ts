/** Close a room's open sockets when someone's rights change, so nobody keeps writing on an old answer. */
import { parseRoomAccessMessage, ROOM_ACCESS_CHANNEL, ROOM_ACCESS_CLOSE, SESSION_ENDED_CHANNEL, SESSION_ENDED_CLOSE, type RoomAccessChange } from "@codechatter/contracts";
import { parseDocName } from "@codechatter/workspace-model";
import type { Extension, Hocuspocus } from "@hocuspocus/server";
import { Redis } from "ioredis";

/**
 * A connection's rights are decided once, when it authenticates (access.ts). So when the
 * API changes them (an interview ending, a public room going private, a room being deleted),
 * it publishes the room's code on Valkey, and every collab instance closes that room's
 * connections, or only one person's when it's about one person (a member removed, or given
 * another role). Everyone else carries on undisturbed.
 *
 * Hocuspocus's own closeConnections isn't enough: it only detaches the document and leaves
 * the socket open, so the browser neither writes nor reconnects, and its editor silently
 * goes stale. Closing the socket makes the client reconnect and authenticate again, with
 * the new rights. A browser's socket carries one room, so nobody else is disturbed.
 */
export function closeRoomConnections(instance: Pick<Hocuspocus, "documents">, { roomId, userId }: RoomAccessChange): string[] {
  const closed: string[] = [];
  for (const [name, document] of instance.documents) {
    if (parseDocName(name)?.roomId !== roomId) continue;
    closed.push(name);
    for (const connection of [...document.connections.keys()]) {
      if (userId && (connection.context as { userId?: string | null } | undefined)?.userId !== userId) continue;
      connection.close(ROOM_ACCESS_CLOSE);
      connection.webSocket.close(ROOM_ACCESS_CLOSE.code, ROOM_ACCESS_CLOSE.reason);
    }
  }
  return closed;
}

/** A sign-in ended: that device's connections close, in every room. It reconnects, and is refused. Their other devices carry on. */
export function closeSessionConnections(instance: Pick<Hocuspocus, "documents">, sessionId: string): number {
  let closed = 0;
  for (const document of instance.documents.values()) {
    for (const connection of [...document.connections.keys()]) {
      if ((connection.context as { sessionId?: string | null } | undefined)?.sessionId !== sessionId) continue;
      connection.close(SESSION_ENDED_CLOSE);
      connection.webSocket.close(SESSION_ENDED_CLOSE.code, SESSION_ENDED_CLOSE.reason);
      closed += 1;
    }
  }
  return closed;
}

export function revocationExtension(valkeyUrl: string): Extension {
  let subscriber: Redis | null = null;
  return {
    extensionName: "access-revocation",
    async onConfigure({ instance }) {
      subscriber = new Redis(valkeyUrl);
      subscriber.on("message", (channel, message: string) => {
        if (channel === SESSION_ENDED_CHANNEL) closeSessionConnections(instance, message);
        else closeRoomConnections(instance, parseRoomAccessMessage(message));
      });
      await subscriber.subscribe(ROOM_ACCESS_CHANNEL, SESSION_ENDED_CHANNEL);
    },
    async onDestroy() {
      subscriber?.disconnect();
      subscriber = null;
    },
  };
}
