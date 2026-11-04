"use client";

import { createCommentThread, placeOfThread, type CommentThread, type ThreadPlace } from "@codechatter/workspace-model";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { modelOwner } from "@/components/room/editor/file-models";
import { monaco } from "@/components/room/monaco-setup";
import { useRoom } from "@/components/room/room-context";

import { notifyComment, useRoomMembers } from "./notify";
import { isThreadOpen, useCommentThreads, useCommentsUi, useFilePaths } from "./store";
import { DraftCard, ThreadCard } from "./thread-card";
import "./comments.css";

type Editor = monaco.editor.IStandaloneCodeEditor;

/** Start a comment on the editor's selection (its line when nothing is selected). */
export function startCommentAt(editor: Editor | null): boolean {
  const model = editor?.getModel();
  const fileId = modelOwner(model ?? null)?.fileId;
  const selection = editor?.getSelection();
  if (!editor || !model || !fileId || !selection) return false;
  // A selection that ends at the start of a line ends on the line before it.
  const end = selection.getEndPosition();
  const to = end.column === 1 && end.lineNumber > selection.startLineNumber ? model.getOffsetAt({ lineNumber: end.lineNumber - 1, column: model.getLineMaxColumn(end.lineNumber - 1) }) : model.getOffsetAt(end);
  useCommentsUi.getState().startDraft({ fileId, from: model.getOffsetAt(selection.getStartPosition()), to });
  return true;
}

type Card = { key: string; afterLine: number; thread: CommentThread | null; place: ThreadPlace | null };
/** A card's view zone: the object Monaco reads its height from, its id, and its last top. */
type Zone = { id: string; zone: monaco.editor.IViewZone; top: number };
/** Space above and below a card. */
const GAP = 8;

/**
 * The room's comment threads in one code editor: their code tinted, a mark beside the
 * line numbers (click it to open or fold the line's threads), and each open thread under
 * its code. A view zone makes room under the line; the thread's card sits over the editor
 * in that space (placed where Monaco says the zone is), so what you type in it is never
 * the editor's.
 */
export function EditorComments({ editor, fileId }: { editor: Editor | null; fileId: string | null }) {
  const { room, doc, comments, me, can } = useRoom();
  const threads = useCommentThreads();
  const members = useRoomMembers();
  const paths = useFilePaths();
  const open = useCommentsUi((state) => state.open);
  const draft = useCommentsUi((state) => state.draft);
  const focus = useCommentsUi((state) => state.focus);
  const [edits, setEdits] = useState(0);
  const [layout, setLayout] = useState<{ left: number; width: number } | null>(null);
  const cardsRef = useRef(new Map<string, HTMLDivElement>());
  const zones = useRef(new Map<string, Zone>());
  const canComment = can("room.chat");

  // Places follow the code: worked out again a moment after each edit.
  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setEdits((n) => n + 1), 120);
    };
    const listeners = [editor.onDidChangeModelContent(bump), editor.onDidChangeModel(bump)];
    const measure = () => {
      const info = editor.getLayoutInfo();
      setLayout({ left: info.contentLeft + 8, width: Math.max(240, Math.min(720, info.contentWidth - info.verticalScrollbarWidth - 32)) });
    };
    measure();
    listeners.push(editor.onDidLayoutChange(measure));
    return () => {
      clearTimeout(timer);
      listeners.forEach((listener) => listener.dispose());
    };
  }, [editor]);

  const mine = useMemo(() => threads.filter((thread) => thread.fileId === fileId), [threads, fileId]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- edits is the change signal
  const places = useMemo(() => new Map(mine.map((thread) => [thread.id, placeOfThread(doc, thread)])), [mine, doc, edits]);
  const draftLine = useMemo(() => {
    if (!draft || draft.fileId !== fileId) return null;
    const model = editor?.getModel();
    return model ? model.getPositionAt(Math.max(draft.from, draft.to)).lineNumber : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- edits is the change signal
  }, [draft, fileId, editor, edits]);

  const cards = useMemo((): Card[] => {
    const out: Card[] = mine
      .filter((thread) => isThreadOpen(thread, open) && places.get(thread.id))
      .map((thread) => ({ key: thread.id, afterLine: places.get(thread.id)!.endLine, thread, place: places.get(thread.id)! }));
    if (draftLine !== null) out.push({ key: "draft", afterLine: draftLine, thread: null, place: null });
    return out;
  }, [mine, open, places, draftLine]);

  // The code tinted, and a mark on each thread's first line.
  useEffect(() => {
    const model = editor?.getModel();
    if (!editor || !model) return;
    const byLine = new Map<number, boolean>();
    const decorations: monaco.editor.IModelDeltaDecoration[] = [];
    for (const thread of mine) {
      const place = places.get(thread.id);
      if (!place) continue;
      byLine.set(place.startLine, (byLine.get(place.startLine) ?? true) && thread.resolved);
      if (!thread.resolved && !place.outdated && place.to > place.from) {
        const start = model.getPositionAt(place.from);
        const end = model.getPositionAt(place.to);
        decorations.push({
          range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
          options: { className: "cc-comment-range", stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges },
        });
      }
    }
    for (const [line, allResolved] of byLine) {
      decorations.push({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          linesDecorationsClassName: `cc-comment-glyph${allResolved ? " cc-comment-resolved" : ""}`,
          linesDecorationsTooltip: "Comments: click to open or fold",
        },
      });
    }
    const collection = editor.createDecorationsCollection(decorations);
    return () => collection.clear();
  }, [editor, mine, places]);

  // A click on a mark opens the line's threads, or folds them when they're open.
  useEffect(() => {
    if (!editor) return;
    const listener = editor.onMouseDown((event) => {
      if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS) return;
      if (!event.target.element?.classList.contains("cc-comment-glyph")) return;
      const line = event.target.position?.lineNumber;
      const here = mine.filter((thread) => places.get(thread.id)?.startLine === line);
      const ui = useCommentsUi.getState();
      const anyOpen = here.some((thread) => isThreadOpen(thread, ui.open));
      for (const thread of here) ui.setOpen(thread.id, !anyOpen);
    });
    return () => listener.dispose();
  }, [editor, mine, places]);

  // A zone under each card's line, as tall as the card; Monaco says where it is as you scroll.
  useEffect(() => {
    if (!editor) return;
    const wanted = new Map(cards.map((card) => [card.key, card]));
    editor.changeViewZones((accessor) => {
      for (const [key, kept] of zones.current) {
        if (wanted.get(key)?.afterLine === kept.zone.afterLineNumber) continue;
        accessor.removeZone(kept.id);
        zones.current.delete(key);
      }
      for (const card of cards) {
        if (zones.current.has(card.key)) continue;
        const kept: Zone = {
          id: "",
          top: -1e6,
          zone: {
            afterLineNumber: card.afterLine,
            heightInPx: (cardsRef.current.get(card.key)?.offsetHeight ?? 96) + GAP,
            domNode: document.createElement("div"),
            onDomNodeTop: (top) => {
              kept.top = top;
              const element = cardsRef.current.get(card.key);
              if (element) element.style.top = `${top + GAP / 2}px`;
            },
          },
        };
        kept.id = accessor.addZone(kept.zone);
        zones.current.set(card.key, kept);
      }
    });
  }, [editor, cards]);

  // Each zone keeps the height of its card (Monaco reads it again on layoutZone).
  useEffect(() => {
    if (!editor) return;
    const observer = new ResizeObserver(() => {
      const changed: Zone[] = [];
      for (const [key, element] of cardsRef.current) {
        const kept = zones.current.get(key);
        if (kept && element.offsetHeight && element.offsetHeight + GAP !== kept.zone.heightInPx) {
          kept.zone.heightInPx = element.offsetHeight + GAP;
          changed.push(kept);
        }
      }
      if (changed.length) editor.changeViewZones((accessor) => changed.forEach((kept) => accessor.layoutZone(kept.id)));
    });
    for (const element of cardsRef.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [editor, cards]);

  // Leaving the file (or the editor) takes its zones away.
  useEffect(
    () => () => {
      const kept = zones.current;
      editor?.changeViewZones((accessor) => kept.forEach((zone) => accessor.removeZone(zone.id)));
      kept.clear();
    },
    [editor, fileId],
  );

  // The Comments view asked for a thread in this file: bring it into view.
  useEffect(() => {
    if (!editor || !focus) return;
    const place = places.get(focus);
    if (!place) return;
    editor.revealLineInCenterIfOutsideViewport(place.endLine);
    useCommentsUi.getState().focusThread(null);
  }, [editor, focus, places]);

  // "Add a comment" in the editor's menu.
  useEffect(() => {
    if (!editor || !canComment) return;
    const action = editor.addAction({
      id: "cc.comment.add",
      label: "Add a comment",
      contextMenuGroupId: "navigation",
      contextMenuOrder: 99,
      run: () => void startCommentAt(editor),
    });
    return () => action.dispose();
  }, [editor, canComment]);

  if (!layout || !cards.length) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {cards.map((card) => (
        <div
          key={card.key}
          ref={(element) => {
            if (element) {
              cardsRef.current.set(card.key, element);
              const top = zones.current.get(card.key)?.top;
              if (top !== undefined) element.style.top = `${top + GAP / 2}px`;
            } else cardsRef.current.delete(card.key);
          }}
          className="pointer-events-auto absolute"
          style={{ left: layout.left, width: layout.width, top: -10_000 }}
        >
          {card.thread ? (
            <ThreadCard thread={card.thread} place={card.place} onFold={() => useCommentsUi.getState().setOpen(card.thread!.id, false)} />
          ) : (
            <DraftCard
              line={card.afterLine}
              onCancel={() => useCommentsUi.getState().cancelDraft()}
              onSubmit={(text) => {
                const current = useCommentsUi.getState().draft;
                if (!current) return false;
                const id = createCommentThread(comments, doc, { ...current, by: { id: me.user.id, name: me.user.name }, text });
                if (!id) {
                  toast.error("The file is gone, so the comment couldn't be added.");
                  return false;
                }
                useCommentsUi.getState().cancelDraft();
                useCommentsUi.getState().setOpen(id, true);
                // Anyone it mentions by name hears of it.
                const path = paths.get(current.fileId);
                if (path) notifyComment(room.id, { kind: "new", thread: null, threadId: id, text, path, line: card.afterLine }, members, me.user.id);
                return true;
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}
