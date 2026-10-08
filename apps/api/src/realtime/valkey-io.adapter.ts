import type { INestApplicationContext } from "@nestjs/common";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { Redis } from "ioredis";
import type { Server, ServerOptions } from "socket.io";

/**
 * Socket.IO over Valkey pub/sub: an emit on one API instance reaches sockets
 * connected to every other (v1's chat only reached the same process).
 */
export class ValkeyIoAdapter extends IoAdapter {
  private readonly pub: Redis;
  private readonly sub: Redis;

  constructor(app: INestApplicationContext, url: string) {
    super(app);
    this.pub = new Redis(url);
    this.sub = this.pub.duplicate();
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, {
      ...options,
      path: options?.path ?? "/socket.io",
      // No CORS: the browser always arrives same-origin through Caddy.
      cors: undefined,
      maxHttpBufferSize: 64 * 1024,
      pingInterval: 20_000,
    } as ServerOptions) as Server;
    server.adapter(createAdapter(this.pub, this.sub));
    return server;
  }

  override async close(server: Server): Promise<void> {
    await super.close(server);
    await Promise.allSettled([this.pub.quit(), this.sub.quit()]);
  }
}
