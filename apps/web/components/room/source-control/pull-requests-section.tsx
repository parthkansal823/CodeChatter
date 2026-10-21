"use client";

import type { PullSummary, RoomRepo } from "@codechatter/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, GitPullRequest } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useEditorUi } from "@/components/room/editor/ui-store";
import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

const pullsKey = (roomId: string) => ["repo-pulls", roomId] as const;

/**
 * The Source Control view's pull requests: the repository's open ones (each opens for
 * review in the editor area), and opening one from the room's branch into the default
 * branch. Folded until you open it, so GitHub is only asked when you want to know.
 */
export function PullRequestsSection({ repo }: { repo: RoomRepo }) {
  const { room, can } = useRoom();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pulls = useQuery({
    queryKey: pullsKey(room.id),
    queryFn: () => api<{ pulls: PullSummary[] }>(`/api/rooms/${room.id}/repo/pulls`).then((r) => r.pulls),
    enabled: open,
    staleTime: 30_000,
  });
  const canOpen = can("files.edit") && repo.branch !== repo.defaultBranch;
  const show = (number: number) => useEditorUi.getState().setPullRequest(number);

  async function submit() {
    if (!title.trim()) return setError("Give the pull request a title.");
    setBusy(true);
    setError(null);
    try {
      const pull = await api<PullSummary>(`/api/rooms/${room.id}/repo/pulls`, {
        method: "POST",
        json: { title: title.trim(), body },
      });
      void client.invalidateQueries({ queryKey: pullsKey(room.id) });
      setComposing(false);
      setTitle("");
      setBody("");
      toast.success(`Opened pull request #${pull.number}`);
      show(pull.number);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.errors?.[0]?.message ?? e.detail)
          : "Couldn't open the pull request. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shrink-0 border-t">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-7 w-full items-center gap-1 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        Pull requests
        {pulls.data && <span className="ml-auto font-mono">{pulls.data.length}</span>}
      </button>
      {open && (
        <div className="max-h-72 overflow-y-auto pb-2">
          {canOpen && !composing && (
            <div className="px-3 pb-2">
              <Button variant="outline" size="xs" className="w-full" onClick={() => setComposing(true)}>
                <GitPullRequest /> Open a pull request
              </Button>
            </div>
          )}
          {composing && (
            <form
              className="grid gap-2 px-3 pb-3"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <p className="text-xs text-muted-foreground">
                From <span className="font-mono text-foreground">{repo.branch}</span> into{" "}
                <span className="font-mono text-foreground">{repo.defaultBranch}</span>
              </p>
              <Input
                aria-label="Pull request title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title"
                className="h-7 text-xs"
                autoFocus
              />
              <Textarea
                aria-label="Pull request description"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="What it changes, and why (optional)"
                className="min-h-16 text-xs"
              />
              {error && (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="xs" onClick={() => setComposing(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="xs"
                  disabled={busy || !repo.login}
                  title={repo.login ? undefined : "Add a GitHub token in Settings first"}
                >
                  {busy ? "Opening…" : "Open pull request"}
                </Button>
              </div>
            </form>
          )}
          {pulls.isPending ? (
            <p className="px-3 text-xs text-muted-foreground">Asking GitHub…</p>
          ) : pulls.isError ? (
            <p role="alert" className="px-3 text-xs text-destructive">
              {pulls.error instanceof ApiError ? pulls.error.detail : "Couldn't list the pull requests."}
            </p>
          ) : pulls.data.length === 0 ? (
            <p className="px-3 text-xs text-muted-foreground">No open pull requests.</p>
          ) : (
            <ul aria-label="Pull requests">
              {pulls.data.map((pull) => (
                <li key={pull.number}>
                  <button
                    type="button"
                    onClick={() => show(pull.number)}
                    className="grid w-full px-3 py-1 text-left text-xs hover:bg-accent"
                  >
                    <span className="truncate">
                      <span className="font-mono text-muted-foreground">#{pull.number}</span> {pull.title}
                    </span>
                    <span className="truncate text-muted-foreground">
                      {pull.head} → {pull.base} · {pull.author}
                      {pull.draft && " · draft"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
