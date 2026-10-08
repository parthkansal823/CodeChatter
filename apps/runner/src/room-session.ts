import type Docker from "dockerode";

import type { SandboxStatus } from "@codechatter/contracts";

import { DocSync } from "./doc-sync.js";
import type { Env } from "./env.js";
import { log } from "./log.js";
import { RunManager } from "./runs.js";
import { LABEL_MANAGED, LABEL_NAMESPACE, LABEL_ROOM, Sandbox } from "./sandbox.js";
import { TunnelHub } from "./tunnel.js";

/**
 * Everything the runner holds for one room: the container, the live copy of
 * the room's files, the current run and open terminals. Created on first use,
 * closed after SANDBOX_IDLE_MINUTES with no run and no terminal.
 */
export class RoomSession {
  readonly sandbox: Sandbox;
  readonly sync: DocSync;
  readonly runs: RunManager;
  readonly tunnels: TunnelHub;
  /** Ports something in the sandbox listens on (reported by the agent). */
  ports: number[] = [];
  terminals = 0;
  private lastCpu: { total: number; system: number } | null = null;
  private lastActive = Date.now();
  private readying: Promise<void> | null = null;

  constructor(
    docker: Docker,
    readonly roomId: string,
    private readonly env: Env,
  ) {
    this.sandbox = new Sandbox(docker, roomId, env);
    this.sync = new DocSync(roomId, { collabUrl: env.COLLAB_INTERNAL_URL, secret: env.SERVICE_SECRET });
    this.runs = new RunManager(this.sandbox, env.RUN_TIMEOUT_MINUTES * 60_000);
    this.tunnels = new TunnelHub(() => this.sandbox.agent);
    this.sandbox.onAgentEvent = (event) => {
      if (event.ev === "ports") this.ports = event.ports;
      else if (event.ev === "tcp_connected" || event.ev === "tcp_data" || event.ev === "tcp_closed") this.tunnels.handle(event);
      else this.sync.applyFromSandbox(event);
    };
    this.sandbox.onAgentClosed = () => {
      this.tunnels.closeAll();
      this.ports = [];
    };
  }

  /**
   * Container running, agent connected, and its files equal to the room's.
   * A sandbox that is (nearly) out of processes, e.g. after a fork bomb that
   * escaped with setsid, is reset first: otherwise the next exec would fail.
   */
  async ready(): Promise<void> {
    this.touch();
    const processes = await this.sandbox.processes();
    if (processes && processes.current >= processes.limit - 8) {
      log.warn(`room ${this.roomId}: ${processes.current}/${processes.limit} processes in use`);
      await this.sandbox.reset();
    } else if (this.sandbox.agent && this.sync.isAttachedTo(this.sandbox.agent)) {
      return;
    }
    this.readying ??= (async () => {
      await this.sync.synced();
      await this.sandbox.ensure();
      // A new agent (first start or after a reset) gets the full file set.
      if (!this.sync.isAttachedTo(this.sandbox.agent)) await this.sync.attach(this.sandbox.agent!);
    })().finally(() => (this.readying = null));
    return this.readying;
  }

  /** Ports, CPU, memory and processes for the Ports and resources panel. */
  async status(): Promise<SandboxStatus> {
    const stats = await this.sandbox.stats();
    if (!stats) return { running: false, ports: [], cpuPercent: null, memory: null, processes: null };
    // CPU% needs two samples; one-shot stats have no "previous", so keep our own.
    let cpuPercent: number | null = null;
    const total = stats.cpu_stats?.cpu_usage?.total_usage;
    const system = stats.cpu_stats?.system_cpu_usage;
    if (typeof total === "number" && typeof system === "number") {
      if (this.lastCpu && system > this.lastCpu.system) {
        const cpus = stats.cpu_stats?.online_cpus ?? 1;
        cpuPercent = Math.max(0, Math.min(100 * cpus, ((total - this.lastCpu.total) / (system - this.lastCpu.system)) * cpus * 100));
      }
      this.lastCpu = { total, system };
    }
    const usage = stats.memory_stats?.usage;
    const limit = stats.memory_stats?.limit;
    const cache = stats.memory_stats?.stats?.inactive_file ?? 0;
    return {
      running: true,
      ports: this.ports,
      cpuPercent: cpuPercent === null ? null : Math.round(cpuPercent * 10) / 10,
      memory: typeof usage === "number" && typeof limit === "number" ? { usedMb: Math.round((usage - cache) / 1048576), limitMb: Math.round(limit / 1048576) } : null,
      processes: typeof stats.pids_stats?.current === "number" ? { current: stats.pids_stats.current, limit: stats.pids_stats.limit ?? this.env.SANDBOX_PIDS } : null,
    };
  }

  touch(): void {
    this.lastActive = Date.now();
  }

  isIdle(now = Date.now()): boolean {
    return !this.runs.running && this.terminals === 0 && now - this.lastActive > this.env.SANDBOX_IDLE_MINUTES * 60_000;
  }

  async close(): Promise<void> {
    await this.runs.stop("stopped").catch(() => {});
    await this.sandbox.stop();
    this.sync.destroy();
  }
}

export class RoomRegistry {
  private readonly sessions = new Map<string, RoomSession>();
  private readonly sweeper: NodeJS.Timeout;

  constructor(
    private readonly docker: Docker,
    private readonly env: Env,
  ) {
    this.sweeper = setInterval(() => void this.sweep(), 60_000);
  }

  get(roomId: string): RoomSession {
    let session = this.sessions.get(roomId);
    if (!session) {
      session = new RoomSession(this.docker, roomId, this.env);
      this.sessions.set(roomId, session);
    }
    return session;
  }

  peek(roomId: string): RoomSession | undefined {
    return this.sessions.get(roomId);
  }

  async shutdown(): Promise<void> {
    clearInterval(this.sweeper);
    // Containers keep running (a dev restart shouldn't kill terminals); the
    // next runner reconnects to them, and the sweep stops unclaimed ones.
    for (const session of this.sessions.values()) session.sync.destroy();
    this.sessions.clear();
  }

  /**
   * Every minute: close idle rooms, stop containers no session owns (left by
   * an earlier runner process), and remove containers stopped for over a day.
   * Volumes (the files) are kept.
   */
  private async sweep(): Promise<void> {
    for (const [roomId, session] of this.sessions) {
      if (!session.isIdle()) continue;
      this.sessions.delete(roomId);
      log.info(`room ${roomId}: idle, stopping its sandbox`);
      await session.close().catch((error) => log.error(`closing ${roomId}`, error));
    }
    const containers = await this.docker
      .listContainers({ all: true, filters: { label: [`${LABEL_MANAGED}=1`, `${LABEL_NAMESPACE}=${this.env.SANDBOX_NAMESPACE}`] } })
      .catch(() => []);
    const dayAgo = Date.now() / 1000 - 24 * 3600;
    for (const info of containers) {
      const roomId = info.Labels[LABEL_ROOM] ?? "";
      const container = this.docker.getContainer(info.Id);
      if (info.State === "running" && !this.sessions.has(roomId) && info.Created < Date.now() / 1000 - this.env.SANDBOX_IDLE_MINUTES * 60) {
        log.info(`stopping unclaimed sandbox ${info.Names[0] ?? info.Id}`);
        await container.stop({ t: 3 }).catch(() => {});
      } else if (info.State === "exited" && !this.sessions.has(roomId) && info.Created < dayAgo) {
        await container.remove().catch(() => {});
      }
    }
  }
}
