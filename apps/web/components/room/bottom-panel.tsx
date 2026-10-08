"use client";

import type { TreeNode } from "@codechatter/workspace-model";
import { ChevronDown, FlaskConical, Gauge, Loader2, Plus, Square, SquareTerminal, X } from "lucide-react";

import { PortsPanel } from "@/components/room/ports-panel";
import { useRoom } from "@/components/room/room-context";
import { useRun } from "@/components/room/run-context";
import { RunOutput } from "@/components/room/run-output";
import { TerminalView } from "@/components/room/terminal-view";
import { TestsPanel } from "@/components/room/tests-panel";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const MAX_TERMINALS = 4;

export type PanelTab = "output" | "tests" | "ports" | `terminal-${number}`;

/**
 * The panel under the editor: the room's shared Run output plus your
 * terminals. Every tab stays mounted while the panel is open, so switching
 * tabs never drops a terminal connection or loses output.
 */
export function BottomPanel({ tab, onTab, file, terminals, onAddTerminal, onCloseTerminal, onClose }: {
  tab: PanelTab;
  /** The open file (the Tests tab shows its test cases). */
  file: TreeNode | null;
  onTab: (tab: PanelTab) => void;
  /** Open terminal numbers (1–4); the workspace owns them so shortcuts can add one. */
  terminals: number[];
  onAddTerminal: () => void;
  onCloseTerminal: (n: number) => void;
  onClose: () => void;
}) {
  const { can } = useRoom();
  const run = useRun();
  const canTerminal = can("terminal.open");

  return (
    <section aria-label="Output and terminals" className="flex h-full min-h-0 flex-col border-t bg-background">
      <div className="flex h-8 shrink-0 items-stretch gap-1 border-b bg-chrome pr-1 pl-2">
        <div role="tablist" aria-label="Panel" className="flex min-w-0 items-stretch gap-3 overflow-x-auto overflow-y-hidden [scrollbar-width:none]">
          <PanelTabButton selected={tab === "output"} onClick={() => onTab("output")}>
            Output
            {run.running && <span aria-label="running" className="size-1.5 animate-pulse rounded-full bg-brand" />}
          </PanelTabButton>
          <PanelTabButton selected={tab === "tests"} onClick={() => onTab("tests")}>
            <FlaskConical className="size-3.5" /> Tests
          </PanelTabButton>
          <PanelTabButton selected={tab === "ports"} onClick={() => onTab("ports")}>
            <Gauge className="size-3.5" /> Ports
          </PanelTabButton>
          {terminals.map((n) => (
            <PanelTabButton key={n} selected={tab === `terminal-${n}`} onClick={() => onTab(`terminal-${n}`)} onClose={() => onCloseTerminal(n)}>
              <SquareTerminal className="size-3.5" /> Terminal {n}
            </PanelTabButton>
          ))}
          {canTerminal && terminals.length < MAX_TERMINALS && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" onClick={onAddTerminal} aria-label="New terminal" className="flex items-center self-center rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
                  <Plus className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>New terminal (Ctrl+`)</TooltipContent>
            </Tooltip>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1">
          {tab === "output" && run.running && can("code.run") && (
            <Button size="xs" variant="ghost" onClick={() => void run.stop()}>
              <Square className="fill-current" /> Stop
            </Button>
          )}
          {run.starting && <Loader2 aria-label="Starting" className="size-3.5 animate-spin text-muted-foreground" />}
          <Button size="icon-xs" variant="ghost" aria-label="Hide panel" onClick={onClose}>
            <ChevronDown />
          </Button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div className={cn("absolute inset-0", tab !== "output" && "hidden")}>
          <RunOutput />
        </div>
        <div className={cn("absolute inset-0", tab !== "tests" && "hidden")}>
          <TestsPanel file={file} />
        </div>
        <div className={cn("absolute inset-0", tab !== "ports" && "hidden")}>
          <PortsPanel visible={tab === "ports"} />
        </div>
        {terminals.map((n) => (
          <div key={n} className={cn("absolute inset-0", tab !== `terminal-${n}` && "hidden")}>
            <TerminalView n={n} />
          </div>
        ))}
      </div>
    </section>
  );
}

function PanelTabButton({ selected, onClick, onClose, children }: { selected: boolean; onClick: () => void; onClose?: () => void; children: React.ReactNode }) {
  return (
    <div className="group relative flex items-center">
      <button
        type="button"
        role="tab"
        aria-selected={selected}
        onClick={onClick}
        className={cn("flex items-center gap-1.5 text-xs font-medium whitespace-nowrap", selected ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
      >
        {children}
      </button>
      {onClose && (
        <button
          type="button"
          aria-label="Close terminal"
          onClick={onClose}
          className="ml-1 rounded-sm p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100"
        >
          <X className="size-3" />
        </button>
      )}
      {selected && <span aria-hidden className="absolute inset-x-0 -bottom-px h-[2px] bg-brand" />}
    </div>
  );
}
