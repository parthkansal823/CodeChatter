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
