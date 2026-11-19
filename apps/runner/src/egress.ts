import { PACKAGE_REGISTRIES } from "@codechatter/contracts";
import type Docker from "dockerode";

import type { Env } from "./env.js";
import { log } from "./log.js";
import { LABEL_MANAGED, LABEL_NAMESPACE, LABEL_ROLE, LABEL_ROOM, roomNetwork, type RoomSandbox, SandboxUnavailableError } from "./sandbox.js";

/** When the proxy is due to go: the sweep removes it then (the later of installs' end and the automations' hosts'). */
export const LABEL_UNTIL = "codechatter.until";
/** When package installs end (the proxy stops letting registries through then, by itself). */
export const LABEL_INSTALLS = "codechatter.installs-until";
/** The hosts the room's owner turned on for its automations, comma-separated. */
export const LABEL_HOSTS = "codechatter.hosts";
export const LABEL_BY = "codechatter.by";
/** The registries the proxy lets through while installs are allowed (sandbox/agent/src/egress.ts reads them from EGRESS_ALLOW). */
export const EGRESS_HOSTS = PACKAGE_REGISTRIES.flatMap((registry) => registry.hosts).join(",");
/** How long the automations' hosts keep a room's proxy after they were last needed: each run or look renews it, so a room unused for a day has none. */
export const SERVICES_MS = 24 * 60 * 60_000;

export type Installs = { until: string; by: string };
/** What a room's proxy lets through: registries until `installsUntil`, and `hosts` until `servicesUntil`. */
export type ProxyPlan = { installsUntil: number | null; by: string; hosts: string[]; servicesUntil: number | null };

/** What the proxy is started with (sandbox/agent/src/egress.ts), and when it's due to go. */
export function proxyEnv(plan: ProxyPlan): { env: Record<string, string>; until: number } {
  return {
    env: { EGRESS_ALLOW: plan.installsUntil ? EGRESS_HOSTS : "", EGRESS_ALWAYS: plan.hosts.join(","), EGRESS_UNTIL: plan.installsUntil ? String(plan.installsUntil) : "" },
    until: Math.max(plan.installsUntil ?? 0, plan.servicesUntil ?? 0),
  };
}
/** A plan read back from what the proxy was started with: what's over is left out. */
export function planOf(labels: Record<string, string | undefined>, now = Date.now()): ProxyPlan {
  // A proxy from before the automations' hosts has only LABEL_UNTIL, the end of installs.
  const installs = Number(labels[LABEL_INSTALLS] ?? labels[LABEL_UNTIL]);
  const hosts = (labels[LABEL_HOSTS] ?? "").split(",").filter(Boolean);
  const until = Number(labels[LABEL_UNTIL]);
  return { installsUntil: installs > now ? installs : null, by: labels[LABEL_BY] ?? "", hosts: hosts.length && until > now ? hosts : [], servicesUntil: hosts.length && until > now ? until : null };
}

/**
 * A room's package proxy, wherever it runs: a container on Docker (Egress, below), or a pod on Kubernetes (kube-egress.ts). It lets through package
 * registries while the owner allows installs, and the hosts the owner turned on for the room's automations; both go through one proxy.
 */
export interface PackageProxy {
  /** Until when installs are allowed in the room, and by whom; null when they aren't. */
  status(roomId: string): Promise<Installs | null>;
  /** Allow installs for `minutes` from now, replacing any earlier allowance. */
  allow(sandbox: RoomSandbox, minutes: number, by: string): Promise<Installs>;
  /** Stop installs now (the automations' hosts stay). */
  stop(roomId: string): Promise<void>;
  /** The automations' hosts: let through from now, or none (an empty list). Renews them when it's been a while, so a room in use keeps them. */
  services(sandbox: RoomSandbox, hosts: string[]): Promise<void>;
}

/** The decisions both drivers share; each says how to read, start and remove its own proxy. */
export abstract class ProxyBase implements PackageProxy {
  protected abstract current(roomId: string): Promise<ProxyPlan | null>;
  protected abstract start(roomId: string, plan: ProxyPlan, sandbox?: RoomSandbox): Promise<void>;
  protected abstract remove(roomId: string): Promise<void>;

  async status(roomId: string): Promise<Installs | null> {
    const plan = await this.current(roomId);
    return plan?.installsUntil ? { until: new Date(plan.installsUntil).toISOString(), by: plan.by } : null;
  }

  async allow(sandbox: RoomSandbox, minutes: number, by: string): Promise<Installs> {
    const earlier = await this.current(sandbox.roomId);
    const until = Date.now() + minutes * 60_000;
    await this.start(sandbox.roomId, { installsUntil: until, by, hosts: earlier?.hosts ?? [], servicesUntil: earlier?.servicesUntil ?? null }, sandbox);
    log.info(`room ${sandbox.roomId}: package installs allowed until ${new Date(until).toISOString()} by ${by}`);
    return { until: new Date(until).toISOString(), by };
  }

  async stop(roomId: string): Promise<void> {
    const earlier = await this.current(roomId);
    if (earlier?.hosts.length) await this.start(roomId, { ...earlier, installsUntil: null });
    else await this.remove(roomId);
  }

  async services(sandbox: RoomSandbox, hosts: string[]): Promise<void> {
    const wanted = [...new Set(hosts)].sort();
    const earlier = await this.current(sandbox.roomId);
    if (!wanted.length) {
      if (!earlier?.hosts.length) return;
      if (earlier.installsUntil) await this.start(sandbox.roomId, { ...earlier, hosts: [], servicesUntil: null }, sandbox);
      else await this.remove(sandbox.roomId);
      return;
    }
    const same = earlier !== null && earlier.hosts.join(",") === wanted.join(",");
    // The same hosts, with most of their day left: nothing to do, so a run doesn't restart the proxy each time.
    if (same && (earlier.servicesUntil ?? 0) - Date.now() > SERVICES_MS / 2) return;
    await this.start(sandbox.roomId, { installsUntil: earlier?.installsUntil ?? null, by: earlier?.by ?? "", hosts: wanted, servicesUntil: Date.now() + SERVICES_MS }, sandbox);
    log.info(`room ${sandbox.roomId}: the automations may reach ${wanted.length} hosts`);
  }
}

/**
 * Package installs and the automations' hosts (ADR 0007). While a room's owner allows installs, or has turned services on for the room's automations, a
 * proxy runs from the sandbox image (sandbox/agent/src/egress.ts) in a container on two networks: the room's, where the sandbox knows it as "egress", and
 * one way out shared by every room's proxy. It tunnels HTTPS to package registries (until installs end) and those hosts only; the sweep removes it when
 * both are over.
 */
export class Egress extends ProxyBase {
  constructor(
    private readonly docker: Docker,
    private readonly env: Env,
  ) {
    super();
  }

  protected async current(roomId: string): Promise<ProxyPlan | null> {
    const info = await this.docker.getContainer(this.name(roomId)).inspect().catch(() => null);
    if (!info?.State.Running) return null;
    const plan = planOf(info.Config.Labels);
    return plan.installsUntil || plan.hosts.length ? plan : null;
  }

  protected async remove(roomId: string): Promise<void> {
    await this.docker
      .getContainer(this.name(roomId))
      .remove({ force: true })
      .catch(() => {});
  }

  protected async start(roomId: string, plan: ProxyPlan, sandbox?: RoomSandbox): Promise<void> {
    if (sandbox) await sandbox.ensureRoom();
    await this.ensureWayOut();
    await this.remove(roomId);
    const { env, until } = proxyEnv(plan);
    const mb = 128 * 1024 * 1024;
    const container = await this.docker.createContainer({
      name: this.name(roomId),
      Image: this.env.SANDBOX_IMAGE,
      Entrypoint: ["node", "/opt/ccagent/egress.mjs"],
      Cmd: [],
      User: "10002",
      Env: Object.entries(env).map(([name, value]) => `${name}=${value}`),
      WorkingDir: "/",
      Labels: {
        [LABEL_MANAGED]: "1",
        [LABEL_NAMESPACE]: this.env.SANDBOX_NAMESPACE,
        [LABEL_ROOM]: roomId,
        [LABEL_ROLE]: "egress",
        [LABEL_UNTIL]: String(until),
        [LABEL_INSTALLS]: String(plan.installsUntil ?? 0),
        [LABEL_HOSTS]: plan.hosts.join(","),
        [LABEL_BY]: plan.by.slice(0, 100),
      },
      HostConfig: {
        NetworkMode: this.wayOut,
        ReadonlyRootfs: true,
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges"],
        PidsLimit: 64,
        Memory: mb,
        MemorySwap: mb,
        NanoCpus: 0.5e9,
        Init: true,
        LogConfig: { Type: "json-file", Config: { "max-size": "1m", "max-file": "1" } },
      },
      NetworkingConfig: { EndpointsConfig: { [this.wayOut]: {}, [roomNetwork(this.env.SANDBOX_NAMESPACE, roomId)]: { Aliases: ["egress"] } } },
    });
    await container.start();
    // A proxy that can't start (an image from before installs existed) exits at once: say so, not "allowed".
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (!(await container.inspect()).State.Running) {
      await this.remove(roomId);
      throw new SandboxUnavailableError(`The package proxy didn't start. Rebuild the sandbox image (pnpm sandbox:build) and try again.`);
    }
  }

  private name(roomId: string): string {
    return `cc-${this.env.SANDBOX_NAMESPACE}-egress-${roomId.toLowerCase()}`;
  }

  /** The proxies' shared network to the internet. They can't reach each other on it (no inter-container traffic). */
  private get wayOut(): string {
    return `cc-${this.env.SANDBOX_NAMESPACE}-egress`;
  }

  private async ensureWayOut(): Promise<void> {
    if (await this.docker.getNetwork(this.wayOut).inspect().then(() => true, () => false)) return;
    await this.docker
      .createNetwork({
        Name: this.wayOut,
        Driver: "bridge",
        Options: { "com.docker.network.bridge.enable_icc": "false" },
        Labels: { [LABEL_MANAGED]: "1", [LABEL_NAMESPACE]: this.env.SANDBOX_NAMESPACE },
      })
      .catch((error: { statusCode?: number }) => {
        if (error.statusCode !== 409) throw error;
      });
  }
}
