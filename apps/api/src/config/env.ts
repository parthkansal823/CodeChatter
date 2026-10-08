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
  GOOGLE_CLIENT_ID: z.string().optional().default(""),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(""),
  GITHUB_CLIENT_ID: z.string().optional().default(""),
  GITHUB_CLIENT_SECRET: z.string().optional().default(""),
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
  /** "true" / "false"; unset means Anthropic yes, OpenAI-compatible yes (turn off for text-only models). */
  AI_VISION: z.string().trim().toLowerCase().optional().default(""),
  AI_MAX_TOKENS: z.coerce.number().int().positive().optional().catch(undefined),
  AI_CONTEXT_CHARS: z.coerce.number().int().min(4000).default(48_000).catch(48_000),
  AI_RATE_LIMIT: z.coerce.number().int().positive().default(30).catch(30),
  AI_RATE_WINDOW_SECONDS: z.coerce.number().int().positive().default(600).catch(600),
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
