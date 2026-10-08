import type { AgentEvent } from "@codechatter/contracts";
import type Docker from "dockerode";
import type { Duplex } from "node:stream";

import { AgentChannel } from "./agent-channel.js";
import type { Env } from "./env.js";
import { log } from "./log.js";

export const LABEL_ROOM = "codechatter.room";
export const LABEL_MANAGED = "codechatter.managed";
export const LABEL_NAMESPACE = "codechatter.namespace";

/** The only environment user code sees (spike S2: no server secrets, no image ENV). */
const USER_ENV = ["PATH=/usr/local/bin:/usr/bin:/bin", "HOME=/home/ccuser", "LANG=C.UTF-8", "TERM=xterm-256color"];
const USER = "10001";
const AGENT_USER = "10002";

export class SandboxUnavailableError extends Error {}

export type ExecHandle = { exec: Docker.Exec; stream: Duplex };

/** The parts of Docker's container stats the runner reads. */
export type ContainerStats = {
  pids_stats?: { current?: number; limit?: number };
  cpu_stats?: { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number; online_cpus?: number };
  memory_stats?: { usage?: number; limit?: number; stats?: { inactive_file?: number } };
};

/**
 * One room's container (ADR 0003): created on first use, network off,
 * read-only root, no capabilities, PID/memory/CPU limits, and a named volume
 * for /workspace that outlives the container.
 */
export class Sandbox {
  readonly name: string;
  readonly volume: string;
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
  ) {
    const id = roomId.toLowerCase();
    this.name = `cc-${env.SANDBOX_NAMESPACE}-room-${id}`;
    this.volume = `cc-${env.SANDBOX_NAMESPACE}-ws-${id}`;
  }

  /** Start (or reconnect to) the container and its agent. Safe to call concurrently. */
  ensure(): Promise<void> {
    if (this.agent?.alive && this.container) return Promise.resolve();
    this.starting ??= this.start().finally(() => (this.starting = null));
    return this.starting;
  }

  /** Run a process as the sandbox user. TTY for terminals and runs, so programs behave interactively. */
  async exec(cmd: string[], options: { tty: boolean; cols?: number; rows?: number; env?: string[]; stdin?: boolean }): Promise<ExecHandle> {
    const stdin = options.stdin ?? true;
    await this.ensure();
    const size: [number, number] | undefined = options.tty ? [options.rows ?? 24, options.cols ?? 80] : undefined;
    const exec = await this.container!.exec({
      Cmd: cmd,
      User: USER,
      WorkingDir: "/workspace",
      Env: [...USER_ENV, ...(options.env ?? [])],
      AttachStdin: stdin,
      AttachStdout: true,
      AttachStderr: true,
      Tty: options.tty,
      ...(size && { ConsoleSize: size }),
    });
    const stream = (await exec.start({ hijack: true, stdin, Tty: options.tty, ...(size && { ConsoleSize: size }) })) as Duplex;
    return { exec, stream };
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

  /** The Docker client's demultiplexer, for non-TTY exec output (stdout and stderr interleaved with frame headers). */
  get modem(): Docker["modem"] {
    return this.docker.modem;
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

    let container = this.docker.getContainer(this.name);
    let info = await container.inspect().catch((error: { statusCode?: number }) => {
      if (error.statusCode === 404) return null;
      throw error;
    });
    // A rebuilt image (pnpm sandbox:build) replaces old containers; files live on the volume.
    if (info && info.Image !== image.Id) {
      log.info(`${this.name}: sandbox image changed, recreating the container`);
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
    const agent = new AgentChannel(stream, this.docker.modem, (event) => this.onAgentEvent(event));
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
      Labels: { [LABEL_MANAGED]: "1", [LABEL_NAMESPACE]: this.env.SANDBOX_NAMESPACE, [LABEL_ROOM]: this.roomId },
      HostConfig: {
        NetworkMode: "none",
        ReadonlyRootfs: true,
        // exec: compiled C/C++ programs run from /tmp.
        Tmpfs: {
          "/tmp": "rw,exec,nosuid,nodev,size=256m,mode=1777",
          "/home/ccuser": "rw,nosuid,nodev,size=64m,uid=10001,gid=10000,mode=0700",
        },
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges"],
        PidsLimit: this.env.SANDBOX_PIDS,
        Memory: mb,
        MemorySwap: mb,
        NanoCpus: Math.round(this.env.SANDBOX_CPUS * 1e9),
        Init: true,
        IpcMode: "private",
        Mounts: [{ Type: "volume", Source: this.volume, Target: "/workspace" }],
      },
    });
  }
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
