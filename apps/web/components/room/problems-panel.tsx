"use client";

import { ChevronRight, CircleAlert, Info, TriangleAlert, X } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { openRoomFile } from "@/components/room/editor/editor-opener";
import { type Problem, type ProblemSeverity } from "@/components/room/editor/problems";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ICON = { error: CircleAlert, warning: TriangleAlert, info: Info } as const;
const TONE = { error: "text-destructive", warning: "text-warning", info: "text-info" } as const;
const LABEL = { error: "Errors", warning: "Warnings", info: "Info" } as const;

/**
 * The Problems tab: what the language servers (and TypeScript) report in the room's
 * open files, grouped by file. A filter, a switch per kind, and a click to go there.
 */
export function ProblemsPanel({ problems }: { problems: Problem[] }) {
  const [filter, setFilter] = useState("");
  const [shown, setShown] = useState<Record<ProblemSeverity, boolean>>({ error: true, warning: true, info: true });
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const filterId = useId();
  const counts = useMemo(() => {
    const c = { error: 0, warning: 0, info: 0 };
    for (const p of problems) c[p.severity] += 1;
    return c;
  }, [problems]);
  const groups = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const byFile = new Map<string, Problem[]>();
    for (const p of problems) {
      if (!shown[p.severity]) continue;
      if (query && !`${p.path} ${p.message} ${p.source ?? ""} ${p.code ?? ""}`.toLowerCase().includes(query)) continue;
      byFile.set(p.path, [...(byFile.get(p.path) ?? []), p]);
    }
    return [...byFile];
  }, [problems, filter, shown]);

  // The cursor goes to where the problem starts, as in VS Code.
  const go = (p: Problem) => openRoomFile(p.path, { startLine: p.line, startColumn: p.column, endLine: p.line, endColumn: p.column });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5 text-xs">
        <div className="flex h-7 w-60 min-w-0 items-center rounded-md border border-input bg-background has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-1 has-[input:focus-visible]:outline-ring">
          <label htmlFor={filterId} className="sr-only">
            Filter problems
          </label>
          <input
            id={filterId}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter (text, file, source)"
            type="text"
            spellCheck={false}
            autoComplete="off"
            className="h-full min-w-0 flex-1 bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground"
          />
          {filter && (
            <Button size="icon-xs" variant="ghost" aria-label="Clear the filter" className="mr-0.5" onClick={() => setFilter("")}>
              <X />
            </Button>
          )}
        </div>
        <div role="group" aria-label="Show" className="flex gap-0.5">
          {(Object.keys(LABEL) as ProblemSeverity[]).map((severity) => {
            const Icon = ICON[severity];
            return (
              <Button
                key={severity}
                size="xs"
                variant={shown[severity] ? "secondary" : "ghost"}
                aria-pressed={shown[severity]}
                aria-label={`${LABEL[severity]}: ${counts[severity]}`}
                onClick={() => setShown((s) => ({ ...s, [severity]: !s[severity] }))}
              >
                <Icon className={TONE[severity]} /> {counts[severity]}
              </Button>
            );
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1 text-xs">
        {groups.length === 0 ? (
          <p role="status" className="px-3 py-1 text-muted-foreground">
            {problems.length === 0 ? "No problems in the open files." : "No problem matches the filter."}
          </p>
        ) : (
          <ul aria-label="Problems">
            {groups.map(([path, list]) => {
              const open = !collapsed.has(path);
              const slash = path.lastIndexOf("/");
              const name = path.slice(slash + 1);
              const dir = slash === -1 ? "" : path.slice(0, slash);
              return (
                <li key={path}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() =>
                      setCollapsed((c) => {
                        const next = new Set(c);
                        if (next.has(path)) next.delete(path);
                        else next.add(path);
                        return next;
                      })
                    }
                    className="flex h-row w-full items-center gap-1 px-2 text-left hover:bg-accent"
                  >
                    <ChevronRight aria-hidden className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform duration-150", open && "rotate-90")} />
                    <span className="truncate font-medium">{name}</span>
                    {dir && <span className="truncate text-muted-foreground">{dir}</span>}
                    <span className="ml-1 min-w-5 rounded-full bg-secondary px-1.5 text-center text-2xs text-muted-foreground tabular-nums">{list.length}</span>
                  </button>
                  {open && (
                    <ul>
                      {list.map((p, i) => {
                        const Icon = ICON[p.severity];
                        return (
                          <li key={`${p.line}:${p.column}:${i}`}>
                            <button
                              type="button"
                              onClick={() => go(p)}
                              title={p.message}
                              className="flex min-h-row w-full items-start gap-1.5 py-0.5 pr-3 pl-7 text-left hover:bg-accent"
                            >
                              <Icon aria-label={p.severity} className={cn("mt-0.5 size-3.5 shrink-0", TONE[p.severity])} />
                              <span className="min-w-0 flex-1 break-words">{p.message}</span>
                              <span className="shrink-0 text-muted-foreground">
                                {[p.source, p.code].filter(Boolean).join(" ")} [{p.line}, {p.column}]
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
