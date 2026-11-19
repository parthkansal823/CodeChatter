import type * as k8s from "@kubernetes/client-node";

import { LABEL_BY, LABEL_HOSTS, LABEL_INSTALLS, LABEL_UNTIL, planOf, ProxyBase, proxyEnv, type ProxyPlan } from "./egress.js";
import type { Env } from "./env.js";
import { EGRESS_PORT, roomNamespace, type Kube } from "./kube-sandbox.js";
import { LABEL_MANAGED, LABEL_NAMESPACE, LABEL_ROLE, LABEL_ROOM, SandboxUnavailableError, type RoomSandbox } from "./sandbox.js";

const POD = "egress";
const missing = (error: unknown) => (error as { code?: number }).code === 404;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Package installs and the automations' hosts on Kubernetes (roadmap K4, ADR 0007). While a room's owner allows installs, or has turned services on for
 * its automations, the proxy from the sandbox image runs as a pod named "egress" in the room's namespace: the sandbox reaches it through the Service of
 * that name (in its /etc/hosts), and the "egress" network policy lets this pod alone out, to the cluster's DNS and to public addresses on HTTPS
 * (kube-sandbox.ts). It tunnels to package registries (until installs end, by itself) and those hosts only, with a deadline on the pod behind that.
 */
export class KubeEgress extends ProxyBase {
  constructor(
    private readonly kube: Kube,
    private readonly env: Env,
  ) {
    super();
  }

  protected async current(roomId: string): Promise<ProxyPlan | null> {
    const pod = await this.read(roomId);
    if (pod?.status?.phase !== "Running" || pod.metadata?.deletionTimestamp) return null;
    const plan = planOf(pod.metadata?.annotations ?? {});
    return plan.installsUntil || plan.hosts.length ? plan : null;
  }

  protected async start(roomId: string, plan: ProxyPlan, sandbox?: RoomSandbox): Promise<void> {
    if (sandbox) await sandbox.ensureRoom(); // its namespace, the "egress" Service, and the policies
    await this.remove(roomId);
    const namespace = this.namespace(roomId);
    await this.kube.core.createNamespacedPod({ namespace, body: this.pod(roomId, plan) });
    // Running, and still running a moment later: a proxy that can't start (an image from
    // before installs existed) exits at once, and says so rather than "allowed".
    for (let i = 0; i < 120; i++) {
      const pod = await this.read(roomId);
      const phase = pod?.status?.phase;
      const waiting = pod?.status?.containerStatuses?.[0]?.state?.waiting?.reason;
      if (phase === "Running") {
        await sleep(500);
        if ((await this.read(roomId))?.status?.phase === "Running") return;
        break;
      }
      if (phase === "Failed" || phase === "Succeeded" || (waiting && /ErrImagePull|ImagePullBackOff|InvalidImageName/.test(waiting))) break;
      await sleep(500);
    }
    await this.remove(roomId);
    throw new SandboxUnavailableError("The package proxy didn't start. Rebuild the sandbox image (pnpm sandbox:build) and try again.");
  }

  protected async remove(roomId: string): Promise<void> {
    const namespace = this.namespace(roomId);
    await this.kube.core.deleteNamespacedPod({ name: POD, namespace, gracePeriodSeconds: 0 }).catch(() => {});
    // Gone before a new one takes its name.
    for (let i = 0; i < 60; i++) {
      if (!(await this.read(roomId))) return;
      await sleep(500);
    }
  }

  private pod(roomId: string, plan: ProxyPlan): k8s.V1Pod {
    const { env, until } = proxyEnv(plan);
    return {
      metadata: {
        name: POD,
        labels: { [LABEL_MANAGED]: "1", [LABEL_NAMESPACE]: this.env.SANDBOX_NAMESPACE, [LABEL_ROOM]: roomId, [LABEL_ROLE]: "egress" },
        // Annotations, not labels: a person's name and a list of hosts aren't valid label values.
        annotations: { [LABEL_UNTIL]: String(until), [LABEL_INSTALLS]: String(plan.installsUntil ?? 0), [LABEL_HOSTS]: plan.hosts.join(","), [LABEL_BY]: plan.by.slice(0, 100) },
      },
      spec: {
        restartPolicy: "Never",
        // Installs end by the proxy itself; the cluster ends the pod a minute after it's due to go, if it hasn't.
        activeDeadlineSeconds: Math.max(60, Math.ceil((until - Date.now()) / 1000) + 60),
        automountServiceAccountToken: false,
        enableServiceLinks: false,
        terminationGracePeriodSeconds: 1,
        // The agent's user in the image: not the room's, so it shares nothing with the room's code.
        securityContext: { runAsUser: 10002, runAsGroup: 10002, runAsNonRoot: true, seccompProfile: { type: "RuntimeDefault" } },
        containers: [
          {
            name: POD,
            image: this.env.SANDBOX_IMAGE,
            imagePullPolicy: this.env.SANDBOX_IMAGE_PULL,
            command: ["node", "/opt/ccagent/egress.mjs"],
            workingDir: "/",
            env: Object.entries(env).map(([name, value]) => ({ name, value })),
            ports: [{ name: POD, containerPort: EGRESS_PORT }],
            securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ["ALL"] } },
            resources: { limits: { memory: "128Mi", cpu: "500m" }, requests: { memory: "32Mi", cpu: "10m" } },
          },
        ],
      },
    };
  }

  private read(roomId: string): Promise<k8s.V1Pod | null> {
    return this.kube.core.readNamespacedPod({ name: POD, namespace: this.namespace(roomId) }).catch((error: unknown) => {
      if (missing(error)) return null;
      throw error;
    });
  }

  private namespace(roomId: string): string {
    return roomNamespace(this.env.SANDBOX_NAMESPACE, roomId);
  }
}
