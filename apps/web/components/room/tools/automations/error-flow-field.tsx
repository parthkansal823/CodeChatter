/**
 * The room's other flows, for "If it fails, run" and "Call a flow". "If it fails, run": a flow's error flow, as n8n's error workflow. When a run of this flow fails or takes too long, the sandbox starts the flow chosen here
 * (automation/host.mjs), giving it the run, its error and this flow. Offered are the room's flows that start on "Another flow fails"; one named in the file
 * that isn't one of them is still shown, so it can be put right.
 */
"use client";

import { CALLED_FLOW_EVENT, ERROR_FLOW_EVENT, isFlowFile, roomEventOf } from "@codechatter/contracts";
import { textOf } from "@codechatter/workspace-model";
import { useId } from "react";

import { useRoomFiles } from "@/components/room/editor/room-files";
import { useRoom } from "@/components/room/room-context";

import { parseFlow, type Flow } from "./model";

const field = "h-7 min-w-0 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The room's flows but the one in `fileId` (all, with null), with their ids and the room event they start on, if any. */
export function useOtherFlows(fileId: string | null) {
  const { doc } = useRoom();
  return useRoomFiles()
    .filter((file) => file.id !== fileId && !file.blob && isFlowFile(file.name))
    .flatMap((file) => {
      const parsed = parseFlow(textOf(doc, file.id)?.toString() ?? "");
      if (!("flow" in parsed) || !parsed.flow.id) return [];
      return [{ id: parsed.flow.id, name: parsed.flow.displayName || file.path, path: file.path, event: roomEventOf(parsed.flow.trigger.settings)?.event ?? null }];
    });
}

export function ErrorFlowField({ flow, fileId, canEdit, onSave }: { flow: Flow; fileId: string; canEdit: boolean; onSave: (flow: Flow) => void }) {
  const others = useOtherFlows(fileId);
  const help = useId();
  const choices = others.filter((other) => other.event === ERROR_FLOW_EVENT);
  const chosen = flow.errorFlow ?? "";
  const unknown = chosen && !choices.some((choice) => choice.id === chosen) ? (others.find((other) => other.id === chosen) ?? { id: chosen, name: "A flow that isn't in the room", path: "" }) : null;

  return (
    <label className="grid gap-1">
      If it fails, run
      <select
        className={field}
        aria-describedby={help}
        disabled={!canEdit}
        value={chosen}
        onChange={(event) => {
          const next = { ...flow };
          if (event.target.value) next.errorFlow = event.target.value;
          else delete next.errorFlow;
          onSave(next);
        }}
      >
        <option value="">Nothing</option>
        {choices.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.name} ({choice.path})
          </option>
        ))}
        {unknown && <option value={unknown.id}>{unknown.name}{unknown.path ? ` (${unknown.path}), which doesn't start on another flow failing` : ""}</option>}
      </select>
      <span id={help} className="text-muted-foreground">
        {choices.length === 0 ? "An error flow is one whose trigger is This room: Another flow fails. Make one, and it's offered here." : "When a run fails or takes too long, that flow runs with what went wrong, as n8n's error workflow does."}
      </span>
    </label>
  );
}

/** "Call a flow"'s flow: those in the room that start on "Called by another flow". One named that isn't is still shown, so it can be put right. */
export function CallFlowField({ value, canEdit, onChange }: { value: unknown; canEdit: boolean; onChange: (id: string) => void }) {
  // A flow may call itself: how deep that goes is limited (automation/host.mjs).
  const others = useOtherFlows(null);
  const help = useId();
  const choices = others.filter((other) => other.event === CALLED_FLOW_EVENT);
  const chosen = typeof value === "string" ? value : "";
  const unknown = chosen && !choices.some((choice) => choice.id === chosen) ? (others.find((other) => other.id === chosen) ?? { id: chosen, name: "A flow that isn't in the room", path: "" }) : null;
  return (
    <label className="grid gap-1">
      Flow (required)
      <select className={field} aria-describedby={help} disabled={!canEdit} value={chosen} onChange={(event) => onChange(event.target.value)}>
        <option value="">Choose one</option>
        {choices.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.name} ({choice.path})
          </option>
        ))}
        {unknown && <option value={unknown.id}>{unknown.name}{unknown.path ? ` (${unknown.path}), which can't be called` : ""}</option>}
      </select>
      <span id={help} className="text-muted-foreground">
        {choices.length === 0 ? "A flow can be called when its trigger is This room: Called by another flow. Make one, and it's offered here." : "It runs with what you send, and this step gives what its last step gave."}
      </span>
    </label>
  );
}
