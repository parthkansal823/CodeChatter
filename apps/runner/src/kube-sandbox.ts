import { DATABASE_KINDS, DATABASES, type AgentEvent } from "@codechatter/contracts";
import * as k8s from "@kubernetes/client-node";
import { Duplex, PassThrough } from "node:stream";

import { AgentChannel } from "./agent-channel.js";
import { databaseEnv, databasePassword, LABEL_KIND } from "./databases.js";
import type { Env } from "./env.js";
import { log, messageOf } from "./log.js";
import {
  LABEL_CONFIG,
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

export type Kube = { core: k8s.CoreV1Api; apps: k8s.AppsV1Api; net: k8s.NetworkingV1Api; exec: k8s.Exec; attach: k8s.Attach };

/** The cluster: the one the runner runs in, else KUBE_CONTEXT or the kubeconfig's current context. */
export function connectKube(env: Env): Kube {
  const config = new k8s.KubeConfig();
  config.loadFromDefault();
  if (env.KUBE_CONTEXT) config.setCurrentContext(env.KUBE_CONTEXT);
  return {
    core: config.makeApiClient(k8s.CoreV1Api),
    apps: config.makeApiClient(k8s.AppsV1Api),
    net: config.makeApiClient(k8s.NetworkingV1Api),
    exec: new k8s.Exec(config),
    attach: new k8s.Attach(config),
  };
}

/** Each room's namespace: everything the room has on the cluster lives in it, and goes with it. */
export const roomNamespace = (namespace: string, roomId: string) => `cc-${namespace}-${roomId.toLowerCase()}`;

const POD = "sandbox";
/** Bumped when the pod's spec changes, so pods made before are replaced on their next start. */
const POD_CONFIG = "4";
/** The package proxy's port (sandbox/agent/src/egress.ts), and its name in the room. */
export const EGRESS_PORT = 3128;
/** The room's Secret: its database password, for its pods' environments. */
export const ROOM_SECRET = "room";
/**
 * The room's settings for its code (its database connections, databases.ts), as the pod's
 * environment has them: those with the password expand it from the Secret when the pod starts.
 */
const POD_ROOM_ENV: k8s.V1EnvVar[] = [
  { name: "CC_PASSWORD", valueFrom: { secretKeyRef: { name: ROOM_SECRET, key: "password" } } },
  ...databaseEnv("$(CC_PASSWORD)").map((entry) => ({ name: entry.slice(0, entry.indexOf("=")), value: entry.slice(entry.indexOf("=") + 1) })),
];
/** For an exec's `env -i`: those settings, copied from the pod's environment by name. */
const COPIED_ENV = POD_ROOM_ENV.slice(1)
  .map(({ name }) => `${name}="$${name}"`)
  .join(" ");
/** Open files per process in the room's code: Docker's default. */
const OPEN_FILES = 1_048_576;
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
    /** The image to run: the room's owner can pick (room-session.ts). */
    private readonly image: () => string = () => env.SANDBOX_IMAGE,
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
    // prlimit fails the exec rather than run without it. The settings that carry the room's
    // database password are the pod's own (from the room's Secret), and the shell copies them
    // over, so the password is never part of an exec request. Open files come down to Docker's
    // limit: containers here get about a billion, and some runtimes size tables by it (Erlang's
    // runs out of memory). Only ever lowered, so a smaller limit just stays.
    const nproc = `--nproc=${this.env.SANDBOX_PIDS}:${this.env.SANDBOX_PIDS}`;
    const script = `ulimit -n ${OPEN_FILES} 2>/dev/null; exec env -i ${COPIED_ENV} "$@"`;
    const command = ["sh", "-c", script, "sh", ...USER_ENV, ...(options.env ?? []), "prlimit", nproc, "--", ...cmd];
    return openExec(this.kube, this.namespace, POD, POD, command, { tty: options.tty, stdin: options.stdin ?? true, cols: options.cols, rows: options.rows }).catch(
      async (error: unknown) => {
        // Usually the pod ended a moment ago (out of memory kills the whole container) and the
        // agent's connection hasn't closed yet: let it go, so the next ensure() starts a new pod.
        const up = await this.noticeEnded();
        throw new SandboxUnavailableError(up ? `The sandbox couldn't start this (${messageOf(error)}).` : "The sandbox stopped (out of memory, or removed). It starts again with the next run.");
      },
    );
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
    // One process (each step execs the next): after a fork bomb the room's user can't start a second one.
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

  /** The pod, or null if there's none. */
  private async readPod(): Promise<k8s.V1Pod | null> {
    return this.kube.core.readNamespacedPod({ name: POD, namespace: this.namespace }).catch((error: unknown) => {
      if (missing(error)) return null;
      throw error;
    });
  }

  /**
   * Why the pod ended ("OOMKilled", "Failed", "deleted"), or null if it's still up after
   * `ms`. Its status lags its container by a few seconds, so after an exec or attach fails
   * this waits a little for the status to catch up.
   */
  private async whyEnded(ms: number): Promise<string | null> {
    const until = Date.now() + ms;
    for (;;) {
      const pod = await this.readPod().catch(() => undefined);
      if (pod === null) return "deleted";
      if (pod && ended(pod)) return pod.status?.containerStatuses?.[0]?.state?.terminated?.reason ?? pod.status?.phase ?? "ended";
      if (Date.now() > until) return null;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  /** After a failed exec: whether the pod is up. If it has ended, the agent goes with it. */
  private async noticeEnded(): Promise<boolean> {
    const reason = await this.whyEnded(5000);
    if (!reason) return true;
    log.warn(`${this.namespace}: the sandbox pod ended (${reason})`);
    this.agent?.close(new Error("sandbox pod ended"));
    this.agent = null;
    return false;
  }

  private labels(role: string): Record<string, string> {
    return { [LABEL_MANAGED]: "1", [LABEL_NAMESPACE]: this.env.SANDBOX_NAMESPACE, [LABEL_ROOM]: this.roomId, [LABEL_ROLE]: role };
  }

  /**
   * Start the pod if it isn't running, and connect to its agent. A pod from another
   * image, one that ended (running out of memory ends the whole pod) or one on its way
   * out is replaced; the files are on the volumes. A pod's status lags its container by
   * a moment, so a pod that turns out to have ended while we connect is replaced too, once.
   */
  private async start(): Promise<void> {
    const aliases = await this.prepare();
    for (let attempt = 1; ; attempt++) {
      const pod = await this.readPod();
      const replace = pod !== null && (pod.spec?.containers[0]?.image !== this.image() || pod.metadata?.labels?.[LABEL_CONFIG] !== POD_CONFIG || ended(pod));
      if (replace) await this.deletePod(true);
      if (!pod || replace) await this.createPod(aliases);
      try {
        // The first start pulls the image into the cluster.
        if (!(await this.waitRunning(10 * 60_000))) throw new SandboxUnavailableError("The sandbox stopped as soon as it started on Kubernetes.");
        this.agent = await this.connect();
        log.info(`${this.namespace}: sandbox pod up`);
        return;
      } catch (error) {
        const reason = attempt === 1 ? await this.whyEnded(10_000) : null;
        if (!reason) throw error;
        log.warn(`${this.namespace}: the sandbox pod ended (${reason}); starting a new one`);
      }
    }
  }

  /** Attach to the agent on the pod's stdio, and wait until it answers. */
  private async connect(): Promise<AgentChannel> {
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
    return agent;
  }

  async ensureRoom(): Promise<void> {
    await this.prepare();
  }

  /**
   * The room's namespace and what's in it before any pod, made the first time
   * and kept current: its network policy, its Secret (the database password),
   * its two volume claims, and a Service for each database kind and the package
   * proxy. Returns the Services' addresses, for the sandbox's /etc/hosts (it has
   * no DNS server).
   */
  private async prepare(): Promise<k8s.V1HostAlias[]> {
    const { namespace } = this;
    const labels = this.labels("room");
    const ignoreExisting = (error: unknown) => {
      if (!exists(error)) throw error;
    };
    await this.kube.core.createNamespace({ body: { metadata: { name: namespace, labels } } }).catch(ignoreExisting);
    // Before any pod: the room's pods reach each other and nothing else, but its package proxy
    // goes out to the registries (ADR 0007).
    for (const made of [ROOM_POLICY, EGRESS_POLICY]) {
      const policy = { ...made, metadata: { name: made.metadata!.name, labels } };
      await this.kube.net.createNamespacedNetworkPolicy({ namespace, body: policy }).catch((error: unknown) => {
        if (!exists(error)) throw error;
        return this.kube.net.replaceNamespacedNetworkPolicy({ name: policy.metadata.name!, namespace, body: policy });
      });
    }
    // Replaced each time, so a new SERVICE_SECRET reaches pods made after it.
    const secret: k8s.V1Secret = { metadata: { name: ROOM_SECRET, labels }, type: "Opaque", stringData: { password: databasePassword(this.env.SERVICE_SECRET, this.roomId) } };
    await this.kube.core.createNamespacedSecret({ namespace, body: secret }).catch((error: unknown) => {
      if (!exists(error)) throw error;
      return this.kube.core.replaceNamespacedSecret({ name: ROOM_SECRET, namespace, body: secret });
    });
    for (const name of ["workspace", "home"]) {
      await this.kube.core
        .createNamespacedPersistentVolumeClaim({
          namespace,
          body: {
            metadata: { name, labels },
            spec: {
              accessModes: ["ReadWriteOnce"],
              resources: { requests: { storage: `${this.env.SANDBOX_STORAGE_GB}Gi` } },
              ...(this.env.SANDBOX_STORAGE_CLASS && { storageClassName: this.env.SANDBOX_STORAGE_CLASS }),
            },
          },
        })
        .catch(ignoreExisting);
    }
    // The room's services by name, before any of them first starts: each database
    // (kube-databases.ts) and the package proxy (kube-egress.ts). Each takes connections as
    // soon as it's listening: readiness is only how a database's health shows.
    const services = [
      ...DATABASE_KINDS.map((kind) => ({ name: kind, port: DATABASES[kind].port, selector: { [LABEL_KIND]: kind }, labels: { ...this.labels("database"), [LABEL_KIND]: kind } })),
      { name: "egress", port: EGRESS_PORT, selector: { [LABEL_ROLE]: "egress" }, labels: this.labels("egress") },
    ];
    const aliases: k8s.V1HostAlias[] = [];
    for (const { name, port, selector, labels: serviceLabels } of services) {
      const body: k8s.V1Service = { metadata: { name, labels: serviceLabels }, spec: { selector, publishNotReadyAddresses: true, ports: [{ name, port, targetPort: port }] } };
      const service = await this.kube.core.createNamespacedService({ namespace, body }).catch(async (error: unknown) => {
        if (!exists(error)) throw error;
        const made = await this.kube.core.readNamespacedService({ name, namespace });
        if (made.spec?.publishNotReadyAddresses) return made;
        // Made before that setting: given it, keeping its address.
        return this.kube.core.replaceNamespacedService({ name, namespace, body: { ...made, spec: { ...made.spec, publishNotReadyAddresses: true } } });
      });
      if (service.spec?.clusterIP) aliases.push({ ip: service.spec.clusterIP, hostnames: [name] });
    }
    return aliases;
  }

  private async createPod(aliases: k8s.V1HostAlias[]): Promise<void> {
    const memory = `${this.env.SANDBOX_MEMORY_MB}Mi`;
    await this.kube.core.createNamespacedPod({
      namespace: this.namespace,
      body: {
        metadata: { name: POD, labels: { ...this.labels("sandbox"), [LABEL_CONFIG]: POD_CONFIG } },
        spec: {
          restartPolicy: "Never",
          // No DNS server: the network policy lets nothing out anyway, and a lookup fails at
          // once instead of after the resolver's timeouts. Room services get /etc/hosts entries.
          dnsPolicy: "None",
          dnsConfig: { nameservers: ["127.0.0.1"] },
          hostAliases: aliases,
          automountServiceAccountToken: false,
          enableServiceLinks: false,
          shareProcessNamespace: true,
          terminationGracePeriodSeconds: 3,
          securityContext: { runAsUser: roomUid(this.roomId), runAsGroup: GROUP, fsGroup: GROUP, runAsNonRoot: true, seccompProfile: { type: "RuntimeDefault" } },
          containers: [
            {
              name: POD,
              image: this.image(),
              imagePullPolicy: this.env.SANDBOX_IMAGE_PULL,
              stdin: true,
              stdinOnce: false,
              tty: false,
              workingDir: "/workspace",
              env: [{ name: "PATH", value: "/usr/local/bin:/usr/bin:/bin" }, { name: "LANG", value: "C.UTF-8" }, ...POD_ROOM_ENV],
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

  /** Until the pod runs (true) or has ended (false). */
  private async waitRunning(ms: number): Promise<boolean> {
    const until = Date.now() + ms;
    for (;;) {
      const pod = await this.kube.core.readNamespacedPod({ name: POD, namespace: this.namespace });
      const status = pod.status?.containerStatuses?.[0];
      if (ended(pod)) return false;
      if (pod.status?.phase === "Running" && status?.state?.running) return true;
      const waiting = status?.state?.waiting?.reason;
      if (waiting && /ErrImagePull|ImagePullBackOff|InvalidImageName|CrashLoopBackOff|CreateContainerConfigError/.test(waiting)) {
        throw new SandboxUnavailableError(`The sandbox couldn't start on Kubernetes: ${waiting}${status?.state?.waiting?.message ? ` (${status.state.waiting.message})` : ""}.`);
      }
      if (Date.now() > until) throw new SandboxUnavailableError(`The sandbox didn't start on Kubernetes (${pod.status?.phase ?? "no status"}).`);
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

/**
 * A process in one of a room's pods over the Kubernetes exec API, as the same
 * ExecHandle Docker's give (sandbox.ts): as the container's user, with the
 * container's environment. With a TTY, `stream` is the terminal both ways;
 * without one, write input to `stream` and read the output with `demux`.
 */
export async function openExec(
  kube: Kube,
  namespace: string,
  pod: string,
  container: string,
  command: string[],
  options: { tty: boolean; stdin: boolean; cols?: number; rows?: number },
): Promise<ExecHandle> {
  const stdin = options.stdin ? new PassThrough() : null;
  // The client resizes a terminal from its output stream's rows and columns, on "resize".
  const stdout = Object.assign(new PassThrough(), { columns: options.cols ?? 80, rows: options.rows ?? 24 });
  const stderr = new PassThrough();
  let exitCode: number | null = null;
  let ended = false;
  const socket = await kube.exec.exec(namespace, pod, container, command, stdout, options.tty ? null : stderr, stdin, options.tty, (status) => {
    exitCode = exitCodeOf(status);
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
  // Without a TTY the output comes through demux and this stream carries none; flowing,
  // its "end" still comes when the exec ends, as Docker's does for those who wait on it.
  else stream.resume();
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

/**
 * The room's network (ADR 0007, as on Docker): its pods (the sandbox, and its databases and
 * package proxy when they run here) reach each other, and nothing else reaches them or is
 * reached: not another room, the cluster's API or nodes, the host, metadata, or the internet.
 */
const ROOM_POLICY: k8s.V1NetworkPolicy = {
  metadata: { name: "room" },
  spec: {
    podSelector: {},
    policyTypes: ["Ingress", "Egress"],
    ingress: [{ _from: [{ podSelector: {} }] }], // "from" on the wire
    egress: [{ to: [{ podSelector: {} }] }],
  },
};

/**
 * The package proxy (kube-egress.ts), the one pod in a room that may go out: to the cluster's
 * DNS, and to public addresses on HTTPS, the only port the proxy uses. It refuses private
 * addresses itself too (sandbox/agent/src/egress-policy.ts). With the room's policy, the
 * room's pods reach it.
 */
const EGRESS_POLICY: k8s.V1NetworkPolicy = {
  metadata: { name: "egress" },
  spec: {
    podSelector: { matchLabels: { [LABEL_ROLE]: "egress" } },
    policyTypes: ["Egress"],
    egress: [
      {
        to: [{ namespaceSelector: {}, podSelector: { matchLabels: { "k8s-app": "kube-dns" } } }],
        ports: [
          { protocol: "UDP", port: 53 },
          { protocol: "TCP", port: 53 },
        ],
      },
      {
        to: [{ ipBlock: { cidr: "0.0.0.0/0", except: ["0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.168.0.0/16"] } }],
        ports: [{ protocol: "TCP", port: 443 }],
      },
    ],
  },
};

/** A pod that has ended, or is on its way out: its phase, or its container's own state, which changes first. */
function ended(pod: k8s.V1Pod): boolean {
  const phase = pod.status?.phase;
  return phase === "Succeeded" || phase === "Failed" || Boolean(pod.metadata?.deletionTimestamp || pod.status?.containerStatuses?.[0]?.state?.terminated);
}

/** An exec's exit code from the status Kubernetes sends at its end. */
function exitCodeOf(status: k8s.V1Status): number | null {
  if (status.status === "Success") return 0;
  const cause = status.details?.causes?.find((c) => c.reason === "ExitCode");
  return cause?.message !== undefined ? Number(cause.message) : null;
}
