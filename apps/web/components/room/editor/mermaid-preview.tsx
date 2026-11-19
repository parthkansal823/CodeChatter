/** Draw shared Mermaid files on demand, keeping the last good image visible while people fix their source. */
"use client";

import { Copy, Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

import { useMermaidDrawing } from "./use-mermaid-drawing";

type Props = { text: string; name: string; onShowLine: (line: number) => void; cacheKey?: string };

const DIAGRAM_NAMES: Record<string, string> = {
  flowchart: "Flowchart", "flowchart-v2": "Flowchart", "flowchart-elk": "Flowchart",
  sequence: "Sequence diagram", classDiagram: "Class diagram", class: "Class diagram",
  state: "State diagram", stateDiagram: "State diagram", "stateDiagram-v2": "State diagram",
  er: "Entity relationship diagram", gantt: "Gantt chart", pie: "Pie chart",
  journey: "User journey", mindmap: "Mind map", timeline: "Timeline",
  gitGraph: "Git graph", requirement: "Requirements diagram", C4: "C4 diagram",
  quadrantChart: "Quadrant chart", sankey: "Sankey diagram", xychart: "Chart",
  block: "Block diagram", packet: "Packet diagram", architecture: "Architecture diagram",
  radar: "Radar chart", treemap: "Treemap",
};

export function MermaidPreview({ text, name, onShowLine, cacheKey }: Props) {
  const [fit, setFit] = useState(true);
  const { drawing, problem, empty } = useMermaidDrawing(text, true, cacheKey);

  const download = () => {
    if (!drawing) return;
    const url = URL.createObjectURL(new Blob([drawing.svg], { type: "image/svg+xml;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name.replace(/\.(mmd|mermaid)$/i, "")}.svg`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const copy = async () => {
    if (!drawing) return;
    try {
      if (await copyText(drawing.svg)) toast.success("SVG copied");
      else toast.error("Couldn't copy the SVG. Try downloading it.");
    } catch {
      toast.error("Couldn't copy the SVG. Try downloading it.");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 overflow-x-auto border-b px-3 text-xs text-muted-foreground">
        <div role="group" aria-label="Zoom" className="flex shrink-0">
          <Button size="xs" variant={fit ? "secondary" : "ghost"} aria-pressed={fit} onClick={() => setFit(true)}>Fit</Button>
          <Button size="xs" variant={!fit ? "secondary" : "ghost"} aria-pressed={!fit} onClick={() => setFit(false)}>Actual size</Button>
        </div>
        <span role="status" className="ml-auto shrink-0">
          {empty ? "" : drawing ? DIAGRAM_NAMES[drawing.type] ?? "Diagram" : problem ? "Check the code" : "Drawing…"}
        </span>
        <Button size="xs" variant="ghost" disabled={empty || !drawing} onClick={download}><Download /> Download SVG</Button>
        <Button size="xs" variant="ghost" disabled={empty || !drawing} onClick={() => void copy()}><Copy /> Copy SVG</Button>
      </div>
      {!empty && problem && (
        <div role="alert" className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 text-xs">
          <p className="min-w-0 flex-1">{problem.line ? `Line ${problem.line}: ` : ""}{problem.message}</p>
          <Button size="xs" variant="outline" onClick={() => onShowLine(problem.line ?? 1)}>Show in the code</Button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto bg-[repeating-conic-gradient(var(--muted)_0%_25%,transparent_0%_50%)] bg-size-[16px_16px] p-4">
        {empty ? (
          <p className="text-xs text-muted-foreground">Write a diagram, for example: <code>graph TD; A--&gt;B</code></p>
        ) : drawing ? (
          // eslint-disable-next-line @next/next/no-img-element -- a safe image of the rendered source, never inline SVG
          <img
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawing.svg)}`}
            role="img"
            alt={`Diagram preview of ${name}`}
            className={cn("mx-auto block", fit ? "h-full max-h-full w-full max-w-full object-contain" : "max-w-none", problem && "opacity-40")}
          />
        ) : !problem ? (
          <p className="text-xs text-muted-foreground">Drawing the diagram…</p>
        ) : null}
      </div>
    </div>
  );
}
