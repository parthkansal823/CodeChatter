"use client";

import type { GitChange, GitStatus } from "@codechatter/contracts";
import { findByPath } from "@codechatter/workspace-model";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, FileText, GitBranch, GitBranchPlus, Minus, Plus, Undo2 } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { useEditorUi } from "@/components/room/editor/ui-store";
import { useRoom } from "@/components/room/room-context";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { gitKey, gitRequest, useGitApply, useGitStatus } from "./sandbox-git";

const OPEN_KEY = "cc:sandbox-git-open";
const MARK_LABEL: Record<string, string> = { M: "changed", A: "added", D: "deleted", R: "renamed", C: "copied", T: "type changed", "?": "new" };
const message = (error: unknown, fallback: string) => (error instanceof ApiError ? error.detail : error instanceof Error ? error.message : fallback);

function readOpen(fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(OPEN_KEY);
    return stored === null ? fallback : stored === "1";
  } catch {
    return fallback;
  }
}

/**
 * The Source Control view's "Git in the sandbox": a real git repository at the room's top
 * folder, kept in its sandbox. Stage, commit (as you), branch and look back through its
 * history; a branch switch or a discard changes the room's files for everyone, through
 * the sandbox's file sync. Needs Run rights (git runs in the sandbox); changes need edit
 * rights too. Collapsed by default in a room that's on GitHub, whose own section is above.
 */
export function SandboxGitSection({ onGitHub }: { onGitHub: boolean }) {
  const { can } = useRoom();
  const [open, setOpen] = useState(() => readOpen(!onGitHub));
  if (!can("code.run")) return null;
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(OPEN_KEY, open ? "0" : "1");
    } catch {
      // Private windows: the choice just isn't remembered.
    }
  };
  return (
    <section aria-label="Git in the sandbox" className="shrink-0 border-t">
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className="flex h-7 w-full items-center gap-1 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        Git in the sandbox
      </button>
      {open && (
        <div className="max-h-[55vh] overflow-x-hidden overflow-y-auto">
          <Body />
        </div>
      )}
    </section>
  );
}

function Body() {
  const { room, doc, can } = useRoom();
  const status = useGitStatus(true);
  const apply = useGitApply();
  const editable = can("files.edit");
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (what: string, action: () => Promise<{ status: GitStatus }>, options: { history?: boolean; done?: string } = {}) => {
    setBusy(what);
    try {
      const result = await action();
      apply(result.status, { history: options.history });
      if (options.done) toast.success(options.done);
      return true;
    } catch (error) {
      toast.error(message(error, "Git couldn't do that."));
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (status.isPending) return <p className="px-3 pb-2 text-xs text-muted-foreground">Checking the sandbox…</p>;
  if (status.isError)
    return (
      <div className="grid gap-1.5 px-3 pb-3 text-xs">
        <p className="text-destructive">{message(status.error, "Couldn't reach the sandbox.")}</p>
        <Button size="xs" variant="outline" className="justify-self-start" onClick={() => void status.refetch()}>
          Try again
        </Button>
      </div>
    );
  const now = status.data;
  if (!now.repo)
    return (
      <div className="grid gap-2 px-3 pb-3 text-xs">
        <p className="text-muted-foreground">
          Keep a git history of this room in its sandbox: commit, branch and compare, here or with <span className="font-mono">git</span> in a terminal.
        </p>
        {editable && (
          <Button
            size="sm"
            className="justify-self-start"
            disabled={busy !== null}
            onClick={() => void run("init", () => gitRequest(room.id, doc, { op: "init" }), { done: "Made a git repository on main." })}
          >
            {busy === "init" ? "Initialising…" : "Initialise a repository"}
          </Button>
        )}
      </div>
    );
  return <Repo status={now} busy={busy} editable={editable} run={run} />;
}

function Repo({
  status,
  busy,
  editable,
  run,
}: {
  status: Extract<GitStatus, { repo: true }>;
  busy: string | null;
  editable: boolean;
  run: (what: string, action: () => Promise<{ status: GitStatus }>, options?: { history?: boolean; done?: string }) => Promise<boolean>;
}) {
  const { room, doc } = useRoom();
  const [commitMessage, setCommitMessage] = useState("");
  const [newBranch, setNewBranch] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState<GitChange[] | null>(null);
  const [branchesWanted, setBranchesWanted] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const messageId = useId();
  const branches = useQuery({
    queryKey: gitKey(room.id, "branches"),
    queryFn: () => gitRequest(room.id, doc, { op: "branches" }),
    enabled: branchesWanted,
    staleTime: 10_000,
  });
  const history = useQuery({
    queryKey: gitKey(room.id, "log"),
    queryFn: async () => (await gitRequest(room.id, doc, { op: "log", limit: 15 })).commits,
    enabled: historyOpen,
    staleTime: 10_000,
  });
  const staged = status.changes.filter((change) => change.staged);
  const unstaged = status.changes.filter((change) => change.unstaged);
  const idle = busy === null;

  const commit = async () => {
    const text = commitMessage.trim();
    if (!text) return void toast.error("Write a commit message.");
    const all = staged.length === 0;
    let made = "";
    const ok = await run(
      "commit",
      async () => {
        const result = await gitRequest(room.id, doc, { op: "commit", message: text, all });
        made = result.commit;
        return result;
      },
      { history: true },
    );
    if (ok) {
      setCommitMessage("");
      toast.success(`Committed ${made} on ${status.branch ?? "a detached HEAD"}.`);
    }
  };

  const switchTo = (branch: string, create: boolean) =>
    run(create ? "branch" : "switch", () => gitRequest(room.id, doc, { op: "checkout", branch, create }), {
      history: true,
      done: create ? `Made ${branch} and switched to it.` : `Switched to ${branch}. The room's files now follow it.`,
    });

  return (
    <div className="grid min-w-0 gap-2 px-3 pb-3 text-xs">
      <div className="flex min-w-0 items-center gap-1">
        <Select
          value={status.branch ?? ""}
          onOpenChange={(next) => next && setBranchesWanted(true)}
          onValueChange={(branch) => branch && branch !== status.branch && void switchTo(branch, false)}
          disabled={!editable || !idle}
        >
          <SelectTrigger size="sm" aria-label="Sandbox branch" className="min-w-0 flex-1 text-xs data-[size=sm]:h-7" title="Switch branch">
            <GitBranch className="size-3.5" />
            <SelectValue placeholder={status.head ? `Detached at ${status.head}` : "No commits yet"}>
              {status.branch && <span className="truncate">{status.branch}</span>}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(branches.data?.branches ?? (status.branch ? [{ name: status.branch, short: status.head ?? "", current: true }] : [])).map((branch) => (
              <SelectItem key={branch.name} value={branch.name}>
                {branch.name}
                {branch.short && <span className="ml-2 font-mono text-muted-foreground">{branch.short}</span>}
              </SelectItem>
            ))}
            {branches.isPending && branchesWanted && <p className="px-2 py-1 text-xs text-muted-foreground">Loading branches…</p>}
          </SelectContent>
        </Select>
        {editable && (
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="New branch"
            disabled={!idle || !status.head}
            title={status.head ? "New branch from here" : "Commit once first"}
            className="size-7 shrink-0"
            onClick={() => setNewBranch("")}
          >
            <GitBranchPlus />
          </Button>
        )}
      </div>
      {newBranch !== null && (
        <form
          className="flex gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            const name = newBranch.trim();
            if (name) void switchTo(name, true).then((ok) => ok && setNewBranch(null));
          }}
        >
          <Input
            autoFocus
            aria-label="New branch name"
            value={newBranch}
            onChange={(event) => setNewBranch(event.target.value)}
            onKeyDown={(event) => event.key === "Escape" && setNewBranch(null)}
            placeholder="feature/my-change"
            spellCheck={false}
            className="h-7 font-mono text-xs"
          />
          <Button size="xs" type="submit" disabled={!idle || !newBranch.trim()}>
            {busy === "branch" ? "Making…" : "Make"}
          </Button>
        </form>
      )}

      {editable && (
        <>
          <label htmlFor={messageId} className="sr-only">
            Commit message for the sandbox repository
          </label>
          <Textarea
            id={messageId}
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                event.stopPropagation();
                void commit();
              }
            }}
            data-own-run-key
            placeholder={`Message (Ctrl+Enter commits to ${status.branch ?? "HEAD"})`}
            className="min-h-14 resize-y text-xs"
          />
          <Button size="sm" disabled={!idle || status.changes.length === 0} onClick={() => void commit()}>
            {busy === "commit" ? "Committing…" : staged.length ? `Commit (${staged.length})` : `Commit all${unstaged.length ? ` (${unstaged.length})` : ""}`}
          </Button>
        </>
      )}

      {staged.length > 0 && (
        <ChangeList
          title="Staged"
          changes={staged}
          side="staged"
          editable={editable && idle}
          action={{ label: "Unstage", icon: <Minus />, run: (paths) => void run("unstage", () => gitRequest(room.id, doc, { op: "unstage", paths })) }}
        />
      )}
      <ChangeList
        title="Changes"
        changes={unstaged}
        side="unstaged"
        editable={editable && idle}
        empty={status.changes.length === 0 ? `Nothing changed since ${status.head ?? "the start"}.` : "Everything is staged."}
        action={{ label: "Stage", icon: <Plus />, run: (paths) => void run("stage", () => gitRequest(room.id, doc, { op: "stage", paths })) }}
        onDiscard={(changes) => setDiscarding(changes)}
      />
      {status.more > 0 && <p className="text-muted-foreground">…and {status.more} more changes not shown.</p>}

      <button
        type="button"
        aria-expanded={historyOpen}
        onClick={() => setHistoryOpen(!historyOpen)}
        className="flex items-center gap-1 justify-self-start font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={cn("size-3.5 transition-transform", historyOpen && "rotate-90")} />
        History
      </button>
      {historyOpen && (
        <ol aria-label="Sandbox commits" className="grid gap-1">
          {history.isPending ? (
            <li className="text-muted-foreground">Loading…</li>
          ) : !history.data?.length ? (
            <li className="text-muted-foreground">No commits yet.</li>
          ) : (
            history.data.map((commit) => (
              <li key={commit.id} className="grid gap-0.5" title={`${commit.id}\n${commit.author} <${commit.email}>`}>
                <span className="truncate">
                  <span className="mr-1.5 font-mono text-muted-foreground">{commit.short}</span>
                  {commit.subject}
                </span>
                <span className="text-muted-foreground">
                  {commit.author}, {formatRelativeTime(commit.at)}
                </span>
              </li>
            ))
          )}
        </ol>
      )}

      <AlertDialog open={discarding !== null} onOpenChange={(next) => !next && setDiscarding(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Discard {discarding?.length === 1 ? discarding[0]!.path : `${discarding?.length ?? 0} changes`}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Changed files go back to the last commit, and new ones are deleted, for everyone in the room. This can&apos;t be undone from here (History has the room&apos;s checkpoints).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const paths = (discarding ?? []).map((change) => change.path);
                setDiscarding(null);
                if (paths.length) void run("discard", () => gitRequest(room.id, doc, { op: "discard", paths }), { done: paths.length === 1 ? `Discarded ${paths[0]}.` : `Discarded ${paths.length} changes.` });
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ChangeList({
  title,
  changes,
  side,
  editable,
  empty,
  action,
  onDiscard,
}: {
  title: string;
  changes: GitChange[];
  side: "staged" | "unstaged";
  editable: boolean;
  empty?: string;
  action: { label: string; icon: React.ReactNode; run: (paths: string[]) => void };
  onDiscard?: (changes: GitChange[]) => void;
}) {
  const { doc } = useRoom();
  return (
    <div className="grid gap-0.5">
      <div className="flex h-6 items-center gap-1 font-medium text-muted-foreground">
        {title}
        <span className="ml-1 font-mono">{changes.length}</span>
        {editable && changes.length > 0 && (
          <span className="ml-auto flex">
            {onDiscard && (
              <Button variant="ghost" size="icon-xs" aria-label={`Discard all ${title.toLowerCase()}`} title="Discard all" onClick={() => onDiscard(changes)}>
                <Undo2 />
              </Button>
            )}
            <Button variant="ghost" size="icon-xs" aria-label={`${action.label} all`} title={`${action.label} all`} onClick={() => action.run(changes.map((change) => change.path))}>
              {action.icon}
            </Button>
          </span>
        )}
      </div>
      {changes.length === 0 ? (
        empty && <p className="text-muted-foreground">{empty}</p>
      ) : (
        <ul aria-label={`Sandbox ${title.toLowerCase()}`}>
          {changes.map((change) => {
            const markLetter = side === "staged" ? change.staged! : change.unstaged!;
            const deleted = markLetter === "D";
            const slash = change.path.lastIndexOf("/");
            const label = `${change.path}, ${change.conflict ? "conflicted" : MARK_LABEL[markLetter] ?? "changed"}`;
            return (
              <li key={`${side}:${change.path}`} className="group flex h-6 items-center gap-1 rounded-sm pr-0.5 hover:bg-accent">
                <button
                  type="button"
                  aria-label={label}
                  title={`${change.path}: compare with the last commit`}
                  className={cn("flex min-w-0 flex-1 items-center gap-1.5 text-left", deleted && "line-through")}
                  onClick={() => {
                    if (!findByPath(doc, change.path) && !deleted) return;
                    useEditorUi.getState().setGitDiff(change.path);
                  }}
                >
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{change.path.slice(slash + 1)}</span>
                  {slash > 0 && <span className="min-w-0 truncate text-muted-foreground">{change.path.slice(0, slash)}</span>}
                </button>
                {editable && onDiscard && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Discard ${change.path}`}
                    title="Discard: back to the last commit"
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => onDiscard([change])}
                  >
                    <Undo2 />
                  </Button>
                )}
                {editable && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`${action.label} ${change.path}`}
                    title={action.label}
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => action.run([change.path])}
                  >
                    {action.icon}
                  </Button>
                )}
                <span
                  aria-hidden
                  className={cn(
                    "w-3 shrink-0 text-center font-mono",
                    change.conflict ? "text-destructive" : markLetter === "A" || markLetter === "?" ? "text-brand" : deleted ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {change.conflict ? "!" : markLetter === "?" ? "U" : markLetter}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
