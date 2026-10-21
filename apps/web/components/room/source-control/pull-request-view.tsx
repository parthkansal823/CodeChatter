"use client";

import type { PullComment, PullDetail, PullFile } from "@codechatter/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, MessageSquarePlus, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";

import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

import { anchorOf, parsePatch, threadsAt, threadsOf, type Anchor, type Thread } from "./patch";
import { useRoomRepo } from "./use-repo";

export const pullKey = (roomId: string, number: number) => ["repo-pull", roomId, number] as const;

/** Where a new comment goes: a line of a file, or a reply in a thread. */
type Target = { path: string; anchor: Anchor } | { replyTo: number };

/**
 * A pull request of the room's repository, reviewed in the room: its description, each
 * changed file's diff, and the review comments on its lines. Comments and replies are
 * posted to GitHub with your token, so the review is the same one GitHub shows.
 */
export function PullRequestView({ number, onClose }: { number: number; onClose: () => void }) {
  const { room, can } = useRoom();
  const repo = useRoomRepo();
  const client = useQueryClient();
  const pull = useQuery({
    queryKey: pullKey(room.id, number),
    queryFn: () => api<PullDetail>(`/api/rooms/${room.id}/repo/pulls/${number}`),
  });
  const [target, setTarget] = useState<Target | null>(null);
  const threads = useMemo(() => threadsOf(pull.data?.comments ?? []), [pull.data]);
  const canComment = can("room.chat") && Boolean(repo?.login);

  const post = async (body: string, at: Target) => {
    const data = pull.data;
    if (!data) return;
    const input =
      "replyTo" in at
        ? { body, inReplyTo: at.replyTo }
        : { body, path: at.path, line: at.anchor.line, side: at.anchor.side, commitId: data.headSha };
    const made = await api<PullComment>(`/api/rooms/${room.id}/repo/pulls/${number}/comments`, {
      method: "POST",
      json: input,
    });
    client.setQueryData<PullDetail>(
      pullKey(room.id, number),
      (current) => current && { ...current, comments: [...current.comments, made] },
    );
    setTarget(null);
  };

  return (
    <section aria-label={`Pull request #${number}`} className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b bg-chrome pr-1 pl-3 text-xs">
        <span className="min-w-0 truncate">
          <span className="font-mono text-muted-foreground">#{number}</span>{" "}
          {pull.data?.title ?? "Pull request"}
        </span>
        <div className="ml-auto flex shrink-0 items-center">
          {pull.data && (
            <Button asChild variant="ghost" size="icon-xs" aria-label="Open on GitHub" title="Open on GitHub">
              <a href={pull.data.url} target="_blank" rel="noreferrer">
                <ExternalLink />
              </a>
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Reload the pull request"
            title="Reload"
            disabled={pull.isFetching}
            onClick={() => void pull.refetch()}
          >
            <RefreshCw className={cn(pull.isFetching && "animate-spin")} />
          </Button>
          <Button variant="ghost" size="icon-xs" aria-label="Close the pull request" onClick={onClose}>
            <X />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {pull.isPending ? (
          <div className="grid gap-2 p-4">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-40" />
          </div>
        ) : pull.isError ? (
          <p role="alert" className="p-4 text-sm text-destructive">
            {pull.error instanceof ApiError ? pull.error.detail : "Couldn't load the pull request."}
          </p>
        ) : (
          <>
            <header className="grid gap-2 border-b px-4 py-3">
              <h2 className="font-medium">{pull.data.title}</h2>
              <p className="text-xs text-muted-foreground">
                <span className="text-foreground">{pull.data.author}</span> wants to merge{" "}
                <span className="font-mono">{pull.data.head}</span> into{" "}
                <span className="font-mono">{pull.data.base}</span> ·{" "}
                {pull.data.merged ? "merged" : pull.data.state} · {pull.data.files.length}{" "}
                {pull.data.files.length === 1 ? "file" : "files"}
              </p>
              {pull.data.body && (
                <p className="max-h-40 overflow-y-auto text-sm whitespace-pre-wrap">{pull.data.body}</p>
              )}
              {!canComment && can("room.chat") && (
                <p className="text-xs text-muted-foreground">
                  To comment,{" "}
                  <Link href="/settings" className="underline underline-offset-2 hover:text-foreground">
                    add a GitHub token
                  </Link>
                  .
                </p>
              )}
            </header>
            {pull.data.files.map((file) => (
              <FileDiff
                key={file.path}
                file={file}
                threads={threads}
                canComment={canComment}
                target={target}
                setTarget={setTarget}
                post={post}
              />
            ))}
          </>
        )}
      </div>
    </section>
  );
}

function FileDiff({
  file,
  threads,
  canComment,
  target,
  setTarget,
  post,
}: {
  file: PullFile;
  threads: Thread[];
  canComment: boolean;
  target: Target | null;
  setTarget: (target: Target | null) => void;
  post: (body: string, at: Target) => Promise<void>;
}) {
  const rows = useMemo(() => (file.patch ? parsePatch(file.patch) : []), [file.patch]);
  const outdated = threads.filter((t) => t.root.path === file.path && t.root.line === null);
  const composing = (anchor: Anchor) =>
    target !== null &&
    "path" in target &&
    target.path === file.path &&
    target.anchor.side === anchor.side &&
    target.anchor.line === anchor.line;

  return (
    <section aria-label={`Diff of ${file.path}`} className="border-b">
      <div className="sticky top-0 z-10 flex h-8 items-center gap-2 border-b bg-panel px-4 text-xs">
        <span className="text-muted-foreground">{file.status}</span>
        <span className="min-w-0 truncate font-mono">
          {file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
        </span>
        <span className="ml-auto shrink-0 font-mono">
          <span className="text-success">+{file.additions}</span>{" "}
          <span className="text-destructive">−{file.deletions}</span>
        </span>
      </div>
      {outdated.map((thread) => (
        <ThreadView
          key={thread.root.id}
          thread={thread}
          outdated
          canComment={canComment}
          target={target}
          setTarget={setTarget}
          post={post}
        />
      ))}
      {!file.patch ? (
        <p className="px-4 py-2 text-xs text-muted-foreground">
          No diff to show: a binary file, or too large for GitHub to show.
        </p>
      ) : (
        <div role="table" aria-label={`Lines of ${file.path}`} className="font-mono text-xs">
          {rows.map((row, index) => {
            if (row.kind === "hunk") {
              return (
                <div key={index} role="row" className="bg-muted/50 px-4 py-0.5 text-muted-foreground">
                  {row.text}
                </div>
              );
            }
            const anchor = anchorOf(row)!;
            const here = threadsAt(threads, file.path, anchor);
            return (
              <Fragment key={index}>
                <div
                  role="row"
                  aria-label={`${row.kind === "add" ? "Added" : row.kind === "del" ? "Removed" : "Line"} ${anchor.line}: ${row.text}`}
                  className={cn(
                    "group flex min-h-5 items-stretch",
                    row.kind === "add" && "bg-success/12",
                    row.kind === "del" && "bg-destructive/12",
                  )}
                >
                  <span className="w-10 shrink-0 pr-2 text-right text-muted-foreground select-none">
                    {row.oldLine ?? ""}
                  </span>
                  <span className="w-10 shrink-0 pr-2 text-right text-muted-foreground select-none">
                    {row.newLine ?? ""}
                  </span>
                  <span className="w-4 shrink-0 text-muted-foreground select-none">
                    {row.kind === "add" ? "+" : row.kind === "del" ? "−" : ""}
                  </span>
                  <span className="min-w-0 flex-1 pr-2 break-all whitespace-pre-wrap">{row.text}</span>
                  {canComment && (
                    <button
                      type="button"
                      aria-label={`Comment on ${file.path} line ${anchor.line}${anchor.side === "LEFT" ? " (removed)" : ""}`}
                      className="mr-1 shrink-0 rounded-sm px-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
                      onClick={() => setTarget({ path: file.path, anchor })}
                    >
                      <MessageSquarePlus className="size-3.5" />
                    </button>
                  )}
                </div>
                {here.map((thread) => (
                  <ThreadView
                    key={thread.root.id}
                    thread={thread}
                    canComment={canComment}
                    target={target}
                    setTarget={setTarget}
                    post={post}
                  />
                ))}
                {composing(anchor) && (
                  <Composer
                    label={`Comment on line ${anchor.line}`}
                    onCancel={() => setTarget(null)}
                    onPost={(body) => post(body, { path: file.path, anchor })}
                  />
                )}
              </Fragment>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ThreadView({
  thread,
  outdated = false,
  canComment,
  target,
  setTarget,
  post,
}: {
  thread: Thread;
  outdated?: boolean;
  canComment: boolean;
  target: Target | null;
  setTarget: (target: Target | null) => void;
  post: (body: string, at: Target) => Promise<void>;
}) {
  const replying = target !== null && "replyTo" in target && target.replyTo === thread.root.id;
  return (
    <div
      role="group"
      aria-label={`Comments by ${thread.root.author}`}
      className="mx-4 my-2 rounded-md border bg-panel font-sans"
    >
      {outdated && (
        <p className="border-b px-3 py-1 text-xs text-muted-foreground">
          Outdated: on a line that has changed since.
        </p>
      )}
      {[thread.root, ...thread.replies].map((comment) => (
        <div key={comment.id} className="border-b px-3 py-2 last:border-b-0">
          <p className="text-xs">
            <span className="font-medium">{comment.author}</span>{" "}
            <a
              href={comment.url}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:underline"
            >
              {new Date(comment.createdAt).toLocaleString()}
            </a>
          </p>
          <p className="mt-1 text-sm whitespace-pre-wrap">{comment.body}</p>
        </div>
      ))}
      {canComment &&
        (replying ? (
          <Composer
            label="Reply"
            onCancel={() => setTarget(null)}
            onPost={(body) => post(body, { replyTo: thread.root.id })}
          />
        ) : (
          <div className="px-3 py-1.5">
            <Button variant="ghost" size="xs" onClick={() => setTarget({ replyTo: thread.root.id })}>
              Reply
            </Button>
          </div>
        ))}
    </div>
  );
}

function Composer({
  label,
  onPost,
  onCancel,
}: {
  label: string;
  onPost: (body: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!body.trim()) return setError("Write a comment.");
    setBusy(true);
    setError(null);
    try {
      await onPost(body.trim());
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.errors?.[0]?.message ?? e.detail)
          : "Couldn't post the comment. Try again.",
      );
      setBusy(false);
    }
  };
  return (
    <div className="mx-4 my-2 grid gap-2 rounded-md border bg-panel p-2 font-sans">
      <Textarea
        aria-label={label}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            e.stopPropagation();
            void submit();
          }
        }}
        data-own-run-key
        autoFocus
        placeholder="Leave a comment (Ctrl+Enter posts it to GitHub)"
        className="min-h-16 text-sm"
      />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={busy} onClick={() => void submit()}>
          {busy ? "Posting…" : "Comment"}
        </Button>
      </div>
    </div>
  );
}
