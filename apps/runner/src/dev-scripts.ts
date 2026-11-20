/**
 * In development, the sandbox's own scripts that run fresh for each run or call (the automations' worker, its built-in steps, and automation.py) are
 * mounted read-only from the repo over the image's copies, so changing one takes effect at once: no image build, no room restart. Off in production,
 * and with SANDBOX_DEV_SCRIPTS=off. Anything else in the image (its Dockerfile, packages, the engine) still needs `pnpm sandbox:build`.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import type { Env } from "./env.js";

/** The scripts, by their place under sandbox/image, which is also their place under the image's /usr/local/lib/codechatter. */
export const DEV_SCRIPTS = ["automation/host.mjs", "automation/engine-call.mjs", "automation/builtins.mjs", "automation/files.mjs", "automation/runs.mjs", "automation.py"] as const;
const IMAGE_LIB = "/usr/local/lib/codechatter";

export type DevMount = { Type: "bind"; Source: string; Target: string; ReadOnly: true };

/** The mounts for a sandbox: none in production or when turned off, else each script the repo has. */
export function devScriptMounts(env: Pick<Env, "NODE_ENV" | "SANDBOX_DEV_SCRIPTS">, exists: (path: string) => boolean = existsSync): DevMount[] {
  if (env.NODE_ENV === "production" || !env.SANDBOX_DEV_SCRIPTS || env.SANDBOX_DEV_SCRIPTS === "off") return [];
  const root = resolve(env.SANDBOX_DEV_SCRIPTS);
  return DEV_SCRIPTS.filter((script) => exists(join(root, script))).map((script) => ({ Type: "bind", Source: join(root, script), Target: `${IMAGE_LIB}/${script}`, ReadOnly: true }));
}
