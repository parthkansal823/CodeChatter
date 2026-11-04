import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  allCommentThreads,
  createCommentThread,
  deleteCommentMessage,
  deleteCommentThread,
  editCommentMessage,
  placeOfThread,
  replyToThread,
  setThreadResolved,
} from "./comments.js";
import { createFile, textOf } from "./model.js";

const ana = { id: "u1", name: "Ana" };
const ben = { id: "u2", name: "Ben" };

function room(content: string) {
  const files = new Y.Doc();
  const fileId = createFile(files, { name: "app.py", content });
  return { files, fileId, text: textOf(files, fileId)!, comments: new Y.Doc() };
}
/** Sync two copies of a document both ways. */
function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
}

describe("comment threads", () => {
  it("start on a range of code, with the first message", () => {
    const { files, fileId, comments } = room("a = 1\nb = compute(a)\nprint(b)\n");
    const from = "a = 1\nb = ".length;
    const id = createCommentThread(comments, files, { fileId, from, to: from + "compute(a)".length, by: ana, text: "  Why not cache this? " })!;
    const [thread] = allCommentThreads(comments);
    expect(thread).toMatchObject({ id, fileId, line: 2, quote: "compute(a)", by: ana, resolved: false });
    expect(thread!.messages.map((m) => m.text)).toEqual(["Why not cache this?"]);
    expect(placeOfThread(files, thread!)).toEqual({ from, to: from + 10, startLine: 2, endLine: 2, outdated: false });
  });

  it("an empty range is its whole line; nothing is made without a file or a message", () => {
    const { files, fileId, comments } = room("one\ntwo\nthree");
    createCommentThread(comments, files, { fileId, from: 5, to: 5, by: ana, text: "here" });
    expect(allCommentThreads(comments)[0]).toMatchObject({ line: 2, quote: "two" });
    expect(createCommentThread(comments, files, { fileId: "gone", from: 0, to: 1, by: ana, text: "x" })).toBeNull();
    expect(createCommentThread(comments, files, { fileId, from: 0, to: 1, by: ana, text: "   " })).toBeNull();
  });

  it("stay on their code while people edit around it, and know when it changed", () => {
    const { files, fileId, text, comments } = room("def f():\n    return 1\n");
    createCommentThread(comments, files, { fileId, from: 13, to: 21, by: ana, text: "magic number" });
    text.insert(0, "import os\n\n");
    text.insert(text.length, "\nf()\n");
    const place = placeOfThread(files, allCommentThreads(comments)[0]!)!;
    expect(place).toMatchObject({ startLine: 4, endLine: 4, outdated: false });
    expect(text.toString().slice(place.from, place.to)).toBe("return 1");
    // Typing right after the code doesn't join it; changing the code marks it.
    text.insert(place.to, "  # one");
    expect(placeOfThread(files, allCommentThreads(comments)[0]!)).toMatchObject({ to: place.to, outdated: false });
    text.delete(place.to - 1, 1);
    text.insert(place.to - 1, "2");
    expect(placeOfThread(files, allCommentThreads(comments)[0]!)?.outdated).toBe(true);
  });

  it("keep their line when the code is deleted, and have no place when the file is", () => {
    const { files, fileId, text, comments } = room("a\nb\nc\n");
    createCommentThread(comments, files, { fileId, from: 2, to: 3, by: ana, text: "b?" });
    text.delete(2, 2);
    expect(placeOfThread(files, allCommentThreads(comments)[0]!)).toMatchObject({ startLine: 2, outdated: true });
    expect(placeOfThread(new Y.Doc(), allCommentThreads(comments)[0]!)).toBeNull();
  });

  it("take replies from two people at once, and a reply opens a resolved thread", () => {
    const { files, fileId, comments } = room("x = 1\n");
    const id = createCommentThread(comments, files, { fileId, from: 0, to: 5, by: ana, text: "rename x" })!;
    const other = new Y.Doc();
    sync(comments, other);
    replyToThread(comments, id, ana, "to count");
    replyToThread(other, id, ben, "agreed");
    sync(comments, other);
    expect(allCommentThreads(other)[0]!.messages.map((m) => m.text).sort()).toEqual(["agreed", "rename x", "to count"]);
    setThreadResolved(comments, id, true, ben);
    expect(allCommentThreads(comments)[0]).toMatchObject({ resolved: true, resolvedBy: ben });
    replyToThread(comments, id, ana, "one more thing");
    expect(allCommentThreads(comments)[0]).toMatchObject({ resolved: false, resolvedBy: null });
  });

  it("let people edit and delete only their own messages; the last one takes the thread", () => {
    const { files, fileId, comments } = room("x = 1\n");
    const id = createCommentThread(comments, files, { fileId, from: 0, to: 5, by: ana, text: "first" })!;
    const reply = replyToThread(comments, id, ben, "second")!;
    expect(editCommentMessage(comments, id, reply, ana.id, "hijacked")).toBe(false);
    expect(editCommentMessage(comments, id, reply, ben.id, "second, edited")).toBe(true);
    const messages = allCommentThreads(comments)[0]!.messages;
    expect(messages[1]).toMatchObject({ text: "second, edited", by: ben });
    expect(messages[1]!.edited).toBeTypeOf("number");
    expect(deleteCommentMessage(comments, id, reply, ana.id)).toBe(false);
    expect(deleteCommentMessage(comments, id, reply, ben.id)).toBe(true);
    expect(deleteCommentMessage(comments, id, messages[0]!.id, ana.id)).toBe(true);
    expect(allCommentThreads(comments)).toEqual([]);
  });

  it("can be taken away whole", () => {
    const { files, fileId, comments } = room("x = 1\n");
    const id = createCommentThread(comments, files, { fileId, from: 0, to: 5, by: ana, text: "on a file that goes" })!;
    expect(deleteCommentThread(comments, id)).toBe(true);
    expect(deleteCommentThread(comments, id)).toBe(false);
    expect(allCommentThreads(comments)).toEqual([]);
  });
});
