/** Close a room's open connections when someone's rights change, so nobody keeps writing on an old answer. */
import { ROOM_ACCESS_CHANNEL } from "@codechatter/contracts";
import { parseDocName } from "@codechatter/workspace-model";
import type { Extension, Hocuspocus } from "@hocuspocus/server";
import { Redis } from "ioredis";

/**
 * A connection's rights are decided once, when it authenticates (access.ts). So when the
 * API changes them (an interview ending turns the candidate into a viewer), it publishes
 * the room's code on Valkey, and every collab instance closes that room's connections.
 * Clients reconnect at once and authenticate again, with the new rights.
 */
export function closeRoomConnections(instance: Pick<Hocuspocus, "documents" | "closeConnections">, roomId: string): string[] {
  const closed = [...instance.documents.keys()].filter((name) => parseDocName(name)?.roomId === roomId);
  for (const name of closed) instance.closeConnections(name);
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
