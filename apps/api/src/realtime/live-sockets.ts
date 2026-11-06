/** Sockets that outlive their permission check: closed when their person's rights no longer cover them. */
import type { RoomAccessChange, RoomRole } from "@codechatter/contracts";
import { Injectable } from "@nestjs/common";

import { RoomsService } from "../rooms/rooms.service.js";

type Watched = { userId: string; stillAllowed: (role: RoomRole) => boolean; close: () => void };

/**
 * Terminals, language servers, the debugger and dev servers' hot reload check rights once, when
 * they connect, and then just pipe bytes. Each registers here. When the API hears a room's rights
 * changed (RoomsService.accessChanged, on Valkey, so every instance hears), it asks again for the
 * sockets concerned, and closes those that may no longer stay.
 */
@Injectable()
export class LiveSockets {
  private readonly byRoom = new Map<string, Set<Watched>>();
  private readonly listeners = new Set<(change: RoomAccessChange) => void>();

  constructor(private readonly rooms: RoomsService) {}

  /** Returns how to stop watching: call it when the socket closes. */
  watch(roomId: string, userId: string, stillAllowed: Watched["stillAllowed"], close: Watched["close"]): () => void {
    const watched: Watched = { userId, stillAllowed, close };
    const inRoom = this.byRoom.get(roomId) ?? new Set<Watched>();
    inRoom.add(watched);
    this.byRoom.set(roomId, inRoom);
    return () => {
      inRoom.delete(watched);
      if (inRoom.size === 0 && this.byRoom.get(roomId) === inRoom) this.byRoom.delete(roomId);
    };
  }

  /** For whatever else remembers an answer (the preview's short cache of who may look). */
  onChange(listener: (change: RoomAccessChange) => void): void {
    this.listeners.add(listener);
  }

  async recheck(change: RoomAccessChange): Promise<void> {
    for (const listener of this.listeners) listener(change);
    const watched = [...(this.byRoom.get(change.roomId) ?? [])].filter((socket) => !change.userId || socket.userId === change.userId);
    await Promise.all(
      watched.map(async (socket) => {
        const role = await this.rooms.require(change.roomId, socket.userId, "room.view").then(
          (found) => found.role,
          () => null,
        );
        if (!role || !socket.stillAllowed(role)) socket.close();
      }),
    );
  }
}
