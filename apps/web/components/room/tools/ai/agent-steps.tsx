"use client";

import type { AgentAction, AgentSegment } from "@codechatter/contracts";
import { createFileAtPath, findByPath, textOf, trash } from "@codechatter/workspace-model";
import { Eye, FilePlus, FlaskConical, Pencil, Play, Undo2, type LucideIcon } from "lucide-react";

import { useRoom } from "@/components/room/room-context";
import { useRun } from "@/components/room/run-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { AiMarkdown } from "./ai-markdown";
import { AI_ORIGIN, appliedToast, applyAiText, canUndoAi, matchTrailingNewline, undoAi } from "./ai-edit";
import { readStep, runStep, testStep } from "./agent-runner";
import type { ChatEntry, StepState } from "./history";
import type { Review } from "./review-dialog";

type ActionSegment = Extract<AgentSegment, { type: "action" }>;

const ICONS: Record<AgentAction["kind"], LucideIcon> = { edit: Pencil, create: FilePlus, read: Eye, run: Play, test: FlaskConical };
const APPROVE: Record<AgentAction["kind"], string> = { edit: "Review changes", create: "Review file", read: "Allow", run: "Run", test: "Run tests" };
const STATUS: Partial<Record<StepState["state"], string>> = { running: "Running…", done: "Done", failed: "Failed", skipped: "Skipped" };

type Props = {
  entry: ChatEntry;
  segments: AgentSegment[];
  /** The answer is still arriving. */
  streaming: boolean;
  onStep: (index: number, state: StepState) => void;
  setReview: (review: Review | null) => void;
};

/**
 * An agent answer: its text, and each proposed action as a card that does
 * nothing until the person approves it. Edits open the diff review first.
 */
export function AgentReply({ entry, segments, streaming, onStep, setReview }: Props) {
  const { doc, room, me, can } = useRoom();
  const run = useRun();
  const steps = entry.steps ?? {};

  const reviewChange = ({ action, index }: ActionSegment) => {
    if (action.kind !== "edit" && action.kind !== "create") return;
    const node = findByPath(doc, action.path);
    const existingId = node?.kind === "file" ? node.id : null;
    if (action.kind === "edit" && !existingId) {
      return onStep(index, { state: "failed", note: `${action.path} doesn't exist, so it can't be edited` });
    }
    const before = existingId ? (textOf(doc, existingId)?.toString() ?? "") : "";
    const after = matchTrailingNewline(before, action.content);
    const makesFile = !existingId;
    setReview({
      title: makesFile ? `Create ${action.path}?` : `${action.kind === "edit" ? "Edit" : "Replace"} ${action.path}?`,
      description: makesFile ? "The AI proposes a new file. Everyone in the room will see it." : "The AI proposes this change. Everyone in the room will see it.",
      path: action.path,
      before,
      after,
      acceptLabel: makesFile ? "Create file" : "Apply edit",
      onAccept: () => {
        let fileId = existingId;
        if (fileId) {
          if (!applyAiText(doc, fileId, after)) return onStep(index, { state: "failed", note: `${action.path} was deleted before the change could apply` });
        } else {
          doc.transact(() => {
            fileId = createFileAtPath(doc, action.path, after, me.user.id);
          }, AI_ORIGIN);
        }
        const id = fileId!;
        appliedToast(`${makesFile ? "Created" : "Edited"} ${action.path}`, () => (makesFile ? (trash(doc, id), true) : undoAi(doc, id)));
        onStep(index, { state: "done", note: `${makesFile ? "Created" : "Edited"} ${action.path}`, fileId: id, ...(makesFile && { created: true }) });
      },
      onReject: () => onStep(index, { state: "skipped", note: "You rejected this change." }),
    });
  };

  const approve = async (segment: ActionSegment) => {
    const { action, index } = segment;
    if (action.kind === "read") return onStep(index, readStep(doc, action.path));
    if (action.kind === "run") {
      onStep(index, { state: "running" });
      return onStep(index, await runStep(run, action.path));
    }
    if (action.kind === "test") {
      onStep(index, { state: "running" });
      return onStep(index, await testStep(doc, room.id, action.path));
    }
    reviewChange(segment);
  };

  const undo = (segment: ActionSegment, state: StepState) => {
    if (!state.fileId) return;
    if (state.created) trash(doc, state.fileId);
    else undoAi(doc, state.fileId);
    onStep(segment.index, { ...state, note: `${state.note} (then undone by the person)`, fileId: undefined, created: undefined });
  };

  const blockedFor = (segment: ActionSegment): string | null => {
    if (streaming) return "Wait for the AI to finish writing.";
    if (!segment.complete) return "The answer stopped before this step was complete.";
    const kind = segment.action.kind;
    if ((kind === "edit" || kind === "create") && !can("files.edit")) return "You can view this room but not edit files.";
    if ((kind === "run" || kind === "test") && !can("code.run")) return "You can't run code in this room.";
    return null;
  };

  return (
    <div>
      {segments.map((segment, i) =>
        segment.type === "text" ? (
          <AiMarkdown key={`t${i}`} text={segment.text} applyBlocked={null} />
        ) : (
          <StepCard
            key={`a${segment.index}`}
            segment={segment}
            state={steps[segment.index] ?? { state: "pending" }}
            blocked={blockedFor(segment)}
            canUndo={Boolean(steps[segment.index]?.fileId) && (steps[segment.index]?.created || canUndoAi(doc, steps[segment.index]!.fileId!))}
            onApprove={() => void approve(segment)}
            onSkip={() => onStep(segment.index, { state: "skipped" })}
            onUndo={() => undo(segment, steps[segment.index]!)}
          />
        ),
      )}
    </div>
  );
}

function title(action: AgentAction): string {
  switch (action.kind) {
    case "edit":
      return `Edit ${action.path}`;
    case "create":
      return `Create ${action.path}`;
    case "read":
      return `Read ${action.path}`;
    case "run":
      return `Run ${action.path}`;
    case "test":
      return `Run the saved tests for ${action.path}`;
  }
}

function StepCard({
  segment,
  state,
  blocked,
  canUndo,
  onApprove,
  onSkip,
  onUndo,
}: {
  segment: ActionSegment;
  state: StepState;
  blocked: string | null;
  canUndo: boolean;
  onApprove: () => void;
  onSkip: () => void;
  onUndo: () => void;
}) {
  const { action } = segment;
  const Icon = ICONS[action.kind];
  const label = title(action);
  const lines = action.kind === "edit" || action.kind === "create" ? action.content.split("\n").length : 0;
  return (
    <div role="group" aria-label={label} className="my-2 rounded-md border bg-background font-sans">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm" title={label}>
          {label}
          {lines > 0 && <span className="text-muted-foreground tabular-nums">{` (${lines} lines)`}</span>}
        </span>
        {state.state === "pending" ? (
          <>
            <Button size="xs" variant="ghost" onClick={onSkip}>
              Skip
            </Button>
            <Button size="xs" disabled={Boolean(blocked)} onClick={onApprove}>
              {APPROVE[action.kind]}
            </Button>
          </>
        ) : (
          <span className={cn("text-xs", state.state === "failed" ? "text-destructive" : "text-muted-foreground")} aria-live="polite">
            {STATUS[state.state]}
          </span>
        )}
      </div>
      {state.state === "pending" && blocked && <p className="px-2.5 pb-1.5 text-2xs text-muted-foreground">{blocked}</p>}
      {state.note && (
        <div className="flex items-center gap-2 border-t px-2.5 py-1.5 text-xs text-muted-foreground">
          <p className="min-w-0 flex-1 break-words">{state.note}</p>
          {canUndo && (
            <Button size="xs" variant="ghost" onClick={onUndo}>
              <Undo2 /> Undo
            </Button>
          )}
        </div>
      )}
      {state.detail && (
        <details className="border-t px-2.5 py-1.5 text-xs">
          <summary className="cursor-pointer text-muted-foreground">Details</summary>
          <pre className="mt-1 max-h-48 overflow-auto font-mono text-2xs leading-relaxed whitespace-pre-wrap">{state.detail}</pre>
        </details>
      )}
    </div>
  );
}
