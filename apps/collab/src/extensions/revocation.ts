/** Close a room's open sockets when someone's rights change, so nobody keeps writing on an old answer. */
import { ROOM_ACCESS_CHANNEL } from "@codechatter/contracts";
import { parseDocName } from "@codechatter/workspace-model";
import type { Extension, Hocuspocus } from "@hocuspocus/server";
import { Redis } from "ioredis";

const RESET = { code: 4205, reason: "Your access to this room changed" };

/**
 * A connection's rights are decided once, when it authenticates (access.ts). So when the
 * API changes them (an interview ending turns the candidate into a viewer), it publishes
 * the room's code on Valkey, and every collab instance closes that room's connections.
 *
 * Hocuspocus's own closeConnections isn't enough: it only detaches the document and leaves
 * the socket open, so the browser neither writes nor reconnects, and its editor silently
 * goes stale. Closing the socket makes the client reconnect and authenticate again, with
 * the new rights. A browser's socket carries one room, so nobody else is disturbed.
 */
export function closeRoomConnections(instance: Pick<Hocuspocus, "documents">, roomId: string): string[] {
  const closed: string[] = [];
  for (const [name, document] of instance.documents) {
    if (parseDocName(name)?.roomId !== roomId) continue;
    closed.push(name);
    for (const connection of [...document.connections.keys()]) {
      connection.close(RESET);
      connection.webSocket.close(RESET.code, RESET.reason);
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
      subscriber.on("message", (_channel, roomId: string) => void closeRoomConnections(instance, roomId));
      await subscriber.subscribe(ROOM_ACCESS_CHANNEL);
    },
    async onDestroy() {
      subscriber?.disconnect();
      subscriber = null;
    },
  };
}
