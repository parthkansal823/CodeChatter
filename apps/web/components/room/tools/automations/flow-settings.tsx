/**
 * A flow's own settings, as n8n's workflow settings: how long one of its runs may take before it's stopped, the time each run saves someone, which Insights
 * adds up, its timezone (what its steps take the time to be), and which runs its trigger started are kept. Kept in the flow's file (`settings`), so they
 * go with it; only what isn't the default is written.
 */
"use client";

import { useState } from "react";

import type { Flow, FlowSettingValues } from "./model";

const LIMITS = { timeoutSeconds: [5, 900], timeSavedMinutes: [0, 1440] } as const;
type Key = keyof typeof LIMITS;
/** Every timezone this browser knows, offered as the timezone's typed. */
const ZONES: readonly string[] = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];

/** A setting as typed: a whole number within its limits, nothing (the default), or what's wrong with it. */
export function settingOf(key: Key, typed: string): { value: number | null } | { problem: string } {
  const text = typed.trim();
  if (!text) return { value: null };
  const [least, most] = LIMITS[key];
  const value = Number(text);
  if (!Number.isInteger(value)) return { problem: "A whole number." };
  if (value < least || value > most) return { problem: `From ${least} to ${most.toLocaleString("en")}.` };
  return { value };
}

/** A timezone as typed: as the list writes it (asia/kolkata is Asia/Kolkata), nothing for UTC (the default), or what's wrong with it. */
export function timezoneOf(typed: string): { value: string | null } | { problem: string } {
  const text = typed.trim();
  if (!text) return { value: null };
  if (!/^[A-Za-z0-9_+/-]{1,64}$/.test(text)) return { problem: "A timezone's name, such as Europe/London." };
  try {
    // Intl's own name for it can be an old one (Asia/Calcutta for Asia/Kolkata), so it's only asked whether it's UTC; the name kept is the list's.
    const resolved = new Intl.DateTimeFormat("en", { timeZone: text }).resolvedOptions().timeZone;
    if (resolved === "UTC" || resolved === "Etc/UTC") return { value: null };
    const same = (zone: string) => zone.toLowerCase() === text.toLowerCase();
    return { value: ZONES.find(same) ?? (same(resolved) ? resolved : text) };
  } catch {
    return { problem: "Not a timezone: try one such as Europe/London or Asia/Kolkata." };
  }
}

/** The flow with a setting changed, or taken away (null); no settings left leaves none in the file. */
export function withSetting<K extends keyof FlowSettingValues>(flow: Flow, key: K, value: FlowSettingValues[K] | null): Flow {
  const settings: FlowSettingValues = { ...(flow.settings ?? {}) };
  if (value === null || value === undefined) delete settings[key];
  else settings[key] = value;
  const next: Flow = { ...flow, settings };
  if (!Object.keys(settings).length) delete next.settings;
  return next;
}

const field = "h-7 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Setting({ flow, name, label, unit, placeholder, help, canEdit, onSave }: { flow: Flow; name: Key; label: string; unit: string; placeholder: string; help: string; canEdit: boolean; onSave: (flow: Flow) => void }) {
  const [typed, setTyped] = useState<string | null>(null);
  const shown = typed ?? (flow.settings?.[name] === undefined ? "" : String(flow.settings[name]));
  const read = settingOf(name, shown);
  return (
    <div className="grid gap-1">
      <label className="flex flex-wrap items-center gap-2">
        {label}
        <input
          type="number"
          inputMode="numeric"
          className={`${field} w-20`}
          aria-describedby={`${name}-help`}
          aria-invalid={"problem" in read}
          readOnly={!canEdit}
          placeholder={placeholder}
          value={shown}
          onChange={(event) => {
            setTyped(event.target.value);
            const next = settingOf(name, event.target.value);
            if ("value" in next) onSave(withSetting(flow, name, next.value));
          }}
          onBlur={() => setTyped(null)}
        />
        {unit}
      </label>
      <span id={`${name}-help`} className={"problem" in read ? "text-destructive" : "text-muted-foreground"}>
        {"problem" in read ? read.problem : help}
      </span>
    </div>
  );
}

function TimezoneSetting({ flow, canEdit, onSave }: { flow: Flow; canEdit: boolean; onSave: (flow: Flow) => void }) {
  const [typed, setTyped] = useState<string | null>(null);
  const shown = typed ?? flow.settings?.timezone ?? "";
  const read = timezoneOf(shown);
  return (
    <div className="grid gap-1">
      <label className="flex flex-wrap items-center gap-2">
        Its timezone
        <input
          className={`${field} w-44`}
          list="flow-timezones"
          spellCheck={false}
          autoComplete="off"
          aria-describedby="timezone-help"
          aria-invalid={"problem" in read}
          readOnly={!canEdit}
          placeholder="UTC"
          value={shown}
          onChange={(event) => {
            setTyped(event.target.value);
            const next = timezoneOf(event.target.value);
            if ("value" in next && next.value !== (flow.settings?.timezone ?? null)) onSave(withSetting(flow, "timezone", next.value));
          }}
          onBlur={() => setTyped(null)}
        />
      </label>
      <datalist id="flow-timezones">
        {ZONES.map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
      <span id="timezone-help" className={"problem" in read ? "text-destructive" : "text-muted-foreground"}>
        {"problem" in read ? read.problem : "The time its steps see, in code and dates. Empty is UTC; a schedule keeps its own."}
      </span>
    </div>
  );
}

function KeptRuns({ flow, canEdit, onSave }: { flow: Flow; canEdit: boolean; onSave: (flow: Flow) => void }) {
  const choice = (key: "saveSucceeded" | "saveFailed", label: string) => (
    <label className="flex items-center gap-1.5">
      <input type="checkbox" disabled={!canEdit} checked={flow.settings?.[key] !== false} onChange={(event) => onSave(withSetting(flow, key, event.target.checked ? null : false))} />
      {label}
    </label>
  );
  return (
    <fieldset className="grid gap-1" aria-describedby="kept-help">
      <legend className="mb-1">Keep the runs its trigger started that</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {choice("saveSucceeded", "Succeeded")}
        {choice("saveFailed", "Failed, were stopped or took too long")}
      </div>
      <span id="kept-help" className="text-muted-foreground">
        Runs by hand are always kept. One not kept still counts in Insights, and goes a minute after it ends.
      </span>
    </fieldset>
  );
}

export function FlowSettings({ flow, canEdit, onSave }: { flow: Flow; canEdit: boolean; onSave: (flow: Flow) => void }) {
  return (
    <section aria-label="Its settings" className="grid gap-2">
      <h4 className="font-medium">Settings</h4>
      <Setting flow={flow} name="timeoutSeconds" label="Stop a run after" unit="seconds" placeholder="300" help="Empty is 300 seconds; 900 at most." canEdit={canEdit} onSave={onSave} />
      <Setting flow={flow} name="timeSavedMinutes" label="Each run saves" unit="minutes" placeholder="0" help="What a run saves someone doing it by hand, for Insights: counted for runs started by the trigger that succeed." canEdit={canEdit} onSave={onSave} />
      <TimezoneSetting flow={flow} canEdit={canEdit} onSave={onSave} />
      <KeptRuns flow={flow} canEdit={canEdit} onSave={onSave} />
    </section>
  );
}
