import { existsSync, readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

import type { NextConfig } from "next";

// This machine's LAN addresses, so a phone on the same Wi-Fi can load the dev
// server through http://<ip>:8080 (Next blocks unknown dev origins otherwise).
const lanHosts = Object.values(networkInterfaces())
  .flat()
  .filter((i) => i && i.family === "IPv4" && !i.internal)
  .map((i) => i!.address);

// Tunnel hosts etc. come from EXTRA_ORIGINS in the root .env, the same list the
// API and collab servers trust (packages/auth/src/origins.ts).
const rootEnv = resolve(process.cwd(), "../../.env");
const extraOrigins = process.env.EXTRA_ORIGINS ?? (existsSync(rootEnv) ? parseEnv(readFileSync(rootEnv, "utf8")).EXTRA_ORIGINS : "");
const extraHosts = (extraOrigins ?? "")
  .split(",")
  .map((origin) => URL.parse(origin.trim())?.hostname)
  .filter((host): host is string => Boolean(host));

const nextConfig: NextConfig = {
  // Standalone server for the Docker image (infra/docker/app.Dockerfile). Trace
  // from the monorepo root so workspace packages are bundled with it.
  output: "standalone",
  outputFileTracingRoot: resolve(process.cwd(), "../.."),
  reactCompiler: true,
  typedRoutes: true,
  poweredByHeader: false,
  // In dev the app is reached through Caddy at localhost:8080, not :3000.
  allowedDevOrigins: ["localhost", "127.0.0.1", ...lanHosts, ...extraHosts],
};

export default nextConfig;
