import type { Auth, OriginPolicy } from "@codechatter/auth";
import { isServiceToken, verifyServiceToken } from "@codechatter/auth/service-token";
import { can, type RoomRole } from "@codechatter/contracts";
import { schema, type Db } from "@codechatter/db";
import { parseDocName } from "@codechatter/workspace-model";
import type { Extension, onAuthenticatePayload } from "@hocuspocus/server";
import { and, eq } from "drizzle-orm";

export interface CollabContext {
  /** null for the runner, which writes files that programs create in the sandbox. */
  userId: string | null;
  name: string;
  image: string | null;
  roomId: string;
  role: RoomRole;
}

/**
 * Who may open a room document, and whether they may write to it.
 *
 * The browser is same-origin (Caddy), so the Better Auth session cookie
 * arrives with the WebSocket upgrade: no token in the URL (v1 put the JWT in
 * the query string). The Origin header is checked so another site can't open
 * a socket with the user's cookie. Viewers get a read-only connection, which
 * Hocuspocus enforces server-side — their updates are rejected, not trusted.
 */
export function accessExtension(deps: { auth: Auth; db: Db; origins: OriginPolicy; serviceSecret: string }): Extension {
  return {
    extensionName: "access",
    async onAuthenticate({ documentName, requestHeaders, connectionConfig, token }: onAuthenticatePayload): Promise<CollabContext> {
      const parsed = parseDocName(documentName);
      if (!parsed) throw new Error("unknown document");

      // The runner joins as a peer to sync files with the room's sandbox
      // (apps/runner/src/doc-sync.ts). Its token names this one document.
      if (isServiceToken(token)) {
        const claims = verifyServiceToken(deps.serviceSecret, token, "collab");
        if (!claims || claims.sub !== documentName) throw new Error("invalid service token");
        connectionConfig.readOnly = false;
        return { userId: null, name: "Sandbox", image: null, roomId: parsed.roomId, role: "editor" };
      }

      if (!deps.origins.isAllowed(requestHeaders.get("origin"))) throw new Error("forbidden origin");

      const session = await deps.auth.api.getSession({ headers: requestHeaders });
      if (!session) throw new Error("not signed in");

      const [room, member] = await Promise.all([
        deps.db.query.rooms.findFirst({ where: eq(schema.rooms.id, parsed.roomId), columns: { visibility: true } }),
        deps.db.query.roomMembers.findFirst({
          where: and(eq(schema.roomMembers.roomId, parsed.roomId), eq(schema.roomMembers.userId, session.user.id)),
          columns: { role: true, status: true },
        }),
      ]);
      if (!room) throw new Error("room not found");

      const role: RoomRole | null =
        member?.status === "active" ? member.role : room.visibility === "public" ? "viewer" : null;
      if (!can(role, "room.view")) throw new Error("no access");

      connectionConfig.readOnly = !can(role, "files.edit");
      return {
        userId: session.user.id,
        name: session.user.name,
        image: session.user.image ?? null,
        roomId: parsed.roomId,
        role: role!,
      };
    },
  };
}
