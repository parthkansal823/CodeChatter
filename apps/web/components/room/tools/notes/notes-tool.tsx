"use client";

import { roomDocName } from "@codechatter/workspace-model";
import { Collaboration } from "@tiptap/extension-collaboration";
import { CollaborationCaret } from "@tiptap/extension-collaboration-caret";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor } from "@tiptap/react";
import { Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import type * as Y from "yjs";

import { useRoom } from "@/components/room/room-context";
import { baseExtensions } from "@/components/room/tools/docs/base-extensions";
import { presenceUser, useDocConnection, type Connection } from "@/components/room/tools/docs/connection";
// The page editor's carets, and its content styles (docs.css).
import { renderCaret, renderSelection } from "@/components/room/tools/docs/page-editor";
import type { RoomToolProps } from "@/components/room/tools/registry";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  advanceIfEnded,
  BREAK_CHOICES,
  clock,
  FOCUS_CHOICES,
  pauseTimer,
  readTimer,
  remainingAt,
  resetTimer,
  setLengths,
  skipTimer,
  startTimer,
} from "./focus-timer";

/**
 * Notes, beside the code (a side tool): the room's notes, which everyone who can chat
 * writes together, and your own, which no one else can open (a document only collab lets
 * you have); above them, the room's shared focus timer. The Docs tool is for pages that
 * last; this is the scratchpad.
 */
export default function NotesTool(_: RoomToolProps) {
  const { room, me } = useRoom();
  const [which, setWhich] = useState<"room" | "mine">("room");
  const shared = useDocConnection(roomDocName(room.id, "notes"));
  const mine = useDocConnection(roomDocName(room.id, "mine", me.user.id));
  return (
    <section aria-label="Notes" className="flex h-full min-h-0 flex-col bg-panel">
      {shared && <FocusTimer doc={shared.doc} />}
      <div role="tablist" aria-label="Which notes" className="flex shrink-0 gap-1 border-b px-2 py-1.5">
        {(["room", "mine"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={which === value}
            onClick={() => setWhich(value)}
            className={cn("h-6 rounded-sm px-2 text-xs text-muted-foreground hover:text-foreground", which === value && "bg-accent text-foreground")}
          >
            {value === "room" ? "Room notes" : "My notes"}
          </button>
        ))}
        <span className="ml-auto self-center text-xs text-muted-foreground">
          {which === "room" ? "Everyone in the room" : "Only you can see these"}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {which === "room"
          ? shared && <NotesEditor key="room" connection={shared} label="Room notes" placeholder="Notes for everyone in the room…" />
          : mine && <NotesEditor key="mine" connection={mine} label="My notes" placeholder="Notes only you can see…" mine />}
      </div>
    </section>
  );
}

function NotesEditor({ connection, label, placeholder, mine = false }: { connection: Connection; label: string; placeholder: string; mine?: boolean }) {
  const { me, can } = useRoom();
  const editable = mine || can("room.chat");
  const editor = useEditor(
    {
      immediatelyRender: false,
      editable,
      extensions: [
        ...baseExtensions(),
        Placeholder.configure({ placeholder }),
        Collaboration.configure({ document: connection.doc, field: "content" }),
        // Your own notes have no one else's caret to show.
        ...(mine ? [] : [CollaborationCaret.configure({ provider: connection.provider, user: presenceUser(me.user), render: renderCaret, selectionRender: renderSelection })]),
      ],
      editorProps: { attributes: { class: "cc-doc-content cc-notes-content", role: "textbox", "aria-multiline": "true", "aria-label": label } },
    },
    [connection.doc],
  );
  if (!connection.synced) return <p className="px-3 py-2 text-xs text-muted-foreground">Opening the notes…</p>;
  return <EditorContent editor={editor} className="px-3 py-2 text-sm" />;
}

/** Re-render when the timer map changes, and every second while it runs. */
function useTimer(map: Y.Map<unknown>) {
  const version = useRef(0);
  const subscribe = useCallback(
    (onChange: () => void) => {
      const handler = () => {
        version.current += 1;
        onChange();
      };
      map.observe(handler);
      return () => map.unobserve(handler);
    },
    [map],
  );
  const tick = useSyncExternalStore(subscribe, () => version.current, () => 0);
  // The map is the same object whatever it holds: the change count says when to read it again.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- tick is the change signal
  const state = useMemo(() => readTimer(map), [map, tick]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!state.running) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [state.running]);
  return { state, now };
}

function FocusTimer({ doc }: { doc: Y.Doc }) {
  const { me, can } = useRoom();
  const map = doc.getMap<unknown>("timer");
  const { state, now } = useTimer(map);
  const canUse = can("room.chat");
  const left = remainingAt(state, now);
  const told = useRef<number | null>(null);

  // A stretch that ends moves on (once, whoever sees it first), and everyone hears it.
  useEffect(() => {
    if (!state.running || state.endsAt === null || left > 0 || told.current === state.endsAt) return;
    told.current = state.endsAt;
    const ended = advanceIfEnded(map, Date.now(), state.endsAt) ?? state.phase;
    toast.message(ended === "focus" ? `Focus time is over: take a ${state.breakMinutes}-minute break.` : "Break's over: back to focus.", { id: "focus-timer" });
  }, [left, map, state]);

  const by = me.user.name;
  return (
    <div role="group" aria-label="Focus timer" className="grid shrink-0 gap-1.5 border-b px-3 py-2">
      <div className="flex items-center gap-2">
        <span className={cn("text-xs font-medium", state.phase === "focus" ? "text-brand" : "text-muted-foreground")}>
          {state.phase === "focus" ? "Focus" : "Break"}
        </span>
        <span role="timer" aria-label="Time left" className="font-mono text-lg tabular-nums">
          {clock(left)}
        </span>
        <div className="ml-auto flex items-center">
          {canUse && (
            <>
              {state.running ? (
                <Button variant="ghost" size="icon-xs" aria-label="Pause the timer" onClick={() => pauseTimer(map, by, Date.now())}>
                  <Pause />
                </Button>
              ) : (
                <Button variant="ghost" size="icon-xs" aria-label="Start the timer" onClick={() => startTimer(map, by, Date.now())}>
                  <Play />
                </Button>
              )}
              <Button variant="ghost" size="icon-xs" aria-label={state.phase === "focus" ? "Skip to the break" : "Skip to focus"} onClick={() => skipTimer(map, by, Date.now())}>
                <SkipForward />
              </Button>
              <Button variant="ghost" size="icon-xs" aria-label="Reset the timer" onClick={() => resetTimer(map, by)}>
                <RotateCcw />
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <label className="flex items-center gap-1">
          Focus
          <select
            aria-label="Focus minutes"
            value={state.focusMinutes}
            disabled={!canUse}
            onChange={(event) => setLengths(map, { focusMinutes: Number(event.target.value) }, by)}
            className="rounded-sm border bg-background px-1 py-0.5 text-xs"
          >
            {FOCUS_CHOICES.map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          Break
          <select
            aria-label="Break minutes"
            value={state.breakMinutes}
            disabled={!canUse}
            onChange={(event) => setLengths(map, { breakMinutes: Number(event.target.value) }, by)}
            className="rounded-sm border bg-background px-1 py-0.5 text-xs"
          >
            {BREAK_CHOICES.map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
        </label>
        {state.by && <span className="ml-auto truncate">{state.running ? "Started" : "Set"} by {state.by}</span>}
      </div>
    </div>
  );
}
