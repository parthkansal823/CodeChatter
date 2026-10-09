import type { AgentEvent } from "@codechatter/contracts";
import type Docker from "dockerode";
import type { Duplex, Writable } from "node:stream";

import { AgentChannel } from "./agent-channel.js";
import type { Env } from "./env.js";
import { log } from "./log.js";
import { freeSubnets } from "./subnets.js";

export const LABEL_ROOM = "codechatter.room";
export const LABEL_MANAGED = "codechatter.managed";
export const LABEL_NAMESPACE = "codechatter.namespace";
/** What a container is to its room, when it isn't the sandbox: "egress" or "database". */
export const LABEL_ROLE = "codechatter.role";
/** Bumped when a container's shape changes (mounts, limits), so older ones are recreated. */
const LABEL_CONFIG = "codechatter.config";
const CONTAINER_CONFIG = "2";

/** The agent's relay to the room's egress proxy (sandbox/agent/src/relay.ts). */
const PROXY = "http://127.0.0.1:3128";
/**
 * The only environment user code sees (spike S2: no server secrets, no image
 * ENV). Package managers go through the agent's relay (ADR 0007) and install
 * into the room's home volume, so `pip install` and `npm install -g` work
 * without root, and their caches make repeat installs fast.
 */
export const USER_ENV = [
  "PATH=/usr/local/bin:/usr/bin:/bin:/home/ccuser/.local/bin:/home/ccuser/.cargo/bin:/home/ccuser/go/bin",
  "HOME=/home/ccuser",
  "LANG=C.UTF-8",
  "TERM=xterm-256color",
  ...["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"].map((name) => `${name}=${PROXY}`),
  ...["NO_PROXY", "no_proxy"].map((name) => `${name}=localhost,127.0.0.1,::1`),
  // Debian marks its Python as managed by apt; with a read-only root, pip installs for the user.
  "PIP_BREAK_SYSTEM_PACKAGES=1",
  "npm_config_prefix=/home/ccuser/.local",
];
const USER = "10001";
const AGENT_USER = "10002";
/** Each room network is a /26 of SANDBOX_SUBNET: the sandbox, the room's services and room to spare. */
const ROOM_SUBNET_BITS = 26;

export class SandboxUnavailableError extends Error {}

export type ExecOptions = { tty: boolean; cols?: number; rows?: number; env?: string[]; stdin?: boolean };

/**
 * What a room needs from its sandbox, whichever driver runs it: Docker (this
 * file) or Kubernetes (kube-sandbox.ts).
 */
export interface RoomSandbox {
  readonly roomId: string;
  agent: AgentChannel | null;
  /** Called for each change the agent reports from inside the sandbox. */
  onAgentEvent: (event: AgentEvent) => void;
  /** Called when the agent connection ends (stop, reset, crash). */
  onAgentClosed: () => void;
  /** Start (or reconnect to) it and its agent. Safe to call concurrently. */
  ensure(): Promise<void>;
  /** Run a process as the sandbox user, in /workspace, with the room's environment. */
  exec(cmd: string[], options: ExecOptions): Promise<ExecHandle>;
  /** Start it again from nothing but its volumes (out of processes, stuck). */
  reset(): Promise<void>;
  /** Stop it (idle). The volumes, and so the files, stay. */
  stop(): Promise<void>;
  stats(): Promise<ContainerStats | null>;
  processes(): Promise<{ current: number; limit: number } | null>;
}

/**
 * A process started in the sandbox, whichever driver runs it. With a TTY,
 * `stream` is the terminal both ways; without one, write its input to
 * `stream` and read its output with `demux`.
 */
export type ExecHandle = {
  stream: Duplex;
  demux(stdout: Writable, stderr: Writable): void;
  resize(cols: number, rows: number): Promise<void>;
  /** Its exit code once it has ended; null while it runs, or when that can't be told. */
  exitCode(): Promise<number | null>;
};

/** The parts of Docker's container stats the runner reads. */
export type ContainerStats = {
  pids_stats?: { current?: number; limit?: number };
  cpu_stats?: { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number; online_cpus?: number };
  memory_stats?: { usage?: number; limit?: number; stats?: { inactive_file?: number } };
};

/**
 * One room's container (ADR 0003): created on first use, on the room's own
 * network (ADR 0007), read-only root, no capabilities, PID/memory/CPU limits,
 * and named volumes for /workspace and the home folder that outlive it.
 */
export class Sandbox implements RoomSandbox {
  readonly name: string;
  readonly volume: string;
  readonly home: string;
  readonly network: string;
  agent: AgentChannel | null = null;
  /** Called for each change the agent reports from inside the sandbox. */
  onAgentEvent: (event: AgentEvent) => void = () => {};
  /** Called when the agent connection ends (stop, reset, crash). */
  onAgentClosed: () => void = () => {};
  private container: Docker.Container | null = null;
  private starting: Promise<void> | null = null;

  constructor(
    private readonly docker: Docker,
    readonly roomId: string,
    private readonly env: Env,
    /** The room's own settings for every terminal and Run: its database connections (databases.ts). */
    private readonly roomEnv: string[] = [],
  ) {
    const id = roomId.toLowerCase();
    this.name = `cc-${env.SANDBOX_NAMESPACE}-room-${id}`;
    this.volume = `cc-${env.SANDBOX_NAMESPACE}-ws-${id}`;
    this.home = `cc-${env.SANDBOX_NAMESPACE}-home-${id}`;
    this.network = `cc-${env.SANDBOX_NAMESPACE}-net-${id}`;
  }

  /** Start (or reconnect to) the container and its agent. Safe to call concurrently. */
  ensure(): Promise<void> {
    if (this.agent?.alive && this.container) return Promise.resolve();
    this.starting ??= this.start().finally(() => (this.starting = null));
    return this.starting;
  }

  /** Run a process as the sandbox user. TTY for terminals and runs, so programs behave interactively. */
  async exec(cmd: string[], options: ExecOptions): Promise<ExecHandle> {
    const stdin = options.stdin ?? true;
    await this.ensure();
    const size: [number, number] | undefined = options.tty ? [options.rows ?? 24, options.cols ?? 80] : undefined;
    const exec = await this.container!.exec({
      Cmd: cmd,
      User: USER,
      WorkingDir: "/workspace",
      Env: [...USER_ENV, ...this.roomEnv, ...(options.env ?? [])],
      AttachStdin: stdin,
      AttachStdout: true,
      AttachStderr: true,
      Tty: options.tty,
      ...(size && { ConsoleSize: size }),
    });
    const stream = (await exec.start({ hijack: true, stdin, Tty: options.tty, ...(size && { ConsoleSize: size }) })) as Duplex;
    return {
      stream,
      // Without a TTY, Docker multiplexes stdout and stderr with 8-byte frame headers.
      demux: (stdout, stderr) => this.docker.modem.demuxStream(stream, stdout, stderr),
      resize: async (cols, rows) => {
        await exec.resize({ h: rows, w: cols });
      },
      exitCode: async () => {
        const info = await exec.inspect().catch(() => null);
        return info && !info.Running ? (info.ExitCode ?? null) : null;
      },
    };
  }

  /**
   * A fork bomb fills the PID limit and then even `docker exec` fails, so the
   * only way out is a restart (ADR 0003 finding 1). The order matters:
   * kill, wait for the old run to end, attach, then start.
   */
  async reset(): Promise<void> {
    log.warn(`${this.name}: resetting the sandbox`);
    const container = this.container ?? this.docker.getContainer(this.name);
    this.agent?.close(new Error("sandbox reset"));
    this.agent = null;
    await container.kill().catch(() => {});
    await container.wait().catch(() => {});
    this.container = null;
    await this.ensure();
  }

  /** Docker's stats for the container, or null if it isn't running. No exec needed. */
  async stats(): Promise<ContainerStats | null> {
    if (!this.container || !this.agent?.alive) return null;
    // "one-shot" answers at once instead of waiting for a second CPU sample.
    return (await this.container.stats({ stream: false, "one-shot": true } as { stream: false }).catch(() => null)) as ContainerStats | null;
  }

  /**
   * Processes in use (still works when the sandbox is out of processes, when
   * exec fails). Null if the container isn't up.
   */
  async processes(): Promise<{ current: number; limit: number } | null> {
    const stats = await this.stats();
    const current = stats?.pids_stats?.current;
    if (typeof current !== "number") return null;
    return { current, limit: stats?.pids_stats?.limit ?? this.env.SANDBOX_PIDS };
  }

  /** Stop the container (idle). The volume, and so the files, stay. */
  async stop(): Promise<void> {
    this.agent?.close(new Error("sandbox stopped"));
    this.agent = null;
    const container = this.container ?? this.docker.getContainer(this.name);
    this.container = null;
    await container.stop({ t: 3 }).catch(() => {});
  }

  private async start(): Promise<void> {
    const image = await this.docker
      .getImage(this.env.SANDBOX_IMAGE)
      .inspect()
      .catch(() => {
        throw new SandboxUnavailableError(`The sandbox image ${this.env.SANDBOX_IMAGE} is missing. Build it with: pnpm sandbox:build`);
      });

    const networkId = await this.ensureNetwork();
    let container = this.docker.getContainer(this.name);
    let info = await container.inspect().catch(missingAsNull);
    // A rebuilt image (pnpm sandbox:build), a new room network or a new
    // container shape replaces old containers (a stopped one would still point
    // at the network it was made with, and fail to start); files live on the
    // volumes.
    if (
      info &&
      (info.Image !== image.Id ||
        info.NetworkSettings.Networks[this.network]?.NetworkID !== networkId ||
        info.Config.Labels?.[LABEL_CONFIG] !== CONTAINER_CONFIG)
    ) {
      log.info(`${this.name}: sandbox image, network or shape changed, recreating the container`);
      await container.remove({ force: true }).catch(() => {});
      info = null;
    }
    if (!info) container = await this.create();
    const running = info?.State.Running ?? false;

    // Attach before start, or the agent's "ready" line is missed (ADR 0003 finding 2).
    const stream = (await withTimeout(
      container.attach({ stream: true, stdin: true, stdout: true, stderr: true, hijack: true }),
      15_000,
      "attaching to the sandbox timed out",
    )) as Duplex;
    // docker-modem also sends the attach options as a JSON request body, and on
    // a hijacked connection the engine sometimes hands those bytes to stdin
    // (seen on the Linux socket: '{"stream":true,...}{"op":"reconcile",...}').
    // A newline first puts any such bytes on a line of their own, which the
    // agent ignores. (An empty body instead leaves Node's request unflushed.)
    stream.write("\n");
    const agent = new AgentChannel(stream, (stdout, stderr) => this.docker.modem.demuxStream(stream, stdout, stderr), (event) => this.onAgentEvent(event));
    try {
      if (running) {
        await agent.request({ op: "ping" }, 5000);
      } else {
        const ready = agent.waitReady(20_000);
        await container.start();
        await ready;
      }
    } catch (error) {
      agent.close();
      throw error;
    }
    agent.onClose(() => {
      if (this.agent === agent) this.agent = null;
      this.onAgentClosed();
    });
    this.container = container;
    this.agent = agent;
    log.info(`${this.name}: sandbox ${running ? "reconnected" : "started"}`);
  }

  /**
   * The room's own network (ADR 0007): internal, with no address on the host
   * (gateway mode "isolated"). The sandbox and the room's services reach each
   * other by name; the host, other rooms and the internet are out of reach
   * (test/network.e2e.mjs). Docker's default address pools hold only about 30
   * networks, so each room takes a block of SANDBOX_SUBNET instead.
   */
  async ensureNetwork(): Promise<string> {
    const existing = await this.docker.getNetwork(this.network).inspect().catch(missingAsNull);
    if (existing) return existing.Id as string;
    const taken = (await this.docker.listNetworks()).flatMap((n) => (n.IPAM?.Config ?? []).map((c) => c.Subnet ?? ""));
    for (const subnet of freeSubnets(this.env.SANDBOX_SUBNET, ROOM_SUBNET_BITS, taken)) {
      try {
        const network = await this.docker.createNetwork({
          Name: this.network,
          Driver: "bridge",
          Internal: true,
          IPAM: { Driver: "default", Config: [{ Subnet: subnet }] },
          Options: { "com.docker.network.bridge.gateway_mode_ipv4": "isolated" },
          Labels: { [LABEL_MANAGED]: "1", [LABEL_NAMESPACE]: this.env.SANDBOX_NAMESPACE, [LABEL_ROOM]: this.roomId },
        });
        log.info(`${this.network}: created on ${subnet}`);
        return network.id;
      } catch (error) {
        // Made meanwhile by another caller (installs allowed while the sandbox starts).
        if ((error as { statusCode?: number }).statusCode === 409) {
          const made = await this.docker.getNetwork(this.network).inspect().catch(missingAsNull);
          if (made) return made.Id as string;
        }
        // Another network took this block since the list (Docker refuses overlaps): try the next.
        if (!/overlap/i.test((error as Error).message)) throw error;
      }
    }
    throw new SandboxUnavailableError(`No room left in SANDBOX_SUBNET (${this.env.SANDBOX_SUBNET}) for another room network.`);
  }

  private create(): Promise<Docker.Container> {
    const mb = this.env.SANDBOX_MEMORY_MB * 1024 * 1024;
    return this.docker.createContainer({
      name: this.name,
      Image: this.env.SANDBOX_IMAGE,
      User: AGENT_USER,
      Env: ["PATH=/usr/local/bin:/usr/bin:/bin", "LANG=C.UTF-8"],
      WorkingDir: "/workspace",
      OpenStdin: true,
      StdinOnce: false,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      Labels: {
        [LABEL_MANAGED]: "1",
        [LABEL_NAMESPACE]: this.env.SANDBOX_NAMESPACE,
        [LABEL_ROOM]: this.roomId,
        [LABEL_CONFIG]: CONTAINER_CONFIG,
      },
      HostConfig: {
        NetworkMode: this.network,
        ReadonlyRootfs: true,
        // exec: compiled C/C++ programs run from /tmp.
        Tmpfs: { "/tmp": "rw,exec,nosuid,nodev,size=256m,mode=1777" },
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges"],
        PidsLimit: this.env.SANDBOX_PIDS,
        Memory: mb,
        MemorySwap: mb,
        NanoCpus: Math.round(this.env.SANDBOX_CPUS * 1e9),
        Init: true,
        IpcMode: "private",
        // A new home volume starts as the image's /home/ccuser: owned by ccuser, mode 700.
        Mounts: [
          { Type: "volume", Source: this.volume, Target: "/workspace" },
          { Type: "volume", Source: this.home, Target: "/home/ccuser" },
        ],
      },
    });
  }
}

/** For Docker inspects: null when the object doesn't exist. */
function missingAsNull(error: { statusCode?: number }): null {
  if (error.statusCode === 404) return null;
  throw error;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}
