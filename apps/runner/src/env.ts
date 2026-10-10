import { z } from "zod";

const production = process.env.NODE_ENV === "production";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  RUNNER_PORT: z.coerce.number().int().positive().default(4200),
  /** Only the API talks to the runner: localhost in dev, the private network in production. */
  RUNNER_HOST: z.string().default(production ? "0.0.0.0" : "127.0.0.1"),
  /** Shared by api, collab and runner to sign service tokens. */
  SERVICE_SECRET: z.string().min(32, "SERVICE_SECRET must be at least 32 characters"),
  /** Where the runner joins room documents as a peer (Hocuspocus, not through Caddy). */
  COLLAB_INTERNAL_URL: z.string().startsWith("ws").default("ws://127.0.0.1:4100"),
  SANDBOX_IMAGE: z.string().default("codechatter-sandbox:dev"),
  /**
   * Separates sandboxes of different deployments on one Docker host (dev and a
   * local production test, or staging and prod): in container names, volume
   * names and labels. Each runner only manages its own namespace.
   */
  SANDBOX_NAMESPACE: z.string().regex(/^[a-z0-9-]{1,20}$/).default(production ? "prod" : "dev"),
  SANDBOX_MEMORY_MB: z.coerce.number().int().min(128).default(768),
  SANDBOX_CPUS: z.coerce.number().positive().default(1),
  SANDBOX_PIDS: z.coerce.number().int().min(32).default(256),
  /**
   * Each room's private network is a /26 of this range (1,024 rooms in a /16). Room
   * networks have no address on the host, so the range only has to stay clear of other
   * Docker networks.
   */
  SANDBOX_SUBNET: z
    .string()
    .regex(/^(\d{1,3}\.){3}\d{1,3}\/(8|9|1\d|2[0-6])$/, "SANDBOX_SUBNET must be an IPv4 range of /26 or larger, like 10.213.0.0/16")
    .default("10.213.0.0/16"),
  /**
   * Where rooms run: "docker" (one container per room, the light default for
   * development) or "kubernetes" (a namespace per room; kube-sandbox.ts), using
   * KUBE_CONTEXT, or the kubeconfig's current context, or the cluster the
   * runner runs in.
   */
  RUNNER_DRIVER: z.enum(["docker", "kubernetes"]).default("docker"),
  KUBE_CONTEXT: z.string().optional(),
  /** Kubernetes: the size of each room's workspace and home volumes, and their storage class (the cluster's default if unset). */
  SANDBOX_STORAGE_GB: z.coerce.number().int().min(1).default(5),
  SANDBOX_STORAGE_CLASS: z.string().optional(),
  /**
   * Kubernetes: when a pod looks for a newer sandbox image. "Always" (the default) picks up
   * `pnpm sandbox:build` at the next start, as the tag stays the same; "IfNotPresent" suits a
   * pinned version from a registry.
   */
  SANDBOX_IMAGE_PULL: z.enum(["Always", "IfNotPresent"]).default("Always"),
  /** Kubernetes: the size of each one-click database's volume claim. */
  DATABASE_STORAGE_GB: z.coerce.number().int().min(1).default(2),
  /** Stop a room's container after this long with no run and no open terminal. */
  SANDBOX_IDLE_MINUTES: z.coerce.number().positive().default(15),
  RUN_TIMEOUT_MINUTES: z.coerce.number().positive().default(30),
});
export type Env = z.infer<typeof Env>;

export function loadEnv(): Env {
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  }
  return parsed.data;
}
