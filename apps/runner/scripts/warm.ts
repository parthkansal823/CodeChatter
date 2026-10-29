/**
 * Pre-warm the templates' installs (roadmap §14 C), like building the sandbox image:
 *   pnpm sandbox:warm              every template with an install in its room.json
 *   pnpm sandbox:warm react flask  just those
 *   pnpm sandbox:warm --force      again, even those already warm
 * Each install runs once, in a clean container of the sandbox image with ordinary
 * internet access (never in a room), at /workspace as rooms have it, and what it puts in
 * place (node_modules, .venv) is archived in the warm volume. Rooms see that volume
 * read-only and unpack the archive whose dependency files match theirs (warm-cache.ts).
 */
import { PassThrough } from "node:stream";

import { ROOM_CONFIG_PATH, RoomConfig } from "@codechatter/contracts";
import { TEMPLATE_FILES, templateFiles } from "@codechatter/workspace-model";
import Docker from "dockerode";

import { loadEnv } from "../src/env.js";
import { MANIFESTS, warmArchive, warmFolder, warmVolume } from "../src/warm-cache.js";

const env = loadEnv();
const docker = new Docker();
const volume = warmVolume(env.SANDBOX_NAMESPACE);
const args = process.argv.slice(2);
const force = args.includes("--force");
const wanted = args.filter((arg) => !arg.startsWith("--"));

/** A command in a throwaway container of the sandbox image, its output shown with a prefix; its exit code. */
async function run(label: string, user: string, script: string, extraEnv: string[] = []): Promise<{ code: number; out: string }> {
  const container = await docker.createContainer({
    Image: env.SANDBOX_IMAGE,
    User: user,
    Entrypoint: ["bash", "-c", script],
    Cmd: [],
    WorkingDir: "/workspace",
    Env: ["HOME=/home/ccuser", "PATH=/usr/local/bin:/usr/bin:/bin:/home/ccuser/.local/bin", "LANG=C.UTF-8", "npm_config_update_notifier=false", "npm_config_fund=false", ...extraEnv],
    HostConfig: {
      Mounts: [{ Type: "volume", Source: volume, Target: "/out" }],
      // At /workspace, as in a room, so paths baked into the install (a venv's) still hold there.
      Tmpfs: { "/workspace": "rw,exec,uid=10001,gid=10001,size=4g", "/tmp": "rw,exec,size=1g,mode=1777" },
      NetworkMode: "bridge",
    },
  });
  const stream = await container.attach({ stream: true, stdout: true, stderr: true });
  let out = "";
  const output = new PassThrough();
  output.on("data", (chunk: Buffer) => {
    out += chunk.toString();
    for (const line of chunk.toString().split("\n").filter(Boolean)) process.stdout.write(`  ${label} | ${line}\n`);
  });
  container.modem.demuxStream(stream, output, output);
  await container.start();
  const { StatusCode } = (await container.wait()) as { StatusCode: number };
  await container.remove({ force: true }).catch(() => {});
  return { code: StatusCode, out };
}

const image = await docker.getImage(env.SANDBOX_IMAGE).inspect().catch(() => null);
if (!image) throw new Error(`The sandbox image ${env.SANDBOX_IMAGE} isn't built. Run pnpm sandbox:build (or sandbox:build:full) first.`);
// The volume belongs to the sandbox user, so the warm containers (as that user) can write to it.
await run("setup", "0", "chown 10001:10001 /out && chmod 755 /out");
const existing = new Set((await run("setup", "10001", "ls -1 /out")).out.split("\n").map((line) => line.trim()));

let failed = 0;
for (const id of Object.keys(TEMPLATE_FILES).filter((id) => !wanted.length || wanted.includes(id))) {
  const files = templateFiles(id);
  const roomJson = files.find((file) => file.path === ROOM_CONFIG_PATH);
  const config = roomJson ? RoomConfig.safeParse(JSON.parse(roomJson.content)) : null;
  if (!config?.success) continue;
  const manifests = new Map(files.filter((file) => MANIFESTS.includes(file.path)).map((file) => [file.path, file.content]));
  const archive = warmArchive(config.data, manifests);
  const folder = warmFolder(config.data);
  if (!archive || !folder || !config.data.installed) continue;
  const name = archive.split("/").pop()!;
  if (existing.has(name) && !force) {
    console.log(`${id}: already warm (${name})`);
    continue;
  }
  console.log(`${id}: installing (${config.data.install})…`);
  const started = Date.now();
  // The template's files, written as a room has them; then its install, checked, then archived.
  const write = `node -e 'const fs=require("fs"),path=require("path");for(const f of JSON.parse(Buffer.from(process.env.CC_FILES,"base64").toString())){const p=path.join("/workspace",f.path);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,f.content)}'`;
  const script = [
    "set -e",
    write,
    "cd /workspace",
    config.data.install,
    `test -e '${config.data.installed}'`,
    `tar -cf '/out/${name}.part' '${folder}'`,
    `mv '/out/${name}.part' '/out/${name}'`,
  ].join("\n");
  const { code } = await run(id, "10001", script, [`CC_FILES=${Buffer.from(JSON.stringify(files)).toString("base64")}`]);
  if (code === 0) console.log(`${id}: warm in ${Math.round((Date.now() - started) / 1000)}s (${name})`);
  else {
    failed++;
    console.log(`${id}: the install failed (exit code ${code}); rooms from it will install as usual.`);
  }
}
process.exit(failed ? 1 : 0);
