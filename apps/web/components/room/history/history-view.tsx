"use client";

import type { CheckpointSummary } from "@codechatter/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, FileText, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";

import { useEditorUi } from "@/components/room/editor/ui-store";
import { useRoom } from "@/components/room/room-context";
import { changesOf, type Change } from "@/components/room/source-control/merge";
import { putBack } from "@/components/room/source-control/room-files";
import { useRoomTexts } from "@/components/room/source-control/use-repo";
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
import { api, ApiError } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { checkpointsKey, checkpointTitle, kindName, requestCheckpoint, useCheckpointFiles, useCheckpoints } from "./checkpoints";

/** What a restore puts back, said from the checkpoint's side. */
const SINCE: Record<Change["kind"], { letter: string; label: string }> = {
  added: { letter: "A", label: "added since" },
  modified: { letter: "M", label: "changed since" },
  deleted: { letter: "D", label: "deleted since" },
};
const RESTORE_ORIGIN = "history";

const failure = (error: unknown) => (error instanceof ApiError ? error.detail : error instanceof Error ? error.message : "Something went wrong. Try again.");
const when = (at: string) => new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * The History view (it shares the sidebar with Files and Search): the room's checkpoints
 * on a slider from the oldest to now. Pick one to see which files differ from now, open
 * each as a diff, and put one file or all of them back; a checkpoint of the files as they
 * are is saved first, so a restore can be undone the same way. Save your own, and name one
 * to keep it.
 */
export function HistoryView() {
  const { room, doc, provider, me, can } = useRoom();
  const client = useQueryClient();
  const checkpoints = useCheckpoints();
  const oldestFirst = useMemo(() => [...(checkpoints ?? [])].reverse(), [checkpoints]);
  const selectedId = useEditorUi((state) => state.historyCheckpoint);
  const setSelectedId = useEditorUi((state) => state.setHistoryCheckpoint);
  const selected = oldestFirst.find((c) => c.id === selectedId) ?? null;
  const position = selected ? oldestFirst.indexOf(selected) : oldestFirst.length;
  const files = useCheckpointFiles(selected?.id ?? null);
  const texts = useRoomTexts();
  const changes = useMemo(() => (files ? changesOf(files, texts) : null), [files, texts]);
  const editable = can("files.edit");
  const [busy, setBusy] = useState(false);
  const [naming, setNaming] = useState<{ id: string | null; label: string } | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const sliderId = useId();

  const refresh = () => client.invalidateQueries({ queryKey: checkpointsKey(room.id) });

  async function save(label: string) {
    setBusy(true);
    try {
      const made = await requestCheckpoint(provider, "manual", label.trim() || null);
      setNaming(null);
      await refresh();
      setSelectedId(made.id);
      toast.success(`Saved “${checkpointTitle(made)}”`);
    } catch (error) {
      toast.error(failure(error));
    } finally {
      setBusy(false);
    }
  }

  async function rename(checkpoint: CheckpointSummary, label: string) {
    setBusy(true);
    try {
      await api(`/api/rooms/${room.id}/checkpoints/${checkpoint.id}`, { method: "PATCH", json: { label: label.trim() || null } });
      setNaming(null);
      await refresh();
    } catch (error) {
      toast.error(failure(error));
    } finally {
      setBusy(false);
    }
  }

  async function remove(checkpoint: CheckpointSummary) {
    setBusy(true);
    try {
      await api(`/api/rooms/${room.id}/checkpoints/${checkpoint.id}`, { method: "DELETE" });
      setSelectedId(null);
      await refresh();
      toast.message(`Deleted “${checkpointTitle(checkpoint)}”`);
    } catch (error) {
      toast.error(failure(error));
    } finally {
      setBusy(false);
    }
  }

  /** Put files back as the checkpoint has them, after saving the files as they are now. */
  async function restore(which: readonly Change[]) {
    if (!selected || !files || !which.length) return;
    setBusy(true);
    try {
      await requestCheckpoint(provider, "pre_restore", `Before restoring “${checkpointTitle(selected)}”`.slice(0, 100));
    } catch (error) {
      toast.error(`Nothing was restored: the files as they are couldn't be saved first. ${failure(error)}`);
      setBusy(false);
      return;
    }
    putBack(doc, which, files, me.user.id, RESTORE_ORIGIN);
    setBusy(false);
    toast.success(
      which.length === 1
        ? `Restored ${which[0]!.path} from “${checkpointTitle(selected)}”`
        : `Restored ${which.length} files from “${checkpointTitle(selected)}”`,
    );
  }

  return (
    <section aria-label="History" className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex h-9 shrink-0 items-center gap-1 pr-1 pl-3">
        <span className="text-xs font-medium text-muted-foreground">History</span>
        {editable && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="ml-auto"
            aria-label="Save a checkpoint"
            title="Save a checkpoint of the files as they are"
            disabled={busy}
            onClick={() => setNaming({ id: null, label: "" })}
          >
            <BookmarkPlus />
          </Button>
        )}
      </div>

      {naming && (
        <form
          className="grid gap-1.5 px-3 pb-2"
          onSubmit={(event) => {
            event.preventDefault();
            const target = naming.id ? oldestFirst.find((c) => c.id === naming.id) : null;
            void (target ? rename(target, naming.label) : save(naming.label));
          }}
        >
          <Input
            aria-label={naming.id ? "Checkpoint name" : "New checkpoint's name"}
            value={naming.label}
            onChange={(event) => setNaming({ ...naming, label: event.target.value })}
            placeholder={naming.id ? "Name (empty takes it away)" : "Name (optional)"}
            maxLength={100}
            className="h-7 text-xs"
            autoFocus
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" className="h-6 text-xs" disabled={busy}>
              {naming.id ? "Save name" : busy ? "Saving…" : "Save checkpoint"}
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-6 text-xs" onClick={() => setNaming(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {!checkpoints ? (
        <p className="px-3 text-xs text-muted-foreground">Reading the room’s history…</p>
      ) : (
        <>
          <div className="grid gap-1 border-b px-3 pb-3">
            <label htmlFor={sliderId} className="sr-only">
              Point in history
            </label>
            <input
              id={sliderId}
              type="range"
              min={0}
              max={oldestFirst.length}
              step={1}
              value={position}
              aria-valuetext={selected ? `${checkpointTitle(selected)}, ${when(selected.at)}` : "Now"}
              onChange={(event) => setSelectedId(oldestFirst[Number(event.target.value)]?.id ?? null)}
              className="w-full accent-brand"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{oldestFirst[0] ? formatRelativeTime(oldestFirst[0].at) : ""}</span>
              <span>Now</span>
            </div>
          </div>

          {selected ? (
            <div className="grid gap-1.5 border-b px-3 py-2 text-xs" aria-label="Selected checkpoint" role="group">
              <div className="flex items-start gap-1">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{checkpointTitle(selected)}</p>
                  <p className="text-muted-foreground">
                    {selected.label && <>{kindName(selected.kind)} · </>}
                    {when(selected.at)}
                    {selected.by && <> · {selected.by.name}</>}
                  </p>
                </div>
                {editable && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={selected.label ? "Rename the checkpoint" : "Name the checkpoint"}
                      title="A named checkpoint is kept"
                      disabled={busy}
                      onClick={() => setNaming({ id: selected.id, label: selected.label ?? "" })}
                    >
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon-xs" aria-label="Delete the checkpoint" disabled={busy} onClick={() => void remove(selected)}>
                      <Trash2 />
                    </Button>
                  </>
                )}
              </div>
              {editable && changes && changes.length > 0 && (
                <Button size="sm" variant="outline" className="h-6 justify-self-start text-xs" disabled={busy} onClick={() => setConfirmAll(true)}>
                  <RotateCcw className="size-3.5" />
                  Restore all {changes.length === 1 ? "1 file" : `${changes.length} files`}
                </Button>
              )}
            </div>
          ) : (
            <p className="border-b px-3 py-2 text-xs text-muted-foreground">
              Now: the files as they are. Move the slider, or pick a checkpoint below, to compare.
            </p>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto pb-2">
            {selected && (
              <>
                <div className="flex h-7 items-center px-3 text-xs font-medium text-muted-foreground">
                  Differences from now{changes && <span className="ml-auto font-mono">{changes.length}</span>}
                </div>
                {!changes ? (
                  <p className="px-3 py-1 text-xs text-muted-foreground">Reading the checkpoint…</p>
                ) : changes.length === 0 ? (
                  <p className="px-3 py-1 text-xs text-muted-foreground">The files are the same as now.</p>
                ) : (
                  <ul aria-label="Differences from now" className="mb-2">
                    {changes.map((change) => (
                      <DifferenceRow
                        key={change.path}
                        change={change}
                        editable={editable && !busy}
                        onDiff={() => useEditorUi.getState().setHistoryDiff({ checkpointId: selected.id, path: change.path })}
                        onRestore={() => void restore([change])}
                      />
                    ))}
                  </ul>
                )}
              </>
            )}
            <div className="flex h-7 items-center px-3 text-xs font-medium text-muted-foreground">
              Checkpoints<span className="ml-auto font-mono">{checkpoints.length}</span>
            </div>
            {checkpoints.length === 0 ? (
              <p className="px-3 py-1 text-xs text-muted-foreground">None yet: one is saved every ten minutes while the files change.</p>
            ) : (
              <ul aria-label="Checkpoints">
                {checkpoints.map((checkpoint) => (
                  <li key={checkpoint.id}>
                    <button
                      type="button"
                      aria-pressed={checkpoint.id === selected?.id}
                      onClick={() => setSelectedId(checkpoint.id === selected?.id ? null : checkpoint.id)}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-1 text-left text-xs hover:bg-accent",
                        checkpoint.id === selected?.id && "bg-accent",
                      )}
                    >
                      <span className={cn("min-w-0 flex-1 truncate", checkpoint.label && "font-medium")}>{checkpointTitle(checkpoint)}</span>
                      <span className="shrink-0 text-muted-foreground" title={when(checkpoint.at)}>
                        {formatRelativeTime(checkpoint.at)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <AlertDialog open={confirmAll} onOpenChange={setConfirmAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore {changes?.length === 1 ? "1 file" : `${changes?.length ?? 0} files`}?</AlertDialogTitle>
            <AlertDialogDescription>
              The files go back to how they were at “{selected ? checkpointTitle(selected) : ""}”, for everyone in the room. A
              checkpoint of the files as they are now is saved first, so you can come back to them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => changes && void restore(changes)}>Restore</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function DifferenceRow({ change, editable, onDiff, onRestore }: { change: Change; editable: boolean; onDiff: () => void; onRestore: () => void }) {
  const slash = change.path.lastIndexOf("/");
  const name = change.path.slice(slash + 1);
  const folder = slash === -1 ? "" : change.path.slice(0, slash);
  const since = SINCE[change.kind];
  return (
    <li className="group flex h-6 items-center gap-1 pr-1 pl-3 text-xs hover:bg-accent">
      <button
        type="button"
        onClick={onDiff}
        aria-label={`${change.path}, ${since.label}`}
        title={`${change.path}: compare with now`}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{name}</span>
        {folder && <span className="min-w-0 truncate text-muted-foreground">{folder}</span>}
      </button>
      {editable && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Restore ${change.path}`}
          title="Put it back as it was at the checkpoint"
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={onRestore}
        >
          <RotateCcw />
        </Button>
      )}
      <span
        aria-hidden
        title={since.label}
        className={cn(
          "w-3 shrink-0 text-center font-mono",
          change.kind === "added" ? "text-brand" : change.kind === "deleted" ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {since.letter}
      </span>
    </li>
  );
}
