import { signServiceToken } from "@codechatter/auth/service-token";
import type { AgentEvent } from "@codechatter/contracts";
import {
  createFileAtPath,
  filesDocName,
  findByPath,
  flatten,
  isInitialised,
  listTree,
  maps,
  setText,
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
 * `written` mirrors the sandbox's files. Up-sync updates it too, so a change
 * that came from the sandbox never goes back into it.
 */
export class DocSync {
  readonly doc = new Y.Doc();
  private readonly socket: HocuspocusProviderWebsocket;
  private readonly provider: HocuspocusProvider;
  private readonly syncedPromise: Promise<void>;
  private agent: AgentChannel | null = null;
  private written = new Map<string, string>();
  private dirs = new Set<string>();
  private treeDirty = true;
  private readonly dirtyTexts = new Set<string>();
  private pathById = new Map<string, string>();
  private timer: NodeJS.Timeout | null = null;
  private pushing: Promise<void> = Promise.resolve();

  constructor(roomId: string, options: { collabUrl: string; secret: string }) {
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
    const { files, dirs } = this.snapshot();
    await agent.request({ op: "reconcile", files: [...files.keys()], dirs: [...dirs] }, 60_000);
    // Sent back to back; the agent applies them in order.
    await Promise.all([
      ...[...dirs].sort().map((path) => agent.request({ op: "mkdir", path })),
      ...[...files].map(([path, content]) => agent.request({ op: "write", path, content })),
    ]);
    this.written = files;
    this.dirs = dirs;
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
    if (event.ev === "file") {
      this.written.set(event.path, event.content);
      this.doc.transact(() => {
        const node = findByPath(this.doc, event.path);
        if (node?.kind === "file") setText(textOf(this.doc, node.id)!, event.content);
        else if (!node) createFileAtPath(this.doc, event.path, event.content, null);
      }, FROM_SANDBOX);
      for (let i = event.path.lastIndexOf("/"); i > 0; i = event.path.lastIndexOf("/", i - 1)) this.dirs.add(event.path.slice(0, i));
    } else if (event.ev === "removed") {
      this.written.delete(event.path);
      const node = findByPath(this.doc, event.path);
      if (node?.kind === "file") this.doc.transact(() => trash(this.doc, node.id), FROM_SANDBOX);
    } else if (event.ev === "skipped") {
      log.info(`${event.path} stays in the sandbox only (${event.reason})`);
    }
  }

  destroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.provider.destroy();
    this.socket.destroy();
    this.doc.destroy();
  }

  private schedule(): void {
    if (!this.agent) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 80);
  }

  /** Every live file (path → text) and folder, as the room shows them. */
  private snapshot(): { files: Map<string, string>; dirs: Set<string> } {
    const files = new Map<string, string>();
    const dirs = new Set<string>();
    this.pathById = new Map();
    for (const node of flatten(listTree(this.doc))) {
      this.pathById.set(node.id, node.path);
      if (node.kind === "folder") dirs.add(node.path);
      else files.set(node.path, textOf(this.doc, node.id)?.toString() ?? "");
    }
    return { files, dirs };
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
    const { files, dirs } = this.snapshot();
    // Removals first (a folder renamed to a file name must be gone first), deepest paths first.
    for (const path of [...this.written.keys()]) {
      if (files.has(path)) continue;
      this.written.delete(path);
      ops.push(agent.request({ op: "delete", path }));
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
    await Promise.all(ops);
  }
}
