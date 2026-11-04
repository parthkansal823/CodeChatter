"use client";

import {
  deleteCommentMessage,
  editCommentMessage,
  MAX_COMMENT_LENGTH,
  replyToThread,
  setThreadResolved,
  type CommentMessage,
  type CommentThread,
  type ThreadPlace,
} from "@codechatter/workspace-model";
import { Check, ChevronUp, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";

import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { notifyComment, useRoomMembers } from "./notify";
import { useFilePaths } from "./store";

const lines = (place: ThreadPlace | null, line: number) =>
  place && place.endLine > place.startLine ? `Lines ${place.startLine}–${place.endLine}` : `Line ${place?.startLine ?? line}`;

/**
 * A comment thread under its code in the editor: the messages, a reply box (Ctrl+Enter
 * sends), and Resolve. You can edit or delete your own messages. It sits over the editor,
 * not inside it, so typing here never reaches the code (data-own-run-key keeps Ctrl+Enter).
 */
export function ThreadCard({ thread, place, onFold }: { thread: CommentThread; place: ThreadPlace | null; onFold: () => void }) {
  const { room, comments, me, can } = useRoom();
  const canWrite = can("room.chat");
  const author = { id: me.user.id, name: me.user.name };
  const members = useRoomMembers();
  const path = useFilePaths().get(thread.fileId) ?? "";
  return (
    <div
      role="group"
      aria-label={`Comment thread on ${lines(place, thread.line).toLowerCase()}`}
      data-own-run-key
      className={cn("grid gap-2 rounded-md border bg-popover p-2 text-xs text-popover-foreground shadow-sm", thread.resolved && "opacity-80")}
    >
      <div className="flex items-center gap-1">
        <span className="font-medium">{lines(place, thread.line)}</span>
        {place?.outdated && <span className="text-muted-foreground">· the code changed since</span>}
        {thread.resolved && <span className="text-muted-foreground">· resolved{thread.resolvedBy && ` by ${thread.resolvedBy.name}`}</span>}
        <div className="ml-auto flex items-center">
          {canWrite && (
            <Button
              variant="ghost"
              size="xs"
              className="h-6 text-xs"
              onClick={() => setThreadResolved(comments, thread.id, !thread.resolved, author)}
            >
              {thread.resolved ? <RotateCcw className="size-3.5" /> : <Check className="size-3.5" />}
              {thread.resolved ? "Reopen" : "Resolve"}
            </Button>
          )}
          <Button variant="ghost" size="icon-xs" aria-label="Fold the thread" title="Fold (the mark beside the line opens it again)" onClick={onFold}>
            <ChevronUp />
          </Button>
        </div>
      </div>
      <ul aria-label="Messages" className="grid gap-2">
        {thread.messages.map((message) => (
          <MessageItem key={message.id} thread={thread} message={message} mine={message.by.id === me.user.id && canWrite} />
        ))}
      </ul>
      {canWrite && (
        <Composer
          label="Reply"
          placeholder="Reply…"
          submit="Reply"
          onSubmit={(text) => {
            const sent = Boolean(replyToThread(comments, thread.id, author, text));
            if (sent && path) notifyComment(room.id, { kind: "reply", thread, threadId: thread.id, text, path, line: place?.startLine ?? thread.line }, members, me.user.id);
            return sent;
          }}
        />
      )}
    </div>
  );
}

function MessageItem({ thread, message, mine }: { thread: CommentThread; message: CommentMessage; mine: boolean }) {
  const { comments, me } = useRoom();
  const [editing, setEditing] = useState(false);
  return (
    <li className="group grid gap-0.5">
      <div className="flex items-center gap-1.5">
        <span className="font-medium">{message.by.name}</span>
        <span className="text-muted-foreground" title={new Date(message.at).toLocaleString()}>
          {formatRelativeTime(new Date(message.at))}
          {message.edited && " · edited"}
        </span>
        {mine && !editing && (
          <span className="ml-auto flex opacity-0 group-hover:opacity-100 focus-within:opacity-100">
            <Button variant="ghost" size="icon-xs" aria-label="Edit your message" onClick={() => setEditing(true)}>
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Delete your message"
              onClick={() => deleteCommentMessage(comments, thread.id, message.id, me.user.id)}
            >
              <Trash2 />
            </Button>
          </span>
        )}
      </div>
      {editing ? (
        <Composer
          label="Your message"
          initial={message.text}
          submit="Save"
          onCancel={() => setEditing(false)}
          onSubmit={(text) => {
            const saved = editCommentMessage(comments, thread.id, message.id, me.user.id, text);
            if (saved) setEditing(false);
            return saved;
          }}
        />
      ) : (
        <p className="break-words whitespace-pre-wrap">{message.text}</p>
      )}
    </li>
  );
}

/** A new thread, before its first message is sent. */
export function DraftCard({ line, onSubmit, onCancel }: { line: number; onSubmit: (text: string) => boolean; onCancel: () => void }) {
  return (
    <div role="group" aria-label={`New comment on line ${line}`} data-own-run-key className="grid gap-2 rounded-md border bg-popover p-2 text-xs shadow-sm">
      <span className="font-medium">New comment · line {line}</span>
      <Composer label="Comment" placeholder="Say something about this code…" submit="Comment" autoFocus onSubmit={onSubmit} onCancel={onCancel} />
    </div>
  );
}

/** A text box that grows as you type; Ctrl+Enter sends and Escape cancels. */
function Composer({
  label,
  placeholder,
  submit,
  initial = "",
  autoFocus,
  onSubmit,
  onCancel,
}: {
  label: string;
  placeholder?: string;
  submit: string;
  initial?: string;
  autoFocus?: boolean;
  /** Whether it was sent (the box empties then). */
  onSubmit: (text: string) => boolean;
  onCancel?: () => void;
}) {
  const [text, setText] = useState(initial);
  const box = useRef<HTMLTextAreaElement>(null);
  const send = () => {
    if (!text.trim()) return;
    if (onSubmit(text)) setText("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      send();
    } else if (event.key === "Escape" && onCancel) {
      event.preventDefault();
      onCancel();
    }
  };
  return (
    <div className="grid gap-1.5">
      <textarea
        ref={box}
        aria-label={label}
        value={text}
        placeholder={placeholder}
        maxLength={MAX_COMMENT_LENGTH}
        rows={text.includes("\n") ? Math.min(8, text.split("\n").length) : 1}
        autoFocus={autoFocus}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        className="w-full resize-none rounded-sm border bg-background px-2 py-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      {(text.trim() || onCancel) && (
        <div className="flex gap-1.5">
          <Button size="xs" className="h-6 text-xs" disabled={!text.trim()} onClick={send}>
            {submit}
          </Button>
          {onCancel && (
            <Button size="xs" variant="outline" className="h-6 text-xs" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <span className="ml-auto self-center text-muted-foreground">Ctrl+Enter</span>
        </div>
      )}
    </div>
  );
}
