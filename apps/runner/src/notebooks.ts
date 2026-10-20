import {
  appendOutput,
  cellOutputs,
  cellSource,
  cellType,
  clearOutputs,
  findCell,
  kernelOf,
  notebookOf,
  notebooks,
  pathOf,
  setKernel,
  setText,
  textOf,
  toIpynb,
  type KernelStatus,
  type NotebookOutput,
} from "@codechatter/workspace-model";
import { PassThrough } from "node:stream";
import type * as Y from "yjs";

import { log, messageOf } from "./log.js";
import { JAIL } from "./plans.js";
import type { ExecHandle, RoomSandbox } from "./sandbox.js";

/** The kernel driver in the sandbox image (sandbox/image/kernel.py). */
const DRIVER = "/usr/local/lib/codechatter/kernel.py";
/** The first kernel in a sandbox imports a lot. */
const START_MS = 120_000;
/** A notebook's file text follows its cells this long after they change. */
const TEXT_DELAY_MS = 600;
/** Writes this module makes to the room's files document. */
const ORIGIN = "notebook-kernel";

export class NotebookError extends Error {}

type Message =
  | { type: "ready" }
  | { type: "restarted" }
  | { type: "error"; message: string }
  | { type: "count"; id: string; count: number | null }
  | { type: "output"; id: string; output: NotebookOutput }
  | { type: "clear"; id: string }
  | { type: "done"; id: string; status: "ok" | "error" | "dead"; count: number | null };

/**
 * Notebooks (roadmap §2): a kernel for each notebook someone runs, in the room's sandbox
 * (kernel.py, an IPython kernel driven by Jupyter's client). Cells run one at a time;
 * their outputs go into the room's files document as they come, so everyone sees text,
 * tables and plots arrive. The runner also keeps each notebook's file (its .ipynb) in
 * step with the cells: it is that text's only writer, so there's nothing to merge.
 */
export class NotebookKernels {
  private readonly kernels = new Map<string, Kernel>();
  private readonly changed = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sandbox: RoomSandbox,
    private readonly doc: Y.Doc,
    synced: Promise<void>,
  ) {
    notebooks(doc).observeDeep((events) => {
      for (const event of events) {
        if (event.target === notebooks(doc)) for (const key of event.changes.keys.keys()) this.changed.add(key);
        else if (typeof event.path[0] === "string") this.changed.add(event.path[0]);
      }
      this.schedule();
    });
    // Notebooks edited while the runner was away catch up once the files have arrived,
    // and a kernel a previous runner left "busy" or "idle" is gone: say so.
    void synced.then(() => {
      notebooks(doc).forEach((nb, id) => {
        this.changed.add(id);
        if (!this.kernels.has(id) && kernelOf(nb).state !== "off") doc.transact(() => setKernel(nb, { ...kernelOff, detail: "The kernel stopped. Run a cell to start a new one." }), ORIGIN);
      });
      this.schedule();
    });
  }

  /** A kernel is running a cell: the room isn't idle. */
  get busy(): boolean {
    return [...this.kernels.values()].some((kernel) => kernel.busy);
  }

  async run(fileId: string, cellIds: string[]): Promise<KernelStatus> {
    if (!notebookOf(this.doc, fileId)) throw new NotebookError("Open the notebook first.");
    return this.kernel(fileId).run(cellIds);
  }

  interrupt(fileId: string): KernelStatus {
    return this.kernels.get(fileId)?.interrupt() ?? kernelOff;
  }

  async restart(fileId: string): Promise<KernelStatus> {
    return this.kernel(fileId).restart();
  }

  shutdown(fileId: string): KernelStatus {
    this.kernels.get(fileId)?.shutdown();
    this.kernels.delete(fileId);
    return kernelOff;
  }

  /** The room closed or its sandbox went: every kernel goes with it. */
  closeAll(reason = "The room's sandbox stopped."): void {
    for (const kernel of this.kernels.values()) kernel.shutdown(reason);
    this.kernels.clear();
  }

  private kernel(fileId: string): Kernel {
    let kernel = this.kernels.get(fileId);
    if (!kernel) {
      kernel = new Kernel(this.sandbox, this.doc, fileId);
      this.kernels.set(fileId, kernel);
    }
    return kernel;
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const ids = [...this.changed];
      this.changed.clear();
      for (const id of ids) this.writeText(id);
    }, TEXT_DELAY_MS);
  }

  /** The notebook's file, as .ipynb JSON from its cells; the sync then takes it to the sandbox. */
  private writeText(fileId: string): void {
    const nb = notebookOf(this.doc, fileId);
    const text = textOf(this.doc, fileId);
    if (!nb || !text) return;
    const next = toIpynb(nb);
    if (text.toString() !== next) this.doc.transact(() => setText(text, next), ORIGIN);
  }
}

const kernelOff: KernelStatus = { state: "off", running: null, queued: [] };

/** One notebook's kernel: kernel.py in the sandbox, in the notebook's folder. */
class Kernel {
  private handle: ExecHandle | null = null;
  private starting: Promise<void> | null = null;
  private buffer = "";
  private queue: string[] = [];
  private running: string | null = null;
  private state: KernelStatus["state"] = "off";
  private detail: string | undefined;
  private waiting: { kind: "ready" | "restarted"; settle: (error?: Error) => void } | null = null;

  constructor(
    private readonly sandbox: RoomSandbox,
    private readonly doc: Y.Doc,
    private readonly fileId: string,
  ) {}

  get busy(): boolean {
    return this.running !== null || this.queue.length > 0;
  }

  async run(cellIds: string[]): Promise<KernelStatus> {
    for (const id of cellIds) if (id !== this.running && !this.queue.includes(id)) this.queue.push(id);
    this.publish();
    try {
      await this.start();
    } catch (error) {
      this.queue = [];
      this.publish();
      throw error;
    }
    if (!this.running) this.next();
    return this.status();
  }

  interrupt(): KernelStatus {
    // As in Jupyter: the cell running stops, and the ones waiting don't run.
    this.queue = [];
    this.send({ type: "interrupt" });
    this.publish();
    return this.status();
  }

  async restart(): Promise<KernelStatus> {
    this.queue = [];
    if (!this.handle) {
      this.state = "off";
      await this.start();
      return this.status();
    }
    this.running = null;
    this.state = "starting";
    this.publish();
    await this.expect("restarted", () => this.send({ type: "restart" }));
    // A cell someone ran meanwhile is already on its way (the driver takes it after the restart).
    this.state = this.running ? "busy" : "idle";
    this.detail = undefined;
    this.publish();
    return this.status();
  }

  shutdown(reason?: string): void {
    this.queue = [];
    if (this.running) this.failRunning(reason ?? "The kernel was shut down.");
    this.send({ type: "shutdown" });
    this.handle?.stream.destroy();
    this.handle = null;
    this.state = "off";
    this.detail = reason;
    this.publish();
  }

  private status(): KernelStatus {
    return { state: this.state, running: this.running, queued: [...this.queue], ...(this.detail && { detail: this.detail }) };
  }

  private start(): Promise<void> {
    if (this.handle && this.state !== "dead") return Promise.resolve();
    this.starting ??= (async () => {
      this.handle?.stream.destroy();
      this.handle = null;
      this.state = "starting";
      this.detail = undefined;
      this.publish();
      const path = pathOf(this.doc, this.fileId) ?? "";
      const dir = path.includes("/") ? `/workspace/${path.slice(0, path.lastIndexOf("/"))}` : "/workspace";
      const handle = await this.sandbox.exec([JAIL, "python3", DRIVER, dir], { tty: false, stdin: true });
      const out = new PassThrough();
      out.on("data", (chunk: Buffer) => this.receive(chunk.toString("utf8")));
      // Its stderr is the kernel's own chatter (warnings): not part of any cell.
      handle.demux(out, new PassThrough().resume());
      const ended = () => {
        if (this.handle === handle) this.ended();
      };
      handle.stream.on("end", ended);
      handle.stream.on("close", ended);
      handle.stream.on("error", ended);
      this.handle = handle;
      await this.expect("ready");
      this.state = "idle";
      this.publish();
    })()
      .catch((error: unknown) => {
        this.handle?.stream.destroy();
        this.handle = null;
        this.state = "dead";
        this.detail = messageOf(error);
        this.publish();
        throw new NotebookError(this.detail);
      })
      .finally(() => (this.starting = null));
    return this.starting;
  }

  /** Wait for the driver to say `kind` (after `then`), or for it to fail or end. */
  private expect(kind: "ready" | "restarted", then?: () => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => settle(new Error("The kernel took too long to start.")), START_MS);
      const settle = (error?: Error) => {
        clearTimeout(timer);
        this.waiting = null;
        if (error) reject(error);
        else resolve();
      };
      this.waiting = { kind, settle };
      then?.();
    });
  }

  private next(): void {
    const nb = notebookOf(this.doc, this.fileId);
    while (this.queue.length) {
      const id = this.queue.shift()!;
      const found = nb ? findCell(nb, id) : null;
      // Gone meanwhile, or markdown: nothing to run.
      if (!found || cellType(found.cell) !== "code") continue;
      this.running = id;
      this.state = "busy";
      this.doc.transact(() => clearOutputs(found.cell), ORIGIN);
      this.publish();
      this.send({ type: "execute", id, code: cellSource(found.cell).toString() });
      return;
    }
    this.running = null;
    if (this.state === "busy") this.state = "idle";
    this.publish();
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    for (let newline = this.buffer.indexOf("\n"); newline !== -1; newline = this.buffer.indexOf("\n")) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line.startsWith("{")) continue;
      let message: Message;
      try {
        message = JSON.parse(line) as Message;
      } catch {
        continue;
      }
      this.onMessage(message);
    }
  }

  private onMessage(message: Message): void {
    if (message.type === "ready" || message.type === "restarted") {
      if (this.waiting?.kind === message.type) this.waiting.settle();
      return;
    }
    if (message.type === "error") {
      this.waiting?.settle(new Error(message.message));
      return;
    }
    const nb = notebookOf(this.doc, this.fileId);
    const cell = nb ? findCell(nb, message.id)?.cell : undefined;
    if (cell) {
      this.doc.transact(() => {
        if (message.type === "count" || message.type === "done") {
          if (message.count !== null && message.count !== undefined) cell.set("count", message.count);
        } else if (message.type === "output") {
          appendOutput(cell, message.output);
        } else if (message.type === "clear") {
          const outputs = cellOutputs(cell);
          if (outputs.length) outputs.delete(0, outputs.length);
        }
      }, ORIGIN);
    }
    if (message.type !== "done" || message.id !== this.running) return;
    this.running = null;
    if (message.status === "dead") {
      this.queue = [];
      this.state = "dead";
      this.detail = "The kernel stopped (out of memory?). Restart it to go on.";
      this.publish();
      return;
    }
    // A cell that failed stops the ones after it, as Jupyter's Run all does.
    if (message.status === "error") this.queue = [];
    this.next();
  }

  /** The driver ended: shut down, crashed, or the sandbox reset. */
  private ended(): void {
    this.handle = null;
    this.waiting?.settle(new Error("The kernel stopped while starting."));
    this.queue = [];
    if (this.running) this.failRunning("The kernel stopped. Run the cell again to start a new one.");
    if (this.state !== "off") {
      this.state = "off";
      this.detail = "The kernel stopped.";
    }
    this.publish();
    log.info(`notebook ${this.fileId}: kernel ended`);
  }

  private failRunning(evalue: string): void {
    const nb = notebookOf(this.doc, this.fileId);
    const cell = nb && this.running ? findCell(nb, this.running)?.cell : undefined;
    if (cell) this.doc.transact(() => appendOutput(cell, { output_type: "error", ename: "KernelStopped", evalue, traceback: [] }), ORIGIN);
    this.running = null;
  }

  private send(message: Record<string, unknown>): void {
    if (this.handle && !this.handle.stream.destroyed) this.handle.stream.write(`${JSON.stringify(message)}\n`);
  }

  /** What everyone's notebook shows about the kernel. */
  private publish(): void {
    const nb = notebookOf(this.doc, this.fileId);
    if (nb) this.doc.transact(() => setKernel(nb, this.status()), ORIGIN);
  }
}
