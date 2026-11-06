import type { Auth, AuthSession, OriginPolicy } from "@codechatter/auth";
import {
  ROOM_ACCESS_CHANNEL,
  SESSION_ENDED_CHANNEL,
  parseRoomAccessMessage,
  RoomCode,
  RunInput,
  RunStartInput,
  RunStopInput,
  SendMessageInput,
  type Ack,
  type ChatMessage,
  type ClientToServerEvents,
  type RunInfo,
  type RunSnapshot,
  type ServerToClientEvents,
} from "@codechatter/contracts";
import { Inject, Logger, type OnModuleDestroy } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayInit,
} from "@nestjs/websockets";
import { fromNodeHeaders } from "better-auth/node";
import type { Redis } from "ioredis";
import type { Server, Socket } from "socket.io";

import { CallsService } from "../calls/calls.service.js";
import { AUTH, ORIGINS, VALKEY } from "../infra/tokens.js";
import { MessagesService } from "../messages/messages.service.js";
import { bindSocketMetrics, chatMessages } from "../metrics/metrics.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { RoomsService } from "../rooms/rooms.service.js";
import { RunnerClient, RunnerUnavailableError } from "../runner/runner.client.js";
import { LiveSockets } from "./live-sockets.js";

type SocketData = { session: AuthSession };
type RoomSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
const channel = (roomId: string) => `room:${roomId}`;
const userChannel = (userId: string) => `user:${userId}`;

/**
 * Room events over Socket.IO (chat now; notifications and run output next).
 * Same-origin through Caddy, so the session cookie authenticates the
 * handshake and the Origin header is checked. The Valkey adapter (main.ts)
 * fans every emit out to sockets on all API instances.
 */
// destroyUpgrade off: other WebSocket paths (/ws/terminal) share this HTTP
// server, and engine.io would otherwise drop their upgrades after 1 s.
@WebSocketGateway({ path: "/socket.io", serveClient: false, destroyUpgrade: false })
export class EventsGateway implements OnGatewayInit, OnModuleDestroy {
  private readonly logger = new Logger(EventsGateway.name);
  private accessChanges: Redis | null = null;
  @WebSocketServer() server!: Server<ClientToServerEvents, ServerToClientEvents>;

  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(ORIGINS) private readonly origins: OriginPolicy,
    @Inject(VALKEY) private readonly valkey: Redis,
    private readonly rooms: RoomsService,
    private readonly messages: MessagesService,
    private readonly runner: RunnerClient,
    private readonly notifications: NotificationsService,
    private readonly live: LiveSockets,
    private readonly calls: CallsService,
  ) {}

  /**
   * Authenticate in middleware, which finishes before the connection is
   * accepted. (Doing it in handleConnection raced the client's first
   * "room:join", which could arrive before the session was attached.)
   */
  afterInit(server: Server) {
    bindSocketMetrics(server);
    // A separate connection: a subscribed one can't do anything else.
    this.accessChanges = this.valkey.duplicate();
    this.accessChanges.on("message", (channelName, message: string) => {
      if (channelName === SESSION_ENDED_CHANNEL) {
        void this.sessionEnded(message).catch((error: unknown) => this.logger.warn(`session ended: ${String(error)}`));
        return;
      }
      const change = parseRoomAccessMessage(message);
      void Promise.allSettled([this.recheckListeners(change.roomId, change.userId), this.live.recheck(change), this.calls.recheck(change)]).then((results) => {
        for (const result of results) if (result.status === "rejected") this.logger.warn(`room access: ${String(result.reason)}`);
      });
    });
    void this.accessChanges.subscribe(ROOM_ACCESS_CHANNEL, SESSION_ENDED_CHANNEL);
    this.notifications.setPush((userId, item) => this.server.to(userChannel(userId)).emit("notification:new", item));
    server.use(async (socket, next) => {
      try {
        if (!this.origins.isAllowed(socket.handshake.headers.origin)) return next(new Error("forbidden origin"));
        const session = await this.auth.api.getSession({ headers: fromNodeHeaders(socket.handshake.headers) });
        if (!session) return next(new Error("not signed in"));
        (socket as RoomSocket).data.session = session;
        // Their own channel, for notifications wherever they're signed in.
        void socket.join(userChannel(session.user.id));
        next();
      } catch (error) {
        this.logger.warn(`socket auth failed: ${String(error)}`);
        next(new Error("auth failed"));
      }
    });
  }

  onModuleDestroy() {
    this.accessChanges?.disconnect();
  }

  /** A session signed out, on this instance or another: nothing connected on it stays connected. */
  private async sessionEnded(sessionId: string): Promise<void> {
    this.live.sessionEnded(sessionId);
    const sockets = await this.server.local.fetchSockets();
    for (const socket of sockets) if ((socket.data as SocketData).session?.session.id === sessionId) socket.disconnect(true);
  }

  /** Rights are checked at room:join, so when they shrink, whoever may no longer listen stops hearing the room. */
  private async recheckListeners(roomId: string, userId?: string): Promise<void> {
    const sockets = await this.server.local.in(channel(roomId)).fetchSockets();
    await Promise.all(
      sockets.map(async (socket) => {
        const listener = (socket.data as SocketData).session.user.id;
        if (userId && listener !== userId) return;
        const allowed = await this.rooms.require(roomId, listener, "room.view").then(
          () => true,
          () => false,
        );
        if (!allowed) socket.leave(channel(roomId));
      }),
    );
  }

  @SubscribeMessage("room:join")
  async join(@ConnectedSocket() socket: RoomSocket, @MessageBody() roomId: unknown): Promise<Ack<null>> {
    const parsed = RoomCode.safeParse(roomId);
    if (!parsed.success || !socket.data.session) return { ok: false, error: "Unknown room." };
    try {
      await this.rooms.require(parsed.data, socket.data.session.user.id, "room.view");
      await socket.join(channel(parsed.data));
      return { ok: true, data: null };
    } catch {
      return { ok: false, error: "You don't have access to this room." };
    }
  }

  @SubscribeMessage("room:leave")
  async leave(@ConnectedSocket() socket: RoomSocket, @MessageBody() roomId: unknown) {
    const parsed = RoomCode.safeParse(roomId);
    if (parsed.success) await socket.leave(channel(parsed.data));
  }

  /** Someone joined, asked to, left, or had their role changed: everyone reads the room's people again. */
  peopleChanged(roomId: string): void {
    this.server.to(channel(roomId)).emit("room:people-changed");
  }

  /** A message posted by the server (GitHub activity) to everyone in the room. */
  postToChat(roomId: string, message: ChatMessage): void {
    this.server.to(channel(roomId)).emit("chat:message", message);
  }

  /** An interview in this room changed: everyone reads it again, each seeing what their role may. */
  interviewChanged(roomId: string): void {
    this.server.to(channel(roomId)).emit("interview:changed");
  }

  @SubscribeMessage("chat:send")
  async send(@ConnectedSocket() socket: RoomSocket, @MessageBody() body: unknown): Promise<Ack<ChatMessage>> {
    const input = SendMessageInput.safeParse(body);
    if (!input.success) return { ok: false, error: input.error.issues[0]?.message ?? "Invalid message." };
    const session = socket.data.session;
    if (!session || !socket.rooms.has(channel(input.data.roomId))) return { ok: false, error: "Join the room first." };
    try {
      await this.rooms.require(input.data.roomId, session.user.id, "room.chat");
    } catch {
      return { ok: false, error: "You can't post in this room." };
    }
    const message = await this.messages.create({ ...input.data, userId: session.user.id });
    chatMessages.inc();
    // People mentioned by name hear about it wherever they are.
    void this.notifications.notifyMentions(input.data.roomId, session.user.id, message.body).catch((error) => this.logger.warn(`mentions: ${String(error)}`));
    // Everyone else gets it from the broadcast; the sender from the ack.
    socket.to(channel(input.data.roomId)).emit("chat:message", message);
    this.logger.debug(`chat ${input.data.roomId} ${message.id}`);
    return { ok: true, data: message };
  }

  /**
   * Run a file in the room's sandbox. Output goes to everyone in the room
   * (the run is shared); the ack answers once the run has started, or with
   * the reason it couldn't.
   */
  @SubscribeMessage("run:start")
  async runStart(@ConnectedSocket() socket: RoomSocket, @MessageBody() body: unknown): Promise<Ack<RunInfo>> {
    const input = RunStartInput.safeParse(body);
    if (!input.success) return { ok: false, error: input.error.issues[0]?.message ?? "Invalid request." };
    const { roomId, path, stateVector } = input.data;
    const user = await this.allowed(socket, roomId, "code.run");
    if (!user) return { ok: false, error: "You can't run code in this room." };

    const room = this.server.to(channel(roomId));
    return new Promise((resolve) => {
      let answered = false;
      const answer = (result: Ack<RunInfo>) => {
        if (!answered) resolve(result);
        answered = true;
      };
      // Notices that arrive before the run has an id are sent right after it starts.
      const early: string[] = [];
      void (async () => {
        try {
          for await (const event of this.runner.start(roomId, user, { path, stateVector })) {
            if (event.type === "started") {
              room.emit("run:started", event.run);
              for (const data of early.splice(0)) room.emit("run:output", { runId: event.run.id, data });
              answer({ ok: true, data: event.run });
            } else if (event.type === "output") {
              if (event.runId) room.emit("run:output", { runId: event.runId, data: event.data });
              else early.push(event.data);
            } else if (event.type === "exit") {
              room.emit("run:exit", event.exit);
            } else if (event.type === "error") {
              answer({ ok: false, error: event.message });
            }
          }
          answer({ ok: false, error: "The run didn't start." });
        } catch (error) {
          if (!(error instanceof RunnerUnavailableError)) this.logger.warn(`run ${roomId}: ${String(error)}`);
          answer({ ok: false, error: error instanceof RunnerUnavailableError ? error.message : "The run failed to start." });
        }
      })();
    });
  }

  @SubscribeMessage("run:stop")
  async runStop(@ConnectedSocket() socket: RoomSocket, @MessageBody() body: unknown): Promise<Ack<null>> {
    const input = RunStopInput.safeParse(body);
    const user = input.success ? await this.allowed(socket, input.data.roomId, "code.run") : null;
    if (!input.success || !user) return { ok: false, error: "You can't stop runs in this room." };
    try {
      await this.runner.stop(input.data.roomId, user);
      return { ok: true, data: null };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Couldn't stop the run." };
    }
  }

  /**
   * Keystrokes for the running program; the runner only accepts them from
   * whoever started it. Handlers run concurrently, so each socket's input is
   * chained: "Ananya" must not arrive as "Anaany".
   */
  @SubscribeMessage("run:input")
  runInput(@ConnectedSocket() socket: RoomSocket, @MessageBody() body: unknown): void {
    const input = RunInput.safeParse(body);
    if (!input.success) return;
    const { roomId, runId, data } = input.data;
    const previous = this.inputQueues.get(socket.id) ?? Promise.resolve();
    const next = previous.then(async () => {
      const user = await this.allowedCached(socket, roomId, "code.run");
      if (user) await this.runner.input(roomId, user, runId, data).catch(() => {});
    });
    this.inputQueues.set(socket.id, next);
    void next.finally(() => this.inputQueues.get(socket.id) === next && this.inputQueues.delete(socket.id));
  }

  private readonly inputQueues = new Map<string, Promise<void>>();
  private readonly permissionCache = new Map<string, { user: { id: string; name: string } | null; until: number }>();

  /** `allowed`, remembered for a few seconds per socket (typing sends many events). */
  private async allowedCached(socket: RoomSocket, roomId: string, action: Parameters<RoomsService["require"]>[2]) {
    const key = `${socket.id}:${roomId}:${action}`;
    const hit = this.permissionCache.get(key);
    if (hit && hit.until > Date.now()) return hit.user;
    const user = await this.allowed(socket, roomId, action);
    this.permissionCache.set(key, { user, until: Date.now() + 10_000 });
    if (this.permissionCache.size > 5000) this.permissionCache.clear();
    return user;
  }

  /** The current (or last) run and its recent output, for someone who just opened the room. */
  @SubscribeMessage("run:snapshot")
  async runSnapshot(@ConnectedSocket() socket: RoomSocket, @MessageBody() roomId: unknown): Promise<Ack<RunSnapshot>> {
    const parsed = RoomCode.safeParse(roomId);
    const user = parsed.success ? await this.allowed(socket, parsed.data, "room.view") : null;
    if (!parsed.success || !user) return { ok: false, error: "Unknown room." };
    try {
      return { ok: true, data: await this.runner.snapshot(parsed.data, user) };
    } catch {
      return { ok: true, data: { run: null, output: "", exit: null } };
    }
  }

  /** The signed-in user if they joined the room's channel and hold the permission. */
  private async allowed(socket: RoomSocket, roomId: string, action: Parameters<RoomsService["require"]>[2]) {
    const session = socket.data.session;
    if (!session || !socket.rooms.has(channel(roomId))) return null;
    try {
      await this.rooms.require(roomId, session.user.id, action);
      return { id: session.user.id, name: session.user.name };
    } catch {
      return null;
    }
  }
}
