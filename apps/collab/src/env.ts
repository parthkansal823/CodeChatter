import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url(),
  EXTRA_ORIGINS: z.string().optional().default(""),
  COLLAB_PORT: z.coerce.number().int().positive().default(4100),
  DATABASE_URL: z.string().startsWith("postgres"),
  VALKEY_URL: z.string().startsWith("redis"),
  BETTER_AUTH_SECRET: z.string().min(32),
  /** Verifies the runner's service tokens (shared with api and runner). */
  SERVICE_SECRET: z.string().min(32),
});
export type Env = z.infer<typeof Env>;

export function loadEnv(): Env {
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  }
  return parsed.data;
}
