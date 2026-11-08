/**
 * Choosing a step: the basics (code, a router, a loop), then every action of every piece, searchable by what it's called or does, as n8n's node panel is.
 * The same list chooses a trigger, or what a step becomes when it's replaced.
 */
"use client";

import type { PieceInfo } from "@codechatter/contracts";
import { ArrowLeft, Code2, GitBranch, Puzzle, Repeat, Zap } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

export type Picked = { kind: "code" } | { kind: "router" } | { kind: "loop" } | { kind: "action"; pieceName: string; actionName: string } | { kind: "trigger"; pieceName: string; triggerName: string };

const MOST_SHOWN = 80;
const words = (text: string) => text.toLowerCase().split(/\s+/).filter(Boolean);

/**
 * `mode`: "add" offers the basics and every action; "replace" only actions and code (nothing with steps inside it); "trigger" every trigger.
 */
export function StepPicker({ pieces, mode, title, onPick, onCancel }: { pieces: Record<string, PieceInfo>; mode: "add" | "replace" | "trigger"; title: string; onPick: (picked: Picked) => void; onCancel: () => void }) {
  const [search, setSearch] = useState("");
  const [pieceName, setPieceName] = useState<string | null>(null);
  const triggers = mode === "trigger";
  const stepsOf = (info: PieceInfo) => Object.entries(triggers ? info.triggers : info.actions).filter(([name]) => name !== "custom_api_call");
  const sorted = Object.entries(pieces)
    .filter(([, info]) => stepsOf(info).length > 0)
    .sort((a, b) => a[1].label.localeCompare(b[1].label));
  const wanted = words(search);
  const matches = (text: string) => wanted.every((word) => text.toLowerCase().includes(word));
  const found = wanted.length
    ? sorted.flatMap(([name, info]) => stepsOf(info).flatMap(([stepName, step]) => (matches(`${info.label} ${step.label} ${step.description}`) ? [{ pieceName: name, piece: info, stepName, step }] : [])))
    : [];
  const pickStep = (name: string, stepName: string) => onPick(triggers ? { kind: "trigger", pieceName: name, triggerName: stepName } : { kind: "action", pieceName: name, actionName: stepName });
  const open = pieceName ? pieces[pieceName] : null;
  const basics = [
    { kind: "code" as const, label: "Code", about: "JavaScript or TypeScript, in this room's sandbox", icon: Code2 },
    ...(mode === "add"
      ? [
          { kind: "router" as const, label: "Router", about: "Branches: the first that matches runs, or each that does", icon: GitBranch },
          { kind: "loop" as const, label: "Loop", about: "The same steps for each item of a list", icon: Repeat },
        ]
      : []),
  ].filter((item) => matches(`${item.label} ${item.about}`));
  const stepCount = sorted.reduce((sum, [, info]) => sum + stepsOf(info).length, 0);

  return (
    <section aria-label={title} className="grid min-h-0 content-start gap-2 text-xs">
      <div className="flex items-center gap-1">
        {open && (
          <Button size="icon-xs" variant="ghost" aria-label="Back to every service" title="Back to every service" onClick={() => setPieceName(null)}>
            <ArrowLeft />
          </Button>
        )}
        <h3 className="flex-1 text-[13px] font-medium">{open ? open.label : title}</h3>
        <Button size="xs" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <Command shouldFilter={false} className="h-auto rounded-md border" label={title}>
        <CommandInput autoFocus value={search} onValueChange={setSearch} placeholder={triggers ? `Search ${stepCount} triggers` : `Search ${stepCount} actions`} aria-label={triggers ? "Search triggers" : "Search actions"} className="h-8 text-xs" />
        <CommandList className="max-h-[min(60vh,420px)]">
          <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">Nothing matches that.</CommandEmpty>
          {!open && !triggers && basics.length > 0 && (
            <CommandGroup heading="Basics">
              {basics.map((item) => (
                <CommandItem key={item.kind} value={`basic-${item.kind}`} onSelect={() => onPick({ kind: item.kind })} className="text-xs">
                  <item.icon />
                  <span className="grid min-w-0">
                    <span>{item.label}</span>
                    <span className="truncate text-[11px] text-muted-foreground">{item.about}</span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {open ? (
            <CommandGroup heading={triggers ? "Triggers" : "Actions"}>
              {stepsOf(open)
                .filter(([, step]) => matches(`${step.label} ${step.description}`))
                .map(([stepName, step]) => (
                  <CommandItem key={stepName} value={`step-${stepName}`} onSelect={() => pickStep(pieceName!, stepName)} className="text-xs">
                    {triggers ? <Zap /> : <Puzzle />}
                    <span className="grid min-w-0">
                      <span>{step.label}</span>
                      {step.description && <span className="truncate text-[11px] text-muted-foreground">{step.description}</span>}
                    </span>
                  </CommandItem>
                ))}
            </CommandGroup>
          ) : wanted.length ? (
            <CommandGroup heading={found.length > MOST_SHOWN ? `The first ${MOST_SHOWN} of ${found.length}` : triggers ? "Triggers" : "Actions"}>
              {found.slice(0, MOST_SHOWN).map((item) => (
                <CommandItem key={`${item.pieceName}:${item.stepName}`} value={`found-${item.pieceName}-${item.stepName}`} onSelect={() => pickStep(item.pieceName, item.stepName)} className="text-xs">
                  {triggers ? <Zap /> : <Puzzle />}
                  <span className="grid min-w-0">
                    <span className="truncate">
                      {item.piece.label}: {item.step.label}
                    </span>
                    {item.step.description && <span className="truncate text-[11px] text-muted-foreground">{item.step.description}</span>}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : (
            <CommandGroup heading="Services">
              {sorted.map(([name, info]) => (
                <CommandItem key={name} value={`piece-${name}`} onSelect={() => setPieceName(name)} className="text-xs">
                  <Puzzle />
                  <span className="flex-1 truncate">{info.label}</span>
                  <span className="text-[11px] text-muted-foreground">{stepsOf(info).length}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
      {!triggers && <p className="text-muted-foreground">Services that need an account say so once added: connections and the internet for rooms come next.</p>}
    </section>
  );
}
