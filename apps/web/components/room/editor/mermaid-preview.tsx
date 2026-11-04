/** Draw shared Mermaid files on demand, keeping the last good image visible while people fix their source. */
"use client";

import { Copy, Download } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";
import { cssVar } from "@/lib/css-color";
import { cn } from "@/lib/utils";

import { mermaidErrorLine } from "./preview-kind";

type Props = { text: string; name: string; onShowLine: (line: number) => void; cacheKey?: string };
type Problem = { message: string; line: number | null };
type Drawing = { svg: string; type: string };

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

let renderId = 0;
let renderQueue: Promise<void> = Promise.resolve();
const lastDrawings = new Map<string, Drawing>();
let cachedCharacters = 0;

function rememberDrawing(key: string, drawing: Drawing) {
  cachedCharacters -= lastDrawings.get(key)?.svg.length ?? 0;
  lastDrawings.delete(key);
  if (drawing.svg.length > 4_000_000) return;
  lastDrawings.set(key, drawing);
  cachedCharacters += drawing.svg.length;
  // Full/side mode remounts the pane. Keep its last good drawing without retaining unbounded SVG data.
  while (lastDrawings.size > 16 || cachedCharacters > 4_000_000) {
    const oldest = lastDrawings.keys().next().value;
    if (oldest === undefined) break;
    cachedCharacters -= lastDrawings.get(oldest)?.svg.length ?? 0;
    lastDrawings.delete(oldest);
  }
}

async function renderDiagram(text: string, dark: boolean, current: () => boolean) {
  const { default: mermaid } = await import("mermaid");
  // Mermaid's configuration is shared. Keep initialization and rendering together across open panes.
  const result = renderQueue.then(async () => {
    if (!current()) return null;
    const background = cssVar("--background");
    const foreground = cssVar("--foreground");
    const card = cssVar("--card");
    const muted = cssVar("--muted");
    const border = cssVar("--border");
    const brand = cssVar("--brand");
    const brandForeground = cssVar("--brand-foreground");
    // Several diagram types have their own palettes, including inverse colours that would turn orange cyan.
    const palette = [card, muted, brand];
    const chartColors: Record<string, string> = {};
    for (let index = 0; index < 12; index++) {
      const fill = palette[index % palette.length] ?? card;
      const ink = index % palette.length === 2 ? brandForeground : foreground;
      Object.assign(chartColors, {
        [`pie${index + 1}`]: fill, [`fillType${index}`]: fill,
        [`cScale${index}`]: fill, [`cScaleInv${index}`]: fill,
        [`cScalePeer${index}`]: fill, [`cScaleLabel${index}`]: ink,
      });
      if (index < 8) Object.assign(chartColors, { [`git${index}`]: fill, [`gitInv${index}`]: fill, [`gitBranchLabel${index}`]: ink });
    }
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: "base",
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      // Source directives cannot turn HTML labels or the safety limits back on or off.
      secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "maxEdges", "suppressErrorRendering", "htmlLabels", "flowchart"],
      themeVariables: {
        darkMode: dark, background, textColor: foreground, lineColor: foreground,
        primaryColor: card, primaryTextColor: foreground, primaryBorderColor: border,
        secondaryColor: muted, secondaryTextColor: foreground, secondaryBorderColor: border,
        tertiaryColor: brand, tertiaryTextColor: brandForeground, tertiaryBorderColor: brand,
        mainBkg: card, nodeBorder: border, nodeTextColor: foreground,
        clusterBkg: muted, clusterBorder: border, edgeLabelBackground: background,
        actorBkg: card, actorBorder: border, actorTextColor: foreground, actorLineColor: foreground,
        signalColor: foreground, signalTextColor: foreground,
        labelBoxBkgColor: muted, labelBoxBorderColor: border, labelTextColor: foreground,
        noteBkgColor: muted, noteBorderColor: border, noteTextColor: foreground,
        activationBkgColor: brand, activationBorderColor: brand, fontSize: "13px",
        critBkgColor: muted, critBorderColor: brand, todayLineColor: brand,
        vertLineColor: border, taskTextClickableColor: foreground,
        altSectionBkgColor: muted, excludeBkgColor: muted, gridColor: border,
        doneTaskBkgColor: muted, doneTaskBorderColor: border,
        taskBkgColor: card, taskBorderColor: border, titleColor: foreground,
        taskTextColor: foreground, taskTextDarkColor: foreground, taskTextOutsideColor: foreground,
        pieStrokeColor: border, pieOuterStrokeColor: border, branchLabelColor: foreground,
        attributeBackgroundColorOdd: card, attributeBackgroundColorEven: muted,
        archEdgeColor: foreground, archEdgeArrowColor: foreground, archGroupBorderColor: border,
        wardleyEvolutionColor: foreground,
        emProcessorFill: card, emProcessorStroke: border, emReadModelFill: muted, emReadModelStroke: border,
        emCommandFill: card, emCommandStroke: border, emEventFill: brand, emEventStroke: brand,
        cynefin: { cliffColor: border, complexBg: muted, complicatedBg: card, chaoticBg: muted, clearBg: card, confusionBg: brand },
        xyChart: { plotColorPalette: palette.join(",") },
        ...chartColors,
      },
    });
    // Layout needs a connected, measurable element. Remove it even when Mermaid rejects the source.
    const container = document.createElement("div");
    Object.assign(container.style, { position: "fixed", left: "-100000px", top: "0", visibility: "hidden" });
    container.setAttribute("aria-hidden", "true");
    document.body.appendChild(container);
    try {
      return await mermaid.render(`room-mermaid-${++renderId}`, text, container);
    } finally {
      container.remove();
    }
  });
  renderQueue = result.then(() => undefined, () => undefined);
  return result;
}

function problemOf(error: unknown, text: string): Problem {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const message = typeof record.message === "string" ? record.message : typeof record.str === "string" ? record.str : String(error);
  const hash = record.hash && typeof record.hash === "object" ? record.hash as Record<string, unknown> : {};
  const location = hash.loc && typeof hash.loc === "object" ? hash.loc as Record<string, unknown> : {};
  const reported = mermaidErrorLine(message) ?? (typeof location.first_line === "number" ? location.first_line : typeof hash.line === "number" ? hash.line + 1 : null);
  const line = reported !== null && Number.isSafeInteger(reported) && reported > 0 ? Math.min(reported, text.split("\n").length) : null;
  if (/No diagram type|UnknownDiagram/i.test(message)) return { line, message: "Start with a diagram type, for example graph TD." };
  if (/max(?:imum)?.*(?:size|edges)|too (?:large|many)/i.test(message)) return { line, message: "This diagram is too large to draw. Try fewer nodes and arrows." };
  const expected = /Expecting ([\s\S]+?),\s*got\b/i.exec(message)?.[1] ?? "";
  if (/ARROW|LINK/.test(expected)) return { line, message: "Mermaid expected an arrow or a node label here." };
  if (/SQE|PE|STOP/.test(expected)) return { line, message: "Mermaid expected a closing bracket or a node label here." };
  return { line, message: "Mermaid couldn't draw this yet. Check the diagram type, arrows and brackets." };
}

function imageSizedSvg(svg: string): string {
  // Mermaid often writes width="100%". Give the image intrinsic dimensions for Actual size.
  const root = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
  const dimensions = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const width = dimensions?.[2];
  const height = dimensions?.[3];
  if (width && height && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    root.setAttribute("width", String(width));
    root.setAttribute("height", String(height));
  }
  return new XMLSerializer().serializeToString(root);
}

export function MermaidPreview({ text, name, onShowLine, cacheKey }: Props) {
  const { resolvedTheme } = useTheme();
  const [fit, setFit] = useState(true);
  const [drawing, setDrawing] = useState<Drawing | null>(() => cacheKey ? lastDrawings.get(cacheKey) ?? null : null);
  const [failure, setFailure] = useState<{ text: string; theme: string | undefined; problem: Problem } | null>(null);
  const problem = failure?.text === text && failure.theme === resolvedTheme ? failure.problem : null;
  const empty = !text.trim();

  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      if (!text.trim()) return;
      void renderDiagram(text, resolvedTheme === "dark", () => current).then(async (result) => {
        if (!current || !result) return;
        const next = { svg: imageSizedSvg(result.svg), type: result.diagramType };
        const image = new Image();
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(next.svg)}`;
        await image.decode();
        if (!current) return;
        if (cacheKey) rememberDrawing(cacheKey, next);
        setDrawing(next);
        setFailure(null);
      }).catch((error: unknown) => {
        if (current) setFailure({ text, theme: resolvedTheme, problem: problemOf(error, text) });
      });
    }, 250);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [text, resolvedTheme, cacheKey]);

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
