"use client";

import {
  MAX_MESSAGE_LENGTH,
  highlightChatSearch,
  isCountedChatMessage as countsFor,
  type ChatMessage,
  type ChatMessageContext,
  type ChatSearchPage,
  type ChatUnreadEvent,
  type ChatUnreadList,
  type ChatUnreadState,
} from "@codechatter/contracts";
import { randomId } from "@codechatter/workspace-model";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { ArrowDown, ArrowUp, RotateCw, Search, X } from "lucide-react";
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
type Conversation = ChatMessageContext & { targetId: string };
const PAGE = 50;
const refreshTimers = new WeakMap<QueryClient, Map<string, ReturnType<typeof setTimeout>>>();

/** Cancel an older snapshot before fetching another; an early response must never restore a cleared count. */
async function refreshChatUnread(client: QueryClient, userId: string) {
  const queryKey = ["chat-unread", userId] as const;
  await client.cancelQueries({ queryKey });
  await client.invalidateQueries({ queryKey });
}

function queueUnreadRefresh(client: QueryClient, userId: string) {
  let timers = refreshTimers.get(client);
  if (!timers) {
    timers = new Map();
    refreshTimers.set(client, timers);
  }
  if (timers.has(userId)) return;
  const pending = timers;
  pending.set(
    userId,
    setTimeout(() => {
      pending.delete(userId);
      void refreshChatUnread(client, userId);
    }, 40),
  );
}

/** One shared dashboard query, independent of the panel's lifetime; public visitors opt into one room fallback. */
export function useChatUnread(userId: string, roomId?: string) {
  const client = useQueryClient();
  const all = useQuery({
    queryKey: ["chat-unread", userId],
    queryFn: ({ signal }) => api<ChatUnreadList>("/api/rooms/chat/unread", { signal }),
    staleTime: 30_000,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
  const memberState = all.data?.rooms.find((room) => room.roomId === roomId);
  const other = useQuery({
    queryKey: ["chat-unread", userId, roomId],
    queryFn: ({ signal }) => api<ChatUnreadState>(`/api/rooms/${roomId}/messages/unread`, { signal }),
    enabled: Boolean(roomId && all.isSuccess && !memberState),
    staleTime: 30_000,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
  useEffect(() => {
    const socket = getSocket();
    const refresh = () => queueUnreadRefresh(client, userId);
    socket.on("chat:unread", refresh);
    socket.on("connect", refresh);
    return () => {
      socket.off("chat:unread", refresh);
      socket.off("connect", refresh);
    };
  }, [client, userId]);
  return {
    rooms: all.data?.rooms ?? [],
    state: memberState ?? (other.isError ? undefined : other.data),
    loading: all.isPending || Boolean(roomId && !memberState && other.isPending),
    error: all.isError || Boolean(roomId && !memberState && other.isError),
  };
}

export function ChatPanel({ visible, onUnread }: { visible: boolean; onUnread: (count: number) => void }) {
  "use no memo";
  // Visibility and the contiguous read prefix come from mutable DOM observers, not a render-time guess.
  const { room, me, can } = useRoom();
  const queryClient = useQueryClient();
  const unread = useChatUnread(me.user.id, room.id);
  const key = ["messages", room.id] as const;
  const [pending, setPending] = useState<Pending[]>([]);
  const [draft, setDraft] = useState("");
  const [connected, setConnected] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState("");
  const [divider, setDivider] = useState<string | null>(null);
  const [openingSync, setOpeningSync] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const pendingScroll = useRef<{ height: number; top: number } | null>(null);
  const scrollTarget = useRef<string | null>(null);
  const visibleRef = useRef(visible);
  const pendingRef = useRef(pending);
  const opened = useRef(false);
  const seen = useRef(new Set<string>());
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readInFlight = useRef(false);
  const readPending = useRef<string | null>(null);
  const submitted = useRef<string | null>(null);
  const contextRequest = useRef(0);
  const contextAbort = useRef<AbortController | null>(null);
  const contextId = useRef<string | null>(null);
  const contextTraffic = useRef(0);
  const latest = useRef<{
    messages: ChatMessage[];
    state: ChatUnreadState | undefined;
    searching: boolean;
    loading: boolean;
  }>({ messages: [], state: undefined, searching: false, loading: true });

  const history = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam, signal }) =>
      api<Page>(`/api/rooms/${room.id}/messages?limit=${PAGE}${pageParam ? `&before=${pageParam}` : ""}`, {
        signal,
      }),
    initialPageParam: "",
    getNextPageParam: (last) => (last.length === PAGE ? last.at(-1)!.id : undefined),
  });
  const search = useInfiniteQuery({
    queryKey: ["chat-search", room.id, searchQuery],
    queryFn: ({ pageParam, signal }) =>
      api<ChatSearchPage>(
        `/api/rooms/${room.id}/messages/search?q=${encodeURIComponent(searchQuery ?? "")}${pageParam ? `&before=${pageParam}` : ""}`,
        { signal },
      ),
    initialPageParam: "",
    getNextPageParam: (last) => (last.hasMore ? (last.nextBefore ?? undefined) : undefined),
    enabled: Boolean(searchQuery && can("room.chat")),
  });
  const recent = (history.data?.pages ?? []).flat().slice().reverse();
  const messages = conversation?.messages ?? recent;
  const results = (search.data?.pages ?? []).flatMap((page) => page.messages);

  function addToCache(message: ChatMessage) {
    contextTraffic.current++;
    queryClient.setQueryData<InfiniteData<Page>>(key, (data) => {
      if (!data || data.pages.some((page) => page.some((item) => item.id === message.id))) return data;
      const [first = [], ...rest] = data.pages;
      return { ...data, pages: [[message, ...first], ...rest] };
    });
    setConversation((current) => {
      if (!current || current.hasMoreAfter || current.messages.some((item) => item.id === message.id))
        return current;
      // A detached HTTP window is a contiguous snapshot. A live arrival does not
      // prove there are no unseen messages between its end and this new id.
      return { ...current, hasMoreAfter: true };
    });
  }

  async function deliver(item: Pending) {
    const socket = getSocket();
    setPending((list) =>
      list.map((current) =>
        current.clientId === item.clientId ? { ...current, status: "sending" } : current,
      ),
    );
    try {
      const result = await socket
        .timeout(8000)
        .emitWithAck("chat:send", { roomId: room.id, body: item.body, clientId: item.clientId });
      if (!result.ok) throw new Error(result.error);
      addToCache(result.data);
      setPending((list) => list.filter((current) => current.clientId !== item.clientId));
    } catch {
      setPending((list) =>
        list.map((current) =>
          current.clientId === item.clientId ? { ...current, status: "failed" } : current,
        ),
      );
    }
  }

  async function openContext(messageId: string) {
    const request = ++contextRequest.current;
    contextAbort.current?.abort();
    const controller = new AbortController();
    contextAbort.current = controller;
    contextId.current = messageId;
    const traffic = contextTraffic.current;
    pendingScroll.current = null;
    setContextLoading(true);
    setContextError("");
    stickToBottom.current = false;
    try {
      const window = await api<ChatMessageContext>(
        `/api/rooms/${room.id}/messages/context?around=${messageId}`,
        { signal: controller.signal },
      );
      if (controller.signal.aborted || contextRequest.current !== request) return;
      setSearchQuery(null);
      setConversation({
        ...window,
        targetId: messageId,
        hasMoreAfter: window.hasMoreAfter || contextTraffic.current !== traffic,
      });
      scrollTarget.current = messageId;
    } catch {
      if (controller.signal.aborted || contextRequest.current !== request) return;
      contextId.current = null;
      setConversation(null);
      setContextError("Could not open that message. It may have been deleted.");
    } finally {
      if (contextRequest.current === request) {
        contextAbort.current = null;
        setContextLoading(false);
      }
    }
  }

  async function loadConversation(direction: "before" | "after") {
    if (!conversation || contextLoading || contextAbort.current) return;
    const edge = direction === "before" ? conversation.messages[0]?.id : conversation.messages.at(-1)?.id;
    if (!edge) return;
    const targetId = conversation.targetId;
    if (contextId.current !== targetId) return;
    const request = ++contextRequest.current;
    const controller = new AbortController();
    contextAbort.current = controller;
    const traffic = contextTraffic.current;
    const previousScroll =
      direction === "before" && scroller.current
        ? { height: scroller.current.scrollHeight, top: scroller.current.scrollTop }
        : null;
    setContextLoading(true);
    try {
      const page = await api<Page>(`/api/rooms/${room.id}/messages?limit=${PAGE}&${direction}=${edge}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted || contextRequest.current !== request) return;
      pendingScroll.current = previousScroll;
      setConversation((current) => {
        if (
          controller.signal.aborted ||
          contextRequest.current !== request ||
          !current ||
          current.targetId !== targetId
        )
          return current;
        const ids = new Set(current.messages.map((message) => message.id));
        const added = page.filter((message) => !ids.has(message.id)).reverse();
        return {
          ...current,
          messages:
            direction === "before" ? [...added, ...current.messages] : [...current.messages, ...added],
          hasMoreBefore: direction === "before" ? page.length === PAGE : current.hasMoreBefore,
          hasMoreAfter:
            (direction === "after" ? page.length === PAGE : current.hasMoreAfter) ||
            contextTraffic.current !== traffic,
        };
      });
    } catch {
      if (!controller.signal.aborted && contextRequest.current === request)
        setContextError("Could not load more messages. Try again.");
    } finally {
      if (contextRequest.current === request) {
        contextAbort.current = null;
        setContextLoading(false);
      }
    }
  }

  function backToLatest() {
    contextRequest.current++;
    contextAbort.current?.abort();
    contextAbort.current = null;
    contextId.current = null;
    pendingScroll.current = null;
    setConversation(null);
    setContextLoading(false);
    setContextError("");
    setSearchQuery(null);
    stickToBottom.current = true;
    scrollTarget.current = "latest";
  }

  async function loadOlder() {
    if (conversation) {
      await loadConversation("before");
      return;
    }
    if (!history.hasNextPage || history.isFetchingNextPage) return;
    if (scroller.current)
      pendingScroll.current = { height: scroller.current.scrollHeight, top: scroller.current.scrollTop };
    await history.fetchNextPage();
  }

  // Join now and after a reconnect; retried sends keep their original clientId.
  useEffect(() => {
    const socket = getSocket();
    const join = async () => {
      contextTraffic.current++;
      const result = await socket.emitWithAck("room:join", room.id);
      setConnected(result.ok);
      if (result.ok) {
        pendingRef.current.filter((item) => item.status === "failed").forEach((item) => void deliver(item));
        void queryClient.invalidateQueries({ queryKey: key });
        const targetId = contextId.current;
        if (targetId) void openContext(targetId);
      }
    };
    const onMessage = (message: ChatMessage) => {
      if (message.roomId === room.id) addToCache(message);
    };
    const onChange = (event: ChatUnreadEvent) => {
      if (event.roomId !== room.id || event.reason !== "deleted") return;
      contextTraffic.current++;
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: ["chat-search", room.id] });
      const current = contextId.current;
      if (current) void openContext(current);
    };
    const onDisconnect = () => {
      contextTraffic.current++;
      contextRequest.current++;
      contextAbort.current?.abort();
      contextAbort.current = null;
      pendingScroll.current = null;
      setContextLoading(false);
      setConversation((current) => (current ? { ...current, hasMoreAfter: true } : current));
      setConnected(false);
    };
    if (socket.connected) void join();
    socket.on("connect", join);
    socket.on("disconnect", onDisconnect);
    socket.on("chat:message", onMessage);
    socket.on("chat:unread", onChange);
    return () => {
      socket.emit("room:leave", room.id);
      socket.off("connect", join);
      socket.off("disconnect", onDisconnect);
      socket.off("chat:message", onMessage);
      socket.off("chat:unread", onChange);
    };
    // Mutable handlers read pending/window refs; the room owns this subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id]);

  useEffect(() => {
    visibleRef.current = visible;
    pendingRef.current = pending;
    latest.current = {
      messages,
      state: unread.state,
      searching: searchQuery !== null,
      loading: openingSync || contextLoading || !opened.current,
    };
  });
  useEffect(() => {
    onUnread(unread.state?.count ?? 0);
  }, [unread.state?.count, onUnread]);

  // Refresh before freezing this opening's marker; selecting Chat alone does not mark anything read.
  useEffect(() => {
    let active = true;
    opened.current = false;
    if (!visible) {
      seen.current.clear();
      readPending.current = null;
      if (readTimer.current) clearTimeout(readTimer.current);
      const frame = requestAnimationFrame(() => setDivider(null));
      return () => {
        active = false;
        cancelAnimationFrame(frame);
      };
    }
    const frame = requestAnimationFrame(() => {
      setOpeningSync(true);
      void refreshChatUnread(queryClient, me.user.id).finally(() => {
        if (active) setOpeningSync(false);
      });
    });
    return () => {
      active = false;
      cancelAnimationFrame(frame);
    };
  }, [visible, room.id, queryClient, me.user.id]);

  useEffect(() => {
    if (!visible || openingSync || !unread.state || opened.current || history.isPending) return;
    const first = unread.state.firstUnreadId;
    const frame = requestAnimationFrame(() => {
      opened.current = true;
      setDivider(first);
      if (!first) {
        stickToBottom.current = true;
        scrollTarget.current = "latest";
        return;
      }
      stickToBottom.current = false;
      if (recent.some((message) => message.id === first)) scrollTarget.current = first;
      else void openContext(first);
    });
    return () => cancelAnimationFrame(frame);
    // Freeze until this panel closes, even after the shared cursor advances.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, openingSync, unread.state, history.isPending]);

  async function flushRead() {
    readTimer.current = null;
    if (
      readInFlight.current ||
      !visibleRef.current ||
      document.visibilityState !== "visible" ||
      !document.hasFocus() ||
      latest.current.searching ||
      latest.current.loading
    )
      return;
    const candidate = readPending.current;
    if (
      !candidate ||
      (latest.current.state?.readThroughId && candidate <= latest.current.state.readThroughId)
    )
      return;
    readPending.current = null;
    submitted.current = candidate;
    readInFlight.current = true;
    try {
      await api<ChatUnreadState>(`/api/rooms/${room.id}/messages/read`, {
        method: "POST",
        json: { messageId: candidate },
      });
      await refreshChatUnread(queryClient, me.user.id);
    } catch {
      submitted.current = null;
    } finally {
      readInFlight.current = false;
      if (readPending.current) readTimer.current = setTimeout(() => void flushRead(), 600);
    }
  }

  function scanVisible() {
    const element = scroller.current;
    const current = latest.current;
    if (
      !element ||
      !visibleRef.current ||
      document.visibilityState !== "visible" ||
      !document.hasFocus() ||
      current.searching ||
      current.loading ||
      !current.state?.firstUnreadId
    )
      return;
    const bounds = element.getBoundingClientRect();
    if (!bounds.height) return;
    for (const row of element.querySelectorAll<HTMLElement>("[data-message-id]")) {
      const rect = row.getBoundingClientRect();
      const overlap =
        Math.min(rect.bottom, bounds.bottom, window.innerHeight) - Math.max(rect.top, bounds.top, 0);
      if (overlap >= Math.min(rect.height, bounds.height * 0.6) - 1) seen.current.add(row.dataset.messageId!);
    }
    const first = current.messages.findIndex((message) => message.id === current.state!.firstUnreadId);
    if (first < 0) return; // There is a history gap before these visible messages.
    let candidate: string | null = null;
    for (const message of current.messages.slice(first)) {
      if (!countsFor(message, me.user.id)) continue;
      if (!seen.current.has(message.id)) break;
      candidate = message.id;
    }
    if (
      !candidate ||
      (submitted.current && candidate <= submitted.current) ||
      (current.state.readThroughId && candidate <= current.state.readThroughId)
    )
      return;
    // A previous timer may have expired while search, focus or loading paused reading.
    // Keep its high-water mark, but schedule it again when the reader returns.
    if (readPending.current && candidate <= readPending.current && readTimer.current) return;
    if (!readPending.current || candidate > readPending.current) readPending.current = candidate;
    if (readTimer.current) clearTimeout(readTimer.current);
    readTimer.current = setTimeout(() => void flushRead(), 600);
  }

  useEffect(() => {
    const element = scroller.current;
    if (!visible || !element || searchQuery !== null) return;
    const observer = new IntersectionObserver(() => scanVisible(), {
      root: element,
      threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
    });
    element.querySelectorAll("[data-message-id]").forEach((row) => observer.observe(row));
    const check = () => scanVisible();
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    const frame = requestAnimationFrame(check);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
    // The observer uses the current list/snapshot through latest.current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, messages, unread.state, searchQuery, contextLoading, openingSync]);

  useEffect(
    () => () => {
      if (readTimer.current) clearTimeout(readTimer.current);
      contextRequest.current++;
      contextAbort.current?.abort();
    },
    [],
  );

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || !visible || searchQuery !== null) return;
    const target = scrollTarget.current;
    if (target) {
      const row =
        target === "latest" ? null : element.querySelector<HTMLElement>(`[data-message-id="${target}"]`);
      if (target === "latest") element.scrollTop = element.scrollHeight;
      else if (row) row.scrollIntoView({ block: "center" });
      if (target === "latest" || row) scrollTarget.current = null;
      return;
    }
    if (pendingScroll.current) {
      const previous = pendingScroll.current;
      element.scrollTop = previous.top + element.scrollHeight - previous.height;
      pendingScroll.current = null;
    } else if (stickToBottom.current && !conversation) element.scrollTop = element.scrollHeight;
  }, [messages, pending.length, visible, divider, searchQuery, conversation]);

  function send() {
    const body = draft.trim();
    if (!body || !can("room.chat")) return;
    const item: Pending = {
      clientId: randomId(),
      body,
      status: "sending",
      createdAt: new Date().toISOString(),
    };
    setPending((list) => [...list, item]);
    setDraft("");
    backToLatest();
    if (connected) void deliver(item);
    else
      setPending((list) =>
        list.map((current) =>
          current.clientId === item.clientId ? { ...current, status: "failed" } : current,
        ),
      );
  }

  const rows: Array<ChatMessage | (Pending & { pending: true })> = [
    ...messages,
    ...pending.map((item) => ({ ...item, pending: true as const })),
  ];
  const canChat = can("room.chat");
  return (
    <section aria-label="Chat panel" className="flex h-full min-h-0 flex-col bg-panel text-[13px]">
      {canChat && (
        <form
          className="flex shrink-0 items-center gap-1 border-b p-2"
          onSubmit={(event) => {
            event.preventDefault();
            const query = searchDraft.trim();
            if (query) {
              if (query === searchQuery)
                void queryClient.invalidateQueries({ queryKey: ["chat-search", room.id, query], exact: true });
              setSearchQuery(query);
            }
          }}
        >
          <label className="sr-only" htmlFor={`chat-search-${room.id}`}>
            Search room chat
          </label>
          <input
            id={`chat-search-${room.id}`}
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            maxLength={200}
            placeholder="Search chat"
            className="h-7 min-w-0 flex-1 rounded-sm border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button
            type="submit"
            size="icon-xs"
            variant="ghost"
            aria-label="Search chat"
            disabled={!searchDraft.trim()}
          >
            <Search />
          </Button>
          {searchQuery && (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="Close chat search"
              onClick={() => setSearchQuery(null)}
            >
              <X />
            </Button>
          )}
        </form>
      )}
      {searchQuery !== null ? (
        <section aria-label="Chat search results" className="min-h-0 flex-1 overflow-auto p-2">
          <p className="mb-2 text-xs text-muted-foreground">Newest matches for “{searchQuery}”</p>
          {search.isPending && (
            <p role="status" className="text-xs text-muted-foreground">
              Searching…
            </p>
          )}
          {search.isError && (
            <p role="status" className="text-xs">
              Could not search chat. Try again.
            </p>
          )}
          {search.isSuccess && !results.length && (
            <p role="status" className="text-xs text-muted-foreground">
              No messages found.
            </p>
          )}
          <ol className="grid gap-2">
            {results.map((message) => (
              <li key={message.id}>
                <button
                  type="button"
                  onClick={() => void openContext(message.id)}
                  className="grid w-full min-w-0 gap-1 rounded-sm border bg-background p-2 text-left hover:bg-accent"
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-xs font-medium">
                      {message.author?.name ??
                        (message.kind === "github"
                          ? "GitHub"
                          : message.kind === "automation"
                            ? "Automations"
                            : "Someone")}
                    </span>
                    <time
                      dateTime={message.createdAt}
                      title={new Date(message.createdAt).toLocaleString()}
                      className="shrink-0 text-2xs text-muted-foreground"
                    >
                      {formatRelativeTime(message.createdAt)}
                    </time>
                  </span>
                  <span className="break-words whitespace-pre-wrap text-xs">
                    {highlightChatSearch(message.body, searchQuery).map((part, index) =>
                      part.match ? (
                        <mark key={index} className="rounded-sm bg-brand/20 text-foreground">
                          {part.text}
                        </mark>
                      ) : (
                        part.text
                      ),
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {search.hasNextPage && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2"
              disabled={search.isFetchingNextPage}
              onClick={() => void search.fetchNextPage()}
            >
              {search.isFetchingNextPage ? "Loading…" : "More results"}
            </Button>
          )}
        </section>
      ) : (
        <>
          <div className="flex shrink-0 flex-wrap gap-1 px-2 pt-1.5">
            {divider && (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => {
                  stickToBottom.current = false;
                  if (messages.some((message) => message.id === divider)) {
                    scroller.current
                      ?.querySelector<HTMLElement>(`[data-message-id="${divider}"]`)
                      ?.scrollIntoView({ block: "center" });
                  } else void openContext(divider);
                }}
              >
                Jump to new messages
              </Button>
            )}
            {conversation && (
              <Button type="button" size="xs" variant="ghost" onClick={backToLatest}>
                Back to latest
              </Button>
            )}
          </div>
          {contextError && (
            <p role="status" className="px-3 pt-2 text-xs">
              {contextError}
            </p>
          )}
          <div
            ref={scroller}
            onScroll={(event) => {
              const element = event.currentTarget;
              stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 60;
              scanVisible();
              if (element.scrollTop < 30 && !contextLoading) void loadOlder();
            }}
            className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
            role="log"
            aria-label="Room chat"
            tabIndex={0}
            aria-live="polite"
          >
            {contextLoading && (
              <p role="status" className="pb-2 text-center text-xs text-muted-foreground">
                Loading messages…
              </p>
            )}
            {(conversation ? conversation.hasMoreBefore : history.hasNextPage) && (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="mb-2 w-full"
                disabled={contextLoading || history.isFetchingNextPage}
                onClick={() => void loadOlder()}
              >
                {history.isFetchingNextPage ? "Loading…" : "Earlier messages"}
              </Button>
            )}
            {history.isError && (
              <p role="status" className="text-xs">
                Could not load chat. Try again.
              </p>
            )}
            {history.isSuccess && rows.length === 0 && (
              <p className="px-2 pt-6 text-center text-xs text-muted-foreground">
                No messages yet. Say hello, or paste a snippet with ``` fences.
              </p>
            )}
            {rows.map((row, index) => {
              const previous = rows[index - 1];
              const authorId = "pending" in row ? me.user.id : (row.author?.id ?? "system");
              const previousAuthor = previous
                ? "pending" in previous
                  ? me.user.id
                  : (previous.author?.id ?? "system")
                : null;
              const isDivider = !("pending" in row) && row.id === divider;
              const grouped =
                !isDivider &&
                previousAuthor === authorId &&
                previous &&
                new Date(row.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60_000;
              const mine = authorId === me.user.id;
              const github = !("pending" in row) && row.kind === "github";
              // A flow's "Post to the room's chat": no author, shown as the automations'.
              const automation = !("pending" in row) && row.kind === "automation";
              const name =
                "pending" in row
                  ? me.user.name
                  : (row.author?.name ?? (github ? "GitHub" : automation ? "Automations" : "Someone"));
              const slot = mine ? 1 : slotFor(authorId);
              return (
                <div key={"pending" in row ? row.clientId : row.id}>
                  {isDivider && (
                    <div
                      role="separator"
                      aria-label="New messages"
                      className="my-3 flex items-center gap-2 text-xs font-medium text-foreground"
                    >
                      <span className="h-px flex-1 bg-brand" />
                      <span>New messages</span>
                      <span className="h-px flex-1 bg-brand" />
                    </div>
                  )}
                  <div
                    data-message-id={"pending" in row ? undefined : row.id}
                    tabIndex={-1}
                    className={cn(
                      !grouped && index > 0 && "mt-3",
                      !("pending" in row) &&
                        conversation?.targetId === row.id &&
                        "rounded-sm bg-accent/60 outline outline-brand/50",
                    )}
                  >
                    {!grouped && (
                      <div className="mb-0.5 flex items-baseline gap-2 pl-3">
                        <span className="text-sm font-medium">{mine ? "You" : name}</span>
                        <time
                          dateTime={row.createdAt}
                          title={new Date(row.createdAt).toLocaleString()}
                          className="text-2xs text-muted-foreground"
                        >
                          {formatRelativeTime(row.createdAt)}
                        </time>
                      </div>
                    )}
                    <div
                      className={cn(
                        "border-l-2 pl-2.5 text-sm leading-relaxed",
                        "pending" in row && row.status === "sending" && "opacity-60",
                      )}
                      style={{
                        borderColor: github || automation ? "var(--muted-foreground)" : presenceVar(slot),
                      }}
                    >
                      <MessageBody body={row.body} links={github || automation} />
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
                </div>
              );
            })}
            {conversation?.hasMoreAfter && (
              <Button
                type="button"
                size="xs"
                variant="outline"
                className="mt-3 w-full"
                disabled={contextLoading}
                onClick={() => void loadConversation("after")}
              >
                <ArrowDown />
                Newer messages
              </Button>
            )}
          </div>
        </>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
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
            onChange={(event) => setDraft(event.target.value.slice(0, MAX_MESSAGE_LENGTH))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
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
    </section>
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
