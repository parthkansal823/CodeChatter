"use client";

import { deleteCommentThread, placeOfThread, type CommentThread } from "@codechatter/workspace-model";
import { MessageSquare, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { openRoomFile } from "@/components/room/editor/editor-opener";
import { keyLabel, keysFor } from "@/components/room/editor/keybindings";
import { useEditorSettings } from "@/components/room/editor/settings-store";
import { useRoom } from "@/components/room/room-context";
import { useRoomTexts } from "@/components/room/source-control/use-repo";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useCommentThreads, useCommentsUi, useFilePaths } from "./store";

/**
 * The Comments view (it shares the sidebar with Files and Search): every comment thread
 * in the room, open or resolved, by file. A thread opens its file at its code, with the
 * thread unfolded under it.
 */
export function CommentsView() {
  const { doc, comments, can } = useRoom();
  const threads = useCommentThreads();
  const paths = useFilePaths();
  // Re-read a moment after edits, so each thread's line follows its code.
  const texts = useRoomTexts();
  const [show, setShow] = useState<"open" | "resolved">("open");
  const addKey = useEditorSettings((state) => keysFor("comment-add", state.keybindings)[0]);
  const counts = { open: threads.filter((t) => !t.resolved).length, resolved: threads.filter((t) => t.resolved).length };

  const groups = useMemo(() => {
    const byFile = new Map<string, Array<{ thread: CommentThread; line: number }>>();
    for (const thread of threads) {
      if (thread.resolved !== (show === "resolved")) continue;
      const path = paths.get(thread.fileId) ?? null;
      const key = path ?? "";
      const line = path ? (placeOfThread(doc, thread)?.startLine ?? thread.line) : thread.line;
      if (!byFile.has(key)) byFile.set(key, []);
      byFile.get(key)!.push({ thread, line });
    }
    for (const list of byFile.values()) list.sort((a, b) => a.line - b.line);
    // Files A→Z; threads on files that are gone last.
    return [...byFile].sort(([a], [b]) => (!a ? 1 : !b ? -1 : a.localeCompare(b)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- texts is the edit signal
  }, [threads, paths, show, doc, texts]);

  const open = (path: string, thread: CommentThread, line: number) => {
    openRoomFile(path, { startLine: line, startColumn: 1, endLine: line, endColumn: 1 });
    useCommentsUi.getState().focusThread(thread.id);
  };

  return (
    <section aria-label="Comments" className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex h-9 shrink-0 items-center gap-1 pr-1 pl-3">
        <span className="text-xs font-medium text-muted-foreground">Comments</span>
        <div role="group" aria-label="Show" className="ml-auto flex rounded-md border p-0.5 text-xs">
          {(["open", "resolved"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={show === value}
              onClick={() => setShow(value)}
              className={cn("h-5 rounded-sm px-1.5 text-muted-foreground", show === value && "bg-accent text-foreground")}
            >
              {value === "open" ? "Open" : "Resolved"} {counts[value]}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {groups.length === 0 ? (
          <p className="px-3 py-1 text-xs text-muted-foreground">
            {show === "open"
              ? `No open comments. Select code, then right-click and choose Add a comment${addKey ? ` (${keyLabel(addKey)})` : ""}.`
              : "No resolved comments."}
          </p>
        ) : (
          groups.map(([path, list]) => (
            <div key={path || "gone"} role="group" aria-label={path || "Deleted files"} className="mb-1">
              <div className="truncate px-3 py-1 text-xs font-medium text-muted-foreground">{path || "Deleted files"}</div>
              <ul>
                {list.map(({ thread, line }) => {
                  const first = thread.messages[0]!;
                  const replies = thread.messages.length - 1;
                  return (
                    <li key={thread.id} className="group relative">
                      {!path && can("room.chat") && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Remove the thread on line ${line}`}
                          title="Its file is gone: remove the thread"
                          className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                          onClick={() => deleteCommentThread(comments, thread.id)}
                        >
                          <Trash2 />
                        </Button>
                      )}
                      <button
                        type="button"
                        disabled={!path}
                        onClick={() => path && open(path, thread, line)}
                        aria-label={`Line ${line}: ${first.text.slice(0, 80)}`}
                        className="grid w-full gap-0.5 px-3 py-1 text-left text-xs hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent"
                      >
                        <span className="flex items-center gap-1.5">
                          <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="font-mono text-muted-foreground">{line}</span>
                          <span className="line-clamp-2 min-w-0 flex-1 break-words">{first.text}</span>
                        </span>
                        <span className="pl-5 text-muted-foreground">
                          {first.by.name} · {formatRelativeTime(new Date(thread.at))}
                          {replies > 0 && ` · ${replies === 1 ? "1 reply" : `${replies} replies`}`}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

/** How many threads are open, on the Comments button. */
export function OpenCommentsCount() {
  const open = useCommentThreads().filter((thread) => !thread.resolved).length;
  if (!open) return null;
  return (
    <span aria-hidden className="absolute top-1 right-0.5 min-w-3.5 rounded-full bg-brand px-1 text-center text-[10px] leading-3.5 font-medium text-brand-foreground">
      {open > 99 ? "99+" : open}
    </span>
  );
}
