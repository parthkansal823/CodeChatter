import Docker from "dockerode";

import { loadEnv } from "./env.js";
import { connectKube } from "./kube-sandbox.js";
import { log } from "./log.js";
import { RoomRegistry } from "./room-session.js";
import { createRunnerServer } from "./server.js";

/**
 * The runner (ADR 0003): the only service with access to Docker, or to the
 * cluster with RUNNER_DRIVER=kubernetes. It keeps one sandbox per room, syncs
 * the room's files into it, and runs code and terminals there on behalf of
 * the API, with the room's databases and package proxy beside it.
 */
const env = loadEnv();
// DOCKER_HOST, or the platform default (/var/run/docker.sock, or the Windows named pipe).
const docker = new Docker();
// RUNNER_DRIVER=kubernetes: rooms run on the cluster, a namespace each, with their databases and package proxies.
const kube = env.RUNNER_DRIVER === "kubernetes" ? connectKube(env) : null;
if (kube) log.info(`rooms run on Kubernetes (namespaces cc-${env.SANDBOX_NAMESPACE}-<room>)`);
const rooms = new RoomRegistry(docker, env, kube);
const server = createRunnerServer({ env, docker, rooms });

const dockerOk = await docker.ping().then(
  () => true,
  () => false,
);
if (!dockerOk) log.warn("Docker is not reachable. Start Docker Desktop; Run and terminals will fail until then.");
else {
  const image = await docker.getImage(env.SANDBOX_IMAGE).inspect().catch(() => null);
  if (!image) log.warn(`Sandbox image ${env.SANDBOX_IMAGE} not found. Build it with: pnpm sandbox:build`);
}

server.listen(env.RUNNER_PORT, env.RUNNER_HOST, () => log.info(`listening on ${env.RUNNER_HOST}:${env.RUNNER_PORT}`));

async function shutdown() {
  server.close();
  await rooms.shutdown();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
