import { DATABASE_KINDS, DATABASES, type DatabaseKind } from "@codechatter/contracts";
import type Docker from "dockerode";
import type { Duplex } from "node:stream";

import { databasePassword, LABEL_KIND, SPECS, type DatabaseDriver, type Observed } from "./databases.js";
import type { Env } from "./env.js";
import { log } from "./log.js";
import { LABEL_MANAGED, LABEL_NAMESPACE, LABEL_ROLE, LABEL_ROOM, roomNetwork, type ExecHandle, type RoomSandbox } from "./sandbox.js";

/**
 * The room's databases on Docker: a container each on the room's network,
 * with the kind as its name there, and a volume each for the data. Stop
 * removes the container and keeps the volume; sleeping with the sandbox stops
 * it, and waking starts the containers that slept.
 */
export class DockerDatabases implements DatabaseDriver {
  constructor(
    private readonly docker: Docker,
    private readonly env: Env,
  ) {}

  async observe(roomId: string): Promise<Map<DatabaseKind, { now: Observed; data: boolean }>> {
    const filters = { label: [`${LABEL_ROOM}=${roomId}`, `${LABEL_ROLE}=database`, `${LABEL_NAMESPACE}=${this.env.SANDBOX_NAMESPACE}`] };
    const [containers, volumes] = await Promise.all([
      this.docker.listContainers({ all: true, filters }),
      this.docker.listVolumes({ filters }).then((r) => r.Volumes ?? []),
    ]);
    return new Map(
      DATABASE_KINDS.map((kind) => {
        const container = containers.find((c) => c.Labels[LABEL_KIND] === kind);
        const now = ((): Observed => {
          if (!container) return { state: "none" };
          if (container.State === "running") {
            return { state: "running", health: container.Status.includes("(healthy)") ? "healthy" : container.Status.includes("(unhealthy)") ? "unhealthy" : "starting" };
          }
          const exit = /^Exited \((\d+)\)/.exec(container.Status)?.[1];
          return { state: "exited", exitCode: exit === undefined ? null : Number(exit) };
        })();
        return [kind, { now, data: volumes.some((v) => v.Labels?.[LABEL_KIND] === kind) }];
      }),
    );
  }

  async bringUp(sandbox: RoomSandbox, kind: DatabaseKind, job: { detail: string }): Promise<void> {
    const spec = SPECS[kind];
    await sandbox.ensureRoom();
    const present = await this.docker.getImage(spec.image).inspect().then(() => true, () => false);
    if (!present) {
      job.detail = `Downloading ${DATABASES[kind].name} (the first time only)`;
      const stream = (await this.docker.pull(spec.image)) as NodeJS.ReadableStream;
      await new Promise<void>((resolve, reject) => this.docker.modem.followProgress(stream, (error: Error | null) => (error ? reject(error) : resolve())));
    }
    job.detail = "Starting";
    const container = this.docker.getContainer(this.name(sandbox.roomId, kind));
    const info = await container.inspect().catch(() => null);
    if (info?.State.Running) return;
    if (!info) await this.create(sandbox.roomId, kind);
    await container.start();
  }

  async stop(roomId: string, kind: DatabaseKind): Promise<void> {
    const container = this.docker.getContainer(this.name(roomId, kind));
    await container.stop({ t: 15 }).catch(() => {});
    await container.remove({ force: true }).catch(() => {});
  }

  async remove(roomId: string, kind: DatabaseKind): Promise<void> {
    await this.stop(roomId, kind);
    await this.docker
      .getVolume(this.volume(roomId, kind))
      .remove()
      .catch((error: { statusCode?: number }) => {
        if (error.statusCode !== 404) throw error;
      });
  }

  async pause(roomId: string): Promise<void> {
    for (const info of await this.containers(roomId, "running")) {
      await this.docker.getContainer(info.Id).stop({ t: 15 }).catch(() => {});
    }
  }

  async resume(roomId: string): Promise<void> {
    for (const info of await this.containers(roomId, "exited")) {
      await this.docker.getContainer(info.Id).start().catch((error: Error) => log.warn(`room ${roomId}: couldn't wake ${info.Labels[LABEL_KIND]}: ${error.message}`));
    }
  }

  async exec(roomId: string, kind: DatabaseKind, cmd: string[], env: string[], stdin: boolean): Promise<ExecHandle | null> {
    const container = this.docker.getContainer(this.name(roomId, kind));
    let exec: Docker.Exec;
    try {
      exec = await container.exec({ Cmd: cmd, Env: env, AttachStdin: stdin, AttachStdout: true, AttachStderr: true });
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 409) return null;
      throw error;
    }
    const stream = (await exec.start({ hijack: true, stdin })) as Duplex;
    return {
      stream,
      demux: (stdout, stderr) => this.docker.modem.demuxStream(stream, stdout, stderr),
      resize: async () => {},
      exitCode: async () => {
        const info = await exec.inspect();
        return info.Running ? null : (info.ExitCode ?? null);
      },
    };
  }

  private async create(roomId: string, kind: DatabaseKind): Promise<void> {
    const spec = SPECS[kind];
    const password = databasePassword(this.env.SERVICE_SECRET, roomId);
    const network = roomNetwork(this.env.SANDBOX_NAMESPACE, roomId);
    const labels = { [LABEL_MANAGED]: "1", [LABEL_NAMESPACE]: this.env.SANDBOX_NAMESPACE, [LABEL_ROOM]: roomId, [LABEL_ROLE]: "database", [LABEL_KIND]: kind };
    const mb = spec.memoryMb * 1024 * 1024;
    // A new volume starts as the image's data folder, owned by its database user.
    await this.docker.createVolume({ Name: this.volume(roomId, kind), Labels: labels });
    await this.docker.createContainer({
      name: this.name(roomId, kind),
      Image: spec.image,
      User: spec.user,
      Env: spec.env(password),
      ...(spec.cmd && { Cmd: spec.cmd(password) }),
      Labels: labels,
      // Quick checks while it starts, then a slow one.
      Healthcheck: { Test: ["CMD-SHELL", spec.health], StartPeriod: 180e9, StartInterval: 2e9, Interval: 30e9, Timeout: 10e9, Retries: 3 } as Docker.HealthConfig,
      HostConfig: {
        NetworkMode: network,
        ReadonlyRootfs: true,
        Tmpfs: Object.fromEntries(spec.tmpfs.map((path) => [path, "rw,nosuid,nodev,mode=1777,size=64m"])),
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges"],
        PidsLimit: 256,
        Memory: mb,
        MemorySwap: mb,
        NanoCpus: 1e9,
        Mounts: [{ Type: "volume", Source: this.volume(roomId, kind), Target: spec.data }],
        LogConfig: { Type: "json-file", Config: { "max-size": "2m", "max-file": "1" } },
      },
      NetworkingConfig: { EndpointsConfig: { [network]: { Aliases: [kind] } } },
    });
  }

  private containers(roomId: string, state: "running" | "exited"): Promise<Docker.ContainerInfo[]> {
    const label = [`${LABEL_ROOM}=${roomId}`, `${LABEL_ROLE}=database`, `${LABEL_NAMESPACE}=${this.env.SANDBOX_NAMESPACE}`];
    return this.docker.listContainers({ all: true, filters: { label, status: [state] } }).catch(() => []);
  }

  private name(roomId: string, kind: DatabaseKind): string {
    return `cc-${this.env.SANDBOX_NAMESPACE}-${kind}-${roomId.toLowerCase()}`;
  }

  private volume(roomId: string, kind: DatabaseKind): string {
    return `cc-${this.env.SANDBOX_NAMESPACE}-db-${kind}-${roomId.toLowerCase()}`;
  }
}
