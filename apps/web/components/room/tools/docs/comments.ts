import { randomId } from "@codechatter/workspace-model";
import type { Editor } from "@tiptap/react";
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import * as Y from "yjs";

/**
 * Comment threads live in the page's own document, next to its text:
 *
 *   comments: Y.Map<threadId, Y.Map{ quote, by, at, resolved, messages: Y.Array<Message> }>
 *
 * The words a thread is about carry a `comment` mark with the thread id, so
 * the anchor follows edits. Messages are appended to a Y.Array, so two people
 * replying at once both keep their reply.
 */
export type Author = { id: string; name: string };
export type Message = { id: string; by: Author; at: number; text: string };
export type Thread = { id: string; quote: string; by: Author; at: number; resolved: boolean; messages: Message[] };

const ORIGIN = "docs-comments";
const threadsMap = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>("comments");

function readThread(id: string, entry: Y.Map<unknown>): Thread {
  const by = entry.get("by") as Author | undefined;
  const messages = entry.get("messages");
  return {
    id,
    quote: typeof entry.get("quote") === "string" ? (entry.get("quote") as string) : "",
    by: by && typeof by.id === "string" ? by : { id: "", name: "Someone" },
    at: typeof entry.get("at") === "number" ? (entry.get("at") as number) : 0,
    resolved: entry.get("resolved") === true,
    messages: messages instanceof Y.Array ? (messages.toArray() as Message[]) : [],
  };
}

export function allThreads(doc: Y.Doc): Thread[] {
  const out: Thread[] = [];
  threadsMap(doc).forEach((entry, id) => entry instanceof Y.Map && out.push(readThread(id, entry)));
  return out.sort((a, b) => a.at - b.at);
}

/** A thread with no messages yet is a comment being written; only its author sees it. */
export function createThread(doc: Y.Doc, input: { id?: string; quote: string; by: Author }): string {
  const id = input.id ?? randomId();
  doc.transact(() => {
    const entry = new Y.Map<unknown>();
    entry.set("quote", input.quote.slice(0, 280));
    entry.set("by", input.by);
    entry.set("at", Date.now());
    entry.set("resolved", false);
    entry.set("messages", new Y.Array<Message>());
    threadsMap(doc).set(id, entry);
  }, ORIGIN);
  return id;
}

export function addMessage(doc: Y.Doc, threadId: string, by: Author, text: string): void {
  const messages = threadsMap(doc).get(threadId)?.get("messages");
  if (messages instanceof Y.Array && text.trim()) messages.push([{ id: randomId(), by, at: Date.now(), text: text.trim() }]);
}

export function setResolved(doc: Y.Doc, threadId: string, resolved: boolean): void {
  threadsMap(doc).get(threadId)?.set("resolved", resolved);
}

export const deleteThread = (doc: Y.Doc, threadId: string) => threadsMap(doc).delete(threadId);

/** Live threads of a page document (empty until it's open). */
export function useThreads(doc: Y.Doc | null): Thread[] {
  const version = useRef(0);
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!doc) return () => {};
      const map = threadsMap(doc);
      const handler = () => {
        version.current += 1;
        onChange();
      };
      map.observeDeep(handler);
      return () => map.unobserveDeep(handler);
    },
    [doc],
  );
  const tick = useSyncExternalStore(subscribe, () => version.current, () => 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (doc ? allThreads(doc) : []), [doc, tick]);
}

/** Where a thread's marked text sits in the editor (first to last character), or null if the text is gone. */
export function threadRange(editor: Editor, threadId: string): { from: number; to: number } | null {
  let from = -1;
  let to = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.marks.some((mark) => mark.type.name === "comment" && mark.attrs.threadId === threadId)) {
      if (from < 0) from = pos;
      to = pos + node.nodeSize;
    }
  });
  return from < 0 ? null : { from, to };
}

/** Take a thread's highlight off the text. */
export function clearThreadMarks(editor: Editor, threadId: string): void {
  const type = editor.state.schema.marks.comment;
  if (!type) return;
  const { tr } = editor.state;
  editor.state.doc.descendants((node, pos) => {
    if (node.marks.some((mark) => mark.type === type && mark.attrs.threadId === threadId)) {
      tr.removeMark(pos, pos + node.nodeSize, type.create({ threadId }));
    }
  });
  if (tr.docChanged) editor.view.dispatch(tr);
}
