"use client";

import type { Editor } from "@tiptap/react";
import { Check, RotateCcw, Trash2, X } from "lucide-react";
import { useState } from "react";
import type * as Y from "yjs";

import { PresenceAvatar, slotFor } from "@/components/presence/presence";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { addMessage, clearThreadMarks, deleteThread, setResolved, threadRange, type Thread } from "./comments";
import { useDocs } from "./docs-context";

type Props = {
  doc: Y.Doc;
  editor: Editor | null;
  threads: Thread[];
  activeId: string | null;
  onActive: (id: string | null) => void;
  onClose: () => void;
};

/** Comment threads on the page's text: open ones first, resolved ones on their own tab. */
export function CommentsPanel({ doc, editor, threads, activeId, onActive, onClose }: Props) {
  const { me, editable } = useDocs();
  const [tab, setTab] = useState<"open" | "resolved">("open");
  // A thread without messages is a comment being written; only its author sees it.
  const visible = threads.filter((t) => t.messages.length > 0 || t.by.id === me.id);
  const open = visible.filter((t) => !t.resolved);
  const resolved = visible.filter((t) => t.resolved);
  const shown = tab === "open" ? open : resolved;

  const show = (thread: Thread) => {
    onActive(thread.id);
    const range = editor && threadRange(editor, thread.id);
    if (editor && range) editor.chain().setTextSelection(range).scrollIntoView().run();
  };

  const remove = (thread: Thread) => {
    if (editor) clearThreadMarks(editor, thread.id);
    deleteThread(doc, thread.id);
    if (activeId === thread.id) onActive(null);
  };

  return (
    <aside aria-label="Comments" className="flex w-80 shrink-0 flex-col border-l bg-panel">
      <div className="flex h-9 shrink-0 items-center gap-3 border-b px-3">
        <div role="tablist" aria-label="Comment status" className="flex items-stretch gap-3 self-stretch">
          {(["open", "resolved"] as const).map((id) => (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn("relative text-xs font-medium", tab === id ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {id === "open" ? `Open ${open.length}` : `Resolved ${resolved.length}`}
              {tab === id && <span aria-hidden className="absolute inset-x-0 -bottom-px h-[2px] bg-brand" />}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="icon-xs" aria-label="Close comments" className="ml-auto" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {shown.length === 0 && (
          <p className="px-2 py-4 text-sm text-muted-foreground">
            {tab === "open"
              ? editable
                ? "No open comments. Select some text and choose Comment."
                : "No open comments on this page."
              : "Resolved comments show up here."}
          </p>
        )}
        <ul className="grid gap-2">
          {shown.map((thread) => (
            <li key={thread.id}>
              <ThreadCard thread={thread} active={thread.id === activeId} draft={thread.messages.length === 0} doc={doc} onShow={() => show(thread)} onDelete={() => remove(thread)} />
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

function ThreadCard({ thread, active, draft, doc, onShow, onDelete }: { thread: Thread; active: boolean; draft: boolean; doc: Y.Doc; onShow: () => void; onDelete: () => void }) {
  const { me, editable } = useDocs();
  const [text, setText] = useState("");
  const send = () => {
    if (!text.trim()) return;
    addMessage(doc, thread.id, { id: me.id, name: me.name }, text);
    setText("");
  };

  return (
    <article aria-label={`Comment thread on ${thread.quote}`} data-thread-card={thread.id} className={cn("relative rounded-md border bg-background p-2.5", active && "border-ring")}>
      {active && <span aria-hidden className="absolute inset-y-0 left-0 w-thread rounded-l-md bg-brand" />}
      <button type="button" onClick={onShow} className="block w-full text-left">
        <blockquote className="line-clamp-2 border-l-2 pl-2 font-note text-xs text-muted-foreground">{thread.quote}</blockquote>
      </button>
      <ul className="mt-2 grid gap-2.5">
        {thread.messages.map((message) => (
          <li key={message.id} className="flex gap-2">
            <PresenceAvatar name={message.by.name} slot={slotFor(message.by.id)} size={20} className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-xs">
                <span className="font-medium">{message.by.name}</span> <span className="text-muted-foreground">{formatRelativeTime(new Date(message.at))}</span>
              </p>
              <p className="text-sm break-words whitespace-pre-wrap">{message.text}</p>
            </div>
          </li>
        ))}
      </ul>
      {editable && !thread.resolved && (
        <div className="mt-2 grid gap-1.5">
          <textarea
            aria-label={draft ? "Add a comment" : "Reply"}
            autoFocus={draft}
            rows={1}
            value={text}
            placeholder={draft ? "Add a comment" : "Reply"}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
              if (e.key === "Escape" && draft) onDelete();
            }}
            className="w-full resize-none rounded-md border bg-background px-2 py-1 text-sm outline-none field-sizing-content focus-visible:border-ring"
          />
          <div className="flex items-center gap-1">
            <Button size="xs" disabled={!text.trim()} onClick={send}>
              {draft ? "Comment" : "Reply"}
            </Button>
            {draft ? (
              <Button size="xs" variant="ghost" onClick={onDelete}>
                Cancel
              </Button>
            ) : (
              <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setResolved(doc, thread.id, true)}>
                <Check /> Resolve
              </Button>
            )}
          </div>
        </div>
      )}
      {editable && thread.resolved && (
        <div className="mt-2 flex items-center gap-1">
          <Button size="xs" variant="ghost" onClick={() => setResolved(doc, thread.id, false)}>
            <RotateCcw /> Reopen
          </Button>
          {thread.by.id === me.id && (
            <Button size="xs" variant="ghost" aria-label="Delete thread" className="ml-auto" onClick={onDelete}>
              <Trash2 />
            </Button>
          )}
        </div>
      )}
    </article>
  );
}
