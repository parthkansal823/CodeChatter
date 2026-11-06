import type { RoomRole } from "@codechatter/contracts";
import { describe, expect, it, vi } from "vitest";

import type { RoomsService } from "../rooms/rooms.service.js";
import { LiveSockets } from "./live-sockets.js";

/** LiveSockets over a room where these people have these roles; anyone else is refused. */
function setup(roles: Record<string, RoomRole>) {
  const require = vi.fn(async (_roomId: string, userId: string) => {
    const role = roles[userId];
    if (!role) throw new Error("no access");
    return { role };
  });
  return { live: new LiveSockets({ require } as unknown as RoomsService), require };
}

describe("LiveSockets", () => {
  it("closes a socket whose person has lost access", async () => {
    const { live } = setup({});
    const close = vi.fn();
    live.watch("ROOM01", "ana", () => true, close);
    await live.recheck({ roomId: "ROOM01" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes a socket their new role doesn't cover, and keeps one it does", async () => {
    const { live } = setup({ ana: "viewer" });
    const terminal = vi.fn();
    const debuggerWatch = vi.fn();
    live.watch("ROOM01", "ana", (role) => role === "editor", terminal);
    live.watch("ROOM01", "ana", () => true, debuggerWatch);
    await live.recheck({ roomId: "ROOM01", userId: "ana" });
    expect(terminal).toHaveBeenCalledOnce();
    expect(debuggerWatch).not.toHaveBeenCalled();
  });

  it("asks only about the person named, and only in that room", async () => {
    const { live, require } = setup({ ana: "viewer", ben: "editor" });
    const ana = vi.fn();
    const ben = vi.fn();
    const elsewhere = vi.fn();
    live.watch("ROOM01", "ana", () => false, ana);
    live.watch("ROOM01", "ben", () => false, ben);
    live.watch("ROOM02", "ana", () => false, elsewhere);
    await live.recheck({ roomId: "ROOM01", userId: "ana" });
    expect(ana).toHaveBeenCalledOnce();
    expect(ben).not.toHaveBeenCalled();
    expect(elsewhere).not.toHaveBeenCalled();
    expect(require).toHaveBeenCalledTimes(1);
  });

  it("forgets a socket once it's closed", async () => {
    const { live, require } = setup({});
    const close = vi.fn();
    const stop = live.watch("ROOM01", "ana", () => true, close);
    stop();
    await live.recheck({ roomId: "ROOM01" });
    expect(close).not.toHaveBeenCalled();
    expect(require).not.toHaveBeenCalled();
  });

  it("tells whatever else remembers an answer", async () => {
    const { live } = setup({});
    const heard = vi.fn();
    live.onChange(heard);
    await live.recheck({ roomId: "ROOM01", userId: "ana" });
    expect(heard).toHaveBeenCalledWith({ roomId: "ROOM01", userId: "ana" });
  });
});
