/**
 * Which flows may call this one (n8n's caller policy), for a flow that starts on "Called by another flow": any of the room's, or only those ticked
 * (none, with none ticked). Kept in the flow's settings as `callers`, the flows' ids; the sandbox refuses a call from any other (automation/host.mjs).
 * A flow ticked before and gone from the room is still listed, so it can be unticked.
 */
"use client";

import { useId } from "react";

import { useOtherFlows } from "./error-flow-field";
import { withSetting } from "./flow-settings";
import type { Flow } from "./model";

export function CallersSetting({ flow, fileId, canEdit, onSave }: { flow: Flow; fileId: string; canEdit: boolean; onSave: (flow: Flow) => void }) {
  const others = useOtherFlows(fileId);
  const name = useId();
  const callers = flow.settings?.callers;
  const some = callers !== undefined;
  const listed = [...others.map((other) => ({ id: other.id, name: other.name })), ...(callers ?? []).filter((id) => !others.some((other) => other.id === id)).map((id) => ({ id, name: "A flow that isn't in the room" }))];
  const choose = (id: string, on: boolean) => onSave(withSetting(flow, "callers", on ? [...(callers ?? []), id] : (callers ?? []).filter((each) => each !== id)));

  return (
    <fieldset className="grid gap-1" aria-describedby={`${name}-help`}>
      <legend className="mb-1">Which flows may call it</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <label className="flex items-center gap-1.5">
          <input type="radio" name={name} disabled={!canEdit} checked={!some} onChange={() => onSave(withSetting(flow, "callers", null))} />
          Any of the room&apos;s
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" name={name} disabled={!canEdit} checked={some} onChange={() => onSave(withSetting(flow, "callers", []))} />
          Only these
        </label>
      </div>
      {some &&
        (listed.length ? (
          <ul aria-label="Flows that may call it" className="grid gap-0.5 pl-5">
            {listed.map((other) => (
              <li key={other.id}>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" disabled={!canEdit} checked={callers.includes(other.id)} onChange={(event) => choose(other.id, event.target.checked)} />
                  <span className="truncate">{other.name}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pl-5 text-muted-foreground">The room has no other flows yet.</p>
        ))}
      <span id={`${name}-help`} className="text-muted-foreground">
        {some && !callers.length ? "No flow may call it now: tick the ones that may." : "A flow calls it with Call a flow; a flow that may not fails there, saying why."}
      </span>
    </fieldset>
  );
}
