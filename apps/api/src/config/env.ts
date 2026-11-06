import { z } from "zod";

// Every setting the API reads, validated once at boot. A missing or malformed
// value fails fast with a readable message instead of surfacing later as an
// undefined deep inside a request.
const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url(),
  /** Comma-separated extra browser origins to trust (e.g. a tunnel URL). */
  EXTRA_ORIGINS: z.string().optional().default(""),
  API_PORT: z.coerce.number().int().positive().default(4000),
  /** Required for remote scrapes; unset permits only development loopback requests. */
  METRICS_TOKEN: z.string().trim().optional(),
  /** Permit private receiver fixtures only in development; the worker also checks NODE_ENV. */
  WEBHOOKS_ALLOW_PRIVATE: z.enum(["0", "1"]).default("0").transform((value) => value === "1"),
  /** Settled webhook deliveries are pruned hourly after this many days. */
  WEBHOOK_DELIVERY_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  DATABASE_URL: z.string().startsWith("postgres"),
  VALKEY_URL: z.string().startsWith("redis"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  /** Signs service tokens for the runner (shared with collab and runner). */
  SERVICE_SECRET: z.string().min(32, "SERVICE_SECRET must be at least 32 characters (see .env.example)"),
  /** apps/runner, on the private network (never exposed through Caddy). */
  RUNNER_URL: z.url().default("http://127.0.0.1:4200"),
  /**
   * Origin for live previews of dev servers: each room+port gets
   * p<port>-<room>.<host>. Must be a different site from APP_URL (a separate
   * domain in production). Unset in production = previews off.
   */
  PREVIEW_ORIGIN: z.url().optional().default(process.env.NODE_ENV === "production" ? "" : "http://preview.localhost:8080").transform((v) => v || undefined),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASS: z.string().optional().default(""),
  MAIL_FROM: z.string().min(3),
  /** How often the notification digest looks for unread notifications, and how long they wait first (tests shorten both). */
  NOTIFICATION_DIGEST_CHECK_MS: z.coerce.number().int().min(1000).default(15 * 60_000),
  NOTIFICATION_DIGEST_AFTER_MS: z.coerce.number().int().min(0).default(60 * 60_000),
  /** At most one digest per person in this long. */
  NOTIFICATION_DIGEST_EVERY_MS: z.coerce.number().int().min(0).default(20 * 60 * 60_000),
  GOOGLE_CLIENT_ID: z.string().optional().default(""),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(""),
  GITHUB_CLIENT_ID: z.string().optional().default(""),
  GITHUB_CLIENT_SECRET: z.string().optional().default(""),
  /** Where repositories are imported from (github/github.service.ts); GitHub Enterprise has its own. */
  GITHUB_API_URL: z.url().default("https://api.github.com"),
  /**
   * Calls (LiveKit): the address browsers reach it at, and the API key and secret its
   * tokens are signed with. In development they default to the dev stack's LiveKit
   * (infra/livekit/livekit.dev.yaml); in production, calls are off until all three are set.
   */
  LIVEKIT_URL: z.string().trim().optional().default(""),
  LIVEKIT_API_KEY: z.string().trim().optional().default(""),
  LIVEKIT_API_SECRET: z.string().trim().optional().default(""),
  /**
   * Binary room files (images, PDFs, fonts) are kept in this S3-compatible store (SeaweedFS
   * in development). Binary files are off until the endpoint, bucket and keys are all set.
   */
  S3_ENDPOINT: z.string().trim().optional().default(""),
  S3_REGION: z.string().trim().optional().default("us-east-1"),
  S3_BUCKET: z.string().trim().optional().default(""),
  S3_ACCESS_KEY: z.string().trim().optional().default(""),
  S3_SECRET_KEY: z.string().trim().optional().default(""),
  /** "Try the demo": one-click guest accounts (off unless set in production). */
  DEMO_ENABLED: z
    .enum(["true", "false", ""])
    .optional()
    .default("")
    .transform((v) => (v === "" ? process.env.NODE_ENV !== "production" : v === "true")),
  // AI copilot (apps/api/src/ai). All optional and never fatal: a bad value
  // turns AI off with a reason on GET /api/ai/status instead of stopping boot.
  AI_PROVIDER: z.string().trim().toLowerCase().optional().default("none"),
  AI_MODEL: z.string().trim().optional().default(""),
  ANTHROPIC_API_KEY: z.string().trim().optional().default(""),
  OPENAI_API_KEY: z.string().trim().optional().default(""),
  /** Any OpenAI-compatible endpoint: OpenAI, OpenRouter, Groq, Gemini, a local Ollama… */
  OPENAI_BASE_URL: z.string().trim().optional().default(""),
  /** Where Ollama listens when AI_PROVIDER=ollama (default http://localhost:11434; http://host.docker.internal:11434 from Docker). */
  OLLAMA_URL: z.string().trim().optional().default(""),
  /** "true" / "false"; unset means Anthropic yes, OpenAI-compatible yes (turn off for text-only models). */
  AI_VISION: z.string().trim().toLowerCase().optional().default(""),
  AI_MAX_TOKENS: z.coerce.number().int().positive().optional().catch(undefined),
  /** Characters of code and context sent with a question; unset means 48 000, or 8 000 for Ollama (small default context window). */
  AI_CONTEXT_CHARS: z.coerce.number().int().min(4000).optional().catch(undefined),
  AI_RATE_LIMIT: z.coerce.number().int().positive().default(30).catch(30),
  AI_RATE_WINDOW_SECONDS: z.coerce.number().int().positive().default(600).catch(600),
  /** Inline completions (ghost text as you type) per person per minute; a separate limit from the one above. */
  AI_COMPLETE_RATE_LIMIT: z.coerce.number().int().positive().default(30).catch(30),
}).superRefine((env, ctx) => {
  // Mailpit only exists on a dev machine; in production, verification and
  // reset emails would vanish while sign-up appears to work.
  if (env.NODE_ENV === "production" && /^(localhost|127\.|mailpit$)/.test(env.SMTP_HOST)) {
    ctx.addIssue({ code: "custom", path: ["SMTP_HOST"], message: "points at the dev mail catcher; set a real SMTP server" });
  }
});

export type Env = z.infer<typeof Env>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = Env.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment:\n${problems}\nSee .env.example at the repo root.`);
  }
  return parsed.data;
}
