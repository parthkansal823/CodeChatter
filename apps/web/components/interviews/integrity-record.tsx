/** The integrity record for an interviewer: how much there is to look at, what counted, and when it happened. Evidence for a person to weigh. */
"use client";

import { INTEGRITY_LABEL, type IntegrityKind, type IntegrityLevel, type IntegrityReport } from "@codechatter/contracts";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const LEVEL_LABEL: Record<IntegrityLevel, string> = { clear: "Nothing unusual", look: "Worth a look", concern: "Concerning" };

export function IntegrityBadge({ level, className }: { level: IntegrityLevel; className?: string }) {
  return <Badge variant={level === "concern" ? "default" : "outline"} className={cn(level === "clear" && "text-muted-foreground", className)}>{LEVEL_LABEL[level]}</Badge>;
}

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function IntegrityRecord({ integrity, full = true }: { integrity: IntegrityReport; full?: boolean }) {
  const counts = Object.entries(integrity.counts) as Array<[IntegrityKind, number]>;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <IntegrityBadge level={integrity.level} />
        {counts.map(([kind, count]) => <span key={kind} className="rounded-sm border px-1.5 py-0.5 text-2xs">{INTEGRITY_LABEL[kind] ?? kind}: {count}</span>)}
        {integrity.bigEdits > 0 && <span className="rounded-sm border px-1.5 py-0.5 text-2xs">Big edits at once: {integrity.bigEdits}</span>}
      </div>
      {counts.length === 0 && integrity.bigEdits === 0 && <p className="text-muted-foreground">Nothing was recorded.</p>}
      {full && integrity.events.length > 0 && (
        <details>
          <summary className="cursor-pointer text-muted-foreground">When it happened ({integrity.events.length})</summary>
          <ol className="mt-1 grid max-h-64 gap-0.5 overflow-y-auto">
            {integrity.events.map((event) => (
              <li key={event.id} className="flex gap-2">
                <span className="shrink-0 font-mono text-muted-foreground tabular-nums">{time(event.at)}</span>
                <span className="min-w-0 break-words">
                  {INTEGRITY_LABEL[event.kind] ?? event.kind}
                  {event.length !== undefined && ` (${event.length} characters)`}
                  {event.seconds !== undefined && ` (${event.seconds} seconds)`}
                </span>
                {event.source === "server" && <span className="ml-auto shrink-0 text-2xs text-muted-foreground">Seen by the server</span>}
              </li>
            ))}
          </ol>
        </details>
      )}
      {full && <p className="text-2xs text-muted-foreground">These are signs to weigh, not proof. Most can have innocent reasons, and what the candidate&apos;s page reports could be switched off by someone determined.</p>}
    </div>
  );
}
