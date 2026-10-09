import type Docker from "dockerode";

import type { SandboxStatus } from "@codechatter/contracts";

import { databaseEnv, databasePassword, Databases } from "./databases.js";
import { DocSync } from "./doc-sync.js";
import { Egress, LABEL_UNTIL } from "./egress.js";
import type { Env } from "./env.js";
import { log } from "./log.js";
import { RunManager } from "./runs.js";
import { KubeSandbox, roomNamespace, type Kube } from "./kube-sandbox.js";
import { LABEL_MANAGED, LABEL_NAMESPACE, LABEL_ROLE, LABEL_ROOM, Sandbox, type RoomSandbox } from "./sandbox.js";
import { TunnelHub } from "./tunnel.js";

/**
 * Everything the runner holds for one room: the container, the live copy of
 * the room's files, the current run and open terminals. Created on first use,
 * closed after SANDBOX_IDLE_MINUTES with no run and no terminal.
 */
export class RoomSession {
  readonly sandbox: RoomSandbox;
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
    private readonly databases: Databases,
    kube: Kube | null,
  ) {
    const roomEnv = databaseEnv(databasePassword(env.SERVICE_SECRET, roomId));
    this.sandbox = kube ? new KubeSandbox(kube, roomId, env, roomEnv) : new Sandbox(docker, roomId, env, roomEnv);
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
      // A new agent (first start or after a reset) gets the full file set,
      // and databases that slept with the sandbox wake up.
      if (!this.sync.isAttachedTo(this.sandbox.agent)) {
        await this.sync.attach(this.sandbox.agent!);
        void this.databases.resume(this.roomId);
      }
    })().finally(() => (this.readying = null));
    return this.readying;
  }

  /** Ports, CPU, memory and processes for the Ports and resources panel. */
  async status(): Promise<Omit<SandboxStatus, "installs">> {
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
    await this.databases.pause(this.roomId).catch(() => {});
    await this.sandbox.stop();
    this.sync.destroy();
  }
}

export class RoomRegistry {
  readonly egress: Egress;
  readonly databases: Databases;
  private readonly sessions = new Map<string, RoomSession>();
  private readonly sweeper: NodeJS.Timeout;

  constructor(
    private readonly docker: Docker,
    private readonly env: Env,
    /** Set when rooms run on Kubernetes (RUNNER_DRIVER=kubernetes). */
    private readonly kube: Kube | null = null,
  ) {
    this.egress = new Egress(docker, env);
    this.databases = new Databases(docker, env);
    this.sweeper = setInterval(() => void this.sweep(), 60_000);
  }

  get(roomId: string): RoomSession {
    let session = this.sessions.get(roomId);
    if (!session) {
      session = new RoomSession(this.docker, roomId, this.env, this.databases, this.kube);
      this.sessions.set(roomId, session);
    }
    return session;
  }

  peek(roomId: string): RoomSession | undefined {
    return this.sessions.get(roomId);
  }

  /**
   * Everything Docker holds for a deleted room, gone: its containers (sandbox,
   * databases, package proxy), volumes and network. Its files live on in the
   * room's document, so the workspace volume is only the sandbox's copy.
   */
  async destroy(roomId: string): Promise<void> {
    const session = this.sessions.get(roomId);
    this.sessions.delete(roomId);
    if (session) {
      await session.runs.stop("stopped").catch(() => {});
      session.sync.destroy();
    }
    const ns = this.env.SANDBOX_NAMESPACE;
    // On Kubernetes, everything the room had is in its namespace.
    if (this.kube) {
      await this.kube.core.deleteNamespace({ name: roomNamespace(ns, roomId) }).catch(() => {});
    }
    const filters = { label: [`${LABEL_ROOM}=${roomId}`, `${LABEL_NAMESPACE}=${ns}`] };
    for (const info of await this.docker.listContainers({ all: true, filters }).catch(() => [])) {
      await this.docker.getContainer(info.Id).remove({ force: true }).catch(() => {});
    }
    // Database volumes carry labels; the workspace and home volumes are made by name.
    const labelled = ((await this.docker.listVolumes({ filters }).catch(() => null))?.Volumes ?? []).map((volume) => volume.Name);
    const id = roomId.toLowerCase();
    for (const name of new Set([...labelled, `cc-${ns}-ws-${id}`, `cc-${ns}-home-${id}`])) {
      await this.docker.getVolume(name).remove().catch(() => {});
    }
    for (const network of await this.docker.listNetworks({ filters }).catch(() => [])) {
      await this.docker.getNetwork(network.Id).remove().catch(() => {});
    }
    log.info(`room ${roomId}: deleted, and its containers, volumes and network with it`);
  }

  /**
   * Remove what's left of rooms that no longer exist: everything in this
   * namespace for a room not in `rooms` (the API sends the rooms it has). A
   * room with a live session is never touched, nor is anything when the list
   * is empty, which is more likely a mistake than an empty server.
   */
  async prune(rooms: string[]): Promise<string[]> {
    if (rooms.length === 0) return [];
    const keep = new Set(rooms);
    const ns = this.env.SANDBOX_NAMESPACE;
    const ours = { label: [`${LABEL_MANAGED}=1`, `${LABEL_NAMESPACE}=${ns}`] };
    const found = new Set<string>();
    for (const info of await this.docker.listContainers({ all: true, filters: ours })) found.add(info.Labels[LABEL_ROOM] ?? "");
    for (const network of await this.docker.listNetworks({ filters: ours })) found.add(network.Labels?.[LABEL_ROOM] ?? "");
    if (this.kube) {
      const namespaces = await this.kube.core.listNamespace({ labelSelector: `${LABEL_MANAGED}=1,${LABEL_NAMESPACE}=${ns}` });
      for (const namespace of namespaces.items) found.add(namespace.metadata?.labels?.[LABEL_ROOM] ?? "");
    }
    const byName = new RegExp(`^cc-${ns}-(?:ws|home|db-[a-z]+)-([a-z0-9]{6})$`);
    for (const volume of (await this.docker.listVolumes()).Volumes ?? []) {
      const match = byName.exec(volume.Name);
      if (match) found.add(match[1]!.toUpperCase());
    }
    const gone = [...found].filter((roomId) => /^[A-Z0-9]{6}$/.test(roomId) && !keep.has(roomId) && !this.sessions.has(roomId));
    for (const roomId of gone) await this.destroy(roomId);
    return gone;
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
   * an earlier runner process), remove containers stopped for over a day and
   * egress proxies whose time is up, put to sleep the databases of rooms with
   * no session, then remove the networks of rooms left with no container.
   * Volumes (files, home folders, database data) are kept.
   */
  private async sweep(): Promise<void> {
    for (const [roomId, session] of this.sessions) {
      if (!session.isIdle()) continue;
      this.sessions.delete(roomId);
      log.info(`room ${roomId}: idle, stopping its sandbox`);
      await session.close().catch((error) => log.error(`closing ${roomId}`, error));
    }
    const ours = { label: [`${LABEL_MANAGED}=1`, `${LABEL_NAMESPACE}=${this.env.SANDBOX_NAMESPACE}`] };
    const containers = await this.docker.listContainers({ all: true, filters: ours }).catch(() => []);
    const dayAgo = Date.now() / 1000 - 24 * 3600;
    const withContainer = new Set<string>();
    // Rooms whose sandbox runs (those have no role label): their databases stay up, even
    // while a restarted runner has no session for them yet.
    const sandboxUp = new Set(containers.filter((info) => !info.Labels[LABEL_ROLE] && info.State === "running").map((info) => info.Labels[LABEL_ROOM]));
    for (const info of containers) {
      const roomId = info.Labels[LABEL_ROOM] ?? "";
      const container = this.docker.getContainer(info.Id);
      if (info.Labels[LABEL_ROLE] === "egress") {
        // Installs end on time: the proxy exits by itself, and goes here if it somehow hasn't.
        if (info.State !== "running" || !(Number(info.Labels[LABEL_UNTIL]) > Date.now())) {
          await container.remove({ force: true }).catch(() => {});
          continue;
        }
      } else if (info.Labels[LABEL_ROLE] === "database") {
        // A room's databases sleep with its sandbox (stopped, data kept) and wake with it.
        if (info.State === "running" && !this.sessions.has(roomId) && !sandboxUp.has(roomId)) await container.stop({ t: 15 }).catch(() => {});
      } else if (info.State === "running" && !this.sessions.has(roomId) && info.Created < Date.now() / 1000 - this.env.SANDBOX_IDLE_MINUTES * 60) {
        log.info(`stopping unclaimed sandbox ${info.Names[0] ?? info.Id}`);
        await container.stop({ t: 3 }).catch(() => {});
      } else if (info.State === "exited" && !this.sessions.has(roomId) && info.Created < dayAgo) {
        await container.remove().catch(() => {});
        continue;
      }
      withContainer.add(roomId);
    }
    // On Kubernetes: sandbox pods no session owns (left by an earlier runner) stop after the idle time.
    if (this.kube) {
      const pods = await this.kube.core.listPodForAllNamespaces({ labelSelector: `${LABEL_MANAGED}=1,${LABEL_NAMESPACE}=${this.env.SANDBOX_NAMESPACE},${LABEL_ROLE}=sandbox` }).catch(() => null);
      for (const pod of pods?.items ?? []) {
        const roomId = pod.metadata?.labels?.[LABEL_ROOM] ?? "";
        const started = pod.metadata?.creationTimestamp ? new Date(pod.metadata.creationTimestamp).getTime() : Date.now();
        if (this.sessions.has(roomId) || Date.now() - started < this.env.SANDBOX_IDLE_MINUTES * 60_000) continue;
        log.info(`stopping unclaimed sandbox pod in ${pod.metadata?.namespace}`);
        await this.kube.core.deleteNamespacedPod({ name: pod.metadata!.name!, namespace: pod.metadata!.namespace!, gracePeriodSeconds: 0 }).catch(() => {});
      }
    }
    // The next start makes a room's network again.
    const networks = await this.docker.listNetworks({ filters: ours }).catch(() => []);
    for (const network of networks) {
      // Room networks only: the proxies' shared way out has no room.
      const roomId = network.Labels?.[LABEL_ROOM];
      if (!roomId || this.sessions.has(roomId) || withContainer.has(roomId)) continue;
      await this.docker
        .getNetwork(network.Id)
        .remove()
        .then(() => log.info(`removed the unused network ${network.Name}`))
        .catch(() => {});
    }
  }
}
