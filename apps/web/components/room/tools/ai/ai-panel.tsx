"use client";

import { AI_LIMITS, AI_MODES, parseAgentReply, type AiChatInput, type AiMode, type AiStatus } from "@codechatter/contracts";
import { flatten, listTree, textOf, type TreeNode } from "@codechatter/workspace-model";
import { useQuery } from "@tanstack/react-query";
import { MessageSquarePlus, RotateCw } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useFileTree } from "@/components/room/hooks";
import { useRoom } from "@/components/room/room-context";
import { useRun } from "@/components/room/run-context";
import type { RoomToolProps } from "@/components/room/tools/registry";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

import { filesToAttach, isDecided, readPaths, resultsMessage, type ActionStep } from "./agent-runner";
import { AgentReply } from "./agent-steps";
import { AiMarkdown } from "./ai-markdown";
import { appliedToast, applyAiText, captureRange, fingerprint, firstCodeBlock, matchTrailingNewline, undoAi } from "./ai-edit";
import { useAiRequests, type AiAttach, type AiRequest } from "./ai-requests";
import { Composer } from "./composer";
import { EditCard } from "./edit-card";
import type { ChatEntry, EditTarget, StepState } from "./history";
import type { PastedImage } from "./image";
import { MODES, SUMMARY_WINDOWS } from "./modes";
import { ReviewDialog, type Review } from "./review-dialog";
import { SetupPanel } from "./setup-panel";
import { describeChanges, ensureBaseline } from "./summary-changes";
import { useAiChat } from "./use-ai-chat";
import { readSelection, useSelectionRange } from "./use-editor-selection";
import { formatTokens, UsageMeter } from "./usage-meter";

/** The AI tab in the room's right panel. */
export default function AiTool({ activeFile }: RoomToolProps) {
  const status = useQuery({ queryKey: ["ai-status"], queryFn: () => api<AiStatus>("/api/ai/status"), staleTime: 60_000 });

  if (status.isPending) {
    return (
      <div className="grid gap-2 p-4" aria-label="Loading the AI">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    );
  }
  if (status.isError) {
    return (
      <div className="p-4 text-sm">
        <p className="text-muted-foreground">Couldn&apos;t check whether AI is set up on this server.</p>
        <Button className="mt-2" size="sm" variant="outline" onClick={() => void status.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  if (!status.data.configured) return <SetupPanel status={status.data} />;
  return <AiChat status={status.data} activeFile={activeFile} />;
}

// Head and tail of an oversized file; the server trims further to its own budget.
function clipMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const marker = "\n… [middle of the file omitted] …\n";
  const head = Math.floor((max - marker.length) * 0.6);
  return text.slice(0, head) + marker + text.slice(text.length - (max - marker.length - head));
}

const actionSteps = (content: string): ActionStep[] =>
  parseAgentReply(content).flatMap((segment) => (segment.type === "action" ? [{ index: segment.index, action: segment.action }] : []));

function AiChat({ status, activeFile }: { status: AiStatus; activeFile: TreeNode | null }) {
  const { room, doc, provider, can, synced } = useRoom();
  const run = useRun();
  const tree = useFileTree();
  const chat = useAiChat(room.id);
  const [attach, setAttach] = useState<AiAttach>(() => MODES[chat.mode].attach);
  const [draft, setDraft] = useState("");
  const [image, setImage] = useState<PastedImage | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [windowMinutes, setWindowMinutes] = useState(60);
  const selection = useSelectionRange(activeFile?.id ?? null);
  const fileCount = useMemo(() => flatten(tree).filter((n) => n.kind === "file").length, [tree]);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const mode = chat.mode;
  const canChat = can("room.chat");

  // A first look at the files, so a later summary can say what changed since.
  useEffect(() => {
    if (synced) ensureBaseline(room.id, doc);
  }, [synced, room.id, doc]);

  const changeMode = (next: AiMode) => {
    chat.setMode(next);
    setAttach(MODES[next].attach);
  };

  /** Read the attached context now, so the AI sees the code as it is at send time. */
  const collect = (use: AiAttach, forMode: AiMode, extraPaths: string[] = []) => {
    const context: AiChatInput["context"] = { runOutput: false };
    const labels: string[] = [];
    let target: EditTarget | undefined;
    const ytext = activeFile ? textOf(doc, activeFile.id) : undefined;
    const selected = use.selection && activeFile ? readSelection(doc, provider.awareness!.getLocalState(), activeFile.id) : null;
    // Changing a whole file needs the file in front of the model.
    const wantFile = use.file || (forMode === "edit" && !selected);
    if (wantFile && activeFile && ytext) {
      context.file = { path: activeFile.path, text: clipMiddle(ytext.toString(), AI_LIMITS.fileChars) };
      labels.push(activeFile.name);
    }
    if (selected && activeFile) {
      context.selection = { path: activeFile.path, text: selected.text.slice(0, AI_LIMITS.selectionChars), startLine: selected.startLine, endLine: selected.endLine };
      labels.push(`Lines ${selected.startLine}-${selected.endLine}`);
    }
    if (use.run) {
      context.runOutput = true;
      labels.push("Run output");
    }
    if (use.paths) {
      context.paths = flatten(listTree(doc))
        .filter((n) => n.kind === "file" && n.path.length <= AI_LIMITS.pathChars)
        .slice(0, AI_LIMITS.paths)
        .map((n) => n.path);
      labels.push("File list");
    }
    if (extraPaths.length) context.extraFiles = filesToAttach(doc, extraPaths);
    if (forMode === "summary") {
      context.summary = { minutes: windowMinutes, changes: describeChanges(room.id, doc, windowMinutes) };
      labels.push(SUMMARY_WINDOWS.find(([minutes]) => minutes === windowMinutes)?.[1] ?? `Last ${windowMinutes} minutes`);
    }
    if (forMode === "edit" && activeFile && ytext) {
      target = {
        fileId: activeFile.id,
        path: activeFile.path,
        range: selected ? captureRange(ytext, selected.start, selected.end) : null,
        fingerprint: fingerprint(selected ? selected.text : ytext.toString()),
      };
    }
    return { context, labels, target };
  };

  const submit = (
    raw: string,
    sendMode: AiMode,
    use: AiAttach,
    history: ChatEntry[] = chat.entries,
    options: { auto?: boolean; extraPaths?: string[]; labels?: string[] } = {},
  ) => {
    if (chat.busy || !canChat) return;
    const attached = !options.auto && image && status.vision ? image : null;
    const text = raw.trim() || MODES[sendMode].fallbackPrompt || (attached ? "What's in this image?" : "");
    if (!text) return;
    if (sendMode === "edit" && !activeFile) return void toast.error("Open the file you want to change first.");
    const { context, labels, target } = collect(use, sendMode, options.extraPaths);
    stickToBottom.current = true;
    // An automatic follow-up must not eat what the person is typing.
    if (!options.auto) {
      setDraft("");
      setImage(null);
    }
    void chat.send({ text, mode: sendMode, context, labels: options.labels ?? labels, image: attached, ...(target && { target }) }, history);
  };

  const retry = (failed: ChatEntry) => {
    const index = chat.entries.findIndex((e) => e.id === failed.id);
    const question = chat.entries[index - 1];
    if (!question || question.role !== "user") return;
    chat.truncateFrom(question.id);
    submit(question.content, question.mode, attach, chat.entries.slice(0, index - 1));
  };

  // Handlers that outlive a render (requests from other panels, steps finishing later) read the newest state here.
  const latest = useRef({ submit, changeMode, busy: chat.busy, entries: chat.entries, attach });
  useEffect(() => {
    latest.current = { submit, changeMode, busy: chat.busy, entries: chat.entries, attach };
  });

  /**
   * A step of an agent answer was decided. When every step has an answer and
   * at least one really ran, the results go back to the AI so it can carry on.
   * Each step was approved by the person, so this follow-up needs no more.
   */
  const handleStep = (entryId: string, index: number, state: StepState) => {
    const entry = latest.current.entries.find((e) => e.id === entryId);
    if (!entry) return;
    const steps = { ...entry.steps, [index]: state };
    const actions = actionSteps(entry.content);
    const ready =
      entry.status === "done" &&
      !entry.followedUp &&
      actions.every((a) => isDecided(steps[a.index])) &&
      actions.some((a) => steps[a.index]?.state !== "skipped");
    chat.patchEntry(entryId, { steps, ...(ready && { followedUp: true }) });
    if (ready) {
      latest.current.submit(resultsMessage(actions, steps), "agent", latest.current.attach, latest.current.entries, {
        auto: true,
        extraPaths: readPaths(actions, steps),
        labels: ["Step results"],
      });
    }
  };

  // Requests from other panels ("Explain this error" in the Run output).
  useEffect(() => {
    const handle = (request: AiRequest) => {
      const use = { ...MODES[request.mode].attach, ...request.attach };
      latest.current.changeMode(request.mode);
      setAttach(use);
      if (request.send === false || latest.current.busy) setDraft(request.prompt);
      else latest.current.submit(request.prompt, request.mode, use);
    };
    const take = () => {
      const request = useAiRequests.getState().take();
      if (request) handle(request);
    };
    // A request made before this panel opened is waiting already.
    queueMicrotask(take);
    return useAiRequests.subscribe((state) => state.pending && take());
  }, []);

  // Follow the answer as it streams, unless the reader scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [chat.entries]);

  /** "Apply to file" on a code block: replace the whole open file, after a diff review. */
  const applyToFile = (code: string) => {
    if (!activeFile) return;
    const ytext = textOf(doc, activeFile.id);
    if (!ytext) return;
    const before = ytext.toString();
    const after = matchTrailingNewline(before, code);
    setReview({
      title: `Replace ${activeFile.name}?`,
      description: "The whole file becomes the AI's code, for everyone in the room.",
      path: activeFile.path,
      before,
      after,
      acceptLabel: "Replace file",
      onAccept: () => {
        if (!can("files.edit")) return void toast.error("You can't edit files in this room.");
        if (applyAiText(doc, activeFile.id, after)) appliedToast(`Replaced ${activeFile.name}`, () => undoAi(doc, activeFile.id));
        else toast.error("That file no longer exists.");
      },
    });
  };

  const applyBlocked = !can("files.edit")
    ? "You can view this room but not edit files."
    : !activeFile
      ? "Open a file to apply code to it."
      : chat.busy
        ? "Wait for the answer to finish."
        : null;
  const canSend = canChat && !chat.busy && Boolean(draft.trim() || MODES[mode].fallbackPrompt || image);

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b px-1.5">
        <Select value={mode} onValueChange={(value) => changeMode(value as AiMode)} disabled={chat.busy}>
          <SelectTrigger size="sm" aria-label="AI mode" className="gap-1 border-transparent px-2 font-medium shadow-none hover:bg-accent data-[size=sm]:h-7 dark:bg-transparent">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            {AI_MODES.map((m) => (
              <SelectItem key={m} value={m}>
                {MODES[m].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="min-w-0 flex-1 truncate text-right font-mono text-2xs text-muted-foreground" title={`Model: ${status.model}`}>
          {status.model}
        </span>
        <UsageMeter />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon-xs" variant="ghost" aria-label="New conversation" onClick={chat.clear} disabled={chat.entries.length === 0}>
              <MessageSquarePlus />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New conversation</TooltipContent>
        </Tooltip>
      </div>

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
        role="log"
        aria-label="AI conversation"
        aria-live="polite"
        aria-busy={chat.busy}
      >
        {chat.entries.length === 0 ? (
          <div className="px-1 pt-2">
            <p className="text-sm font-medium">{MODES[mode].label}</p>
            <p className="mt-1 text-sm text-muted-foreground">{MODES[mode].description}</p>
            <div className="mt-3 grid justify-items-start gap-1">
              {MODES[mode].starters.map((starter) => (
                <Button key={starter} size="xs" variant="outline" disabled={!canChat} onClick={() => submit(starter, mode, attach)}>
                  {starter}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          chat.entries.map((entry, i) => (
            <Entry
              key={entry.id}
              entry={entry}
              first={i === 0}
              currentMode={mode}
              onApply={activeFile ? applyToFile : undefined}
              applyBlocked={applyBlocked}
              onRetry={() => retry(entry)}
              onStep={handleStep}
              setReview={setReview}
              patch={chat.patchEntry}
            />
          ))
        )}
      </div>

      <Composer
        draft={draft}
        onDraft={setDraft}
        placeholder={MODES[mode].placeholder}
        attach={attach}
        onAttach={setAttach}
        available={{ fileName: activeFile?.name ?? null, selection, hasRun: Boolean(run.run), fileCount }}
        image={image}
        onImage={setImage}
        vision={status.vision}
        busy={chat.busy}
        canChat={canChat}
        canSend={canSend}
        onSend={() => submit(draft, mode, attach)}
        onStop={chat.stop}
        {...(mode === "summary" && { summaryWindow: { minutes: windowMinutes, onChange: setWindowMinutes } })}
      />
      <ReviewDialog review={review} onClose={() => setReview(null)} />
    </div>
  );
}

const ENDINGS: Partial<Record<NonNullable<ChatEntry["status"]>, string>> = {
  stopped: "Stopped.",
  cut: "The answer reached the model's length limit and was cut off.",
  refused: "The model declined to answer this.",
};

type EntryProps = {
  entry: ChatEntry;
  first: boolean;
  currentMode: AiMode;
  onApply: ((code: string) => void) | undefined;
  applyBlocked: string | null;
  onRetry: () => void;
  onStep: (entryId: string, index: number, state: StepState) => void;
  setReview: (review: Review | null) => void;
  patch: (id: string, patch: Partial<ChatEntry>) => void;
};

function Entry({ entry, first, currentMode, onApply, applyBlocked, onRetry, onStep, setReview, patch }: EntryProps) {
  if (entry.role === "user") {
    const attached = [...(entry.context ?? []), ...(entry.image ? ["Image"] : [])];
    return (
      <div className={cn(!first && "mt-4")}>
        <div className="mb-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 pl-3">
          <span className="text-sm font-medium">You</span>
          {attached.length > 0 && <span className="text-2xs text-muted-foreground">with {attached.join(", ")}</span>}
        </div>
        {/* Your own messages carry the brand rule, as in the room chat. */}
        <div className="max-h-48 overflow-y-auto border-l-2 border-brand pl-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap">{entry.content}</div>
      </div>
    );
  }

  const streaming = entry.status === "streaming";
  const ending = entry.status ? ENDINGS[entry.status] : undefined;
  const code = entry.mode === "edit" && entry.status === "done" ? firstCodeBlock(entry.content) : null;
  const thinking = <p className="animate-pulse font-ai text-sm text-muted-foreground">Thinking…</p>;
  return (
    <div className="mt-3">
      <div className="mb-0.5 flex items-baseline gap-2 pl-3">
        <span className="text-sm font-medium">AI</span>
        {entry.mode !== currentMode && <span className="text-2xs text-muted-foreground">{MODES[entry.mode].label}</span>}
      </div>
      <div className="border-l-2 border-border pl-2.5">
        {!entry.content ? (
          streaming ? thinking : null
        ) : entry.mode === "agent" ? (
          <AgentReply entry={entry} segments={parseAgentReply(entry.content)} streaming={streaming} onStep={(index, state) => onStep(entry.id, index, state)} setReview={setReview} />
        ) : (
          // Edit answers apply through their own review, so a code block there never replaces the whole file.
          <AiMarkdown
            text={entry.content}
            {...(entry.mode !== "edit" && onApply && { onApply })}
            applyBlocked={streaming ? "Wait for the answer to finish." : applyBlocked}
          />
        )}
        {code !== null && <EditCard entry={entry} code={code} setReview={setReview} patch={(p) => patch(entry.id, p)} />}
        {ending && <p className="mt-1 text-xs text-muted-foreground">{ending}</p>}
        {entry.status === "error" && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <p role="alert" className="text-destructive">
              {entry.error}
            </p>
            <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 text-foreground hover:underline">
              <RotateCw className="size-3" /> Retry
            </button>
          </div>
        )}
        {entry.usage && <p className="mt-1 text-2xs text-muted-foreground tabular-nums">{formatTokens(entry.usage)}</p>}
      </div>
    </div>
  );
}
