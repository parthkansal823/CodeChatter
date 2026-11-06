import { createHash } from "node:crypto";

import type { ObjectStore } from "@codechatter/auth/s3";
import { signServiceToken } from "@codechatter/auth/service-token";
import { blobKey, SANDBOX_BLOB_MAX_BYTES, typeForName, type AgentEvent, type BlobRef } from "@codechatter/contracts";
import {
  createBinaryFileAtPath,
  createFileAtPath,
  filesDocName,
  findByPath,
  flatten,
  isInitialised,
  listTree,
  maps,
  setBlob,
  setFileText,
  textOf,
  trash,
} from "@codechatter/workspace-model";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";

import type { AgentChannel } from "./agent-channel.js";
import { log } from "./log.js";

/** Transaction origin for changes that came from the sandbox (not echoed back to it). */
const FROM_SANDBOX = "sandbox";

/**
 * The runner as a peer of the room's files document (plan §5 "Sync").
 *
 * Down: every change in the room is written into the sandbox, debounced, and
 *       only what differs from what the sandbox already has.
 * Up:   files that programs or the terminal change are written into the
 *       document, so they appear in everyone's editor.
 *
 * `written` mirrors the sandbox's text files and `writtenBlobs` its binary
 * ones (by SHA-256). Up-sync updates them too, so a change that came from the
 * sandbox never goes back into it.
 *
 * Binary files' bytes live in the object store (`blobKey`): going down they're
 * fetched and sent base64; coming up they're stored and the file tree gets the
 * blob. Without a store, binary files stay out of the sandbox.
 */
export class DocSync {
  readonly doc = new Y.Doc();
  private readonly socket: HocuspocusProviderWebsocket;
  private readonly provider: HocuspocusProvider;
  private readonly syncedPromise: Promise<void>;
  private readonly store: ObjectStore | null;
  private agent: AgentChannel | null = null;
  private written = new Map<string, string>();
  private writtenBlobs = new Map<string, string>();
  private dirs = new Set<string>();
  private treeDirty = true;
  private readonly dirtyTexts = new Set<string>();
  private pathById = new Map<string, string>();
  private timer: NodeJS.Timeout | null = null;
  private pushing: Promise<void> = Promise.resolve();
  /** Changes from the sandbox, applied in the order they came (storing a binary takes a moment). */
  private incoming: Promise<void> = Promise.resolve();
  private warnedNoStore = false;

  constructor(
    private readonly roomId: string,
    options: { collabUrl: string; secret: string; store?: ObjectStore | null },
  ) {
    this.store = options.store ?? null;
    const name = filesDocName(roomId);
    this.socket = new HocuspocusProviderWebsocket({ url: options.collabUrl, WebSocketPolyfill: WebSocket as never });
    this.provider = new HocuspocusProvider({
      websocketProvider: this.socket,
      name,
      document: this.doc,
      // Fresh on every (re)connect; valid for this one document only.
      token: () => signServiceToken(options.secret, { aud: "collab", sub: name }, 300),
    });
    this.provider.attach();
    this.syncedPromise = new Promise((resolve) => this.provider.on("synced", () => resolve()));

    const { nodes, contents } = maps(this.doc);
    nodes.observeDeep(() => {
      this.treeDirty = true;
      this.schedule();
    });
    contents.observeDeep((events) => {
      for (const event of events) {
        if (event.target === contents) this.treeDirty = true;
        else if (typeof event.path[0] === "string") this.dirtyTexts.add(event.path[0]);
      }
      this.schedule();
    });
  }

  /** Resolves once the room's current files have arrived from the collab server. */
  async synced(timeoutMs = 15_000): Promise<void> {
    await Promise.race([
      this.syncedPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("could not load the room's files")), timeoutMs)),
    ]);
    if (!isInitialised(this.doc)) throw new Error("the room's files are not ready yet");
  }

  /** Point at a (new) sandbox agent and bring its workspace in line with the room. */
  async attach(agent: AgentChannel): Promise<void> {
    await this.synced();
    this.agent = agent;
    const { files, blobs, dirs } = this.snapshot();
    await agent.request({ op: "reconcile", files: [...files.keys(), ...blobs.keys()], dirs: [...dirs] }, 60_000);
    this.written = files;
    this.writtenBlobs = new Map([...blobs].map(([path, blob]) => [path, blob.sha256]));
    this.dirs = dirs;
    // Sent back to back; the agent applies them in order.
    await Promise.all([
      ...[...dirs].sort().map((path) => agent.request({ op: "mkdir", path })),
      ...[...files].map(([path, content]) => agent.request({ op: "write", path, content })),
      ...[...blobs].map(([path, blob]) => this.writeBlob(agent, path, blob)),
    ]);
    this.dirtyTexts.clear();
    this.treeDirty = false;
  }

  isAttachedTo(agent: AgentChannel | null): boolean {
    return agent !== null && this.agent === agent && agent.alive;
  }

  /**
   * Wait until this peer has every edit the caller had when they pressed Run
   * (their Yjs state vector). False if some never arrived (e.g. the caller is
   * offline); the run then uses what the server has.
   */
  waitFor(stateVectorBase64: string, timeoutMs = 4000): Promise<boolean> {
    if (!stateVectorBase64) return Promise.resolve(true);
    let wanted: Map<number, number>;
    try {
      wanted = Y.decodeStateVector(Buffer.from(stateVectorBase64, "base64"));
    } catch {
      return Promise.resolve(true);
    }
    const hasAll = () => {
      const mine = Y.decodeStateVector(Y.encodeStateVector(this.doc));
      for (const [client, clock] of wanted) if ((mine.get(client) ?? 0) < clock) return false;
      return true;
    };
    if (hasAll()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const onUpdate = () => {
        if (!hasAll()) return;
        clearTimeout(timer);
        this.doc.off("update", onUpdate);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.doc.off("update", onUpdate);
        resolve(false);
      }, timeoutMs);
      this.doc.on("update", onUpdate);
    });
  }

  /** Push pending changes now and wait until the sandbox has them. */
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pushing = this.pushing.then(() => this.push()).catch((error) => log.error("sync to sandbox failed", error));
    return this.pushing;
  }

  /** A change reported by the sandbox agent (a program or the terminal wrote a file). */
  applyFromSandbox(event: AgentEvent): void {
    this.incoming = this.incoming
      .then(() => this.fromSandbox(event))
      .catch((error) => log.error(`sync from sandbox failed for ${"path" in event ? event.path : event.ev}`, error));
  }

  /** Resolves when every change the sandbox has reported so far is in the document. */
  settled(): Promise<void> {
    return this.incoming;
  }

  destroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.provider.destroy();
    this.socket.destroy();
    this.doc.destroy();
  }

  private async fromSandbox(event: AgentEvent): Promise<void> {
    if (event.ev === "file") {
      this.written.set(event.path, event.content);
      this.writtenBlobs.delete(event.path);
      this.doc.transact(() => {
        const node = findByPath(this.doc, event.path);
        if (node?.kind === "file") setFileText(this.doc, node.id, event.content);
        else if (!node) createFileAtPath(this.doc, event.path, event.content, null);
      }, FROM_SANDBOX);
      this.addParents(event.path);
    } else if (event.ev === "blob") {
      await this.blobFromSandbox(event.path, Buffer.from(event.b64, "base64"));
    } else if (event.ev === "removed") {
      this.written.delete(event.path);
      this.writtenBlobs.delete(event.path);
      const node = findByPath(this.doc, event.path);
      if (node?.kind === "file") this.doc.transact(() => trash(this.doc, node.id), FROM_SANDBOX);
    } else if (event.ev === "skipped") {
      log.info(`${event.path} stays in the sandbox only (${event.reason})`);
    }
  }

  /** A binary a program made: store its bytes, then point the file tree at them. */
  private async blobFromSandbox(path: string, bytes: Buffer): Promise<void> {
    if (!this.store) {
      this.warnNoStore(path);
      return;
    }
    if (bytes.byteLength > SANDBOX_BLOB_MAX_BYTES) return;
    const blob: BlobRef = { sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.byteLength, type: typeForName(path) };
    const key = blobKey(this.roomId, blob.sha256);
    if (!(await this.store.head(key))) await this.store.put(key, bytes, blob.type);
    this.written.delete(path);
    this.writtenBlobs.set(path, blob.sha256);
    this.doc.transact(() => {
      const node = findByPath(this.doc, path);
      if (node?.kind === "file") setBlob(this.doc, node.id, blob);
      else if (!node) createBinaryFileAtPath(this.doc, path, blob, null);
    }, FROM_SANDBOX);
    this.addParents(path);
  }

  private addParents(path: string): void {
    for (let i = path.lastIndexOf("/"); i > 0; i = path.lastIndexOf("/", i - 1)) this.dirs.add(path.slice(0, i));
  }

  private warnNoStore(path: string): void {
    if (this.warnedNoStore) return;
    this.warnedNoStore = true;
    log.warn(`room ${this.roomId}: binary files need an object store (S3_*); ${path} and others stay out of sync`);
  }

  /** Fetch a binary file's bytes and write them, unless the room has moved on by the time they arrive. */
  private async writeBlob(agent: AgentChannel, path: string, blob: BlobRef): Promise<void> {
    if (!this.store) {
      this.warnNoStore(path);
      return;
    }
    const object = await this.store.get(blobKey(this.roomId, blob.sha256)).catch((error: unknown) => {
      log.error(`could not fetch ${path} for the sandbox`, error);
      return null;
    });
    if (!object) {
      log.warn(`room ${this.roomId}: ${path}'s bytes are missing from the object store`);
      return;
    }
    if (this.writtenBlobs.get(path) !== blob.sha256 || !agent.alive) return;
    await agent.request({ op: "write", path, content: object.body.toString("base64"), encoding: "base64" }, 60_000);
  }

  /** Every file of the room as bytes (binary ones from the object store), for a copy outside the sandbox. */
  async exportFiles(): Promise<Array<{ path: string; data: Buffer }>> {
    const { files, blobs } = this.snapshot();
    const out: Array<{ path: string; data: Buffer }> = [...files].map(([path, text]) => ({ path, data: Buffer.from(text, "utf8") }));
    for (const [path, blob] of blobs) {
      const object = await this.store?.get(blobKey(this.roomId, blob.sha256)).catch(() => null);
      if (object) out.push({ path, data: object.body });
    }
    return out;
  }

  private schedule(): void {
    if (!this.agent) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 80);
  }

  /** Every live text file (path → text), binary file (path → blob) and folder, as the room shows them. */
  private snapshot(): { files: Map<string, string>; blobs: Map<string, BlobRef>; dirs: Set<string> } {
    const files = new Map<string, string>();
    const blobs = new Map<string, BlobRef>();
    const dirs = new Set<string>();
    this.pathById = new Map();
    for (const node of flatten(listTree(this.doc))) {
      this.pathById.set(node.id, node.path);
      if (node.kind === "folder") dirs.add(node.path);
      else if (node.blob) blobs.set(node.path, node.blob);
      else files.set(node.path, textOf(this.doc, node.id)?.toString() ?? "");
    }
    return { files, blobs, dirs };
  }

  private async push(): Promise<void> {
    const agent = this.agent;
    if (!agent?.alive) return;
    const ops: Promise<void>[] = [];

    if (!this.treeDirty) {
      // Only text changed: rewrite just those files.
      for (const id of this.dirtyTexts) {
        const path = this.pathById.get(id);
        const content = textOf(this.doc, id)?.toString();
        if (path === undefined || content === undefined || this.written.get(path) === content) continue;
        this.written.set(path, content);
        ops.push(agent.request({ op: "write", path, content }));
      }
      this.dirtyTexts.clear();
      await Promise.all(ops);
      return;
    }

    this.treeDirty = false;
    this.dirtyTexts.clear();
    const { files, blobs, dirs } = this.snapshot();
    // Removals first (a folder renamed to a file name must be gone first), deepest paths first.
    // A file that only switched between text and binary is overwritten, not removed.
    for (const path of [...this.written.keys()]) {
      if (files.has(path)) continue;
      this.written.delete(path);
      if (!blobs.has(path)) ops.push(agent.request({ op: "delete", path }));
    }
    for (const path of [...this.writtenBlobs.keys()]) {
      if (blobs.has(path)) continue;
      this.writtenBlobs.delete(path);
      if (!files.has(path)) ops.push(agent.request({ op: "delete", path }));
    }
    for (const dir of [...this.dirs].sort().reverse()) {
      if (dirs.has(dir)) continue;
      this.dirs.delete(dir);
      ops.push(agent.request({ op: "delete", path: dir }));
    }
    for (const dir of [...dirs].sort()) {
      if (this.dirs.has(dir)) continue;
      this.dirs.add(dir);
      ops.push(agent.request({ op: "mkdir", path: dir }));
    }
    for (const [path, content] of files) {
      if (this.written.get(path) === content) continue;
      this.written.set(path, content);
      ops.push(agent.request({ op: "write", path, content }));
    }
    for (const [path, blob] of blobs) {
      if (this.writtenBlobs.get(path) === blob.sha256) continue;
      this.writtenBlobs.set(path, blob.sha256);
      ops.push(this.writeBlob(agent, path, blob));
    }
    await Promise.all(ops);
  }
}
