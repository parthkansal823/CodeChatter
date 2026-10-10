import { DATABASE_KINDS, DATABASES, type DatabaseKind } from "@codechatter/contracts";
import type * as k8s from "@kubernetes/client-node";

import { databasePassword, LABEL_KIND, SPECS, type DatabaseDriver, type Observed } from "./databases.js";
import type { Env } from "./env.js";
import { openExec, ROOM_SECRET, roomNamespace, type Kube } from "./kube-sandbox.js";
import { LABEL_CONFIG, LABEL_MANAGED, LABEL_NAMESPACE, LABEL_ROLE, LABEL_ROOM, type ExecHandle, type RoomSandbox } from "./sandbox.js";

/** Bumped when a database's StatefulSet changes, so those made before are made again (their data stays) on their next start. */
const DATABASE_CONFIG = "2";
/** Where a database's settings say "the password": the pod expands it from the room's Secret. */
const PASSWORD = "$(CC_PASSWORD)";

const missing = (error: unknown) => (error as { code?: number }).code === 404;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The room's databases on Kubernetes (roadmap K3): a StatefulSet each in the
 * room's namespace, named after its kind, with its data on a volume claim
 * ("data-<kind>-0") and the Service of the same name in front of it
 * (kube-sandbox.ts makes those, so the sandbox's /etc/hosts has them from the
 * start). Hardened as on Docker: the image's database user, a read-only root
 * with memory-backed scratch folders, no capabilities, seccomp, no
 * Kubernetes token, and the room's network policy around it.
 *
 * Sleeping with the sandbox scales a StatefulSet to 0, and waking scales it
 * back; stop deletes it and keeps the claim; delete deletes both. The password
 * comes from the room's Secret, so it's in neither the pod's spec nor any exec.
 */
export class KubeDatabases implements DatabaseDriver {
  constructor(
    private readonly kube: Kube,
    private readonly env: Env,
  ) {}

  async observe(roomId: string): Promise<Map<DatabaseKind, { now: Observed; data: boolean }>> {
    const namespace = this.namespace(roomId);
    const labelSelector = `${LABEL_ROLE}=database`;
    const nothing = { items: [] };
    const [sets, pods, claims] = await Promise.all([
      this.kube.apps.listNamespacedStatefulSet({ namespace, labelSelector }).catch(() => nothing),
      this.kube.core.listNamespacedPod({ namespace, labelSelector }).catch(() => nothing),
      this.kube.core.listNamespacedPersistentVolumeClaim({ namespace, labelSelector }).catch(() => nothing),
    ]);
    const of = <T extends { metadata?: k8s.V1ObjectMeta }>(items: T[], kind: DatabaseKind) => items.find((item) => item.metadata?.labels?.[LABEL_KIND] === kind);
    return new Map(
      DATABASE_KINDS.map((kind) => {
        const set = of(sets.items, kind);
        const pod = of(pods.items, kind);
        const now = ((): Observed => {
          if (!set) return { state: "none" };
          if (!set.spec?.replicas) return { state: "exited", exitCode: null }; // asleep with the sandbox
          if (!pod || pod.metadata?.deletionTimestamp) return { state: "pending", detail: "Starting" };
          const status = pod.status?.containerStatuses?.[0];
          const waiting = status?.state?.waiting?.reason;
          if (waiting && /ErrImagePull|ImagePullBackOff|InvalidImageName/.test(waiting)) {
            return { state: "failed", detail: `Its image couldn't be downloaded (${waiting}). Check the cluster can reach Docker Hub, then start it again.` };
          }
          if (waiting === "CrashLoopBackOff" || status?.state?.terminated) {
            return { state: "exited", exitCode: status?.state?.terminated?.exitCode ?? status?.lastState?.terminated?.exitCode ?? null };
          }
          // As Docker's health check: quick checks while it starts (the startup probe), then slow ones
          // (the readiness probe). Started but not ready is either before the first slow check, or
          // after they failed: the pod's Ready condition turned false since the container started.
          if (status?.state?.running) {
            if (status.ready || !status.started) return { state: "running", health: status.ready ? "healthy" : "starting" };
            const ready = pod.status?.conditions?.find((c) => c.type === "Ready");
            const turned = ready?.lastTransitionTime ? new Date(ready.lastTransitionTime).getTime() : 0;
            const startedAt = status.state.running.startedAt ? new Date(status.state.running.startedAt).getTime() : 0;
            return { state: "running", health: turned > startedAt ? "unhealthy" : "healthy" };
          }
          const unscheduled = pod.status?.conditions?.some((c) => c.type === "PodScheduled" && c.status === "False");
          return { state: "pending", detail: unscheduled ? "Waiting for space on the cluster" : "Starting" };
        })();
        return [kind, { now, data: Boolean(of(claims.items, kind)) }];
      }),
    );
  }

  async bringUp(sandbox: RoomSandbox, kind: DatabaseKind, job: { detail: string }): Promise<void> {
    await sandbox.ensureRoom(); // its namespace, Secret and Service
    const namespace = this.namespace(sandbox.roomId);
    let set = await this.kube.apps.readNamespacedStatefulSet({ name: kind, namespace }).catch((error: unknown) => {
      if (missing(error)) return null;
      throw error;
    });
    if (set && set.metadata?.labels?.[LABEL_CONFIG] !== DATABASE_CONFIG) {
      job.detail = "Updating it";
      await this.deleteSet(namespace, kind);
      set = null;
    }
    if (!set) {
      await this.kube.apps.createNamespacedStatefulSet({ namespace, body: this.statefulSet(sandbox.roomId, kind) });
      return;
    }
    if (!set.spec?.replicas) await this.scale(namespace, kind, 1);
  }

  async stop(roomId: string, kind: DatabaseKind): Promise<void> {
    await this.deleteSet(this.namespace(roomId), kind);
  }

  async remove(roomId: string, kind: DatabaseKind): Promise<void> {
    const namespace = this.namespace(roomId);
    await this.deleteSet(namespace, kind);
    const claim = `data-${kind}-0`;
    await this.kube.core.deleteNamespacedPersistentVolumeClaim({ name: claim, namespace }).catch((error: unknown) => {
      if (!missing(error)) throw error;
    });
    // Gone before it's started again: a new pod would otherwise find the old claim on its way out.
    for (let i = 0; i < 120; i++) {
      if (await this.kube.core.readNamespacedPersistentVolumeClaim({ name: claim, namespace }).then(() => false, missing)) return;
      await sleep(500);
    }
  }

  async pause(roomId: string): Promise<void> {
    const namespace = this.namespace(roomId);
    for (const set of await this.sets(namespace)) if (set.spec?.replicas) await this.scale(namespace, set.metadata!.name!, 0).catch(() => {});
  }

  async resume(roomId: string): Promise<void> {
    const namespace = this.namespace(roomId);
    for (const set of await this.sets(namespace)) if (!set.spec?.replicas) await this.scale(namespace, set.metadata!.name!, 1).catch(() => {});
  }

  async exec(roomId: string, kind: DatabaseKind, cmd: string[], env: string[], stdin: boolean): Promise<ExecHandle | null> {
    const namespace = this.namespace(roomId);
    const name = `${kind}-0`;
    const pod = await this.kube.core.readNamespacedPod({ name, namespace }).catch(() => null);
    if (!pod?.status?.containerStatuses?.[0]?.state?.running || pod.metadata?.deletionTimestamp) return null;
    // The client's settings that carry the password are made inside the pod, from the
    // password in its environment (the room's Secret), so it's never in the exec request.
    // Those settings are the client's own, never the user's (database-queries.ts).
    const password = databasePassword(this.env.SERVICE_SECRET, roomId);
    const secret = env.filter((entry) => entry.includes(password)).map((entry) => {
      const [name, value] = [entry.slice(0, entry.indexOf("=")), entry.slice(entry.indexOf("=") + 1)];
      return `${name}="${value.replaceAll(password, "$CC_PASSWORD")}"`;
    });
    const plain = env.filter((entry) => !entry.includes(password));
    return openExec(this.kube, namespace, name, kind, ["sh", "-c", `exec env ${secret.join(" ")} "$@"`, "sh", ...plain, ...cmd], { tty: false, stdin });
  }

  private statefulSet(roomId: string, kind: DatabaseKind): k8s.V1StatefulSet {
    const spec = SPECS[kind];
    const [uid, gid] = spec.user.split(":").map(Number);
    const labels = {
      [LABEL_MANAGED]: "1",
      [LABEL_NAMESPACE]: this.env.SANDBOX_NAMESPACE,
      [LABEL_ROOM]: roomId,
      [LABEL_ROLE]: "database",
      [LABEL_KIND]: kind,
    };
    const probe = (periodSeconds: number, failureThreshold: number): k8s.V1Probe => ({
      exec: { command: ["sh", "-c", spec.health] },
      periodSeconds,
      timeoutSeconds: 10,
      failureThreshold,
    });
    return {
      metadata: { name: kind, labels: { ...labels, [LABEL_CONFIG]: DATABASE_CONFIG } },
      spec: {
        serviceName: kind,
        replicas: 1,
        selector: { matchLabels: { [LABEL_KIND]: kind } },
        persistentVolumeClaimRetentionPolicy: { whenDeleted: "Retain", whenScaled: "Retain" },
        template: {
          metadata: { labels },
          spec: {
            automountServiceAccountToken: false,
            enableServiceLinks: false,
            terminationGracePeriodSeconds: 15,
            securityContext: { runAsUser: uid, runAsGroup: gid, fsGroup: gid, runAsNonRoot: true, seccompProfile: { type: "RuntimeDefault" } },
            containers: [
              {
                name: kind,
                image: spec.image,
                imagePullPolicy: "IfNotPresent",
                ...(spec.cmd && { args: spec.cmd(PASSWORD) }),
                // Only the image's own settings: its start-up script reads the environment too.
                env: [
                  { name: "CC_PASSWORD", valueFrom: { secretKeyRef: { name: ROOM_SECRET, key: "password" } } },
                  ...spec.env(PASSWORD).map((entry) => ({ name: entry.slice(0, entry.indexOf("=")), value: entry.slice(entry.indexOf("=") + 1) })),
                ],
                ports: [{ name: kind, containerPort: DATABASES[kind].port }],
                securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ["ALL"] } },
                resources: { limits: { memory: `${spec.memoryMb}Mi`, cpu: "1" }, requests: { memory: "64Mi", cpu: "50m" } },
                // Quick checks while it starts (up to 3 minutes), then a slow one: Docker's health check.
                startupProbe: probe(2, 90),
                readinessProbe: probe(30, 3),
                volumeMounts: [{ name: "data", mountPath: spec.data }, ...spec.tmpfs.map((path, i) => ({ name: `scratch-${i}`, mountPath: path }))],
              },
            ],
            volumes: spec.tmpfs.map((_, i) => ({ name: `scratch-${i}`, emptyDir: { medium: "Memory", sizeLimit: "64Mi" } })),
          },
        },
        volumeClaimTemplates: [
          {
            metadata: { name: "data", labels },
            spec: {
              accessModes: ["ReadWriteOnce"],
              resources: { requests: { storage: `${this.env.DATABASE_STORAGE_GB}Gi` } },
              ...(this.env.SANDBOX_STORAGE_CLASS && { storageClassName: this.env.SANDBOX_STORAGE_CLASS }),
            },
          },
        ],
      },
    };
  }

  /** Delete a database's StatefulSet, and wait for its pod to go (its claim stays). */
  private async deleteSet(namespace: string, kind: DatabaseKind): Promise<void> {
    await this.kube.apps.deleteNamespacedStatefulSet({ name: kind, namespace, propagationPolicy: "Foreground" }).catch((error: unknown) => {
      if (!missing(error)) throw error;
    });
    for (let i = 0; i < 90; i++) {
      if (await this.kube.core.readNamespacedPod({ name: `${kind}-0`, namespace }).then(() => false, missing)) return;
      await sleep(500);
    }
  }

  private async scale(namespace: string, name: string, replicas: number): Promise<void> {
    await this.kube.apps.replaceNamespacedStatefulSetScale({ name, namespace, body: { metadata: { name, namespace }, spec: { replicas } } });
  }

  private async sets(namespace: string): Promise<k8s.V1StatefulSet[]> {
    return (await this.kube.apps.listNamespacedStatefulSet({ namespace, labelSelector: `${LABEL_ROLE}=database` }).catch(() => ({ items: [] }))).items;
  }

  private namespace(roomId: string): string {
    return roomNamespace(this.env.SANDBOX_NAMESPACE, roomId);
  }
}
