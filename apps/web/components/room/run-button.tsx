"use client";

import type { TreeNode } from "@codechatter/workspace-model";
import { Globe2, Loader2, Play, Square } from "lucide-react";

import { useRoom } from "@/components/room/room-context";
import { canRunPath, useRun } from "@/components/room/run-context";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Run (orange, the one brand-coloured action in the room) and Stop while something runs. */
export function RunButton({ file, onRun, onPreview }: { file: TreeNode | null; onRun: () => void; onPreview: () => void }) {
  const { can } = useRoom();
  const run = useRun();
  // For a web page, "run" means preview it (works for viewers too: nothing executes on the server).
  if (file && /\.html?$/i.test(file.name)) {
    return (
      <Button size="sm" variant="brand" onClick={onPreview}>
        <Globe2 /> Preview
      </Button>
    );
  }
  if (!can("code.run")) return null;
  const runnable = canRunPath(file?.path);

  return (
    <div className="flex items-center gap-1">
      {run.running && (
        <Button size="sm" variant="outline" onClick={() => void run.stop()}>
          <Square className="fill-current" /> Stop
        </Button>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          {/* The span keeps the tooltip working while the button is disabled. */}
          <span tabIndex={runnable ? -1 : 0}>
            <Button size="sm" variant="brand" disabled={!runnable || run.starting} onClick={onRun}>
              {run.starting ? <Loader2 className="animate-spin" /> : <Play className="fill-current" />}
              {run.running ? "Run again" : "Run"}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {runnable ? (
            <span className="flex items-center gap-2">
              Run {file!.name} <Kbd>Ctrl Enter</Kbd>
            </span>
          ) : (
            "Open a Python, JavaScript, TypeScript, C, C++, Java or Bash file to run it, or an HTML file to preview it"
          )}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
