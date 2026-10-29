import { z } from "zod";

/** Kinds the Kubernetes panel lists, as kubectl names them (singular). Secrets stay out: their values would show. */
export const KUBE_KINDS = ["namespace", "node", "deployment", "statefulset", "daemonset", "job", "cronjob", "pod", "service", "ingress", "configmap"] as const;
export type KubeKind = (typeof KUBE_KINDS)[number];

/** A Kubernetes name: DNS-style, lower case. */
const KubeName = z
  .string()
  .max(253)
  .regex(/^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/, "That isn't a Kubernetes name.");

/** One object of the cluster: its kind, where it is, and its name. Cluster-wide kinds have no namespace. */
export const KubeRef = z.object({ kind: z.enum(KUBE_KINDS), namespace: KubeName.nullable().default(null), name: KubeName });
export type KubeRef = z.infer<typeof KubeRef>;

/** What the room's Kubernetes panel asks of the playground in its sandbox (runner: kube.ts). */
export const KubeRequest = z.discriminatedUnion("op", [
  z.object({ op: z.literal("status") }),
  z.object({ op: z.literal("up") }),
  z.object({ op: z.literal("down") }),
  z.object({ op: z.literal("resources") }),
  z.object({ op: z.literal("object"), ref: KubeRef, view: z.enum(["yaml", "describe"]) }),
  /** A manifest's text (the open file), applied as it is in the editor. */
  z.object({ op: z.literal("apply"), text: z.string().min(1, "The file is empty.").max(1024 * 1024) }),
  z.object({ op: z.literal("delete"), ref: KubeRef }),
  /** Check a manifest against the Kubernetes schemas, without a cluster (kubeconform). */
  z.object({ op: z.literal("check"), text: z.string().min(1, "The file is empty.").max(1024 * 1024) }),
]);
export type KubeRequest = z.infer<typeof KubeRequest>;

/** Whether the playground can run here (kubectl is in the full image only) and whether it's up. */
export type KubeStatus = { available: boolean; running: boolean };

/**
 * An object, summed up for a table: `status` in words, `healthy` true when it's as it
 * should be, false when it isn't, null when that doesn't apply (a Service, a ConfigMap).
 */
export type KubeItem = {
  kind: KubeKind;
  namespace: string | null;
  name: string;
  status: string;
  healthy: boolean | null;
  detail: string;
  createdAt: string;
};

export type KubeEvent = {
  namespace: string | null;
  type: string;
  reason: string;
  message: string;
  object: string;
  count: number;
  lastSeen: string;
};

export type KubeResources = { items: KubeItem[]; events: KubeEvent[] };

/**
 * A manifest's check: each object in it, in order, and whether it matches the schema of
 * its kind. "skipped" has no schema to check against (a custom resource); "error" couldn't
 * be read (not YAML, or no kind). Errors say where, as a path into the object (/spec/replicas).
 */
export type KubeCheck = {
  objects: Array<{
    kind: string;
    name: string;
    status: "valid" | "invalid" | "error" | "skipped";
    message: string | null;
    errors: Array<{ path: string; message: string }>;
  }>;
};

/** The answer to each request: `output` is what kubectl said (up, down, apply, delete) or the YAML or description. */
export type KubeResponse = KubeStatus | KubeResources | KubeCheck | { output: string };
