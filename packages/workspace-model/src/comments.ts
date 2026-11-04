import * as Y from "yjs";

import { randomId, textOf } from "./model.js";

/**
 * Comment threads on code (the editor's inline threads and the Comments view), in a
 * document of their own, `room:ID:comments`, which anyone who can chat in the room may
 * write; the code they're about stays in the files document:
 *
 *   threads: Y.Map<threadId, Y.Map{ fileId, start, end, line, quote, by, at,
 *                                     resolved, resolvedBy, messages: Y.Array<Message> }>
 *
 * `start` and `end` are Yjs relative positions into the file's text in the files
 * document, so a thread stays on its code while people edit around it. `quote` is the
 * code it was made on (to tell when that code has changed since) and `line` where it was,
 * for when the code is gone. Messages are appended, so two replies at once both stay.
 */
export type CommentAuthor = { id: string; name: string };
export type CommentMessage = { id: string; by: CommentAuthor; at: number; text: string; edited?: number };
export type CommentThread = {
  id: string;
  fileId: string;
  start: unknown;
  end: unknown;
  line: number;
  quote: string;
  by: CommentAuthor;
  at: number;
  resolved: boolean;
  resolvedBy: CommentAuthor | null;
  messages: CommentMessage[];
};

/** Where a thread's code is now: offsets and 1-based lines in the file's text. */
export type ThreadPlace = { from: number; to: number; startLine: number; endLine: number; outdated: boolean };

export const MAX_COMMENT_LENGTH = 4000;
const MAX_QUOTE = 2000;
const ORIGIN = "code-comments";

export const commentThreadsMap = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>("threads");

const isAuthor = (value: unknown): value is CommentAuthor =>
  Boolean(value) && typeof (value as CommentAuthor).id === "string" && typeof (value as CommentAuthor).name === "string";

function readThread(id: string, entry: Y.Map<unknown>): CommentThread | null {
  const fileId = entry.get("fileId");
  const messages = entry.get("messages");
  if (typeof fileId !== "string" || !(messages instanceof Y.Array)) return null;
  const by = entry.get("by");
  const resolvedBy = entry.get("resolvedBy");
  return {
    id,
    fileId,
    start: entry.get("start"),
    end: entry.get("end"),
    line: typeof entry.get("line") === "number" ? (entry.get("line") as number) : 1,
    quote: typeof entry.get("quote") === "string" ? (entry.get("quote") as string) : "",
    by: isAuthor(by) ? by : { id: "", name: "Someone" },
    at: typeof entry.get("at") === "number" ? (entry.get("at") as number) : 0,
    resolved: entry.get("resolved") === true,
    resolvedBy: isAuthor(resolvedBy) ? resolvedBy : null,
    messages: (messages.toArray() as CommentMessage[]).filter((m) => m && typeof m.id === "string" && typeof m.text === "string" && isAuthor(m.by)),
  };
}

/** Every thread in the room, oldest first; one with no messages left isn't a thread. */
export function allCommentThreads(doc: Y.Doc): CommentThread[] {
  const out: CommentThread[] = [];
  commentThreadsMap(doc).forEach((entry, id) => {
    const thread = entry instanceof Y.Map ? readThread(id, entry) : null;
    if (thread && thread.messages.length) out.push(thread);
  });
  return out.sort((a, b) => a.at - b.at);
}

/** The 1-based line holding `index`. */
function lineAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}

/** The whole line around `index`, without its line break. */
function lineAround(content: string, index: number): { from: number; to: number } {
  const from = content.lastIndexOf("\n", index - 1) + 1;
  const next = content.indexOf("\n", index);
  return { from, to: next === -1 ? content.length : next };
}

/**
 * Start a thread on a file's code from `from` to `to` (offsets in its text; an empty range
 * means its whole line), with its first message. Null when the file or the message isn't there.
 */
export function createCommentThread(
  comments: Y.Doc,
  files: Y.Doc,
  input: { fileId: string; from: number; to: number; by: CommentAuthor; text: string; id?: string },
): string | null {
  const ytext = textOf(files, input.fileId);
  const text = input.text.trim().slice(0, MAX_COMMENT_LENGTH);
  if (!ytext || !text) return null;
  const content = ytext.toString();
  let from = Math.max(0, Math.min(input.from, content.length));
  let to = Math.max(from, Math.min(input.to, content.length));
  if (from === to) ({ from, to } = lineAround(content, from));
  // The end keeps to the code before it, so typing just after the code doesn't join the thread.
  const start = Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, from, 0));
  const end = Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, to, -1));
  const id = input.id ?? randomId();
  const now = Date.now();
  comments.transact(() => {
    const entry = new Y.Map<unknown>();
    entry.set("fileId", input.fileId);
    entry.set("start", start);
    entry.set("end", end);
    entry.set("line", lineAt(content, from));
    entry.set("quote", content.slice(from, to).slice(0, MAX_QUOTE));
    entry.set("by", input.by);
    entry.set("at", now);
    entry.set("resolved", false);
    const messages = new Y.Array<CommentMessage>();
    messages.push([{ id: randomId(), by: input.by, at: now, text }]);
    entry.set("messages", messages);
    commentThreadsMap(comments).set(id, entry);
  }, ORIGIN);
  return id;
}

/** Where a thread's code is now in its file; null when the file is gone. */
export function placeOfThread(files: Y.Doc, thread: Pick<CommentThread, "fileId" | "start" | "end" | "line" | "quote">): ThreadPlace | null {
  const ytext = textOf(files, thread.fileId);
  if (!ytext) return null;
  const content = ytext.toString();
  const resolve = (json: unknown) => {
    try {
      const position = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(json), files);
      return position && position.type === ytext ? position.index : null;
    } catch {
      return null;
    }
  };
  const start = resolve(thread.start);
  const end = resolve(thread.end);
  if (start === null || end === null) {
    // Positions this document can't place: the line it was made on, as far as the file goes.
    const lines = content.split("\n").length;
    const line = Math.min(thread.line, lines);
    return { from: 0, to: 0, startLine: line, endLine: line, outdated: true };
  }
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  return { from, to, startLine: lineAt(content, from), endLine: lineAt(content, Math.max(from, to - 1)), outdated: content.slice(from, to) !== thread.quote };
}

function entryOf(doc: Y.Doc, threadId: string): { entry: Y.Map<unknown>; messages: Y.Array<CommentMessage> } | null {
  const entry = commentThreadsMap(doc).get(threadId);
  const messages = entry instanceof Y.Map ? entry.get("messages") : null;
  return entry instanceof Y.Map && messages instanceof Y.Array ? { entry, messages: messages as Y.Array<CommentMessage> } : null;
}

/** Add a reply; null when the thread is gone or the reply is empty. */
export function replyToThread(doc: Y.Doc, threadId: string, by: CommentAuthor, text: string): string | null {
  const found = entryOf(doc, threadId);
  const body = text.trim().slice(0, MAX_COMMENT_LENGTH);
  if (!found || !body) return null;
  const id = randomId();
  doc.transact(() => {
    found.messages.push([{ id, by, at: Date.now(), text: body }]);
    // Replying to a resolved thread opens it again.
    if (found.entry.get("resolved") === true) {
      found.entry.set("resolved", false);
      found.entry.delete("resolvedBy");
    }
  }, ORIGIN);
  return id;
}

export function setThreadResolved(doc: Y.Doc, threadId: string, resolved: boolean, by: CommentAuthor): boolean {
  const found = entryOf(doc, threadId);
  if (!found) return false;
  doc.transact(() => {
    found.entry.set("resolved", resolved);
    if (resolved) found.entry.set("resolvedBy", by);
    else found.entry.delete("resolvedBy");
  }, ORIGIN);
  return true;
}

/** Change your own message's text. */
export function editCommentMessage(doc: Y.Doc, threadId: string, messageId: string, byId: string, text: string): boolean {
  const found = entryOf(doc, threadId);
  const body = text.trim().slice(0, MAX_COMMENT_LENGTH);
  if (!found || !body) return false;
  const index = found.messages.toArray().findIndex((m) => m.id === messageId);
  const message = found.messages.get(index);
  if (index === -1 || message?.by.id !== byId) return false;
  doc.transact(() => {
    found.messages.delete(index, 1);
    found.messages.insert(index, [{ ...message, text: body, edited: Date.now() }]);
  }, ORIGIN);
  return true;
}

/** Delete your own message; a thread whose last message goes is deleted with it. */
export function deleteCommentMessage(doc: Y.Doc, threadId: string, messageId: string, byId: string): boolean {
  const found = entryOf(doc, threadId);
  if (!found) return false;
  const index = found.messages.toArray().findIndex((m) => m.id === messageId);
  if (index === -1 || found.messages.get(index)?.by.id !== byId) return false;
  doc.transact(() => {
    found.messages.delete(index, 1);
    if (found.messages.length === 0) commentThreadsMap(doc).delete(threadId);
  }, ORIGIN);
  return true;
}

/** Take a whole thread away (one on a file that's gone: the Comments view offers it there). */
export function deleteCommentThread(doc: Y.Doc, threadId: string): boolean {
  if (!commentThreadsMap(doc).has(threadId)) return false;
  doc.transact(() => commentThreadsMap(doc).delete(threadId), ORIGIN);
  return true;
}
