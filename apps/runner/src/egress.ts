import { PACKAGE_REGISTRIES } from "@codechatter/contracts";
import type Docker from "dockerode";

import type { Env } from "./env.js";
import { log } from "./log.js";
import { LABEL_MANAGED, LABEL_NAMESPACE, LABEL_ROLE, LABEL_ROOM, roomNetwork, type RoomSandbox, SandboxUnavailableError } from "./sandbox.js";

export const LABEL_UNTIL = "codechatter.until";
export const LABEL_BY = "codechatter.by";
/** The registries the proxy lets through (sandbox/agent/src/egress.ts reads them from EGRESS_ALLOW). */
export const EGRESS_HOSTS = PACKAGE_REGISTRIES.flatMap((registry) => registry.hosts).join(",");

export type Installs = { until: string; by: string };

/**
 * A room's package proxy, wherever it runs: a container on Docker (Egress,
 * below), or a pod on Kubernetes (kube-egress.ts).
 */
export interface PackageProxy {
  /** Until when installs are allowed in the room, and by whom; null when they aren't. */
  status(roomId: string): Promise<Installs | null>;
  /** Allow installs for `minutes` from now, replacing any earlier allowance. */
  allow(sandbox: RoomSandbox, minutes: number, by: string): Promise<Installs>;
  /** Stop installs now. */
  stop(roomId: string): Promise<void>;
}

/**
 * Package installs (ADR 0007). While a room's owner allows them, a proxy runs
 * from the sandbox image (sandbox/agent/src/egress.ts) in a container on two
 * networks: the room's, where the sandbox knows it as "egress", and one way
 * out shared by every room's proxy. It tunnels HTTPS to package registries
 * only, and exits by itself when the time is up; the sweep then removes it.
 */
export class Egress implements PackageProxy {
  constructor(
    private readonly docker: Docker,
    private readonly env: Env,
  ) {}

  async status(roomId: string): Promise<Installs | null> {
    const info = await this.docker.getContainer(this.name(roomId)).inspect().catch(() => null);
    const until = Number(info?.Config.Labels[LABEL_UNTIL]);
    if (!info?.State.Running || !(until > Date.now())) return null;
    return { until: new Date(until).toISOString(), by: info.Config.Labels[LABEL_BY] ?? "" };
  }

  async allow(sandbox: RoomSandbox, minutes: number, by: string): Promise<Installs> {
    await sandbox.ensureRoom();
    await this.ensureWayOut();
    await this.stop(sandbox.roomId);
    const until = Date.now() + minutes * 60_000;
    const mb = 128 * 1024 * 1024;
    const container = await this.docker.createContainer({
      name: this.name(sandbox.roomId),
      Image: this.env.SANDBOX_IMAGE,
      Entrypoint: ["node", "/opt/ccagent/egress.mjs"],
      Cmd: [],
      User: "10002",
      Env: [`EGRESS_ALLOW=${EGRESS_HOSTS}`, `EGRESS_UNTIL=${until}`],
      WorkingDir: "/",
      Labels: {
        [LABEL_MANAGED]: "1",
        [LABEL_NAMESPACE]: this.env.SANDBOX_NAMESPACE,
        [LABEL_ROOM]: sandbox.roomId,
        [LABEL_ROLE]: "egress",
        [LABEL_UNTIL]: String(until),
        [LABEL_BY]: by.slice(0, 100),
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
      NetworkingConfig: { EndpointsConfig: { [this.wayOut]: {}, [roomNetwork(this.env.SANDBOX_NAMESPACE, sandbox.roomId)]: { Aliases: ["egress"] } } },
    });
    await container.start();
    // A proxy that can't start (an image from before installs existed) exits at once: say so, not "allowed".
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (!(await container.inspect()).State.Running) {
      await this.stop(sandbox.roomId);
      throw new SandboxUnavailableError(`The package proxy didn't start. Rebuild the sandbox image (pnpm sandbox:build) and try again.`);
    }
    log.info(`room ${sandbox.roomId}: package installs allowed until ${new Date(until).toISOString()} by ${by}`);
    return { until: new Date(until).toISOString(), by };
  }

  async stop(roomId: string): Promise<void> {
    await this.docker
      .getContainer(this.name(roomId))
      .remove({ force: true })
      .catch(() => {});
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
