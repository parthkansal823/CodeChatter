"use client";

import type { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";

import { usePeers } from "@/components/room/hooks";
import { monaco } from "@/components/room/monaco-setup";
import { useRoom } from "@/components/room/room-context";
import { cssVar } from "@/lib/css-color";

import { modelOwner } from "./file-models";

type Awareness = NonNullable<HocuspocusProvider["awareness"]>;
type Editor = monaco.editor.IStandaloneCodeEditor;

type RemoteState = {
  user?: { slot: number };
  selection?: { anchor?: unknown; head?: unknown };
};

/**
 * Everyone else's selection and caret in this editor, plus a mark on their
 * cursor line in the overview ruler (the scrollbar) and the minimap, in their
 * presence colour. Selections come from awareness as Yjs relative positions
 * (y-monaco's format), so they stay on the right text while others type.
 * Call refresh() after a theme change: Monaco wants colour strings, resolved
 * from the design tokens when the marks are drawn.
 */
export function attachRemoteCursors(editor: Editor, doc: Y.Doc, awareness: Awareness) {
  const collection = editor.createDecorationsCollection();
  let frame = 0;
  let observed: Y.Text | null = null;

  const render = () => {
    frame = 0;
    const model = editor.getModel();
    const owner = modelOwner(model);
    if (!model || !owner) return collection.clear();
    const index = (relative: unknown) => {
      if (!relative) return null;
      const absolute = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(relative), doc);
      return absolute && absolute.type === owner.ytext ? absolute.index : null;
    };
    const colors = new Map<number, string>();
    const decorations: monaco.editor.IModelDeltaDecoration[] = [];
    awareness.getStates().forEach((state, clientId) => {
      const { user, selection } = state as RemoteState;
      if (clientId === awareness.clientID || !user || !selection) return;
      const anchor = index(selection.anchor);
      const head = index(selection.head);
      if (anchor === null || anchor === undefined || head === null || head === undefined) return;
      const start = model.getPositionAt(Math.min(anchor, head));
      const end = model.getPositionAt(Math.max(anchor, head));
      const headClass = `yRemoteSelectionHead yRemoteSelectionHead-${clientId}`;
      const forward = anchor < head;
      decorations.push({
        range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
        options: {
          className: `yRemoteSelection yRemoteSelection-${clientId}`,
          afterContentClassName: forward ? headClass : null,
          beforeContentClassName: forward ? null : headClass,
        },
      });
      let color = colors.get(user.slot);
      if (!color) {
        color = cssVar(`--p-${user.slot}`);
        colors.set(user.slot, color);
      }
      const line = model.getPositionAt(head).lineNumber;
      decorations.push({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          overviewRuler: { color, position: monaco.editor.OverviewRulerLane.Full },
          minimap: { color: `${color}b3`, position: monaco.editor.MinimapPosition.Inline },
        },
      });
    });
    collection.set(decorations);
  };
  const refresh = () => {
    if (!frame) frame = requestAnimationFrame(render);
  };

  // Positions move when the text does, so redraw on edits to the open file as well.
  const watchText = () => {
    observed?.unobserve(refresh);
    observed = modelOwner(editor.getModel())?.ytext ?? null;
    observed?.observe(refresh);
    refresh();
  };
  awareness.on("change", refresh);
  const onModel = editor.onDidChangeModel(watchText);
  watchText();

  return {
    refresh,
    dispose: () => {
      cancelAnimationFrame(frame);
      awareness.off("change", refresh);
      onModel.dispose();
      observed?.unobserve(refresh);
      collection.clear();
    },
  };
}

/**
 * y-monaco tags each remote selection with the peer's awareness clientID.
 * This paints them in that person's presence colour with a name flag.
 */
export function RemoteCursorStyles() {
  const peers = usePeers();
  const { provider } = useRoom();
  const awareness = provider.awareness!;
  const css: string[] = [];
  awareness.getStates().forEach((state, clientId) => {
    const user = (state as { user?: { name: string; slot: number } }).user;
    if (clientId === awareness.clientID || !user) return;
    const name = JSON.stringify(user.name.slice(0, 24));
    css.push(
      `.yRemoteSelection-${clientId}{background:color-mix(in oklch,var(--p-${user.slot}) 22%,transparent)}`,
      `.yRemoteSelectionHead-${clientId}{position:absolute;border-left:2px solid var(--p-${user.slot});height:100%;box-sizing:border-box}`,
      `.yRemoteSelectionHead-${clientId}::after{content:${name};position:absolute;top:-1.35em;left:-2px;padding:0 5px;border-radius:3px 3px 3px 0;background:var(--p-${user.slot}-soft);color:black;font:500 10.5px/15px var(--font-mona),system-ui,sans-serif;white-space:nowrap;pointer-events:none;z-index:10}`,
    );
  });
  // `peers` in the key re-renders this whenever awareness changes.
  return <style key={peers.length}>{css.join("\n")}</style>;
}
