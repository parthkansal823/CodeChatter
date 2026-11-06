import { randomBytes } from "node:crypto";
import { Readable, type Duplex } from "node:stream";

import type Docker from "dockerode";

import type { Env } from "./env.js";
import { log } from "./log.js";
import { LABEL_MANAGED, LABEL_NAMESPACE, LABEL_ROLE, LABEL_ROOM, USER_ENV, type ExecHandle, type ExecOptions } from "./sandbox.js";

/**
 * A throwaway container for tests a person mustn't see (an interview's hidden tests).
 *
 * A program being judged receives each test's input, so in the room's own sandbox it
 * could save the input to a file and read it later, or hand it to a process left running.
 * Here it runs in a container of the same image with a copy of the room's files: no
 * network, a read-only root, no capabilities, and its own anonymous volume. The container
 * and everything in it are gone when the tests end, so nothing it learned can reach the room.
 */

const USER = "10001";
const GROUP = "10000";
/** A safety net: the container ends by itself even if the runner dies. The janitor removes what's left. */
const LIFETIME_SECONDS = 900;

export type BoxFile = { path: string; data: Buffer };

function octal(value: number, length: number): string {
  return value.toString(8).padStart(length - 1, "0");
}

/** One ustar header, or null when a path is too long for the format. */
function tarHeader(path: string, size: number, directory: boolean): Buffer | null {
  let name = path;
  let prefix = "";
  if (Buffer.byteLength(name) > 100) {
    const cut = path.indexOf("/", Math.max(0, Buffer.byteLength(path) - 101));
    if (cut === -1) return null;
    prefix = path.slice(0, cut);
    name = path.slice(cut + 1);
    if (Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155) return null;
  }
  const header = Buffer.alloc(512);
  const put = (text: string, at: number) => header.write(text, at, "utf8");
  put(name, 0);
  put(`${octal(directory ? 0o2775 : 0o664, 8)}\0`, 100);
  put(`${octal(Number(USER), 8)}\0`, 108);
  put(`${octal(Number(GROUP), 8)}\0`, 116);
  put(`${octal(size, 12)}\0`, 124);
  put(`${octal(0, 12)}\0`, 136);
  put("        ", 148);
  put(directory ? "5" : "0", 156);
  put("ustar\0", 257);
  put("00", 263);
  put(prefix, 345);
  let sum = 0;
  for (const byte of header) sum += byte;
  put(`${octal(sum, 7)}\0 `, 148);
  return header;
}

/** A tar of these files, and each one's folders, owned by the sandbox user. Paths too long for tar are left out. */
export function tarOf(files: BoxFile[]): Buffer {
  const parts: Buffer[] = [];
  const folders = new Set<string>();
  for (const file of files) {
    const pieces = file.path.split("/");
    for (let depth = 1; depth < pieces.length; depth++) {
      const folder = pieces.slice(0, depth).join("/");
      if (folders.has(folder)) continue;
      folders.add(folder);
      const header = tarHeader(`${folder}/`, 0, true);
      if (header) parts.push(header);
    }
    const header = tarHeader(file.path, file.data.byteLength, false);
    if (!header) continue;
    parts.push(header, file.data, Buffer.alloc((512 - (file.data.byteLength % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

/** The container: exec into it as a sandbox would be, then close it. */
export class JudgeBox {
  private constructor(
    private readonly docker: Docker,
    private readonly container: Docker.Container,
  ) {}

  static async open(docker: Docker, env: Env, roomId: string, image: string, files: BoxFile[]): Promise<JudgeBox> {
    const mb = env.SANDBOX_MEMORY_MB * 1024 * 1024;
    const container = await docker.createContainer({
      name: `cc-${env.SANDBOX_NAMESPACE}-judge-${roomId.toLowerCase()}-${randomBytes(4).toString("hex")}`,
      Image: image,
      User: USER,
      Entrypoint: ["sleep"],
      Cmd: [String(LIFETIME_SECONDS)],
      WorkingDir: "/workspace",
      Env: ["PATH=/usr/local/bin:/usr/bin:/bin", "LANG=C.UTF-8"],
      NetworkDisabled: true,
      // An anonymous volume, removed with the container.
      Volumes: { "/workspace": {} },
      Labels: { [LABEL_MANAGED]: "1", [LABEL_NAMESPACE]: env.SANDBOX_NAMESPACE, [LABEL_ROOM]: roomId, [LABEL_ROLE]: "judge" },
      HostConfig: {
        NetworkMode: "none",
        ReadonlyRootfs: true,
        Tmpfs: {
          "/tmp": "rw,exec,nosuid,nodev,size=256m,mode=1777",
          "/home/ccuser": `rw,nosuid,nodev,size=64m,uid=${USER},gid=${GROUP},mode=700`,
        },
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges"],
        PidsLimit: env.SANDBOX_PIDS,
        Memory: mb,
        MemorySwap: mb,
        NanoCpus: Math.round(env.SANDBOX_CPUS * 1e9),
        Init: true,
        IpcMode: "private",
      },
    });
    const box = new JudgeBox(docker, container);
    try {
      await container.start();
      await container.putArchive(Readable.from([tarOf(files)]), { path: "/workspace" });
      return box;
    } catch (error) {
      await box.close();
      throw error;
    }
  }

  async exec(cmd: string[], options: ExecOptions): Promise<ExecHandle> {
    const stdin = options.stdin ?? false;
    const exec = await this.container.exec({
      Cmd: cmd,
      User: USER,
      WorkingDir: "/workspace",
      Env: [...USER_ENV, ...(options.env ?? [])],
      AttachStdin: stdin,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });
    const stream = (await exec.start({ hijack: true, stdin, Tty: false })) as Duplex;
    return {
      stream,
      demux: (stdout, stderr) => this.docker.modem.demuxStream(stream, stdout, stderr),
      resize: async () => {},
      exitCode: async () => {
        const info = await exec.inspect().catch(() => null);
        return info && !info.Running ? (info.ExitCode ?? null) : null;
      },
    };
  }

  async close(): Promise<void> {
    await this.container.remove({ force: true, v: true }).catch((error: unknown) => log.warn(`judge box wasn't removed: ${String(error)}`));
  }
}
