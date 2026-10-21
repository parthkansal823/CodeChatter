"use client";

import type { CommitResult, PullResult, RoomRepo } from "@codechatter/contracts";
import { findByPath, type TreeNode } from "@codechatter/workspace-model";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, ExternalLink, FileText, GitBranch, Undo2 } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";

import { useEditorUi } from "@/components/room/editor/ui-store";
import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

import { changesOf, mergeFiles, type Change, type ChangeKind } from "./merge";
import { PublishSection } from "./publish-section";
import { PullRequestsSection } from "./pull-requests-section";
import { WebhookSection } from "./webhook-section";
import { applyPlan, discardChange, hasConflictMarkers, markSynced, roomTexts } from "./room-files";
import { baseKey, repoKey, useBaseFiles, useRoomRepo, useRoomTexts } from "./use-repo";

const KIND_LETTER: Record<ChangeKind, string> = { added: "A", modified: "M", deleted: "D" };
const KIND_LABEL: Record<ChangeKind, string> = { added: "added", modified: "changed", deleted: "deleted" };
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const failure = (error: unknown, fallback: string) =>
  error instanceof ApiError ? (error.errors?.[0]?.message ?? error.detail) : fallback;

/**
 * The Source Control view (it shares the sidebar with Files and Search). For a room on
 * GitHub: the room's changes since it last synced, each opening as a diff; commit and push
 * them (to the room's branch or a new one); pull GitHub's newer commits, merged into
 * everyone's files; switch branches; pull requests; activity in chat. For a room that
 * isn't, publishing it as a new repository.
 */
export function SourceControlView({ onOpen }: { onOpen: (node: TreeNode) => void }) {
  const repo = useRoomRepo();
  if (repo === undefined) return <Frame>{<Skeleton className="m-3 h-24" />}</Frame>;
  if (repo === null) {
    return (
      <Frame>
        <PublishSection />
      </Frame>
    );
  }
  return <Linked repo={repo} onOpen={onOpen} />;
}

function Frame({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section aria-label="Source control" className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex h-9 shrink-0 items-center gap-1 pr-1 pl-3">
        <span className="text-xs font-medium text-muted-foreground">Source control</span>
        <div className="ml-auto flex items-center">{actions}</div>
      </div>
      {children}
    </section>
  );
}

function Linked({ repo, onOpen }: { repo: RoomRepo; onOpen: (node: TreeNode) => void }) {
  const { room, doc, me, can } = useRoom();
  const client = useQueryClient();
  const base = useBaseFiles(repo.commit);
  const texts = useRoomTexts();
  const changes = useMemo(() => (base ? changesOf(base, texts) : null), [base, texts]);
  const [message, setMessage] = useState("");
  const [toNewBranch, setToNewBranch] = useState(false);
  const [newBranch, setNewBranch] = useState("");
  const [busy, setBusy] = useState<"commit" | "pull" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [branchesWanted, setBranchesWanted] = useState(false);
  const branches = useQuery({
    queryKey: ["repo-branches", room.id],
    queryFn: () => api<{ branches: string[] }>(`/api/rooms/${room.id}/repo/branches`).then((r) => r.branches),
    enabled: branchesWanted,
    staleTime: 30_000,
  });
  const messageId = useId();
  const editable = can("files.edit");
  const openDiff = (path: string) => useEditorUi.getState().setRepoDiff(path);

  const synced = (result: { branch: string; commit: string }, files: Map<string, string>) => {
    client.setQueryData(baseKey(room.id, result.commit), files);
    client.setQueryData<RoomRepo>(
      repoKey(room.id),
      (current) =>
        current && {
          ...current,
          branch: result.branch,
          commit: result.commit,
          syncedAt: new Date().toISOString(),
        },
    );
    void client.invalidateQueries({ queryKey: repoKey(room.id) });
  };

  async function commit() {
    if (!base || !changes?.length) return;
    const now = roomTexts(doc);
    const payload = changes.map((change) => ({
      path: change.path,
      content: change.kind === "deleted" ? null : (now.get(change.path) ?? ""),
    }));
    const marked = payload
      .filter((change) => change.content !== null && hasConflictMarkers(change.content))
      .map((change) => change.path);
    if (marked.length)
      return setError(
        `${marked.join(", ")} still ${marked.length === 1 ? "has" : "have"} conflict markers (<<<<<<<). Resolve them first.`,
      );
    if (!message.trim()) return setError("Write a commit message.");
    if (toNewBranch && !newBranch.trim()) return setError("Name the new branch.");
    setBusy("commit");
    setError(null);
    try {
      const result = await api<CommitResult>(`/api/rooms/${room.id}/repo/commit`, {
        method: "POST",
        json: {
          since: repo.commit,
          message: message.trim(),
          ...(toNewBranch && { newBranch: newBranch.trim() }),
          changes: payload,
        },
      });
      const next = new Map(base);
      for (const change of payload) {
        if (change.content === null) next.delete(change.path);
        else next.set(change.path, change.content);
      }
      synced(result, next);
      markSynced(doc, { branch: result.branch, commit: result.commit });
      setMessage("");
      setToNewBranch(false);
      setNewBranch("");
      toast.success(`Pushed ${result.commit.slice(0, 7)} to ${result.branch}`);
    } catch (e) {
      setError(failure(e, "Couldn't commit. Try again."));
    } finally {
      setBusy(null);
    }
  }

  async function pull(branch?: string) {
    if (!base) return;
    setBusy("pull");
    setError(null);
    try {
      const result = await api<PullResult>(`/api/rooms/${room.id}/repo/pull`, {
        method: "POST",
        json: { since: repo.commit, ...(branch && { branch }) },
      });
      if (result.upToDate) return void toast(`Up to date with ${result.branch} on GitHub`);
      const remote = new Map(result.files.map((file) => [file.path, file.content]));
      const plan = mergeFiles(base, roomTexts(doc), remote, {
        ours: "room",
        theirs: `github ${result.branch}`,
      });
      applyPlan(doc, plan, me.user.id, { branch: result.branch, commit: result.commit });
      synced(result, remote);
      const touched = plan.write.size + plan.remove.length;
      const what = branch
        ? `Switched to ${result.branch}`
        : `Pulled ${result.commit.slice(0, 7)} from ${result.branch}`;
      if (plan.conflicts.length)
        toast.warning(
          `${what}. ${plural(plan.conflicts.length, "file")} conflicted: look for <<<<<<< in ${plan.conflicts.join(", ")}.`,
        );
      else toast.success(`${what}: ${touched ? `${plural(touched, "file")} updated` : "no files changed"}.`);
    } catch (e) {
      setError(failure(e, "Couldn't pull. Try again."));
    } finally {
      setBusy(null);
    }
  }

  const open = (path: string) => {
    const node = findByPath(doc, path);
    if (node?.kind !== "file") return;
    useEditorUi.getState().setRepoDiff(null);
    onOpen(node);
  };

  const pullButton = editable && (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label="Pull from GitHub"
      title={`Pull newer commits on ${repo.branch} from GitHub`}
      disabled={!base || busy !== null}
      onClick={() => void pull()}
    >
      <ArrowDownToLine />
    </Button>
  );

  return (
    <Frame actions={pullButton}>
      <div className="grid shrink-0 gap-2 px-3 pb-3">
        <div className="flex min-w-0 items-center gap-1.5 text-xs">
          <a
            href={`https://github.com/${repo.owner}/${repo.name}/tree/${repo.branch}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-w-0 items-center gap-1 truncate font-mono text-muted-foreground hover:text-foreground"
          >
            {repo.owner}/{repo.name} <ExternalLink className="size-3 shrink-0" />
          </a>
          <span
            className="ml-auto shrink-0 font-mono text-muted-foreground"
            title={`Last synced with commit ${repo.commit}`}
          >
            {repo.commit.slice(0, 7)}
          </span>
        </div>
        <Select
          value={repo.branch}
          onOpenChange={(next) => next && setBranchesWanted(true)}
          onValueChange={(branch) => branch !== repo.branch && void pull(branch)}
          disabled={!editable || busy !== null || Boolean(changes?.length)}
        >
          <SelectTrigger
            size="sm"
            aria-label="Branch"
            className="w-full text-xs data-[size=sm]:h-7"
            title={changes?.length ? "Commit or discard your changes to switch branches" : "Switch branch"}
          >
            <GitBranch className="size-3.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(branches.data ?? [repo.branch]).map((branch) => (
              <SelectItem key={branch} value={branch}>
                {branch}
              </SelectItem>
            ))}
            {branches.isPending && branchesWanted && (
              <p className="px-2 py-1 text-xs text-muted-foreground">Loading branches…</p>
            )}
          </SelectContent>
        </Select>

        {editable && (
          <>
            <label htmlFor={messageId} className="sr-only">
              Commit message
            </label>
            <Textarea
              id={messageId}
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  e.stopPropagation();
                  void commit();
                }
              }}
              data-own-run-key
              placeholder={`Message (Ctrl+Enter commits to ${toNewBranch ? "the new branch" : repo.branch})`}
              className="min-h-16 resize-y text-xs"
            />
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={toNewBranch} onCheckedChange={(v) => setToNewBranch(v === true)} />
              Commit to a new branch
            </label>
            {toNewBranch && (
              <Input
                aria-label="New branch name"
                value={newBranch}
                onChange={(e) => setNewBranch(e.target.value)}
                placeholder="feature/my-change"
                className="h-7 font-mono text-xs"
                spellCheck={false}
              />
            )}
            <Button
              size="sm"
              disabled={!changes?.length || busy !== null || !repo.login}
              onClick={() => void commit()}
            >
              {busy === "commit"
                ? "Pushing…"
                : `Commit and push${changes?.length ? ` (${changes.length})` : ""}`}
            </Button>
            <p className="text-xs text-muted-foreground">
              {repo.login ? (
                <>
                  Commits as <span className="font-mono">{repo.login}</span>, with your GitHub token.
                </>
              ) : (
                <>
                  To commit,{" "}
                  <Link href="/settings" className="underline underline-offset-2 hover:text-foreground">
                    add a GitHub token
                  </Link>{" "}
                  that can write to this repository.
                </>
              )}
            </p>
          </>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        {busy === "pull" && (
          <p role="status" className="text-xs text-muted-foreground">
            Fetching from GitHub…
          </p>
        )}
      </div>

      <div className="flex h-7 shrink-0 items-center border-t px-3 text-xs font-medium text-muted-foreground">
        Changes{changes && <span className="ml-auto font-mono">{changes.length}</span>}
      </div>
      <div className="min-h-20 flex-1 overflow-y-auto pb-2">
        {!changes ? (
          <p className="px-3 py-1 text-xs text-muted-foreground">Reading the repository…</p>
        ) : changes.length === 0 ? (
          <p className="px-3 py-1 text-xs text-muted-foreground">
            No changes since {repo.commit.slice(0, 7)}.
          </p>
        ) : (
          <ul aria-label="Changes">
            {changes.map((change) => (
              <ChangeRow
                key={change.path}
                change={change}
                editable={editable && busy === null}
                onDiff={() => openDiff(change.path)}
                onOpen={change.kind === "deleted" ? null : () => open(change.path)}
                onDiscard={() => base && discardChange(doc, change, base, me.user.id)}
              />
            ))}
          </ul>
        )}
      </div>
      <PullRequestsSection repo={repo} />
      {can("room.manage") && <WebhookSection repo={repo} />}
    </Frame>
  );
}

function ChangeRow({
  change,
  editable,
  onDiff,
  onOpen,
  onDiscard,
}: {
  change: Change;
  editable: boolean;
  onDiff: () => void;
  onOpen: (() => void) | null;
  onDiscard: () => void;
}) {
  const slash = change.path.lastIndexOf("/");
  const name = change.path.slice(slash + 1);
  const folder = slash === -1 ? "" : change.path.slice(0, slash);
  return (
    <li className="group flex h-6 items-center gap-1 pr-1 pl-3 text-xs hover:bg-accent">
      <button
        type="button"
        onClick={onDiff}
        aria-label={`${change.path}, ${KIND_LABEL[change.kind]}`}
        title={`${change.path}: compare with GitHub`}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1.5 text-left",
          change.kind === "deleted" && "line-through",
        )}
      >
        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{name}</span>
        {folder && <span className="min-w-0 truncate text-muted-foreground">{folder}</span>}
      </button>
      {onOpen && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Open ${change.path}`}
          title="Open the file"
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={onOpen}
        >
          <FileText />
        </Button>
      )}
      {editable && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Discard changes to ${change.path}`}
          title="Discard: put it back as it is on GitHub"
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={onDiscard}
        >
          <Undo2 />
        </Button>
      )}
      <span
        aria-hidden
        className={cn(
          "w-3 shrink-0 text-center font-mono",
          change.kind === "added"
            ? "text-brand"
            : change.kind === "deleted"
              ? "text-destructive"
              : "text-muted-foreground",
        )}
      >
        {KIND_LETTER[change.kind]}
      </span>
    </li>
  );
}
