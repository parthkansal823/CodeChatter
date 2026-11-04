"use client";

import { useEffect, useMemo, useRef } from "react";
import * as Y from "yjs";

import { usePeers, type Peer } from "@/components/room/hooks";
import { monaco } from "@/components/room/monaco-setup";
import { useRoom } from "@/components/room/room-context";

import { getPrimaryEditor } from "./active-editor";
import { modelOwner } from "./file-models";
import { useEditorUi } from "./ui-store";

type Viewport = { fileId: string; top: unknown };
type TheirState = { user?: { id: string }; activeFileId?: string | null; viewport?: Viewport | null };

/**
 * Present mode and following. Presenting puts a time in your presence; everyone else then
 * follows you: your file opens for them and their editor keeps your scroll (the first line
 * you see, which wire-editor.ts publishes). Someone who stops following isn't pulled back in
 * by the same presentation, and when it ends they stop following. The newest presentation
 * wins when two people present. Returns who's presenting (not you) and who follows you.
 */
export function usePresentMode(): { presenter: Peer | null; followers: Peer[]; presentationKey: string | null } {
  const { provider, doc, me } = useRoom();
  const peers = usePeers();
  const presenting = useEditorUi((state) => state.presenting);
  const following = useEditorUi((state) => state.following);
  const optOut = useEditorUi((state) => state.presentOptOut);

  // Tell the room.
  useEffect(() => provider.setAwarenessField("presenting", presenting), [provider, presenting]);
  useEffect(() => provider.setAwarenessField("following", following), [provider, following]);

  const presenter = useMemo(
    () => (presenting ? null : (peers.filter((peer) => peer.presenting).sort((a, b) => b.presenting! - a.presenting!)[0] ?? null)),
    [peers, presenting],
  );
  const presentationKey = presenter ? `${presenter.user.id}:${presenter.presenting}` : null;
  const followers = useMemo(() => peers.filter((peer) => peer.following === me.user.id), [peers, me.user.id]);

  // A new presentation pulls you in (unless you chose not to follow it); its end lets you go.
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    const previous = lastKey.current;
    lastKey.current = presentationKey;
    if (presentationKey === previous) return;
    const ui = useEditorUi.getState();
    if (presenter && presentationKey !== optOut) ui.follow(presenter.user.id);
    else if (!presenter && previous && ui.following === previous.slice(0, previous.lastIndexOf(":"))) ui.follow(null);
  }, [presentationKey, presenter, optOut]);

  // Following someone: keep their scroll in the main editor while it shows their file.
  useEffect(() => {
    if (!following) return;
    const awareness = provider.awareness!;
    const apply = () => {
      const editor = getPrimaryEditor();
      const model = editor?.getModel();
      const owner = modelOwner(model ?? null);
      if (!editor || !model || !owner) return;
      let viewport: Viewport | null = null;
      awareness.getStates().forEach((state) => {
        const theirs = state as TheirState;
        // Of their tabs, the one in the file they're in.
        if (theirs.user?.id === following && theirs.viewport && theirs.viewport.fileId === theirs.activeFileId) viewport = theirs.viewport;
      });
      const wanted = viewport as Viewport | null;
      if (!wanted || wanted.fileId !== owner.fileId) return;
      let position: Y.AbsolutePosition | null = null;
      try {
        position = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(wanted.top), doc);
      } catch {
        return;
      }
      if (!position || position.type !== owner.ytext) return;
      const line = model.getPositionAt(position.index).lineNumber;
      if (editor.getVisibleRanges()[0]?.startLineNumber === line) return;
      editor.setScrollTop(editor.getTopForLineNumber(line), monaco.editor.ScrollType.Smooth);
    };
    awareness.on("change", apply);
    // Their file opening here restores the place you left it; theirs wins just after.
    const opened = getPrimaryEditor()?.onDidChangeModel(() => setTimeout(apply, 60));
    apply();
    return () => {
      awareness.off("change", apply);
      opened?.dispose();
    };
  }, [following, provider, doc]);

  return { presenter, followers, presentationKey };
}
