"use client";

import type { HocuspocusProvider } from "@hocuspocus/provider";
import type * as Y from "yjs";

import { slotFor, type PresenceSlot } from "@/components/presence/presence";

import { Atom } from "./atom";
import { Editor, type Camera } from "./editor";
import type { Point } from "./geometry";
import { Interaction } from "./interaction";
import { measureText } from "./measure";
import type { CanvasKind } from "./shape";

export type PeerUser = { id: string; name: string; slot: PresenceSlot; image: string | null };

/** Another person on this canvas, from awareness. */
export type CanvasPeer = {
  clientId: number;
  user: PeerUser;
  /** Canvas coordinates, or null when their pointer is off the canvas. */
  cursor: Point | null;
  selection: string[];
};

type AwarenessChange = { added: number[]; updated: number[]; removed: number[] };

/** Where you were looking in each canvas, so reopening one returns there (this page session only). */
const cameras = new Map<string, Camera>();

/**
 * One open canvas: the editor plus presence. Your cursor and selection go out
 * through awareness (cursor moves at most once a frame); everyone else's come
 * back as `peers`. Changes that only touch your own state don't re-render.
 */
export class CanvasSession {
  readonly editor: Editor;
  readonly interaction: Interaction;
  readonly peers = new Atom<CanvasPeer[]>([]);
  private readonly provider: HocuspocusProvider;
  private pendingCursor: Point | null | undefined;
  private frame = 0;
  private cleanups: Array<() => void> = [];
  private readonly key: string;
  private placed = false;

  constructor(doc: Y.Doc, provider: HocuspocusProvider, kind: CanvasKind, me: { id: string; name: string; image: string | null }) {
    this.provider = provider;
    this.key = provider.configuration.name;
    this.editor = new Editor(doc, kind, measureText);
    this.interaction = new Interaction(this.editor);
    provider.setAwarenessField("user", { id: me.id, name: me.name, slot: slotFor(me.id), image: me.image });
    provider.setAwarenessField("cursor", null);
    provider.setAwarenessField("selection", []);
    const awareness = provider.awareness;
    if (awareness) {
      const onChange = ({ added, updated, removed }: AwarenessChange) => {
        const own = awareness.clientID;
        if ([...added, ...updated, ...removed].every((id) => id === own)) return;
        this.readPeers();
      };
      awareness.on("change", onChange);
      this.cleanups.push(() => awareness.off("change", onChange));
      this.readPeers();
    }
    this.cleanups.push(this.editor.selection.subscribe(() => provider.setAwarenessField("selection", [...this.editor.selection.get()])));
  }

  private readPeers() {
    const awareness = this.provider.awareness;
    if (!awareness) return;
    const peers: CanvasPeer[] = [];
    awareness.getStates().forEach((state, clientId) => {
      if (clientId === awareness.clientID) return;
      const s = state as { user?: PeerUser; cursor?: Point | null; selection?: string[] };
      if (!s.user) return;
      peers.push({
        clientId,
        user: s.user,
        cursor: s.cursor && typeof s.cursor.x === "number" ? s.cursor : null,
        selection: Array.isArray(s.selection) ? s.selection : [],
      });
    });
    this.peers.set(peers);
  }

  /** Share where your pointer is (canvas coordinates), at most once per animation frame. */
  setCursor(point: Point | null) {
    this.pendingCursor = point;
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.pendingCursor === undefined) return;
      const p = this.pendingCursor;
      this.provider.setAwarenessField("cursor", p ? { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 } : null);
      this.pendingCursor = undefined;
    });
  }

  /** First view once the canvas knows its size: where you left it, or everything in view. */
  placeCamera() {
    if (this.placed || this.editor.viewport.get().w === 0) return;
    this.placed = true;
    const saved = cameras.get(this.key);
    if (saved) this.editor.camera.set(saved);
    else this.editor.zoomToFit();
  }

  destroy() {
    if (this.placed) cameras.set(this.key, this.editor.camera.get());
    this.provider.setAwarenessField("cursor", null);
    cancelAnimationFrame(this.frame);
    this.cleanups.forEach((cleanup) => cleanup());
    this.editor.destroy();
  }
}
