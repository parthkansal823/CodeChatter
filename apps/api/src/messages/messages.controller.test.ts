/** Ensure search, context, read positions and deletion cannot bypass the room permission check or another person's identity. */
import type { AuthSession } from "@codechatter/auth";
import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { RoomsService } from "../rooms/rooms.service.js";
import { MessagesController } from "./messages.controller.js";
import type { MessagesService } from "./messages.service.js";

const session = { user: { id: "reader" } } as AuthSession;
const messageId = "019baabc-0000-7000-8000-000000000001";
function setup(allowed = true) {
  const require = allowed
    ? vi.fn().mockResolvedValue({})
    : vi.fn().mockRejectedValue(new ForbiddenException());
  const methods = {
    unread: vi.fn(),
    unreadInRoom: vi.fn(),
    markRead: vi.fn(),
    search: vi.fn(),
    context: vi.fn(),
    deleteOwn: vi.fn(),
    list: vi.fn(),
  };
  const controller = new MessagesController(
    { require } as unknown as RoomsService,
    methods as unknown as MessagesService,
  );
  return { controller, require, methods };
}

describe("chat controller authorization", () => {
  it("takes the dashboard reader from the authenticated session", async () => {
    const f = setup();
    await f.controller.unread(session);
    expect(f.methods.unread).toHaveBeenCalledExactlyOnceWith("reader");
  });

  for (const method of ["unreadInRoom", "markRead", "search", "context", "deleteOwn"] as const) {
    const invoke = (controller: MessagesController) => {
      if (method === "markRead") return controller.markRead(session, "E2ETST", { messageId });
      if (method === "search") return controller.search(session, "E2ETST", { q: "%" });
      if (method === "context") return controller.context(session, "E2ETST", { around: messageId });
      if (method === "deleteOwn") return controller.deleteOwn(session, "E2ETST", messageId);
      return controller.unreadInRoom(session, "E2ETST");
    };
    it(`${method} requires room.chat before accessing message storage`, async () => {
      const f = setup(false);
      await expect(invoke(f.controller)).rejects.toBeInstanceOf(ForbiddenException);
      expect(f.require).toHaveBeenCalledExactlyOnceWith("E2ETST", "reader", "room.chat");
      expect(f.methods[method]).not.toHaveBeenCalled();
    });
  }

  it("preserves room.view history permission and forwards the forward-page cursor", async () => {
    const f = setup();
    await f.controller.history(session, "E2ETST", { after: messageId, limit: 50 });
    expect(f.require).toHaveBeenCalledExactlyOnceWith("E2ETST", "reader", "room.view");
    expect(f.methods.list).toHaveBeenCalledExactlyOnceWith("E2ETST", { after: messageId, limit: 50 });
  });
});
