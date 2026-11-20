/**
 * A flow's versions, as n8n's workflow history: the room's checkpoints (History), newest first. For the one chosen, what's changed since, step by step
 * and in the flow's own fields, and its chart as it was, with the steps changed since drawn as warnings and those gone since dashed, each with a note.
 * Restore puts that version back in the flow's file, after saving a checkpoint of the room as it is (so History can undo it), as History's restore does.
 */
"use client";

import type { AutomationManifest } from "@codechatter/contracts";
import { setFileText, textOf, type TreeNode } from "@codechatter/workspace-model";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Flowchart, type FlowchartEdge, type FlowchartNode } from "@/components/flowchart/flowchart";
import { checkpointTitle, requestCheckpoint, useCheckpointFiles, useCheckpoints } from "@/components/room/history/checkpoints";
import { useRoom } from "@/components/room/room-context";
import { useYVersion } from "@/components/room/tools/api-studio/connection";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { changesInWords, flowChanges, flowIn, type StepChange } from "./flow-diff";
import { GLYPHS } from "./glyphs";
import { chartOfFlow, parseFlow } from "./model";

const MOST_SHOWN = 50;
const when = (at: string) => new Date(at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
const failure = (error: unknown) => (error instanceof Error ? error.message : "Try again.");
const CHANGE_WORDS: Record<StepChange["change"], string> = { added: "Added since", changed: "Changed since", removed: "Gone since" };

export function VersionsView({ node, pieces, onRestored }: { node: TreeNode; pieces: AutomationManifest["pieces"] | undefined; onRestored: () => void }) {
  const { doc, provider, can } = useRoom();
  const canEdit = can("files.edit");
  const text = textOf(doc, node.id);
  useYVersion(text);
  const now = parseFlow(text?.toString() ?? "");
  const checkpoints = useCheckpoints();
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const listed = (checkpoints ?? []).slice(0, MOST_SHOWN);
  const chosen = listed.find((checkpoint) => checkpoint.id === chosenId) ?? listed[0] ?? null;
  const files = useCheckpointFiles(chosen?.id ?? null);
  const nowFlow = "flow" in now ? now.flow : null;
  const then = files && nowFlow ? flowIn(files, node.path, nowFlow.id) : null;
  const changes = then && nowFlow ? flowChanges(then.flow, nowFlow) : null;

  const restore = async () => {
    if (!chosen || !then) return;
    setBusy(true);
    try {
      await requestCheckpoint(provider, "pre_restore", `Before restoring ${nowFlow?.displayName ?? node.name} from “${checkpointTitle(chosen)}”`.slice(0, 100));
    } catch (error) {
      toast.error(`Nothing was restored: the room as it is couldn't be saved first. ${failure(error)}`);
      setBusy(false);
      return;
    }
    setFileText(doc, node.id, then.text);
    setBusy(false);
    toast.success(`Restored the version from ${when(chosen.at)}. History has the one before.`);
    onRestored();
  };

  if (!nowFlow) return <p className="p-4 text-xs text-destructive">This flow&apos;s file doesn&apos;t read as a flow just now, so it can&apos;t be compared.</p>;

  // The chart as it was: what's changed since is a warning, what's gone since is dashed, and each says so under its box.
  const byName = new Map((changes?.steps ?? []).map((change) => [change.name, change]));
  const chart = then ? chartOfFlow(then.flow, undefined, pieces, { adds: false }) : null;
  const nodes = (chart?.items ?? [])
    .filter((item) => item.shape !== "add")
    .map((item): FlowchartNode => {
      const change = byName.get(item.id);
      const note = change?.change === "removed" ? "Gone since" : change?.change === "changed" ? `Changed since: ${change.what.join(", ")}` : undefined;
      return { ...item, icon: GLYPHS[item.glyph], status: change?.change === "changed" ? "warning" : "idle", muted: change?.change === "removed" || item.muted, note: note ?? item.note, description: `${item.description}${note ? `. ${note}.` : ""}` };
    });
  const shown = new Set(nodes.map((each) => each.id));
  const edges = (chart?.edges ?? []).filter((edge) => shown.has(edge.from) && shown.has(edge.to)).map((edge): FlowchartEdge => ({ from: edge.from, to: edge.to, ...(edge.label ? { label: edge.label } : {}) }));

  return (
    <section aria-label="Versions" className="grid min-h-0 flex-1 grid-rows-[auto_1fr] text-xs md:grid-cols-[16rem_1fr] md:grid-rows-1">
      <nav aria-label="The room's checkpoints" className="min-h-0 overflow-auto border-b p-2 md:border-r md:border-b-0">
        <h3 className="px-1 pb-1 text-[13px] font-medium">Versions</h3>
        <p className="px-1 pb-2 text-muted-foreground">From the room&apos;s History: each checkpoint has the flow as it was then.</p>
        {checkpoints === undefined ? (
          <p className="px-1 text-muted-foreground">Reading History…</p>
        ) : !listed.length ? (
          <p className="px-1 text-muted-foreground">No checkpoints yet. History saves one every so often, and before a restore; you can save one there too.</p>
        ) : (
          <ul className="grid gap-0.5">
            {listed.map((checkpoint) => (
              <li key={checkpoint.id}>
                <button type="button" aria-current={chosen?.id === checkpoint.id ? "true" : undefined} className={cn("grid w-full rounded-sm px-1.5 py-1 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring", chosen?.id === checkpoint.id && "bg-accent")} onClick={() => setChosenId(checkpoint.id)}>
                  <span className="font-medium">{checkpointTitle(checkpoint)}</span>
                  <span className="text-muted-foreground">
                    {when(checkpoint.at)}
                    {checkpoint.by ? ` · ${checkpoint.by.name}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>
      <div className="flex min-h-0 flex-col overflow-hidden">
        <div className="grid max-h-64 shrink-0 content-start gap-2 overflow-auto border-b p-3">
          {!chosen ? null : !files ? (
            <p className="text-muted-foreground">Reading that checkpoint…</p>
          ) : !then ? (
            <p>This flow wasn&apos;t in the room at {when(chosen.at)}.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-[13px] font-medium">
                  As it was at {when(chosen.at)} ({checkpointTitle(chosen)})
                </h4>
                {canEdit && changes && (changes.steps.length > 0 || changes.flow.length > 0) && (
                  <Button size="xs" variant="outline" className="ml-auto" disabled={busy} onClick={() => void restore()}>
                    <RotateCcw /> Restore this version
                  </Button>
                )}
              </div>
              <p role="status">{!changes ? "" : changes.steps.length || changes.flow.length ? `Since then: ${changesInWords(changes)}.` : "It's the same as now."}</p>
              {then.path !== node.path && <p className="text-muted-foreground">It was at {then.path} then.</p>}
              {changes && changes.steps.length > 0 && (
                <ul aria-label="What's changed since" className="grid gap-0.5">
                  {changes.steps.map((change) => (
                    <li key={`${change.change}:${change.name}`}>
                      <span className={cn("font-medium", change.change === "removed" && "text-destructive")}>{CHANGE_WORDS[change.change]}:</span> {change.title}
                      {change.what.length ? <span className="text-muted-foreground"> ({change.what.join(", ")})</span> : null}
                    </li>
                  ))}
                </ul>
              )}
              {changes && changes.flow.length > 0 && <p>The flow&apos;s own: {changes.flow.join(", ")}.</p>}
            </>
          )}
        </div>
        <div className="min-h-0 flex-1">{then && nodes.length > 0 && <Flowchart label="The steps as they were" nodes={nodes} edges={edges} selected={null} onSelect={() => {}} />}</div>
      </div>
    </section>
  );
}
