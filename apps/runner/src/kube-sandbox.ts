import type { AgentEvent } from "@codechatter/contracts";
import * as k8s from "@kubernetes/client-node";
import { Duplex, PassThrough } from "node:stream";

import { AgentChannel } from "./agent-channel.js";
import type { Env } from "./env.js";
import { log, messageOf } from "./log.js";
import {
  LABEL_MANAGED,
  LABEL_NAMESPACE,
  LABEL_ROLE,
  LABEL_ROOM,
  SandboxUnavailableError,
  USER_ENV,
  type ContainerStats,
  type ExecHandle,
  type ExecOptions,
  type RoomSandbox,
} from "./sandbox.js";

export type Kube = { core: k8s.CoreV1Api; exec: k8s.Exec; attach: k8s.Attach };

/** The cluster: the one the runner runs in, else KUBE_CONTEXT or the kubeconfig's current context. */
export function connectKube(env: Env): Kube {
  const config = new k8s.KubeConfig();
  config.loadFromDefault();
  if (env.KUBE_CONTEXT) config.setCurrentContext(env.KUBE_CONTEXT);
  return { core: config.makeApiClient(k8s.CoreV1Api), exec: new k8s.Exec(config), attach: new k8s.Attach(config) };
}

/** Each room's namespace: everything the room has on the cluster lives in it, and goes with it. */
export const roomNamespace = (namespace: string, roomId: string) => `cc-${namespace}-${roomId.toLowerCase()}`;

const POD = "sandbox";
/** The group that shares the room's files (as in the Docker image). */
const GROUP = 10000;

/**
 * A user id for the room. Kubernetes runs every exec as the pod's user, so
 * the agent and the room's code share one; a user per room keeps rooms apart
 * on a node, and lets the per-user process limit (RLIMIT_NPROC) be per room.
 */
export function roomUid(roomId: string): number {
  let hash = 0x811c9dc5;
  for (const c of roomId) hash = Math.imul(hash ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return 100_000 + (hash % 900_000);
}

/** Missing on the cluster: a 404 from the API. */
const missing = (error: unknown) => (error as { code?: number }).code === 404;
const exists = (error: unknown) => (error as { code?: number }).code === 409;

/**
 * One room's sandbox on Kubernetes (roadmap §14 F, Track 2). The room is a
 * namespace with two volume claims, its workspace and its home, and a pod named
 * "sandbox" from the same image as on Docker:
 *
 *   - non-root (the room's own user), read-only root, no capabilities, seccomp,
 *     no Kubernetes token, and no service addresses in its environment
 *   - /tmp in memory; the pause process as PID 1 reaps orphans, as Docker's --init did
 *   - the same agent over attach, and runs and terminals over exec
 *
 * Stopping deletes the pod; the volumes, and so the files, stay. Deleting the
 * room deletes its namespace.
 */
export class KubeSandbox implements RoomSandbox {
  readonly namespace: string;
  agent: AgentChannel | null = null;
  onAgentEvent: (event: AgentEvent) => void = () => {};
  onAgentClosed: () => void = () => {};
  private starting: Promise<void> | null = null;

  constructor(
    private readonly kube: Kube,
    readonly roomId: string,
    private readonly env: Env,
    private readonly roomEnv: string[] = [],
  ) {
    this.namespace = roomNamespace(env.SANDBOX_NAMESPACE, roomId);
  }

  ensure(): Promise<void> {
    if (this.agent?.alive) return Promise.resolve();
    this.starting ??= this.start().finally(() => (this.starting = null));
    return this.starting;
  }

  async exec(cmd: string[], options: ExecOptions): Promise<ExecHandle> {
    await this.ensure();
    // An exec takes the pod's environment and has no limit of its own, so both are set here:
    // exactly the room's environment (env -i), and the room's process limit. The limit counts
    // the room user's processes and threads, the agent's included, like Docker's PID limit;
    // prlimit fails the exec rather than run without it.
    const nproc = `--nproc=${this.env.SANDBOX_PIDS}:${this.env.SANDBOX_PIDS}`;
    const command = ["env", "-i", ...USER_ENV, ...this.roomEnv, ...(options.env ?? []), "prlimit", nproc, "--", ...cmd];
    const stdin = (options.stdin ?? true) ? new PassThrough() : null;
    // The client resizes a terminal from its output stream's rows and columns, on "resize".
    const stdout = Object.assign(new PassThrough(), { columns: options.cols ?? 80, rows: options.rows ?? 24 });
    const stderr = new PassThrough();
    let exitCode: number | null = null;
    let ended = false;
    const socket = await this.kube.exec
      .exec(this.namespace, POD, POD, command, stdout, options.tty ? null : stderr, stdin, options.tty, (status) => {
        exitCode = exitCodeOf(status);
      })
      .catch(async (error: unknown) => {
        // Usually the pod ended a moment ago (out of memory kills the whole container) and the
        // agent's connection hasn't closed yet: let it go, so the next ensure() starts a new pod.
        const up = await this.noticeEnded();
        throw new SandboxUnavailableError(up ? `The sandbox couldn't start this (${messageOf(error)}).` : "The sandbox stopped (out of memory, or removed). It starts again with the next run.");
      });
    const stream = new Duplex({
      write(chunk: Buffer, _encoding, done) {
        if (stdin) stdin.write(chunk, () => done());
        else done();
      },
      final(done) {
        stdin?.end();
        done();
      },
      read() {},
      destroy(error, done) {
        socket.close();
        done(error);
      },
    });
    if (options.tty) stdout.on("data", (chunk: Buffer) => stream.push(chunk));
    socket.on("close", () => {
      ended = true;
      stream.push(null);
    });
    socket.on("error", (error: Error) => stream.destroy(error));
    return {
      stream,
      demux: (out, err) => {
        stdout.pipe(out);
        stderr.pipe(err);
      },
      resize: async (cols, rows) => {
        stdout.columns = cols;
        stdout.rows = rows;
        stdout.emit("resize");
      },
      exitCode: async () => (ended ? exitCode : null),
    };
  }

  async reset(): Promise<void> {
    log.warn(`${this.namespace}: resetting the sandbox`);
    this.agent?.close(new Error("sandbox reset"));
    this.agent = null;
    await this.deletePod(true);
    await this.ensure();
  }

  async stop(): Promise<void> {
    this.agent?.close(new Error("sandbox stopped"));
    this.agent = null;
    await this.deletePod(false);
  }

  /** From the pod's own cgroup (no metrics server needed), shaped like Docker's stats. Null when it isn't up. */
  async stats(): Promise<ContainerStats | null> {
    if (!this.agent?.alive) return null;
    // One process, no shell: after a fork bomb the room's user can't start a second one.
    const files = ["memory.current", "memory.max", "pids.current", "cpu.stat", "memory.stat"].map((name) => `/sys/fs/cgroup/${name}`);
    const handle = await this.exec(["cat", ...files], { tty: false, stdin: false }).catch(() => null);
    if (!handle) return null;
    const out = new PassThrough();
    let text = "";
    out.on("data", (chunk: Buffer) => (text += chunk.toString()));
    handle.demux(out, new PassThrough().resume());
    await new Promise((resolve) => handle.stream.on("end", resolve).resume());
    const [current, max, pids] = text.split("\n");
    const field = (name: string) => Number(new RegExp(`^${name} (\\d+)`, "m").exec(text)?.[1] ?? 0);
    const limit = Number(max) || this.env.SANDBOX_MEMORY_MB * 1024 * 1024;
    return {
      pids_stats: { current: Number(pids) || 0, limit: this.env.SANDBOX_PIDS },
      // CPU time against wall-clock time: one CPU busy is 100%.
      cpu_stats: { cpu_usage: { total_usage: field("usage_usec") * 1000 }, system_cpu_usage: Date.now() * 1e6, online_cpus: 1 },
      memory_stats: { usage: Number(current) || 0, limit, stats: { inactive_file: field("inactive_file") } },
    };
  }

  async processes(): Promise<{ current: number; limit: number } | null> {
    const stats = await this.stats();
    return stats?.pids_stats?.current !== undefined ? { current: stats.pids_stats.current, limit: this.env.SANDBOX_PIDS } : null;
  }

  /** Whether the pod is up. If it has ended or is gone, the agent goes with it; an API error says nothing either way. */
  private async noticeEnded(): Promise<boolean> {
    const pod = await this.kube.core.readNamespacedPod({ name: POD, namespace: this.namespace }).catch((error: unknown) => (missing(error) ? null : undefined));
    if (pod === undefined) return true;
    const state = pod?.status?.containerStatuses?.[0]?.state;
    if (pod?.status?.phase === "Running" && state?.running && !pod.metadata?.deletionTimestamp) return true;
    log.warn(`${this.namespace}: the sandbox pod ended (${state?.terminated?.reason ?? pod?.status?.phase ?? "deleted"})`);
    this.agent?.close(new Error("sandbox pod ended"));
    this.agent = null;
    return false;
  }

  private labels(role: string): Record<string, string> {
    return { [LABEL_MANAGED]: "1", [LABEL_NAMESPACE]: this.env.SANDBOX_NAMESPACE, [LABEL_ROOM]: this.roomId, [LABEL_ROLE]: role };
  }

  private async start(): Promise<void> {
    await this.ensureRoom();
    let pod = await this.kube.core.readNamespacedPod({ name: POD, namespace: this.namespace }).catch((error: unknown) => {
      if (missing(error)) return null;
      throw error;
    });
    // A pod from another image, one that ended, or one on its way out is replaced; the files are on the volumes.
    const phase = pod?.status?.phase;
    if (pod && (pod.spec?.containers[0]?.image !== this.env.SANDBOX_IMAGE || phase === "Succeeded" || phase === "Failed" || pod.metadata?.deletionTimestamp)) {
      await this.deletePod(true);
      pod = null;
    }
    if (!pod) await this.createPod();
    await this.waitRunning(10 * 60_000); // the first start pulls the image into the cluster

    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const socket = await this.kube.attach.attach(this.namespace, POD, POD, stdout, stderr, stdin, false);
    const stream = new Duplex({
      write(chunk: Buffer, _encoding, done) {
        stdin.write(chunk, () => done());
      },
      read() {},
      destroy(error, done) {
        socket.close();
        done(error);
      },
    });
    socket.on("close", () => {
      stream.push(null);
      stream.destroy();
    });
    socket.on("error", (error: Error) => stream.destroy(error));
    const agent = new AgentChannel(
      stream,
      (out, err) => {
        stdout.pipe(out);
        stderr.pipe(err);
      },
      (event) => this.onAgentEvent(event),
    );
    try {
      // Attached after the pod started, so its "ready" line may be gone: ask until it answers.
      const until = Date.now() + 60_000;
      for (;;) {
        try {
          await agent.request({ op: "ping" }, 5000);
          break;
        } catch (error) {
          if (Date.now() > until || !agent.alive) throw error;
        }
      }
    } catch (error) {
      agent.close();
      throw error;
    }
    agent.onClose(() => {
      if (this.agent === agent) this.agent = null;
      this.onAgentClosed();
    });
    this.agent = agent;
    log.info(`${this.namespace}: sandbox pod up`);
  }

  /** The room's namespace and its two volume claims, made the first time. */
  private async ensureRoom(): Promise<void> {
    const labels = this.labels("room");
    await this.kube.core.createNamespace({ body: { metadata: { name: this.namespace, labels } } }).catch((error: unknown) => {
      if (!exists(error)) throw error;
    });
    for (const name of ["workspace", "home"]) {
      await this.kube.core
        .createNamespacedPersistentVolumeClaim({
          namespace: this.namespace,
          body: {
            metadata: { name, labels },
            spec: {
              accessModes: ["ReadWriteOnce"],
              resources: { requests: { storage: `${this.env.SANDBOX_STORAGE_GB}Gi` } },
              ...(this.env.SANDBOX_STORAGE_CLASS && { storageClassName: this.env.SANDBOX_STORAGE_CLASS }),
            },
          },
        })
        .catch((error: unknown) => {
          if (!exists(error)) throw error;
        });
    }
  }

  private async createPod(): Promise<void> {
    const memory = `${this.env.SANDBOX_MEMORY_MB}Mi`;
    await this.kube.core.createNamespacedPod({
      namespace: this.namespace,
      body: {
        metadata: { name: POD, labels: this.labels("sandbox") },
        spec: {
          restartPolicy: "Never",
          automountServiceAccountToken: false,
          enableServiceLinks: false,
          shareProcessNamespace: true,
          terminationGracePeriodSeconds: 3,
          securityContext: { runAsUser: roomUid(this.roomId), runAsGroup: GROUP, fsGroup: GROUP, runAsNonRoot: true, seccompProfile: { type: "RuntimeDefault" } },
          containers: [
            {
              name: POD,
              image: this.env.SANDBOX_IMAGE,
              imagePullPolicy: "IfNotPresent",
              stdin: true,
              stdinOnce: false,
              tty: false,
              workingDir: "/workspace",
              env: [
                { name: "PATH", value: "/usr/local/bin:/usr/bin:/bin" },
                { name: "LANG", value: "C.UTF-8" },
              ],
              securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ["ALL"] } },
              resources: { limits: { memory, cpu: String(this.env.SANDBOX_CPUS) }, requests: { memory: "128Mi", cpu: "100m" } },
              volumeMounts: [
                { name: "workspace", mountPath: "/workspace" },
                { name: "home", mountPath: "/home/ccuser" },
                { name: "tmp", mountPath: "/tmp" },
              ],
            },
          ],
          volumes: [
            { name: "workspace", persistentVolumeClaim: { claimName: "workspace" } },
            { name: "home", persistentVolumeClaim: { claimName: "home" } },
            // exec allowed: compiled C and C++ programs run from /tmp.
            { name: "tmp", emptyDir: { medium: "Memory", sizeLimit: "256Mi" } },
          ],
        },
      },
    });
  }

  private async waitRunning(ms: number): Promise<void> {
    const until = Date.now() + ms;
    for (;;) {
      const pod = await this.kube.core.readNamespacedPod({ name: POD, namespace: this.namespace });
      const status = pod.status?.containerStatuses?.[0];
      if (pod.status?.phase === "Running" && status?.state?.running) return;
      const waiting = status?.state?.waiting?.reason;
      if (waiting && /ErrImagePull|ImagePullBackOff|InvalidImageName|CrashLoopBackOff|CreateContainerConfigError/.test(waiting)) {
        throw new SandboxUnavailableError(`The sandbox couldn't start on Kubernetes: ${waiting}${status?.state?.waiting?.message ? ` (${status.state.waiting.message})` : ""}.`);
      }
      if (pod.status?.phase === "Failed" || Date.now() > until) throw new SandboxUnavailableError(`The sandbox didn't start on Kubernetes (${pod.status?.phase ?? "no status"}).`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  /** Delete the pod; with `wait`, until it's gone (a new one takes its name). */
  private async deletePod(wait: boolean): Promise<void> {
    await this.kube.core.deleteNamespacedPod({ name: POD, namespace: this.namespace, gracePeriodSeconds: 0 }).catch(() => {});
    if (!wait) return;
    for (let i = 0; i < 120; i++) {
      const gone = await this.kube.core.readNamespacedPod({ name: POD, namespace: this.namespace }).then(
        () => false,
        (error: unknown) => missing(error),
      );
      if (gone) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

/** An exec's exit code from the status Kubernetes sends at its end. */
function exitCodeOf(status: k8s.V1Status): number | null {
  if (status.status === "Success") return 0;
  const cause = status.details?.causes?.find((c) => c.reason === "ExitCode");
  return cause?.message !== undefined ? Number(cause.message) : null;
}
