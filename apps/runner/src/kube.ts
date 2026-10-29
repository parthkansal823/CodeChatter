import { KUBE_KINDS, type KubeCheck, type KubeEvent, type KubeItem, type KubeKind, type KubeRef, type KubeResources, type KubeStatus } from "@codechatter/contracts";

import { Collector, ended } from "./databases.js";
import { JAIL } from "./plans.js";
import { exitCodeOnceEnded, type RoomSandbox } from "./sandbox.js";

/** What kubectl may print for a whole cluster; the playground's are small. */
const MAX_OUTPUT = 8 * 1024 * 1024;
const MAX_EVENTS = 200;

/** The room's Kubernetes playground couldn't do it; the message is for people. */
export class KubeError extends Error {}

type Output = { code: number; stdout: string; stderr: string };

/**
 * A command in the room's sandbox, inside the jail like a Run (so kubectl finds the
 * playground's kubeconfig in the jail's home): `input`, when given, is its stdin.
 */
async function run(sandbox: RoomSandbox, args: string[], options: { timeout?: number; input?: string } = {}): Promise<Output> {
  const input = options.input === undefined ? null : Buffer.from(options.input, "utf8");
  const script = `n=$1; t=$2; shift 2; command -v "$1" >/dev/null || { echo "cc-kube: missing" >&2; exit 127; }; if [ "$n" -ge 0 ]; then head -c "$n" | timeout "$t" "$@"; else timeout "$t" "$@" </dev/null; fi`;
  const handle = await sandbox.exec([JAIL, "sh", "-c", script, "cc-kube", String(input ? input.length : -1), String(options.timeout ?? 20), ...args], { tty: false, stdin: Boolean(input) });
  const stdout = new Collector(MAX_OUTPUT);
  const stderr = new Collector(64 * 1024);
  handle.demux(stdout, stderr);
  const finished = ended(handle.stream);
  if (input) handle.stream.write(input);
  await finished;
  const code = await exitCodeOnceEnded(handle);
  handle.stream.destroy();
  if (code === 127 && stderr.text().includes("cc-kube: missing")) {
    throw new KubeError("The Kubernetes playground isn't in this room's sandbox: it comes with the full image.");
  }
  if (code === 124) throw new KubeError("kubectl took too long and was stopped. Is the playground up? (k8s up)");
  return { code: code ?? -1, stdout: stdout.text(), stderr: stderr.text() };
}

const said = (output: Output, fallback: string) =>
  output.stderr
    .split("\n")
    .filter((line) => line.trim())
    .slice(0, 6)
    .join("\n") || fallback;

export async function kubeStatus(sandbox: RoomSandbox): Promise<KubeStatus> {
  try {
    const ready = await run(sandbox, ["kubectl", "--request-timeout=3s", "get", "--raw", "/readyz"], { timeout: 8 });
    return { available: true, running: ready.code === 0 };
  } catch (error) {
    if (error instanceof KubeError && error.message.includes("full image")) return { available: false, running: false };
    throw error;
  }
}

/** `k8s up` (about 5 seconds) or `k8s down`, with what it said. */
export async function kubePower(sandbox: RoomSandbox, up: boolean): Promise<string> {
  const output = await run(sandbox, ["k8s", up ? "up" : "down"], { timeout: up ? 150 : 40 });
  if (output.code !== 0) throw new KubeError(said(output, up ? "The playground didn't start." : "The playground didn't stop."));
  return output.stdout.trim();
}

/** Every listed object, summed up, and the latest events. */
export async function kubeResources(sandbox: RoomSandbox): Promise<KubeResources> {
  const [objects, events] = await Promise.all([
    run(sandbox, ["kubectl", "--request-timeout=10s", "get", KUBE_KINDS.join(","), "--all-namespaces", "-o", "json"]),
    run(sandbox, ["kubectl", "--request-timeout=10s", "get", "events", "--all-namespaces", "-o", "json"]),
  ]);
  if (objects.code !== 0) throw new KubeError(said(objects, "kubectl couldn't list the cluster. Is the playground up? (k8s up)"));
  const items = (JSON.parse(objects.stdout) as { items: K8sObject[] }).items.map(summarize).filter((item): item is KubeItem => item !== null);
  const eventList = events.code === 0 ? (JSON.parse(events.stdout) as { items: K8sEvent[] }).items.map(summarizeEvent) : [];
  eventList.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  return { items, events: eventList.slice(0, MAX_EVENTS) };
}

const where = (ref: KubeRef) => (ref.namespace ? ["-n", ref.namespace] : []);

/** An object as YAML, or as `kubectl describe` tells it. */
export async function kubeObject(sandbox: RoomSandbox, ref: KubeRef, view: "yaml" | "describe"): Promise<string> {
  const args = view === "yaml" ? ["kubectl", "get", ref.kind, ref.name, ...where(ref), "-o", "yaml"] : ["kubectl", "describe", ref.kind, ref.name, ...where(ref)];
  const output = await run(sandbox, args);
  if (output.code !== 0) throw new KubeError(said(output, `kubectl couldn't find ${ref.kind} ${ref.name}.`));
  return output.stdout;
}

/** A manifest (the open file, as it is in the editor) applied with `kubectl apply -f -`. */
export async function kubeApply(sandbox: RoomSandbox, text: string): Promise<string> {
  const output = await run(sandbox, ["kubectl", "apply", "-f", "-"], { input: text, timeout: 30 });
  if (output.code !== 0) throw new KubeError(said(output, "kubectl couldn't apply the file."));
  return output.stdout.trim();
}

/** Where kubeconform finds the schemas made with the image (sandbox/image/k8s-schemas.py). */
const SCHEMAS = "/usr/local/share/kubernetes-schemas/{{ .ResourceKind }}{{ .KindSuffix }}.json";

type Verdict = { kind?: string; name?: string; status?: string; msg?: string; validationErrors?: Array<{ path?: string; msg?: string }> };

/**
 * Each mistake and where it is. With several, kubeconform's list has only the top of the
 * tree ("validation failed"), but its message has every one, as "at '/spec': what".
 */
export function errorsOf(verdict: Verdict): Array<{ path: string; message: string }> {
  const listed = (verdict.validationErrors ?? []).filter((error) => error.msg && error.msg !== "validation failed");
  if (listed.length) return listed.map((error) => ({ path: error.path || "/", message: error.msg! }));
  return [...(verdict.msg ?? "").matchAll(/at '([^']*)': (.*?)(?=\s+- at '|$)/g)]
    .map((match) => ({ path: match[1] || "/", message: match[2]!.trim() }))
    .filter((error) => error.message !== "validation failed");
}

/**
 * A manifest checked against the schemas of the playground's Kubernetes version, offline
 * and without the playground running: strict, so a misspelt field is an error; a kind with
 * no schema (a custom resource) is skipped.
 */
export async function kubeCheck(sandbox: RoomSandbox, text: string): Promise<KubeCheck> {
  const output = await run(sandbox, ["kubeconform", "-strict", "-verbose", "-output", "json", "-ignore-missing-schemas", "-schema-location", SCHEMAS, "-"], { input: text, timeout: 30 });
  let verdicts: Verdict[];
  try {
    verdicts = (JSON.parse(output.stdout) as { resources?: Verdict[] }).resources ?? [];
  } catch {
    throw new KubeError(said(output, "kubeconform couldn't check the file."));
  }
  const statuses: Record<string, KubeCheck["objects"][number]["status"]> = { statusValid: "valid", statusInvalid: "invalid", statusError: "error", statusSkipped: "skipped" };
  return {
    objects: verdicts.map((verdict) => {
      const errors = errorsOf(verdict);
      return {
        kind: verdict.kind ?? "",
        name: verdict.name ?? "",
        status: statuses[verdict.status ?? ""] ?? "error",
        // The errors say it better than the summary that lists them.
        message: errors.length ? null : verdict.msg || null,
        errors,
      };
    }),
  };
}

export async function kubeDelete(sandbox: RoomSandbox, ref: KubeRef): Promise<string> {
  const output = await run(sandbox, ["kubectl", "delete", ref.kind, ref.name, ...where(ref), "--wait=false"]);
  if (output.code !== 0) throw new KubeError(said(output, `kubectl couldn't delete ${ref.kind} ${ref.name}.`));
  return output.stdout.trim();
}

/** The parts of a Kubernetes object the summaries read. */
export type K8sObject = {
  kind: string;
  metadata: { name: string; namespace?: string; creationTimestamp?: string };
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
  data?: Record<string, unknown>;
};
type K8sEvent = {
  metadata: { namespace?: string; creationTimestamp?: string };
  type?: string;
  reason?: string;
  message?: string;
  count?: number;
  lastTimestamp?: string | null;
  eventTime?: string | null;
  involvedObject?: { kind?: string; name?: string };
};

const num = (value: unknown) => (typeof value === "number" ? value : 0);
const containers = (spec: Record<string, unknown> | undefined) =>
  (((spec?.template as { spec?: { containers?: Array<{ image?: string }> } } | undefined)?.spec?.containers ?? []).map((c) => c.image).filter(Boolean) as string[]).join(", ");

/** One object in words for the panel's tables; null for a kind it doesn't list. */
export function summarize(object: K8sObject): KubeItem | null {
  const kind = object.kind.toLowerCase() as KubeKind;
  if (!(KUBE_KINDS as readonly string[]).includes(kind)) return null;
  const spec = object.spec ?? {};
  const status = object.status ?? {};
  const base = { kind, namespace: object.metadata.namespace ?? null, name: object.metadata.name, createdAt: object.metadata.creationTimestamp ?? "" };
  switch (kind) {
    case "namespace": {
      const phase = String(status.phase ?? "Active");
      return { ...base, status: phase, healthy: phase === "Active", detail: "" };
    }
    case "node": {
      const ready = ((status.conditions as Array<{ type: string; status: string }> | undefined) ?? []).find((c) => c.type === "Ready")?.status === "True";
      const version = (status.nodeInfo as { kubeletVersion?: string } | undefined)?.kubeletVersion ?? "";
      return { ...base, status: ready ? "Ready" : "Not ready", healthy: ready, detail: version };
    }
    case "deployment":
    case "statefulset": {
      const want = typeof spec.replicas === "number" ? spec.replicas : 1;
      const ready = num(status.readyReplicas);
      return { ...base, status: `${ready}/${want} ready`, healthy: ready >= want, detail: containers(spec) };
    }
    case "daemonset": {
      const want = num(status.desiredNumberScheduled);
      const ready = num(status.numberReady);
      return { ...base, status: `${ready}/${want} ready`, healthy: ready >= want, detail: containers(spec) };
    }
    case "job": {
      const want = typeof spec.completions === "number" ? spec.completions : 1;
      const done = num(status.succeeded);
      const failed = num(status.failed);
      const words = done >= want ? "Complete" : failed ? `Failed (${failed})` : "Running";
      return { ...base, status: words, healthy: done >= want ? true : failed ? false : null, detail: `${done}/${want} done` };
    }
    case "cronjob":
      return { ...base, status: spec.suspend ? "Suspended" : "Scheduled", healthy: null, detail: String(spec.schedule ?? "") };
    case "pod": {
      const phase = String(status.phase ?? "Pending");
      const statuses = (status.containerStatuses as Array<{ ready?: boolean; restartCount?: number }> | undefined) ?? [];
      const restarts = statuses.reduce((sum, c) => sum + num(c.restartCount), 0);
      const healthy = phase === "Succeeded" || (phase === "Running" && statuses.every((c) => c.ready !== false));
      return { ...base, status: restarts ? `${phase}, ${restarts} restarts` : phase, healthy: phase === "Pending" ? null : healthy, detail: String(spec.nodeName ?? "") };
    }
    case "service": {
      const ports = ((spec.ports as Array<{ port: number; protocol?: string }> | undefined) ?? []).map((p) => `${p.port}/${p.protocol ?? "TCP"}`).join(", ");
      return { ...base, status: String(spec.type ?? "ClusterIP"), healthy: null, detail: [spec.clusterIP, ports].filter(Boolean).join(" · ") };
    }
    case "ingress": {
      const hosts = ((spec.rules as Array<{ host?: string }> | undefined) ?? []).map((r) => r.host ?? "*").join(", ");
      return { ...base, status: "Ingress", healthy: null, detail: hosts };
    }
    case "configmap": {
      const keys = Object.keys(object.data ?? {}).length;
      return { ...base, status: `${keys} ${keys === 1 ? "key" : "keys"}`, healthy: null, detail: "" };
    }
  }
}

export function summarizeEvent(event: K8sEvent): KubeEvent {
  return {
    namespace: event.metadata.namespace ?? null,
    type: event.type ?? "Normal",
    reason: event.reason ?? "",
    message: event.message ?? "",
    object: `${(event.involvedObject?.kind ?? "").toLowerCase()}/${event.involvedObject?.name ?? ""}`,
    count: event.count ?? 1,
    lastSeen: event.lastTimestamp ?? event.eventTime ?? event.metadata.creationTimestamp ?? "",
  };
}
