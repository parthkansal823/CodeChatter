"use client";

import { MAX_MESSAGE_LENGTH, type ChatMessage } from "@codechatter/contracts";
import { randomId } from "@codechatter/workspace-model";
import { useInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { ArrowUp, RotateCw } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { presenceVar, slotFor } from "@/components/presence/presence";
import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";
import { getSocket } from "@/lib/socket";
import { cn } from "@/lib/utils";

type Pending = { clientId: string; body: string; status: "sending" | "failed"; createdAt: string };
type Page = ChatMessage[];
const PAGE = 50;

export function ChatPanel({ visible, onUnread }: { visible: boolean; onUnread: (count: number) => void }) {
  const { room, me, can } = useRoom();
  const queryClient = useQueryClient();
  const key = ["messages", room.id] as const;
  const [pending, setPending] = useState<Pending[]>([]);
  const [draft, setDraft] = useState("");
  const [connected, setConnected] = useState(false);
  const unread = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  // Read inside socket handlers without re-subscribing when they change.
  const visibleRef = useRef(visible);
  const pendingRef = useRef(pending);
  useEffect(() => {
    visibleRef.current = visible;
    pendingRef.current = pending;
  });

  const history = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) =>
      api<Page>(`/api/rooms/${room.id}/messages?limit=${PAGE}${pageParam ? `&before=${pageParam}` : ""}`),
    initialPageParam: "",
    getNextPageParam: (last) => (last.length === PAGE ? last.at(-1)!.id : undefined),
  });

  // Newest-first pages → one oldest-first list for display.
  const messages = (history.data?.pages ?? []).flat().slice().reverse();

  function addToCache(message: ChatMessage) {
    queryClient.setQueryData<InfiniteData<Page>>(key, (data) => {
      if (!data) return data;
      if (data.pages.some((page) => page.some((m) => m.id === message.id))) return data;
      const [first = [], ...rest] = data.pages;
      return { ...data, pages: [[message, ...first], ...rest] };
    });
  }

  async function deliver(item: Pending) {
    const socket = getSocket();
    setPending((list) => list.map((p) => (p.clientId === item.clientId ? { ...p, status: "sending" } : p)));
    try {
      const result = await socket
        .timeout(8000)
        .emitWithAck("chat:send", { roomId: room.id, body: item.body, clientId: item.clientId });
      if (!result.ok) throw new Error(result.error);
      addToCache(result.data);
      setPending((list) => list.filter((p) => p.clientId !== item.clientId));
    } catch {
      setPending((list) => list.map((p) => (p.clientId === item.clientId ? { ...p, status: "failed" } : p)));
    }
  }

  // Join the room channel, now and after every reconnect; flush the outbox.
  useEffect(() => {
    const socket = getSocket();
    const join = async () => {
      const result = await socket.emitWithAck("room:join", room.id);
      setConnected(result.ok);
      if (result.ok) {
        // Anything written while offline goes out now (same clientId, so the
        // server stores each one once even if an earlier attempt landed).
        pendingRef.current.filter((p) => p.status === "failed").forEach((p) => void deliver(p));
        void queryClient.invalidateQueries({ queryKey: key });
      }
    };
    const onMessage = (message: ChatMessage) => {
      if (message.roomId !== room.id) return;
      addToCache(message);
      if (!visibleRef.current) {
        unread.current += 1;
        onUnread(unread.current);
      }
    };
    const onDisconnect = () => setConnected(false);
    if (socket.connected) void join();
    socket.on("connect", join);
    socket.on("disconnect", onDisconnect);
    socket.on("chat:message", onMessage);
    return () => {
      socket.emit("room:leave", room.id);
      socket.off("connect", join);
      socket.off("disconnect", onDisconnect);
      socket.off("chat:message", onMessage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id]);

  useEffect(() => {
    if (visible) {
      unread.current = 0;
      onUnread(0);
    }
  }, [visible, onUnread]);

  // Stay pinned to the newest message unless the reader has scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, pending.length, visible]);

  function send() {
    const body = draft.trim();
    if (!body) return;
    const item: Pending = {
      clientId: randomId(),
      body,
      status: "sending",
      createdAt: new Date().toISOString(),
    };
    setPending((list) => [...list, item]);
    setDraft("");
    stickToBottom.current = true;
    if (connected) void deliver(item);
    else
      setPending((list) => list.map((p) => (p.clientId === item.clientId ? { ...p, status: "failed" } : p)));
  }

  const canChat = can("room.chat");
  const rows: Array<ChatMessage | (Pending & { pending: true })> = [
    ...messages,
    ...pending.map((p) => ({ ...p, pending: true as const })),
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          if (el.scrollTop < 40 && history.hasNextPage && !history.isFetchingNextPage)
            void history.fetchNextPage();
        }}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
        role="log"
        aria-label="Room chat"
        aria-live="polite"
      >
        {history.isFetchingNextPage && (
          <p className="pb-2 text-center text-xs text-muted-foreground">Loading earlier messages…</p>
        )}
        {history.isSuccess && rows.length === 0 && (
          <p className="px-2 pt-6 text-center text-xs text-muted-foreground">
            No messages yet. Say hello, or paste a snippet with ``` fences.
          </p>
        )}
        {rows.map((row, i) => {
          const prev = rows[i - 1];
          const authorId = "pending" in row ? me.user.id : (row.author?.id ?? "system");
          const prevAuthor = prev ? ("pending" in prev ? me.user.id : (prev.author?.id ?? "system")) : null;
          const grouped =
            prevAuthor === authorId &&
            prev &&
            new Date(row.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
          const mine = authorId === me.user.id;
          const github = !("pending" in row) && row.kind === "github";
          const name =
            "pending" in row ? me.user.name : (row.author?.name ?? (github ? "GitHub" : "Someone"));
          const slot = mine ? 1 : slotFor(authorId);
          return (
            <div key={"pending" in row ? row.clientId : row.id} className={cn(!grouped && i > 0 && "mt-3")}>
              {!grouped && (
                <div className="mb-0.5 flex items-baseline gap-2 pl-3">
                  <span className="text-sm font-medium">{mine ? "You" : name}</span>
                  <span className="text-2xs text-muted-foreground">{formatRelativeTime(row.createdAt)}</span>
                </div>
              )}
              {/* Author-coloured rule instead of a bubble (ADR 0006). */}
              <div
                className={cn(
                  "border-l-2 pl-2.5 text-sm leading-relaxed",
                  "pending" in row && row.status === "sending" && "opacity-60",
                )}
                style={{ borderColor: github ? "var(--muted-foreground)" : presenceVar(slot) }}
              >
                <MessageBody body={row.body} links={github} />
                {"pending" in row && row.status === "failed" && (
                  <button
                    type="button"
                    onClick={() => void deliver(row)}
                    className="mt-1 inline-flex items-center gap-1 text-xs text-destructive hover:underline"
                  >
                    <RotateCw className="size-3" /> Not sent. Retry
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="border-t p-2"
      >
        {!connected && (
          <p className="px-1 pb-1.5 text-2xs text-muted-foreground">
            Reconnecting… messages will send when you’re back.
          </p>
        )}
        <div className="flex items-end gap-2 rounded-md border bg-background p-1.5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_MESSAGE_LENGTH))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            disabled={!canChat}
            rows={1}
            placeholder={canChat ? `Message ${room.name}` : "You can read this chat but not post."}
            aria-label="Message"
            className="max-h-32 min-h-7 flex-1 resize-none bg-transparent px-1.5 py-1 text-sm outline-none placeholder:text-muted-foreground [field-sizing:content]"
          />
          <Button type="submit" size="icon-sm" disabled={!canChat || !draft.trim()} aria-label="Send message">
            <ArrowUp />
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Plain text with ``` code fences and `inline code` — enough for a dev chat. */
/** Text with ``` fences and `code`; `links` makes https addresses links (only for GitHub's messages, which the server writes). */
function MessageBody({ body, links = false }: { body: string; links?: boolean }) {
  const parts = body.split(/```(?:[a-z0-9+-]*\n)?([\s\S]*?)```/g);
  return (
    <div className="break-words whitespace-pre-wrap">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <pre
            key={i}
            className="my-1 overflow-x-auto rounded-md border bg-background px-2.5 py-2 font-mono text-xs leading-relaxed"
          >
            {part.replace(/\n$/, "")}
          </pre>
        ) : (
          <span key={i}>
            {part.split(/(`[^`\n]+`)/g).map((chunk, j) =>
              chunk.startsWith("`") && chunk.endsWith("`") && chunk.length > 2 ? (
                <code key={j} className="rounded-sm bg-muted px-1 font-mono text-[0.85em]">
                  {chunk.slice(1, -1)}
                </code>
              ) : links ? (
                <Linked key={j} text={chunk} />
              ) : (
                chunk
              ),
            )}
          </span>
        ),
      )}
    </div>
  );
}

function Linked({ text }: { text: string }) {
  return text.split(/(https:\/\/\S+)/g).map((part, i) =>
    i % 2 === 1 ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noreferrer"
        className="break-all underline underline-offset-2 hover:text-foreground"
      >
        {part}
      </a>
    ) : (
      part
    ),
  );
}
